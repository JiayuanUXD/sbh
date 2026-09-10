import type { Endpoint } from 'payload'

import { requireOperationPermission, type RequestContext } from '@/domain/auth/access'
import { withAudit } from '@/domain/audit/with-audit'
import { permissionForPublishAction } from '@/domain/listing/publication-actions'
import { resolveEffectiveSupply } from '@/domain/review/effective-supply-snapshot'
import {
  canTransitionPublication,
  isPublicationStatus,
  isPublishAction,
  nextPublicationStatus,
} from '@/domain/review/publication-status'

/**
 * 房源显式发布 endpoint（tasks.md M4.6「实现显式发布动作」/ R4, R8）
 *
 * POST /api/listings/:id/publish  body { action, reason?, expectedVersion? }
 *   action ∈ publish | unpublish | mark_leased | mark_sold
 *
 * 语义（design §3.4 / M4 验收门）：
 *   - 发布轴独立于审核轴。本端点**只动 publicationStatus / isFeatured**，绝不写 reviewStatus。
 *   - publish 前置：reviewStatus 必须 approved 且有效供给精筛谓词通过
 *     （媒体≥3 §6、商户关系在有效期 §8、商户合格 §9-§10）；否则 422 并回显 reasons，不改状态。
 *   - unpublish 必须填写下架原因，否则 422；原因 trim 后随审计写入 audit_logs.reason
 *     （弹层向运营承诺「会记入审计」，这里是兑现点）。
 *   - mark_leased 自动撤销推荐（isFeatured=false）并收回前台可见（发布轴落 leased）。
 *   - mark_sold 同 mark_leased（撤销推荐 + 收回可见，落 sold）。
 *   - mark_leased 只允许租赁房源、mark_sold 只允许出售房源（businessType 缺省按租赁）；
 *     写反是不可逆的（成交是终态），所以界面之外这里也挡一次 → 422 BUSINESS_TYPE_MISMATCH。
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
 *   - 422: 发布前置不满足 / 下架缺原因 / 租售类型与成交动作不符（BUSINESS_TYPE_MISMATCH）
 */

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
        // 权限口径与动作条（ListingPublicationActionsClient）共用同一个纯函数：
        // 端点是唯一强制点，界面只用它决定按钮显隐，两处不再各写一份 if。
        await requireOperationPermission(req as RequestContext, permissionForPublishAction(action))
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

      // 6b. 租售错标守卫：leased / sold 都是终态，写反了状态机不给出边，谁都改不回来，
      //     而事后也分不清「已租」是真已租还是被误标的已售。动作条只按已保存的 businessType
      //     显隐成交按钮，但直调 API 绕得过界面，所以端点必须自己再挡一次。
      //     缺省（历史数据没有 businessType）按租赁处理，与动作条同口径。
      //     放在转移校验之后：终态房源应回 409「非法转移」，而不是被说成租售类型不对。
      const isSale = listing.businessType === 'sale'
      if ((action === 'mark_leased' && isSale) || (action === 'mark_sold' && !isSale)) {
        return Response.json(
          {
            ok: false,
            error: isSale
              ? '出售房源不能标记为已租，请使用「标记已售」'
              : '租赁房源不能标记为已售，请使用「标记已租」',
            code: 'BUSINESS_TYPE_MISMATCH',
          },
          { status: 422 },
        )
      }

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

      // 下架原因：弹层正文与 placeholder 都向运营承诺「会记入审计」，所以校验完不能丢，
      // 要一路带到 withAudit 落进 audit_logs.reason。只有 unpublish 强制填；
      // mark_leased / mark_sold 不收原因（弹层 requiresReason: false），审计里为 null。
      let unpublishReason: string | null = null
      if (action === 'unpublish') {
        const reason = body.reason
        if (typeof reason !== 'string' || reason.trim().length === 0) {
          return Response.json(
            { ok: false, error: '下架必须填写原因', code: 'UNPUBLISH_REASON_REQUIRED' },
            { status: 422 },
          )
        }
        unpublishReason = reason.trim()
      }

      // 8. 写入：只动发布轴 + 成交副作用，绝不触碰 reviewStatus
      //    M8.2 高风险动作审计：审计失败视为业务失败
      const auditAction =
        action === 'publish' ? 'listing.publish' :
        action === 'unpublish' ? 'listing.unpublish' :
        'listing.unpublish' // mark_leased / mark_sold 也归为下架类审计
      const data: Record<string, unknown> = { publicationStatus: next }
      if (action === 'mark_leased' || action === 'mark_sold') {
        // 成交（已租 / 已售）自动撤销推荐——已售房源留在首页推荐位是比已租更明显的错误；收回前台可见由 publicationStatus 落终态保证。
        data.isFeatured = false
      }
      const changedFields: string[] = ['publicationStatus']
      if (action === 'mark_leased' || action === 'mark_sold') changedFields.push('isFeatured')

      const result = await withAudit({
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
      })

      if (result === null) {
        return Response.json(
          { ok: false, error: '发布操作失败，请重试', code: 'PUBLISH_FAILED' },
          { status: 500 },
        )
      }

      return Response.json({ ok: true, publicationStatus: result })
    },
  }
}
