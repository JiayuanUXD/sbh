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
        if (JSON.stringify(where).includes('isFeatured')) return { totalDocs: 3 }
        if (JSON.stringify(where).includes('coverImage')) return { totalDocs: 4 }
      }
      if (collection === 'buildings') return { totalDocs: 5 }
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
    })

    expect(countCalls).toHaveLength(7)
    for (const call of countCalls) {
      expect(call.overrideAccess).toBe(false)
      expect(call.req).toBe(req)
    }

    const listingCall = findCalls.find((call) => call.collection === 'listings')
    expect(listingCall).toMatchObject({
      overrideAccess: false,
      req,
      pagination: false,
      limit: 500,
      depth: 2,
      where: { id: { not_in: [3] } },
    })
    expect(findCalls.some((call) => call.collection === 'listing-merchant-relations')).toBe(false)
  })
})
