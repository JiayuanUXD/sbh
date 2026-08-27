import type { ListViewServerProps, Where } from 'payload'

import { shouldDeferToDefaultListView } from './list-view-context'
import { renderDefaultListView } from './payload-default-list-fallback'

import {
  BUSINESS_TYPES,
  BUSINESS_TYPE_LABELS,
  LISTING_TYPES,
  LISTING_TYPE_LABELS,
} from '@/domain/review/listing-fields'
import {
  PUBLICATION_STATUSES,
  PUBLICATION_STATUS_LABELS,
} from '@/domain/review/publication-status'
import { REVIEW_STATUSES, REVIEW_STATUS_LABELS } from '@/domain/review/review-status'
import type { Listing } from '@/payload-types'
import ListingsListViewClient, { type ListingRow } from './ListingsListViewClient'

/**
 * 房源列表 - 服务端入口（OPT-056 后台列表 Arco 化）
 *
 * 整页替换 listings 默认列表视图：服务端分页 + 标题搜索 + 状态筛选，
 * 客户端用 Arco Table 呈现（状态标签、推荐位行内快捷编辑）。
 *
 * 注册：Listings.admin.components.views.list.Component
 *
 * 权限：collection access 与字段权限仍由服务端强制——列表查询走 Local API
 * （listings read 本就公开），行内快捷编辑走 REST PATCH（access + hooks 全跑）。
 *
 * 仅接管「整页列表」；回收站与关系抽屉让位给 Payload 原生视图，
 * 判定与理由见 `list-view-context.ts`。
 */

const PAGE_SIZE_DEFAULT = 25
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100]

/** searchParams 值归一（string | string[] → string | null）。 */
function firstParam(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value
  if (Array.isArray(value) && typeof value[0] === 'string' && value[0].length > 0) {
    return value[0]
  }
  return null
}

function inOptions(value: string | null, options: readonly string[]): string | null {
  return value && (options as readonly string[]).includes(value) ? value : null
}

export default async function ListingsListView(props: ListViewServerProps) {
  if (shouldDeferToDefaultListView(props)) {
    return renderDefaultListView(props)
  }

  const { payload, user, searchParams } = props
  if (!user) {
    return <div style={{ padding: 24 }}>请先登录后台。</div>
  }

  const params = searchParams ?? {}
  const q = firstParam(params.q)
  const publicationStatus = inOptions(firstParam(params.publicationStatus), PUBLICATION_STATUSES)
  const reviewStatus = inOptions(firstParam(params.reviewStatus), REVIEW_STATUSES)
  const listingType = inOptions(firstParam(params.listingType), LISTING_TYPES)
  const businessType = inOptions(firstParam(params.businessType), BUSINESS_TYPES)
  const page = Math.max(1, Number.parseInt(firstParam(params.page) ?? '1', 10) || 1)
  const limitRaw = Number.parseInt(firstParam(params.limit) ?? '', 10)
  const limit = PAGE_SIZE_OPTIONS.includes(limitRaw) ? limitRaw : PAGE_SIZE_DEFAULT
  // 深链参数（无独立筛选控件，激活时客户端以可关闭标签呈现）：
  // building=<id> 来自楼盘聚合卡「查看房源」；missingCover=1 来自运营概览「缺少封面」；
  // pendingRecheck=1 来自运营概览「待复核供给」。
  const buildingRaw = Number.parseInt(firstParam(params.building) ?? '', 10)
  const building = Number.isInteger(buildingRaw) && buildingRaw > 0 ? buildingRaw : null
  const missingCover = firstParam(params.missingCover) === '1'
  const pendingRecheck = firstParam(params.pendingRecheck) === '1'

  const conditions: Where[] = []
  if (q) conditions.push({ title: { like: q } })
  if (publicationStatus) conditions.push({ publicationStatus: { equals: publicationStatus } })
  if (reviewStatus) conditions.push({ reviewStatus: { equals: reviewStatus } })
  if (listingType) conditions.push({ listingType: { equals: listingType } })
  if (businessType) conditions.push({ businessType: { equals: businessType } })
  if (building !== null) conditions.push({ building: { equals: building } })
  if (missingCover) conditions.push({ coverImage: { exists: false } })
  if (pendingRecheck) conditions.push({ supplyVisibilityHold: { equals: 'pending_recheck' } })

  const [result, buildingDoc] = await Promise.all([
    payload.find({
      collection: 'listings',
      where: conditions.length > 0 ? { and: conditions } : undefined,
      depth: 1,
      limit,
      page,
      sort: '-updatedAt',
    }),
    building !== null
      ? payload
          .findByID({ collection: 'buildings', id: building, depth: 0 })
          .catch(() => null)
      : Promise.resolve(null),
  ])

  const rows: ListingRow[] = (result.docs as Listing[]).map((doc) => {
    const building = doc.building
    const merchant = doc.merchant
    return {
      id: doc.id,
      title: doc.title,
      slug: doc.slug ?? null,
      buildingName:
        building && typeof building === 'object' ? (building.name ?? null) : null,
      merchantName:
        merchant && typeof merchant === 'object' ? (merchant.name ?? null) : null,
      listingType: doc.listingType,
      businessType: doc.businessType ?? null,
      publicationStatus: doc.publicationStatus ?? null,
      reviewStatus: doc.reviewStatus ?? null,
      supplyVisibilityHold: doc.supplyVisibilityHold ?? null,
      isFeatured: Boolean(doc.isFeatured),
      area: typeof doc.area === 'number' ? doc.area : null,
      version: typeof doc.version === 'number' ? doc.version : null,
      updatedAt: doc.updatedAt,
    }
  })

  return (
    <ListingsListViewClient
      rows={rows}
      page={result.page ?? 1}
      pageSize={limit}
      totalDocs={result.totalDocs ?? 0}
      activeQ={q}
      activePublicationStatus={publicationStatus}
      activeReviewStatus={reviewStatus}
      activeListingType={listingType}
      activeBusinessType={businessType}
      activeBuilding={building}
      activeBuildingName={
        buildingDoc && typeof buildingDoc === 'object' && 'name' in buildingDoc
          ? ((buildingDoc as { name?: string }).name ?? null)
          : null
      }
      activeMissingCover={missingCover}
      activePendingRecheck={pendingRecheck}
      publicationStatusOptions={PUBLICATION_STATUSES.map((value) => ({
        value,
        label: PUBLICATION_STATUS_LABELS[value],
      }))}
      reviewStatusOptions={REVIEW_STATUSES.map((value) => ({
        value,
        label: REVIEW_STATUS_LABELS[value],
      }))}
      listingTypeOptions={LISTING_TYPES.map((value) => ({
        value,
        label: LISTING_TYPE_LABELS[value],
      }))}
      businessTypeOptions={BUSINESS_TYPES.map((value) => ({
        value,
        label: BUSINESS_TYPE_LABELS[value],
      }))}
    />
  )
}
