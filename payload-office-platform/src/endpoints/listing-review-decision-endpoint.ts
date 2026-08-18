import type { Endpoint } from 'payload'

import { requireOperationPermission, type RequestContext } from '@/domain/auth/access'
import { withAudit } from '@/domain/audit/with-audit'
import { checkListingCompleteness } from '@/domain/review/listing-completeness'
import {
  canTransitionReview,
  isReviewDecision,
  nextReviewStatus,
} from '@/domain/review/review-status'
import {
  assertReasonForDecision,
  buildListingSnapshot,
  computeSnapshotHash,
  taskStatusForDecision,
} from '@/domain/review/review-transition'
import { InvalidOperationError } from '@/domain/shared/errors'

/**
 * 房源审核决策 endpoint（tasks.md M4.6 / M4.4 / design §3.5 / R4, R8）
 *
 * POST /api/listings/:id/review  body { decision, reason?, expectedVersion? }
 *   decision ∈ submit | withdraw | approve | reject | fast_track
 *
 * 语义（design §3.5 listing_reviews 事件溯源）：
 *   - 审核轴独立于发布轴。本端点**只改 reviewStatus**，绝不写 publicationStatus
 *     （审核通过不隐式发布 / R3、M4 验收门第 2 条）。
 *   - 每个动作 append 一条不可变 listing-reviews 记录：decision + 服务端推导的
 *     taskStatus + 提交快照 + 确定性哈希（snapshot/hash 绝不信任外部传入）。
 *   - 驳回必须填写原因（assertReasonForDecision）。
 *   - 非法状态转移（如 approved 再 approve）→ 409。
 *   - 版本乐观锁：expectedVersion 与当前工作版本不符 → 409，不写记录、不改房源。
 *
 * 响应：
 *   - 200: { ok: true, reviewStatus, reviewId }
 *   - 400: 缺房源 ID / 非法 decision
 *   - 401: 未登录  403: 无 listing:review 权限
 *   - 404: 房源不存在
 *   - 409: 非法转移 / 版本冲突
 *   - 422: 驳回缺原因
 */
export function createListingReviewDecisionEndpoint(): Endpoint {
  return {
    // 注册在 Listings collection 的 endpoints 上 → 实际路径 /api/listings/:id/review。
    path: '/:id/review',
    method: 'post',
    handler: async (req) => {
      // 1. 取 body
      const body = ((req as unknown as { data?: unknown }).data ??
        (typeof req.json === 'function' ? await req.json() : {})) as Record<string, unknown>
      const decision = body.decision
      if (!isReviewDecision(decision)) {
        return Response.json({ ok: false, error: '非法审核动作' }, { status: 400 })
      }

      // 2. 鉴权：所有审核动作要 listing:review；免审直发再加一道专属权限
      try {
        await requireOperationPermission(req as RequestContext, 'listing:review')
        if (decision === 'fast_track') {
          // 单独的权限码而不是复用 listing:review：直发绕过了「另一个人复核」这道
          // 组织约束，应当只授予少数人，而不是所有能审核的人自动获得。
          await requireOperationPermission(
            req as RequestContext,
            'listing:fast_track_review',
          )
        }
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

      // 4. 读房源
      let listing: Record<string, unknown>
      try {
        listing = (await req.payload.findByID({
          collection: 'listings',
          id: listingId,
          depth: 0,
          req,
        })) as unknown as Record<string, unknown>
      } catch {
        return Response.json({ ok: false, error: '房源不存在' }, { status: 404 })
      }

      const currentRaw = listing.reviewStatus
      const current = typeof currentRaw === 'string' ? currentRaw : 'not_submitted'

      // 5. 版本乐观锁
      const expectedVersion = body.expectedVersion
      if (expectedVersion !== undefined && expectedVersion !== null) {
        if (listing.version !== expectedVersion) {
          return Response.json(
            { ok: false, error: '房源版本已变更，请刷新后重试', code: 'VERSION_CONFLICT' },
            { status: 409 },
          )
        }
      }

      // 6. 审核状态机合法性
      if (
        current !== 'not_submitted' &&
        current !== 'pending' &&
        current !== 'approved' &&
        current !== 'rejected'
      ) {
        return Response.json({ ok: false, error: '房源当前审核状态非法' }, { status: 409 })
      }
      if (!canTransitionReview(current, decision)) {
        return Response.json(
          { ok: false, error: `当前状态 ${current} 不允许 ${decision}`, code: 'ILLEGAL_TRANSITION' },
          { status: 409 },
        )
      }
      const next = nextReviewStatus(current, decision)!

      // 7. 驳回必填原因
      try {
        assertReasonForDecision(decision, body.reason)
      } catch (err) {
        if (err instanceof InvalidOperationError) {
          return Response.json({ ok: false, error: err.message, code: err.code }, { status: 422 })
        }
        throw err
      }

      // 8. 服务端推导快照 / 哈希 / 任务状态（绝不信任外部传入）
      const snapshot = buildListingSnapshot(listing)
      const snapshotHash = computeSnapshotHash(snapshot)

      // 8.1 免审直发仍要过质量底线。
      //
      // 直发省掉的是「人工点通过」，不是「可以上架残缺房源」。放行不达标的房源会
      // 造出一批「后台显示已发布、前台 404」的幽灵——有效供给精筛按媒体数等条件
      // 实时判定，不达标会被静默撤下，而发布状态不会跟着变，事后极难排查。
      //
      // 这里是目前唯一在服务端跑完整度校验的地方：常规 submit 流程的完整度拦截只在
      // 后台 UI（ListingReviewQueue），服务端没有兜底。直发既然跳过了那层 UI，就必须
      // 自己把关。
      if (decision === 'fast_track') {
        const completeness = checkListingCompleteness(
          {
            ...snapshot,
            hasValidMerchantRelation: snapshot.merchant != null,
          },
          'submit',
        )
        if (!completeness.complete) {
          return Response.json(
            {
              ok: false,
              error: '房源信息不完整，无法免审直发',
              code: 'INCOMPLETE_LISTING',
              missing: completeness.missing,
              score: completeness.score,
            },
            { status: 422 },
          )
        }
      }
      const taskStatus = taskStatusForDecision(decision)
      const nowIso = new Date().toISOString()
      const rawUserId = (req.user as { id?: unknown } | null)?.id
      const userId = typeof rawUserId === 'number' ? rawUserId : undefined

      // 9. append 审核记录（不可变） + 10. 更新房源审核轴
      //    M8.2 高风险动作审计：两步操作用 withAudit 包装，审计失败视为整体失败
      const auditAction: Record<string, 'listing.review_submit' | 'listing.review_approve' | 'listing.review_reject' | 'listing.update'> = {
        submit: 'listing.review_submit',
        approve: 'listing.review_approve',
        reject: 'listing.review_reject',
        withdraw: 'listing.update',
      }
      const isSubmit = decision === 'submit'
      const isReview = decision === 'approve' || decision === 'reject'
      const listingVersion = typeof listing.version === 'number' ? listing.version : 1

      const result = await withAudit({
        req,
        action: auditAction[decision] ?? 'listing.update',
        object: {
          collection: 'listings',
          objectId: listingId,
          objectVersion: listingVersion,
        },
        before: listing,
        fn: async () => {
          const record = await req.payload.create({
            collection: 'listing-reviews',
            data: {
              listing: listingId as number,
              decision,
              taskStatus,
              reason: typeof body.reason === 'string' ? body.reason : undefined,
              snapshot: snapshot as unknown as Record<string, unknown>,
              snapshotHash,
              submittedBy: isSubmit ? userId : undefined,
              reviewedBy: isReview ? userId : undefined,
              submittedAt: isSubmit ? nowIso : undefined,
              reviewedAt: isReview ? nowIso : undefined,
              listingVersion,
              version: 1,
            },
            req,
          })

          // 更新房源审核轴——绝不触碰 publicationStatus
          const updated = await req.payload.update({
            collection: 'listings',
            id: listingId,
            data: { reviewStatus: next },
            req,
          })

          return {
            ok: true as const,
            data: {
              reviewStatus: next,
              reviewId: (record as { id?: unknown } | null)?.id as string | number | undefined,
            },
            after: updated as unknown as Record<string, unknown>,
            changedFields: ['reviewStatus'],
          }
        },
        throwOnError: false,
      })

      if (result === null) {
        return Response.json(
          { ok: false, error: '审核操作失败，请重试', code: 'REVIEW_FAILED' },
          { status: 500 },
        )
      }

      return Response.json({
        ok: true,
        reviewStatus: result.reviewStatus,
        reviewId: result.reviewId,
      })
    },
  }
}
