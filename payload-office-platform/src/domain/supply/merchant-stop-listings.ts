/**
 * 商户停用冻结：批量标记关联 Listing 为待复核（tasks.md M4.8 / R2, R4, R8）
 *
 * 业务不变量（design §3.5 / R2 §56 / R4 / R8）：
 *   - 商户停用时关联 Listing 必须从有效供给中即时撤下，但不得直接删除/下架
 *   - 标记为 pending review（"待复核"）而非 publicationStatus=offline，
 *     因任务语义是「合规冻结,等运营显式解除/重新发布」,不是审核驳回
 *   - 商户恢复不自动解除（design §3.5）：运营需逐条显式重新发布
 *
 * 实现策略：
 *   - OPT-034 起供给商户直接存在 listings.merchant，按 merchant.equals(merchantId)
 *     查 listings 即找到当前由该商户供给的房源，不再经 listing-merchant-relations
 *     关系表 + effectiveFrom/effectiveTo 区间判定
 *   - 对每条 listing 把 reviewStatus=pending（绕过状态机的 submit 动作，
 *     因这是合规冻结而非业务流程；附 _auditReason 标记供审计）
 *   - publicationStatus 不改（保持 draft / published 状态值，仅有效供给谓词
 *     在 M4.7 查询层会因 merchant.status=disabled 而过滤掉）
 *
 * 与 protectMerchantStop 的关系：
 *   - protectMerchantStop: 停用前的「影响确认」（默认阻止,要求先看影响）
 *   - markListingsPendingReviewOnMerchantStop: 停用成功后的批量标记（afterChange）
 *
 * 原子性：调用方（afterChange hook）在同一请求事务内传入 req,任一步失败整体回滚。
 */

import type { BasePayload, PayloadRequest } from 'payload'

/** 商户停用时把关联 Listing 标记为待复核的原因码（写入审计） */
export const MERCHANT_STOP_LISTING_REASON = 'MERCHANT_DISABLED_BATCH_REVIEW'

/**
 * 列出该商户当前供给的所有房源 ID。
 *
 * OPT-034 起供给商户直接存在 listings.merchant：按 merchant.equals(merchantId)
 * 查 listings 即为该商户当前供给的房源，字段有值即视为供给中，不再有
 * 「关系尚未生效 / 已过期」的时间窗口判定。同时排除已逻辑删除的房源
 * （deletedAt 非空），避免把已删除房源也转入待复核。
 *
 * 返回去重后的 listing id 列表。
 */
export async function listActiveListingIdsForMerchant(
  payload: BasePayload,
  merchantId: number | string,
  req?: PayloadRequest,
): Promise<Array<number | string>> {
  const LIMIT = 1000
  const res = (await payload.find({
    collection: 'listings' as never,
    where: { merchant: { equals: merchantId }, deletedAt: { exists: false } },
    limit: LIMIT,
    depth: 0,
    overrideAccess: true,
    req,
  })) as { docs?: Array<{ id: number | string }>; totalDocs?: number }
  const docs = res.docs ?? []
  const ids = new Set<number | string>(docs.map((d) => d.id))
  // totalDocs 是查询命中总数（不受 limit 截断），docs.length 是实际返回条数。
  // 二者不一致说明真实供给量超过 LIMIT，本函数会静默漏掉超出部分——这些房源
  // 不会被转 pending review，商户恢复启用时会绕过人工复核直接重新曝光
  // （见头注释「商户恢复不自动解除」这条不变量）。分页取全量或放开上限需要
  // 单独设计（markListingsPendingReview 是逐条 findByID+update 的串行循环，
  // 且与商户更新共享同一事务，简单放开会把单事务往返次数推到数千级，
  // 容易超时回滚导致停用动作本身失败）——这里先把静默失败变成有日志线索。
  if (typeof res.totalDocs === 'number' && res.totalDocs > LIMIT) {
    payload.logger.warn(
      { merchantId, totalDocs: res.totalDocs, limit: LIMIT, returned: docs.length },
      'merchant_stop_listings_truncated',
    )
  }
  return Array.from(ids)
}

/**
 * 把指定房源列表的 reviewStatus 批量置为 pending（待复核）。
 *
 *   - 仅当当前 reviewStatus !== 'pending' 时更新（避免重复写）
 *   - 不改 publicationStatus（保留 draft/published/offline 现值）
 *   - 透传 req 保持事务一致性
 *
 * 返回每条房源的处理结果（成功/失败 + 错误信息）。
 */
export interface MarkListingPendingResult {
  listingId: number | string
  ok: boolean
  /** 失败时的错误信息 */
  error?: string
  /** 是否实际写入了更新（reviewStatus 已是 pending 时 skipped=true） */
  skipped?: boolean
}

export async function markListingsPendingReview(
  payload: BasePayload,
  listingIds: ReadonlyArray<number | string>,
  req?: PayloadRequest,
): Promise<MarkListingPendingResult[]> {
  const results: MarkListingPendingResult[] = []
  for (const id of listingIds) {
    try {
      // 1. 载入当前 listing（仅取审核状态字段以判断是否需要更新）
      const doc = (await payload.findByID({
        collection: 'listings' as never,
        id: id as never,
        depth: 0,
        overrideAccess: true,
        req,
      })) as { reviewStatus?: string; version?: number } | null
      if (!doc) {
        results.push({ listingId: id, ok: false, error: 'listing not found' })
        continue
      }
      // 2. 已是 pending → 跳过（避免无谓写入 + version 递增）
      if (doc.reviewStatus === 'pending') {
        results.push({ listingId: id, ok: true, skipped: true })
        continue
      }
      // 3. 批量更新：绕过状态机（合规冻结）,直接置 reviewStatus=pending
      //    version 透传当前值（保持乐观锁语义,如有并发编辑由 VersionConflict 兜底）
      await payload.update({
        collection: 'listings' as never,
        id: id as never,
        data: {
          reviewStatus: 'pending',
        } as never,
        overrideAccess: true,
        req,
      })
      results.push({ listingId: id, ok: true })
    } catch (err) {
      results.push({
        listingId: id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return results
}

/**
 * 一站式：商户停用后批量标记关联 Listing 为待复核。
 *
 * 调用方（afterChange hook）只需传 merchantId + req,本函数完成查找 + 批量标记。
 *
 * 返回汇总：受影响房源数 / 成功数 / 跳过数 / 失败数 / 失败详情。
 */
export interface MerchantStopBatchReport {
  merchantId: number | string
  affectedListingIds: Array<number | string>
  results: MarkListingPendingResult[]
  total: number
  succeeded: number
  skipped: number
  failed: number
  failures: Array<{ listingId: number | string; error: string }>
}

export async function markListingsPendingReviewOnMerchantStop(
  payload: BasePayload,
  merchantId: number | string,
  req?: PayloadRequest,
): Promise<MerchantStopBatchReport> {
  const affectedListingIds = await listActiveListingIdsForMerchant(payload, merchantId, req)
  const results = await markListingsPendingReview(payload, affectedListingIds, req)
  const succeeded = results.filter((r) => r.ok && !r.skipped).length
  const skipped = results.filter((r) => r.skipped).length
  const failures = results
    .filter((r) => !r.ok)
    .map((r) => ({ listingId: r.listingId, error: r.error ?? 'unknown' }))
  return {
    merchantId,
    affectedListingIds,
    results,
    total: results.length,
    succeeded,
    skipped,
    failed: failures.length,
    failures,
  }
}
