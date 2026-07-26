import type { ListViewServerPropsOnly } from 'payload'

import {
  buildPermissionContext,
  hasOperationPermission,
} from '@/domain/auth/permission-context'
import { checkListingCompleteness } from '@/domain/review/listing-completeness'
import type { Listing, ListingReview, Role, User } from '@/payload-types'
import ListingReviewQueueClient, {
  type QueueRow,
  type ReviewHistoryEntry,
} from './ListingReviewQueueClient'

/**
 * 房源审核台 - 服务端入口（tasks.md M4.5 / PRD 04_房源审核 / R1, R4）
 *
 * 整页替换 listing-reviews 默认列表视图：
 *   - 服务端读待审核房源队列（reviewStatus=pending），按提交时间升序（先进先审）
 *   - 每条房源计算提交完整度分数与缺失项定位（M4.3 纯函数复用）
 *   - 附带该房源审核历史（listing-reviews 事件流），供详情抽屉时间线
 *   - 读当前用户权限：listing:review 决定能否通过/驳回；listing:publish 决定
 *     "通过后上架"复选是否可见（M4.5 子项：仅同时具备审核+发布权限者开放）
 *
 * 注册：ListingReviews.admin.components.views.list.Component
 *
 * 写侧动作全走已有服务端 endpoint（服务端强制权限/状态机/原因门槛）：
 *   - 通过/驳回/撤回 → POST /api/listings/:id/review
 *   - 通过后上架    → POST /api/listings/:id/publish (action=publish)
 * 本视图只负责浏览、对比与触发，绝不在客户端复制业务规则。
 */
export default async function ListingReviewQueue({
  payload,
  user,
}: ListViewServerPropsOnly) {
  // 当前用户权限：决定客户端按钮可见性（服务端仍是唯一强制点）。
  // 列表视图直接提供 payload + user（无 req），因此直接构造权限上下文，
  // 而非走 getPermissionContext(req)。
  const ctx = user
    ? await buildPermissionContext({
        user: user as unknown as Pick<
          User,
          'id' | 'roles' | 'cityScope' | 'status' | 'sessionVersion'
        >,
        loadRoles: async (roleIds) => {
          const docs = await payload.find({
            collection: 'roles',
            where: { id: { in: roleIds } },
            depth: 0,
            overrideAccess: true,
            limit: roleIds.length,
          })
          return docs.docs as unknown as Role[]
        },
      })
    : null
  const canReview = ctx ? hasOperationPermission(ctx, 'listing:review') : false
  const canPublish = ctx ? hasOperationPermission(ctx, 'listing:publish') : false

  // 1. 待审核房源队列（reviewStatus=pending）
  const listingsResult = await payload.find({
    collection: 'listings',
    where: { reviewStatus: { equals: 'pending' } },
    depth: 1,
    limit: 200,
    sort: 'updatedAt',
    overrideAccess: true,
  })
  const listings = listingsResult.docs as Listing[]
  const listingIds = listings.map((l) => l.id)

  // 2. 一次性取这些房源的全部审核记录（事件流），客户端按 listing 分组做时间线
  const reviewsByListing = new Map<number, ReviewHistoryEntry[]>()
  if (listingIds.length > 0) {
    const reviewsResult = await payload.find({
      collection: 'listing-reviews',
      where: { listing: { in: listingIds } },
      depth: 1,
      limit: 2000,
      sort: '-createdAt',
      overrideAccess: true,
    })
    for (const raw of reviewsResult.docs as ListingReview[]) {
      const listingId = relationId(raw.listing)
      if (listingId == null) continue
      const entry: ReviewHistoryEntry = {
        id: raw.id,
        decision: raw.decision,
        taskStatus: (raw.taskStatus as ReviewHistoryEntry['taskStatus']) ?? null,
        reason: raw.reason ?? null,
        actorName: relationLabel(raw.reviewedBy) ?? relationLabel(raw.submittedBy),
        createdAt: raw.createdAt,
      }
      const list = reviewsByListing.get(listingId) ?? []
      list.push(entry)
      reviewsByListing.set(listingId, list)
    }
  }

  // 3. 组装队列行（完整度 + 缺失项 + 历史）
  const rows: QueueRow[] = listings.map((listing) => {
    const completeness = checkListingCompleteness(
      {
        title: listing.title,
        slug: listing.slug,
        listingType: listing.listingType,
        building: listing.building,
        businessType: listing.businessType,
        decorationStatus: listing.decorationStatus,
        price: toPriceSnapshot(listing.price),
        area: listing.area,
        floor: listing.floor,
        minimumLeaseMonths: listing.minimumLeaseMonths,
        paymentTerms: listing.paymentTerms,
        availableFrom: listing.availableFrom,
        description: listing.description,
        contactBroker: listing.contactBroker,
        galleryCount: Array.isArray(listing.gallery) ? listing.gallery.length : 0,
        // 商户关系有效性此处不在队列展开（避免 N 次关系查询），
        // 提交时已由 M4.3 门槛校验；审核台以字段完整度为主视角。
        hasValidMerchantRelation: true,
      },
      'submit',
    )

    return {
      listingId: listing.id,
      title: listing.title ?? '(未命名房源)',
      slug: listing.slug ?? '',
      buildingName: relationLabel(listing.building) ?? '—',
      listingType: listing.listingType ?? '',
      version: typeof listing.version === 'number' ? listing.version : 1,
      completenessScore: completeness.score,
      missing: completeness.missing.map((m) => ({ label: m.label, reason: m.reason })),
      submittedAt: latestSubmittedAt(reviewsByListing.get(listing.id)),
      history: reviewsByListing.get(listing.id) ?? [],
    }
  })

  return (
    <ListingReviewQueueClient
      rows={rows}
      canReview={canReview}
      canPublish={canPublish}
    />
  )
}

/** 房源价格组归一为完整度校验用的 PriceSnapshot（null → undefined）。 */
function toPriceSnapshot(
  price: Listing['price'] | null | undefined,
): { amount?: number; currency?: string; period?: string; unit?: string } | undefined {
  if (!price) return undefined
  return {
    amount: price.amount ?? undefined,
    currency: price.currency ?? undefined,
    period: price.period ?? undefined,
    unit: price.unit ?? undefined,
  }
}

/** 关系值归一为数值 ID（number | populated 对象 | null）。 */
function relationId(value: unknown): number | null {
  if (typeof value === 'number') return value
  if (value && typeof value === 'object') {
    const id = (value as { id?: unknown }).id
    if (typeof id === 'number') return id
  }
  return null
}

/** 关系值取可读标签（populated 对象的 name/title；否则 null）。 */
function relationLabel(value: unknown): string | null {
  if (value && typeof value === 'object') {
    const obj = value as { name?: unknown; title?: unknown }
    if (typeof obj.name === 'string') return obj.name
    if (typeof obj.title === 'string') return obj.title
  }
  return null
}

/** 从审核历史里取最近一次 submit 动作的时间（队列按提交先后展示）。 */
function latestSubmittedAt(history: ReviewHistoryEntry[] | undefined): string | null {
  if (!history) return null
  const submit = history.find((h) => h.decision === 'submit')
  return submit?.createdAt ?? null
}
