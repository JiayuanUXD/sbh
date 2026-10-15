import type { Endpoint } from 'payload'

import { requireOperationPermission, type RequestContext } from '@/domain/auth/access'
import { executeListingPublishAction } from '@/domain/listing/listing-publish-action'
import { permissionForPublishAction } from '@/domain/listing/publication-actions'
import { isPublishAction } from '@/domain/review/publication-status'

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
 * OPT-113：第 4 步之后的执行逻辑抽到 `domain/listing/listing-publish-action.ts`，
 * 与批量端点 `listing-batch-publish-endpoint.ts` 共用；本文件只剩取参、鉴权与 HTTP 映射。
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

      // 4. 执行：状态机 / 前置门 / 乐观锁 / 审计全在共享核心里（批量端点同调这一个函数）
      const outcome = await executeListingPublishAction(req, {
        listingId,
        action,
        reason: body.reason,
        expectedVersion: body.expectedVersion,
      })
      if (!outcome.ok) {
        const { status, ...rest } = outcome
        return Response.json(rest, { status })
      }

      return Response.json({ ok: true, publicationStatus: outcome.publicationStatus })
    },
  }
}
