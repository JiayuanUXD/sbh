import type { Endpoint } from 'payload'

import { requireOperationPermission, type RequestContext } from '@/domain/auth/access'
import { resolveEffectiveSupply } from '@/domain/review/effective-supply-snapshot'
import {
  canTransitionPublication,
  isPublicationStatus,
  isPublishAction,
  nextPublicationStatus,
  type PublishAction,
} from '@/domain/review/publication-status'

/**
 * 房源显式发布 endpoint（tasks.md M4.6「实现显式发布动作」/ R4, R8）
 *
 * POST /api/listings/:id/publish  body { action, reason?, expectedVersion? }
 *   action ∈ publish | unpublish | mark_leased
 *
 * 语义（design §3.4 / M4 验收门）：
 *   - 发布轴独立于审核轴。本端点**只动 publicationStatus / isFeatured**，绝不写 reviewStatus。
 *   - publish 前置：reviewStatus 必须 approved 且有效供给精筛谓词通过
 *     （媒体≥3 §6、商户关系在有效期 §8、商户合格 §9-§10）；否则 422 并回显 reasons，不改状态。
 *   - unpublish 必须填写下架原因，否则 422。
 *   - mark_leased 自动撤销推荐（isFeatured=false）并收回前台可见（发布轴落 leased）。
 *   - 非法发布转移（如 leased 再 publish）→ 409。
 *   - 版本乐观锁：expectedVersion 与当前 version 不符 → 409，不 update。
 *
 * 审计经 auditFieldsPlugin：透传 req 让 payload.update 记录 lastModifiedBy。
 *
 * 响应：
 *   - 200: { ok: true, publicationStatus }（翻转后的新值）
 *   - 400: 缺少房源 ID / 非法 action
 *   - 401: 未登录  403: 无对应发布权限
 *   - 404: 房源不存在
 *   - 409: 非法状态转移 / 版本冲突
 *   - 422: 发布前置不满足 / 下架缺原因
 */

/** publish/mark_leased 需要 listing:publish；unpublish 需要 listing:unpublish。 */
function permissionForAction(action: PublishAction): string {
  return action === 'unpublish' ? 'listing:unpublish' : 'listing:publish'
}

export function createListingPublishEndpoint(): Endpoint {
  return {
    // 注册在 Listings collection 的 endpoints 上 → 实际路径 /api/listings/:id/publish。
    path: '/:id/publish',
    method: 'post',
    handler: async (req) => {
      // 1. 取 body（action 决定所需权限，须先解析）
      const body = ((req as unknown as { data?: unknown }).data ??
        (typeof req.json === 'function' ? await req.json() : {})) as Record<string, unknown>
      const action = body.action
      if (!isPublishAction(action)) {
        return Response.json({ ok: false, error: '非法发布动作' }, { status: 400 })
      }

      // 2. 鉴权：按动作区分 publish / unpublish 权限
      try {
        await requireOperationPermission(req as RequestContext, permissionForAction(action))
      } catch (err) {
        const message = err instanceof Error ? err.message : '权限不足'
        const status = message.includes('未登录') ? 401 : 403
        return Response.json({ ok: false, error: message }, { status })
      }

      // 3. 房源 ID
      const rawId = (req.routeParams as Record<string, unknown> | undefined)?.id
      const listingId = typeof rawId === 'string' || typeof rawId === 'number' ? rawId : undefined
      if (listingId === undefined || listingId === '') {
        return Response.json({ ok: false, error: '缺少房源 ID' }, { status: 400 })
      }

      // 4. 读房源（关联展开一层以取商户/楼盘城市）
      let listing: Record<string, unknown>
      try {
        listing = (await req.payload.findByID({
          collection: 'listings',
          id: listingId,
          depth: 2,
          req,
        })) as unknown as Record<string, unknown>
      } catch {
        return Response.json({ ok: false, error: '房源不存在' }, { status: 404 })
      }

      const current = listing.publicationStatus
      if (!isPublicationStatus(current)) {
        return Response.json(
          { ok: false, error: '房源当前发布状态非法' },
          { status: 409 },
        )
      }

      // 5. 版本乐观锁：显式传 expectedVersion 时必须与当前一致
      const expectedVersion = body.expectedVersion
      if (expectedVersion !== undefined && expectedVersion !== null) {
        if (listing.version !== expectedVersion) {
          return Response.json(
            { ok: false, error: '房源版本已变更，请刷新后重试', code: 'VERSION_CONFLICT' },
            { status: 409 },
          )
        }
      }

      // 6. 发布轴状态转移合法性（leased 为终态等）
      if (!canTransitionPublication(current, action)) {
        return Response.json(
          { ok: false, error: `当前状态 ${current} 不允许 ${action}`, code: 'ILLEGAL_TRANSITION' },
          { status: 409 },
        )
      }
      const next = nextPublicationStatus(current, action)!

      // 7. 动作特定前置门
      if (action === 'publish') {
        // 7a. 审核必须通过（审核通过不隐式发布，反之发布强依赖审核通过）
        if (listing.reviewStatus !== 'approved') {
          return Response.json(
            { ok: false, error: '房源审核未通过，不能发布', code: 'REVIEW_NOT_APPROVED' },
            { status: 422 },
          )
        }
        // 7b. 有效供给精筛谓词（媒体 / 关系 / 商户）——复用共享助手,与 C 端口径一致
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
          return Response.json(
            { ok: false, error: '房源不满足有效供给条件', reasons: supply.reasons },
            { status: 422 },
          )
        }
      }

      if (action === 'unpublish') {
        const reason = body.reason
        if (typeof reason !== 'string' || reason.trim().length === 0) {
          return Response.json(
            { ok: false, error: '下架必须填写原因', code: 'UNPUBLISH_REASON_REQUIRED' },
            { status: 422 },
          )
        }
      }

      // 8. 写入：只动发布轴 + 成交副作用，绝不触碰 reviewStatus
      const data: Record<string, unknown> = { publicationStatus: next }
      if (action === 'mark_leased') {
        // 已租自动撤销推荐（收回前台可见由 publicationStatus=leased 保证）
        data.isFeatured = false
      }
      await req.payload.update({
        collection: 'listings',
        id: listingId,
        data,
        req, // 透传 req → auditFieldsPlugin 记录 lastModifiedBy
      })

      return Response.json({ ok: true, publicationStatus: next })
    },
  }
}
