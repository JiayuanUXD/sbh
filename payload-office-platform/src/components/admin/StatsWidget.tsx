import type { Payload, PayloadRequest, Where } from 'payload'
import type { WidgetServerProps } from 'payload'

import {
  getEffectiveSupplyWhere,
  getPausedListingIds,
  type PayloadQueryPort,
} from '@/domain/review/effective-supply'
import { resolveEffectiveSupply } from '@/domain/review/effective-supply-snapshot'
import DashboardOverview from './DashboardOverview'

/** 候选房源上限：MVP 内存精筛口径,超过封顶（后续优化点,与 supply-adapter / 楼盘聚合对齐）。 */
const LISTING_CANDIDATE_CAP = 500

/**
 * 「对外可见房源」计数——走 M4.7 统一有效供给口径（与前台 / 详情 / 楼盘聚合一致）。
 *
 * 因需逐条精筛（媒体 §6 / 关系 §8 / 商户 §9-§10）无法用纯 count：查询层
 * getEffectiveSupplyWhere（§1-4 + §7）粗筛 + §5 举报暂停 not_in 排除,取候选后
 * 逐条 resolveEffectiveSupply,count = 精筛后长度。overrideAccess:false 随权限脱敏。
 */
async function countEffectiveListings(payload: Payload, req: PayloadRequest): Promise<number> {
  const asOf = new Date()
  const port = payload as unknown as PayloadQueryPort
  const pausedIds = await getPausedListingIds(port)

  const where: Where = {
    ...(getEffectiveSupplyWhere(asOf) as Where),
    ...(pausedIds.length > 0 ? { id: { not_in: pausedIds } } : {}),
  }

  const findRes = await payload.find({
    collection: 'listings',
    where,
    overrideAccess: false,
    req,
    pagination: false,
    limit: LISTING_CANDIDATE_CAP,
    depth: 2, // building + merchant + gallery,供精筛判定
  })

  let count = 0
  for (const raw of findRes.docs as unknown[]) {
    if (typeof raw !== 'object' || raw === null) continue
    const supply = await resolveEffectiveSupply(port, raw as Record<string, unknown>, asOf, req)
    if (supply.eligible) count += 1
  }
  return count
}

export default async function StatsWidget({ req }: WidgetServerProps) {
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
    req.payload.count({ collection: 'listings', overrideAccess: false, req }),
    countEffectiveListings(req.payload, req),
    req.payload.count({
      collection: 'listings',
      overrideAccess: false,
      req,
      where: { isFeatured: { equals: true } },
    }),
    req.payload.count({
      collection: 'listings',
      overrideAccess: false,
      req,
      where: { coverImage: { exists: false } },
    }),
    req.payload.count({ collection: 'buildings', overrideAccess: false, req }),
    req.payload.count({ collection: 'leads', overrideAccess: false, req }),
    req.payload.count({
      collection: 'leads',
      overrideAccess: false,
      req,
      where: { status: { equals: 'new' } },
    }),
    req.payload.count({
      collection: 'leads',
      overrideAccess: false,
      req,
      where: { status: { in: ['contacted', 'visited'] } },
    }),
  ])

  return (
    <DashboardOverview
      availableListings={availableListings}
      buildings={buildings.totalDocs}
      activeLeads={activeLeads.totalDocs}
      featuredListings={featuredListings.totalDocs}
      leads={leads.totalDocs}
      listings={listings.totalDocs}
      listingsWithoutCover={listingsWithoutCover.totalDocs}
      newLeads={newLeads.totalDocs}
    />
  )
}
