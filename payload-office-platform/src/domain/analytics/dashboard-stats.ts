import type { Where } from 'payload'

import {
  getEffectiveSupplyWhere,
  getPausedListingIds,
  type PayloadQueryPort,
} from '@/domain/review/effective-supply'
import { resolveEffectiveSupplies } from '@/domain/review/effective-supply-snapshot'

/** 保持现有 DashboardOverview 的八项数值合同。 */
export type DashboardStats = {
  activeLeads: number
  availableListings: number
  buildings: number
  featuredListings: number
  leads: number
  listings: number
  listingsWithoutCover: number
  newLeads: number
}

type DashboardStatsFindParams = Parameters<PayloadQueryPort['find']>[0] & {
  pagination?: boolean
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
  const candidates = await payload.find({
    collection: 'listings',
    where,
    overrideAccess: false,
    req,
    pagination: false,
    limit: LISTING_CANDIDATE_CAP,
    depth: 2,
  })
  const supplies = await resolveEffectiveSupplies(payload, candidates.docs, asOf, req)

  return [...supplies.values()].filter((supply) => supply.eligible).length
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
  }
}
