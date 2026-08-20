/**
 * 平台管理员保存即发布的接线（OPT-033 C）
 *
 * 判定在 `admin-auto-publish.ts`（纯函数）；这里只负责取上下文、改两轴、记审计。
 *
 * 分两个 hook 而不是一个：
 *   - beforeChange 直接改 `data` 的两轴 —— 与本次保存同一次写入，不需要回头再
 *     `payload.update` 一遍，也就不会触发 hook 递归。
 *   - afterChange 才写 listing-reviews 记录 —— 它要引用房源 id，create 场景下
 *     beforeChange 阶段还没有 id。
 * 两者之间用 `req.context` 传递意图，且**只有 beforeChange 真的放行时才会置位**。
 */

import type { CollectionAfterChangeHook, CollectionBeforeChangeHook } from 'payload'

import { derivePermissionContextFromRequest, type RequestContext } from '@/domain/auth/access'
import { withAudit } from '@/domain/audit/with-audit'
import { decideAdminAutoPublish } from '@/domain/review/admin-auto-publish'
import { buildListingSnapshot, computeSnapshotHash, taskStatusForDecision } from '@/domain/review/review-transition'

/** req.context 上的标记键：beforeChange 决定上架后置位，afterChange 消费。 */
const AUTO_PUBLISH_MARK = '__opt033AdminAutoPublish'

interface AutoPublishMark {
  userId: number | string
  before: Record<string, unknown> | null
}

const readMark = (req: unknown): AutoPublishMark | undefined => {
  const context = (req as { context?: Record<string, unknown> }).context
  return context?.[AUTO_PUBLISH_MARK] as AutoPublishMark | undefined
}

/**
 * 平台管理员保存房源时，若完整度达标则连同审核轴与发布轴一起推到「已发布」。
 *
 * 必须排在 `syncListingMedia` 与 `protectListing` **之后**：gallery 由 mediaItems
 * 派生、三轴缺省值由 protectListing 初始化，早于它们判定会读到半成品数据。
 */
export const adminAutoPublish: CollectionBeforeChangeHook = async ({ data, originalDoc, req }) => {
  // 用 derive 而不是带缓存的 getPermissionContext：这是安全敏感判定，
  // 不能让 Local API 调用方通过预置 req 上的缓存属性绕过角色检查。
  const ctx = await derivePermissionContextFromRequest(req as RequestContext)
  if (!ctx) return data

  const merged = { ...(originalDoc ?? {}), ...(data ?? {}) } as Record<string, unknown>
  const snapshot = buildListingSnapshot(merged as never)

  const decision = decideAdminAutoPublish({
    roleCodes: ctx.roleCodes,
    reviewStatus: merged.reviewStatus,
    snapshot: {
      ...snapshot,
      // 与审核端点同口径：OPT-034 起 `listings.merchant` 即唯一真相，不再是近似。
      hasValidMerchantRelation: snapshot.merchant != null,
    },
  })

  if (!decision.publish) return data

  data.reviewStatus = 'approved'
  data.publicationStatus = 'published'

  const context = ((req as { context?: Record<string, unknown> }).context ??= {})
  context[AUTO_PUBLISH_MARK] = {
    userId: ctx.userId,
    before: (originalDoc as Record<string, unknown> | undefined) ?? null,
  } satisfies AutoPublishMark

  return data
}

/**
 * 补写审计：一条 decision=fast_track 的 listing-reviews 记录 + 一条
 * listing.review_fast_track 审计日志。
 *
 * 记 fast_track 而不是 approve：两者都让房源变成 approved，但只有前者能表达
 * 「没有第二个人复核过」。`reviewedBy` 必须写——这条记录是「谁把它直接放上线的」
 * 的唯一凭据，不写就等于没有审计。
 */
export const recordAdminAutoPublish: CollectionAfterChangeHook = async ({ doc, req }) => {
  const mark = readMark(req)
  if (!mark) return doc

  // 先清标记：同一请求里若还有后续写入（如关联更新触发的二次 afterChange），
  // 不应再补一条重复的审核记录。
  const context = (req as { context?: Record<string, unknown> }).context
  if (context) delete context[AUTO_PUBLISH_MARK]

  const listing = doc as Record<string, unknown>
  const listingId = listing.id as number
  const snapshot = buildListingSnapshot(listing as never)
  const listingVersion = typeof listing.version === 'number' ? listing.version : 1

  await withAudit({
    req: req as never,
    action: 'listing.review_fast_track',
    object: { collection: 'listings', objectId: listingId, objectVersion: listingVersion },
    before: mark.before,
    fn: async () => {
      const record = await req.payload.create({
        collection: 'listing-reviews',
        data: {
          listing: listingId,
          decision: 'fast_track',
          taskStatus: taskStatusForDecision('fast_track'),
          snapshot: snapshot as unknown as Record<string, unknown>,
          snapshotHash: computeSnapshotHash(snapshot),
          reviewedBy: typeof mark.userId === 'number' ? mark.userId : undefined,
          reviewedAt: new Date().toISOString(),
          listingVersion,
          version: 1,
        },
        req,
      })
      return { ok: true as const, data: record, after: listing }
    },
  })

  return doc
}
