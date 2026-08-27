import { describe, expect, it, vi } from 'vitest'

import {
  resolveDashboardStats,
  type DashboardStatsPayloadPort,
} from '@/domain/analytics/dashboard-stats'

const asOf = '2000-01-01T00:00:00.000Z'

type CountInput = Parameters<DashboardStatsPayloadPort['count']>[0]
type FindInput = Parameters<DashboardStatsPayloadPort['find']>[0]

function eligibleListing(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    gallery: [{ id: `${id}-a` }, { id: `${id}-b` }, { id: `${id}-c` }],
    building: { id: 10, city: { id: 100 } },
    merchant: {
      id: 20,
      status: 'active',
      qualificationStatus: 'valid',
      qualificationExpiresAt: '2999-01-01T00:00:00.000Z',
      serviceCities: [{ id: 100 }],
    },
    ...overrides,
  }
}

describe('dashboard-stats/resolveDashboardStats', () => {
  // OPT-034：精筛不再批量查 listing-merchant-relations，商户直接读已展开的
  // listing.merchant——标题从「批量关系查询」改为「不再查关系表」。
  it('保留现有八项统计口径，且精筛不再查 listing-merchant-relations', async () => {
    const req = { requestId: 'dashboard-request' }
    const countCalls: CountInput[] = []
    const findCalls: FindInput[] = []
    const count: DashboardStatsPayloadPort['count'] = async ({ collection, where, ...input }) => {
      countCalls.push({ collection, where, ...input })
      if (collection === 'listings' && where === undefined) return { totalDocs: 12 }
      if (collection === 'listings') {
        const serialized = JSON.stringify(where)
        if (serialized.includes('isFeatured')) return { totalDocs: 3 }
        if (serialized.includes('coverImage')) return { totalDocs: 4 }
        if (serialized.includes('reviewStatus')) return { totalDocs: 13 }
        if (serialized.includes('supplyVisibilityHold')) return { totalDocs: 14 }
      }
      if (collection === 'buildings') return { totalDocs: 5 }
      if (collection === 'listing-reports') return { totalDocs: 15 }
      if (collection === 'supply-submissions') return { totalDocs: 16 }
      if (collection === 'leads' && where === undefined) return { totalDocs: 9 }
      if (collection === 'leads' && JSON.stringify(where).includes('"new"')) return { totalDocs: 2 }
      if (collection === 'leads') return { totalDocs: 6 }
      return { totalDocs: 0 }
    }
    const find: DashboardStatsPayloadPort['find'] = async ({ collection, ...input }) => {
      findCalls.push({ collection, ...input })
      if (collection === 'listing-reports') {
        return { docs: [{ targetListing: 3 }], hasNextPage: false, nextPage: null }
      }
      if (collection === 'listings') {
        return {
          docs: [
            eligibleListing(1),
            // 未设置供给商户 → 精筛淘汰。2026-08-19 前这里用的是「图片只有 1
            // 张」，图片条件移出精筛后换成「无生效关系」；OPT-034 删除关系表
            // 后再换成「listing.merchant 为空」。
            eligibleListing(2, { merchant: null }),
          ],
          hasNextPage: false,
          nextPage: null,
        }
      }
      // OPT-034：精筛不再查 listing-merchant-relations——throw 而不是给空
      // docs，免得关系表又被悄悄查起来时这里还是绿的。
      throw new Error(`Unexpected collection: ${collection}`)
    }
    const payload = { count, find } satisfies DashboardStatsPayloadPort

    const stats = await resolveDashboardStats(payload, req)

    expect(stats).toEqual({
      listings: 12,
      availableListings: 1,
      featuredListings: 3,
      listingsWithoutCover: 4,
      buildings: 5,
      leads: 9,
      newLeads: 2,
      activeLeads: 6,
      pendingReviews: 13,
      pendingRecheck: 14,
      openReports: 15,
      pendingSubmissions: 16,
    })

    expect(countCalls).toHaveLength(11)
    for (const call of countCalls) {
      expect(call.overrideAccess).toBe(false)
      expect(call.req).toBe(req)
    }

    // OPT-056：精筛快照只需 depth 1（merchant.serviceCities 的裸 id 可被 toId 归一），
    // 且用 select 投影裁掉媒体/富文本等大字段——这是概览端点最重查询的主要瘦身点。
    const listingCall = findCalls.find((call) => call.collection === 'listings')
    expect(listingCall).toMatchObject({
      overrideAccess: false,
      req,
      pagination: false,
      limit: 500,
      depth: 1,
      select: { building: true, merchant: true },
      where: { id: { not_in: [3] } },
    })
    expect(findCalls.some((call) => call.collection === 'listing-merchant-relations')).toBe(false)
  })

  it('待办类计数无权限时降级为 null，不拖垮整个概览', async () => {
    const req = { requestId: 'dashboard-degraded' }
    const count: DashboardStatsPayloadPort['count'] = async ({ collection, where }) => {
      if (collection === 'listing-reports' || collection === 'supply-submissions') {
        throw new Error('Forbidden')
      }
      if (collection === 'listings' && where !== undefined) {
        const serialized = JSON.stringify(where)
        if (serialized.includes('reviewStatus')) return { totalDocs: 2 }
        if (serialized.includes('supplyVisibilityHold')) return { totalDocs: 1 }
      }
      return { totalDocs: 0 }
    }
    const find: DashboardStatsPayloadPort['find'] = async ({ collection }) => {
      if (collection === 'listing-reports') {
        return { docs: [], hasNextPage: false, nextPage: null }
      }
      return { docs: [], hasNextPage: false, nextPage: null }
    }
    const payload = { count, find } satisfies DashboardStatsPayloadPort

    const stats = await resolveDashboardStats(payload, req)

    expect(stats.openReports).toBeNull()
    expect(stats.pendingSubmissions).toBeNull()
    expect(stats.pendingReviews).toBe(2)
    expect(stats.pendingRecheck).toBe(1)
    expect(stats.listings).toBe(0)
  })
})
