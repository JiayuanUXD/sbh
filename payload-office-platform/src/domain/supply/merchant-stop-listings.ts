/**
 * 商户停用冻结：批量标记关联 Listing 为待复核（tasks.md M4.8 / R2, R4, R8）
 *
 * 业务不变量（design §3.5 / R2 §56 / R4 / R8）：
 *   - 商户停用时关联 Listing 必须从有效供给中即时撤下，但不得直接删除/下架
 *   - 标记为 pending review（「待复核」）而非 publicationStatus=offline，
 *     因任务语义是「合规冻结，等运营显式解除/重新发布」，不是审核驳回
 *   - 商户恢复不自动解除（design §3.5）：运营需逐条显式重新发布
 *
 * ## 为什么走 jobs 队列，而不是留在 afterChange 里内联跑
 *
 * 原实现在商户更新的同一事务里用 limit: 1000 取一次房源，然后逐条
 * findByID + update。生产实测商户「官网」名下 2161 条房源：超出 1000 的
 * 1161 条被静默跳过，既无日志也无报错。
 *
 * 被跳过的房源**不会**在停用期间继续曝光 —— supply-adapter.ts 的
 * findEffectiveListingsByBuilding / sumEffectiveLeasableAreaByBuildings
 * 两处原始 SQL 都带 m.status = 'active'，停用商户的房源整体被挡在前台外。
 * 真正被破坏的是上面第三条不变量：这 1161 条 reviewStatus 仍是 approved，
 * **商户恢复启用的瞬间会自动重新曝光，绕过人工复核**。这是合规风险。
 *
 * 简单放开 limit 取全量不可行：2161 条 × (findByID + update) ≈ 4300 次往返
 * 全挤在商户更新的同一个事务里，很容易超时回滚，导致「停用商户」这个动作
 * 本身失败 —— 那比静默跳过更糟。所以改成：
 *   - afterChange 只 enqueue 一个 job（透传 req，与商户更新同事务：
 *     停用回滚则 job 行一并回滚，不留孤儿任务）
 *   - job 用游标分页遍历全量，**不设上限**
 *   - 写侧每条房源各自独立事务，理由见 markListingsPendingReview 的注释
 *
 * ## 异步化引入的语义取舍（都是有意的，别当 bug 修回去）
 *
 *   - **停用与冻结不再原子**：停用先提交，冻结随后跑完。可接受，因为前台
 *     曝光由 merchant.status 直接挡住，本来就不依赖 reviewStatus。
 *   - **job 跑完前商户被重新启用：不中止，照样跑完。** 停用事件即冻结事件。
 *     中途中止会留下「一半 pending 一半 approved」的半吊子状态，而那正是
 *     「恢复不自动解除」这条不变量要防的东西。
 *   - **幂等**：已是 pending 的房源跳过；job 重试从头扫也不会重复写。
 *
 * 与 protectMerchantStop 的关系：
 *   - protectMerchantStop: 停用前的「影响确认」（有有效楼盘关系时阻止停用）
 *   - 本模块: 停用成功后的批量冻结（afterChange enqueue → job 执行）
 */

import type { BasePayload, PayloadRequest, TaskConfig } from 'payload'
import { assertTransactionIntact } from '@/domain/shared/transaction-safety'

/** 商户停用时把关联 Listing 标记为待复核的原因码（写入审计） */
export const MERCHANT_STOP_LISTING_REASON = 'MERCHANT_DISABLED_BATCH_REVIEW'

export const MERCHANT_STOP_CASCADE_TASK = 'cascade-merchant-stop-listings'
export const MERCHANT_STOP_CASCADE_QUEUE = 'merchant-stop-cascade'

/**
 * 游标分页每页条数。只决定取数往返次数，**不决定事务边界**
 * （写侧是逐条独立事务），所以调大调小都不会带回超时回滚的风险。
 */
export const MERCHANT_STOP_CASCADE_PAGE_SIZE = 200

/** 报告里最多保留多少条失败详情，避免 job output 与日志被打爆 */
const MAX_REPORTED_FAILURES = 50

/** job input 是 text（Payload inputSchema 限制），这里还原成查询用的 id 类型 */
function normalizeMerchantId(raw: string): number | string {
  return /^\d+$/.test(raw) ? Number(raw) : raw
}

/** 游标是否严格前进；不前进说明 sort/where 被改坏，宁可报错也不要空转 */
function cursorAdvanced(prev: number | string, next: number | string): boolean {
  const prevNum = Number(prev)
  const nextNum = Number(next)
  if (Number.isFinite(prevNum) && Number.isFinite(nextNum)) return nextNum > prevNum
  return String(next) > String(prev)
}

export interface MerchantListingPage {
  ids: Array<number | string>
  /** 下一页游标（本页最后一条的 id）；null 表示已到末页 */
  nextCursor: number | string | null
}

/**
 * 按 id 游标取该商户供给的一页房源。
 *
 * OPT-034 起供给商户直接存在 listings.merchant：字段有值即视为供给中，
 * 不再有「关系尚未生效 / 已过期」的时间窗口判定。同时排除已逻辑删除的房源
 * （deletedAt 非空），避免把已删除房源也转入待复核。
 *
 * 用 id > cursor 游标而非 page/offset：本级联只改 reviewStatus，而
 * reviewStatus 不在 where 谓词里，结果集在遍历期间稳定；游标还能避免
 * 深翻页时 offset 逐页变慢。
 */
export async function findMerchantListingPage(
  payload: BasePayload,
  merchantId: number | string,
  options: { after?: number | string | null; limit?: number; req?: PayloadRequest } = {},
): Promise<MerchantListingPage> {
  const limit = options.limit ?? MERCHANT_STOP_CASCADE_PAGE_SIZE
  const after = options.after ?? null
  const res = (await payload.find({
    collection: 'listings' as never,
    where: {
      merchant: { equals: merchantId },
      deletedAt: { exists: false },
      ...(after === null ? {} : { id: { greater_than: after } }),
    },
    sort: 'id',
    limit,
    depth: 0,
    overrideAccess: true,
    req: options.req,
  })) as { docs?: Array<{ id: number | string }> }
  const docs = res.docs ?? []
  const ids = docs.map((d) => d.id)
  return {
    ids,
    // 不足一页说明已到末页；正好一页则再取一次（下一页返回空自然收敛）
    nextCursor: ids.length < limit ? null : ids[ids.length - 1],
  }
}

/**
 * 把指定房源列表的 reviewStatus 批量置为 pending（待复核）。
 *
 *   - 仅当当前 reviewStatus !== 'pending' 时更新（避免重复写）
 *   - 不改 publicationStatus（保留 draft/published/offline 现值）
 *
 * ## req 传不传，是 load-bearing 的
 *
 * 级联在 job 里跑时**故意不传 req**：不传 req 时 Payload 为每次 update
 * 各开一个事务，于是
 *   1. 单条房源失败不会污染其它房源 —— PG 事务一旦报错，同事务内后续语句
 *      全部拒绝执行（current transaction is aborted）。共享事务下一条坏
 *      房源会废掉整批，且 job 重试永远卡在同一条上，等于把「静默跳过」换成
 *      「静默停摆」；
 *   2. 事务短，不会把几千次往返攒在一个长事务里超时回滚。
 *
 * 所以别「顺手」把 job handler 的 req 透传进来 —— 那会一次性把上面两条
 * 都退回去。req 参数保留是给同步调用方（以及单测）用的。
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
  // 本函数跑在商户停用那笔事务里（Merchants 的 afterChange）。逐条兜底不能吞掉
  // 「事务被拆」——Payload 每个 operation 的 catch 都会 killTransaction(req)，
  // 一旦被拆，商户自己那条 status=disabled 也不会落库，而调用方还看到「停用成功」。
  // 详见 domain/shared/transaction-safety.ts。
  const transactionId = req?.transactionID
  for (const id of listingIds) {
    try {
      // 1. 载入当前 listing（仅取审核状态字段以判断是否需要更新）
      //    disableErrors：查不到时 Payload 早于 catch 就 return null，不会拆事务
      const doc = (await payload.findByID({
        collection: 'listings' as never,
        id: id as never,
        depth: 0,
        overrideAccess: true,
        disableErrors: true,
        req,
      })) as { reviewStatus?: string; version?: number } | null
      if (!doc) {
        results.push({ listingId: id, ok: false, error: 'listing not found' })
        continue
      }
      // 2. 已是 pending → 跳过（避免无谓写入 + version 递增），也是重试幂等的支点
      if (doc.reviewStatus === 'pending') {
        results.push({ listingId: id, ok: true, skipped: true })
        continue
      }
      // 3. 批量更新：绕过状态机（合规冻结），直接置 reviewStatus=pending
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
      // 单条失败可以吞（这是止血批处理，不该因为一条房源就整体失败）；
      // 但事务被拆掉不能吞，否则商户停用本身会静默丢失。
      assertTransactionIntact(req, transactionId, 'merchant-stop-listings')
      results.push({
        listingId: id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return results
}

export interface MerchantStopCascadeReport {
  merchantId: number | string
  /** 实际遍历到的房源总数（游标遍历全量，不再有 limit 截断） */
  total: number
  succeeded: number
  skipped: number
  failed: number
  pages: number
  /** 最多 MAX_REPORTED_FAILURES 条 */
  failures: Array<{ listingId: number | string; error: string }>
}

/**
 * 游标遍历该商户名下全部房源，逐条转为待复核。
 *
 * 取数分页、写入逐条独立事务；任何一条失败都记进 report 并继续遍历，
 * 由调用方（job handler）决定是否据此让 job 失败重试。
 */
export async function cascadeMerchantStopListings(
  payload: BasePayload,
  merchantId: number | string,
  options: { pageSize?: number } = {},
): Promise<MerchantStopCascadeReport> {
  const pageSize = options.pageSize ?? MERCHANT_STOP_CASCADE_PAGE_SIZE
  let cursor: number | string | null = null
  let pages = 0
  let total = 0
  let succeeded = 0
  let skipped = 0
  let failed = 0
  const failures: Array<{ listingId: number | string; error: string }> = []

  for (;;) {
    const page = await findMerchantListingPage(payload, merchantId, {
      after: cursor,
      limit: pageSize,
    })
    if (page.ids.length === 0) break
    pages += 1
    total += page.ids.length

    // 不透传 req：每条 update 各自开事务，见 markListingsPendingReview 的注释
    const results = await markListingsPendingReview(payload, page.ids)
    for (const result of results) {
      if (!result.ok) {
        failed += 1
        if (failures.length < MAX_REPORTED_FAILURES) {
          failures.push({ listingId: result.listingId, error: result.error ?? 'unknown' })
        }
      } else if (result.skipped) {
        skipped += 1
      } else {
        succeeded += 1
      }
    }

    if (page.nextCursor === null) break
    if (cursor !== null && !cursorAdvanced(cursor, page.nextCursor)) {
      throw new Error('merchant_stop_cascade_cursor_stalled')
    }
    cursor = page.nextCursor
  }

  payload.logger?.info?.(
    { merchantId, total, succeeded, skipped, failed, pages },
    'merchant_stop_cascade_completed',
  )

  return { merchantId, total, succeeded, skipped, failed, pages, failures }
}

/**
 * 商户停用后把冻结级联投递到队列。
 *
 * 透传 req：job 行与商户状态变更同事务落库，停用回滚则任务一并消失。
 */
export async function enqueueMerchantStopCascade(
  req: PayloadRequest,
  merchantId: number | string,
): Promise<void> {
  await req.payload.jobs.queue({
    task: MERCHANT_STOP_CASCADE_TASK as never,
    queue: MERCHANT_STOP_CASCADE_QUEUE,
    input: { merchantId: String(merchantId) } as never,
    overrideAccess: true,
    req,
  })
}

type MerchantStopCascadeTaskShape = {
  input: { merchantId: string }
  output: { total: number; succeeded: number; skipped: number; failed: number }
}

export const merchantStopCascadeTask: TaskConfig<MerchantStopCascadeTaskShape> = {
  slug: MERCHANT_STOP_CASCADE_TASK,
  label: '商户停用冻结房源',
  inputSchema: [{ name: 'merchantId', type: 'text', required: true }],
  outputSchema: [
    { name: 'total', type: 'number', required: true },
    { name: 'succeeded', type: 'number', required: true },
    { name: 'skipped', type: 'number', required: true },
    { name: 'failed', type: 'number', required: true },
  ],
  retries: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 10_000 },
  },
  handler: async ({ input, req }) => {
    const report = await cascadeMerchantStopListings(
      req.payload,
      normalizeMerchantId(input.merchantId),
    )
    if (report.failed > 0) {
      // 停用早已提交，这里抛错不会阻断停用动作，只是让失败在 payload_jobs 里
      // 可见并触发重试；重试幂等（已 pending 的房源会被跳过）。
      // 同步实现时代不敢抛（会连累停用回滚），异步之后抛错是免费的。
      throw new Error(
        `merchant_stop_cascade_partial_failure merchant=${input.merchantId} ` +
          `total=${report.total} failed=${report.failed} ` +
          `sample=${JSON.stringify(report.failures.slice(0, 5))}`,
      )
    }
    return {
      output: {
        total: report.total,
        succeeded: report.succeeded,
        skipped: report.skipped,
        failed: report.failed,
      },
    }
  },
}
