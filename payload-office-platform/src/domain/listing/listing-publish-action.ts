import type { PayloadRequest } from 'payload'

import { withAudit } from '@/domain/audit/with-audit'
import { runInRequestTransaction } from '@/domain/shared/transaction-safety'
import { resolveEffectiveSupply } from '@/domain/review/effective-supply-snapshot'
import {
  canTransitionPublication,
  isPublicationStatus,
  nextPublicationStatus,
  type PublicationStatus,
  type PublishAction,
} from '@/domain/review/publication-status'

/**
 * 单条房源发布动作的执行核心（OPT-113 从 listing-publish-endpoint 抽出）。
 *
 * 单条端点 `POST /api/listings/:id/publish` 与批量端点 `POST /api/listings/batch-publish`
 * 都调这一个函数：状态机、审核前置、有效供给、租售守卫、下架原因、乐观锁、审计
 * 只有一份。**鉴权不在这里**——两个端点各自按动作先过 `permissionForPublishAction`，
 * 批量端点只需鉴权一次。
 *
 * 不抛业务错误：可预期的失败一律以 `{ ok: false, status, ... }` 返回，由端点映射成 HTTP。
 * `payload.update` 自身抛的异常（钩子里的 VersionConflictError、库故障）照常抛出——
 * 单条端点交给 Payload 的统一错误处理，批量端点逐条兜住，不让一条拖垮整批。
 */

export type ListingPublishOutcome =
  | { ok: true; publicationStatus: PublicationStatus }
  | {
      ok: false
      status: 404 | 409 | 422 | 500
      error: string
      code?: string
      reasons?: string[]
    }

export type ListingPublishParams = {
  listingId: string | number
  action: PublishAction
  /** 仅 unpublish 必填；其余动作忽略 */
  reason?: unknown
  /** 显式传入时必须与库里的 version 一致，否则 409 */
  expectedVersion?: unknown
}

export async function executeListingPublishAction(
  req: PayloadRequest,
  { listingId, action, reason, expectedVersion }: ListingPublishParams,
): Promise<ListingPublishOutcome> {
  // 1. 读房源（关联展开一层以取商户/楼盘城市）
  let listing: Record<string, unknown>
  try {
    listing = (await req.payload.findByID({
      collection: 'listings',
      id: listingId,
      depth: 2,
      req,
    })) as unknown as Record<string, unknown>
  } catch {
    return { ok: false, status: 404, error: '房源不存在' }
  }

  const current = listing.publicationStatus
  if (!isPublicationStatus(current)) {
    return { ok: false, status: 409, error: '房源当前发布状态非法' }
  }

  // 2. 版本乐观锁：显式传 expectedVersion 时必须与当前一致
  if (expectedVersion !== undefined && expectedVersion !== null) {
    if (listing.version !== expectedVersion) {
      return {
        ok: false,
        status: 409,
        error: '房源版本已变更，请刷新后重试',
        code: 'VERSION_CONFLICT',
      }
    }
  }

  // 3. 发布轴状态转移合法性（leased 为终态等）
  if (!canTransitionPublication(current, action)) {
    return {
      ok: false,
      status: 409,
      error: `当前状态 ${current} 不允许 ${action}`,
      code: 'ILLEGAL_TRANSITION',
    }
  }
  const next = nextPublicationStatus(current, action)!

  // 3b. 租售错标守卫：leased / sold 都是终态，写反了状态机不给出边，谁都改不回来，
  //     而事后也分不清「已租」是真已租还是被误标的已售。动作条只按已保存的 businessType
  //     显隐成交按钮，但直调 API 绕得过界面，所以端点必须自己再挡一次。
  //     缺省（历史数据没有 businessType）按租赁处理，与动作条同口径。
  //     放在转移校验之后：终态房源应回 409「非法转移」，而不是被说成租售类型不对。
  const isSale = listing.businessType === 'sale'
  if ((action === 'mark_leased' && isSale) || (action === 'mark_sold' && !isSale)) {
    return {
      ok: false,
      status: 422,
      error: isSale
        ? '出售房源不能标记为已租，请使用「标记已售」'
        : '租赁房源不能标记为已售，请使用「标记已租」',
      code: 'BUSINESS_TYPE_MISMATCH',
    }
  }

  // 4. 动作特定前置门
  if (action === 'publish') {
    // 4a. 审核必须通过（审核通过不隐式发布，反之发布强依赖审核通过）
    if (listing.reviewStatus !== 'approved') {
      return {
        ok: false,
        status: 422,
        error: '房源审核未通过，不能发布',
        code: 'REVIEW_NOT_APPROVED',
      }
    }
    // 4b. 有效供给精筛谓词（媒体 / 关系 / 商户）——复用共享助手,与 C 端口径一致
    // 包装 req.payload 为 PayloadQueryPort（find 签名差异由适配器抹平）
    const payloadPort = {
      find: async (params: {
        collection: string
        where: Record<string, unknown>
        depth?: number
        limit?: number
        overrideAccess?: boolean
      }) => {
        const res = await req.payload.find({
          collection: params.collection as never,
          where: params.where as never,
          depth: params.depth ?? 0,
          limit: params.limit ?? 25,
          overrideAccess: params.overrideAccess ?? true,
          req,
        })
        return { docs: res.docs as unknown as Array<{ targetListing?: string | number | { id: string | number } | null }> }
      },
    }
    const supply = await resolveEffectiveSupply(payloadPort, listing, new Date())
    if (!supply.eligible) {
      return {
        ok: false,
        status: 422,
        error: '房源不满足有效供给条件',
        reasons: supply.reasons,
      }
    }
  }

  // 下架原因：弹层正文与 placeholder 都向运营承诺「会记入审计」，所以校验完不能丢，
  // 要一路带到 withAudit 落进 audit_logs.reason。只有 unpublish 强制填；
  // mark_leased / mark_sold 不收原因（弹层 requiresReason: false），审计里为 null。
  let unpublishReason: string | null = null
  if (action === 'unpublish') {
    if (typeof reason !== 'string' || reason.trim().length === 0) {
      return {
        ok: false,
        status: 422,
        error: '下架必须填写原因',
        code: 'UNPUBLISH_REASON_REQUIRED',
      }
    }
    unpublishReason = reason.trim()
  }

  // 5. 写入：只动发布轴 + 成交副作用，绝不触碰 reviewStatus
  //    M8.2 高风险动作审计：审计失败视为业务失败
  const auditAction =
    action === 'publish' ? 'listing.publish' :
    action === 'unpublish' ? 'listing.unpublish' :
    'listing.unpublish' // mark_leased / mark_sold 也归为下架类审计
  const data: Record<string, unknown> = { publicationStatus: next }
  // 调用方给了 expectedVersion（上面已与读到的 version 比对过）就把它带进写入：
  // listing-protect 会在 update 自己读到的 originalDoc 上再比一次，读与写之间若有人改过，
  // 这里抛 VersionConflictError（409），而不是带着过期判断覆盖最新状态。
  if (expectedVersion !== undefined && expectedVersion !== null) {
    data.version = listing.version
  }
  if (action === 'mark_leased' || action === 'mark_sold') {
    // 成交（已租 / 已售）自动撤销推荐——已售房源留在首页推荐位是比已租更明显的错误；收回前台可见由 publicationStatus 落终态保证。
    data.isFeatured = false
  }
  const changedFields: string[] = ['publicationStatus']
  if (action === 'mark_leased' || action === 'mark_sold') changedFields.push('isFeatured')

  // 业务写与审计写同一事务：审计写失败则发布状态一并回滚（M8.2）。
  const result = await runInRequestTransaction(req, 'listing-publish-action', () =>
    withAudit({
      req,
      action: auditAction,
      object: {
        collection: 'listings',
        objectId: listingId,
        objectVersion: typeof listing.version === 'number' ? listing.version : 1,
      },
      before: listing,
      reason: unpublishReason,
      fn: async () => {
        const updated = await req.payload.update({
          collection: 'listings',
          id: listingId,
          data,
          req,
        })
        return {
          ok: true as const,
          data: next,
          after: updated as unknown as Record<string, unknown>,
          changedFields,
        }
      },
      throwOnError: false,
    }),
  )

  if (result === null) {
    return { ok: false, status: 500, error: '发布操作失败，请重试', code: 'PUBLISH_FAILED' }
  }

  return { ok: true, publicationStatus: result }
}
