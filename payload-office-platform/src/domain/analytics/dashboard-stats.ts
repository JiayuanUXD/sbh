import type { Where } from 'payload'

import {
  getEffectiveSupplyWhere,
  getPausedListingIds,
  type PayloadQueryPort,
} from '@/domain/review/effective-supply'
import { resolveEffectiveSupplies } from '@/domain/review/effective-supply-snapshot'

/**
 * DashboardOverview 的数值合同。
 *
 * 待办类计数（pendingReviews / pendingRecheck / openReports / pendingSubmissions）
 * 允许为 null：当前用户对相应集合无读权限时降级为 null（前端隐藏该项），
 * 不拖垮整个概览响应。
 */
export type DashboardStats = {
  activeLeads: number
  availableListings: number
  buildings: number
  featuredListings: number
  leads: number
  listings: number
  listingsWithoutCover: number
  newLeads: number
  openReports: number | null
  pendingRecheck: number | null
  pendingReviews: number | null
  pendingSubmissions: number | null
}

type DashboardStatsFindParams = Parameters<PayloadQueryPort['find']>[0] & {
  pagination?: boolean
  select?: Record<string, boolean>
}

/** Dashboard 所需的最小 Payload Local API 端口，便于在领域层测试。 */
export interface DashboardStatsPayloadPort extends PayloadQueryPort {
  count: (params: {
    collection: string
    where?: Record<string, unknown>
    overrideAccess: boolean
    req: unknown
  }) => Promise<{ totalDocs: number }>
  find: (params: DashboardStatsFindParams) => ReturnType<PayloadQueryPort['find']>
}

/** 与原 Widget 保持一致的候选上限；本次仅优化查询形态，不改变统计口径。 */
const LISTING_CANDIDATE_CAP = 500

async function countEffectiveListings(
  payload: DashboardStatsPayloadPort,
  req: unknown,
): Promise<number> {
  const asOf = new Date()
  const pausedIds = await getPausedListingIds(payload)
  const where: Where = {
    ...(getEffectiveSupplyWhere(asOf) as Where),
    ...(pausedIds.length > 0 ? { id: { not_in: pausedIds } } : {}),
  }
  // depth 1 即可：精筛快照读 building.city / merchant.serviceCities 时接受裸 id
  // （buildEffectiveSnapshot 的 toId 归一）；select 投影裁掉媒体、富文本等大字段，
  // 是本查询从「拉全文档 × 500」瘦身的主要来源。
  const candidates = await payload.find({
    collection: 'listings',
    where,
    overrideAccess: false,
    req,
    pagination: false,
    limit: LISTING_CANDIDATE_CAP,
    depth: 1,
    select: { building: true, merchant: true },
  })
  const supplies = await resolveEffectiveSupplies(payload, candidates.docs, asOf, req)

  return [...supplies.values()].filter((supply) => supply.eligible).length
}

/** 待办类计数：无权限（或集合查询失败）降级为 null，由前端隐藏该项。 */
async function safeCount(
  payload: DashboardStatsPayloadPort,
  params: Parameters<DashboardStatsPayloadPort['count']>[0],
): Promise<number | null> {
  try {
    const result = await payload.count(params)
    return result.totalDocs
  } catch {
    return null
  }
}

/**
 * 解析后台运营概览统计。
 *
 * 用户范围内的房源、楼盘和线索计数均显式携带原始请求并保留 access；举报与
 * 房源-商户关系是有效供给内部事实，延续共享解析器的 trusted read 语义。
 */
export async function resolveDashboardStats(
  payload: DashboardStatsPayloadPort,
  req: unknown,
): Promise<DashboardStats> {
  const [
    listings,
    availableListings,
    featuredListings,
    listingsWithoutCover,
    buildings,
    leads,
    newLeads,
    activeLeads,
    pendingReviews,
    pendingRecheck,
    openReports,
    pendingSubmissions,
  ] = await Promise.all([
    payload.count({ collection: 'listings', overrideAccess: false, req }),
    countEffectiveListings(payload, req),
    payload.count({
      collection: 'listings',
      overrideAccess: false,
      req,
      where: { isFeatured: { equals: true } },
    }),
    payload.count({
      collection: 'listings',
      overrideAccess: false,
      req,
      where: { coverImage: { exists: false } },
    }),
    payload.count({ collection: 'buildings', overrideAccess: false, req }),
    payload.count({ collection: 'leads', overrideAccess: false, req }),
    payload.count({
      collection: 'leads',
      overrideAccess: false,
      req,
      where: { status: { equals: 'new' } },
    }),
    payload.count({
      collection: 'leads',
      overrideAccess: false,
      req,
      where: { status: { in: ['contacted', 'visited'] } },
    }),
    // —— 以下为 OPT-056 新增的待办类计数（口径与后台列表深链一致） ——
    safeCount(payload, {
      collection: 'listings',
      overrideAccess: false,
      req,
      where: { reviewStatus: { equals: 'pending' } },
    }),
    safeCount(payload, {
      collection: 'listings',
      overrideAccess: false,
      req,
      where: { supplyVisibilityHold: { equals: 'pending_recheck' } },
    }),
    safeCount(payload, {
      collection: 'listing-reports',
      overrideAccess: false,
      req,
      where: { status: { not_equals: 'closed' } },
    }),
    safeCount(payload, {
      collection: 'supply-submissions',
      overrideAccess: false,
      req,
      where: { status: { equals: 'pending' } },
    }),
  ])

  return {
    listings: listings.totalDocs,
    availableListings,
    featuredListings: featuredListings.totalDocs,
    listingsWithoutCover: listingsWithoutCover.totalDocs,
    buildings: buildings.totalDocs,
    leads: leads.totalDocs,
    newLeads: newLeads.totalDocs,
    activeLeads: activeLeads.totalDocs,
    pendingReviews,
    pendingRecheck,
    openReports,
    pendingSubmissions,
  }
}
