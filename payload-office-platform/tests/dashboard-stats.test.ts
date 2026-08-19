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
    ...overrides,
  }
}

const activeRelation = (listing: number) => ({
  id: `relation-${listing}`,
  listing,
  effectiveFrom: asOf,
  effectiveTo: null,
  merchant: {
    id: 20,
    status: 'active',
    qualificationStatus: 'valid',
    qualificationExpiresAt: '2999-01-01T00:00:00.000Z',
    serviceCities: [{ id: 100 }],
  },
})

describe('dashboard-stats/resolveDashboardStats', () => {
  it('保留现有八项统计口径，并用一次批量关系查询统计有效供给', async () => {
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
            // 无生效商户关系 → 精筛淘汰（下方 relations 只返回 listing 1 的）。
            // 2026-08-19 前这里用的是「图片只有 1 张」，图片条件移出精筛后换成关系。
            eligibleListing(2),
          ],
          hasNextPage: false,
          nextPage: null,
        }
      }
      if (collection === 'listing-merchant-relations') {
        return {
          docs: [activeRelation(1)],
          hasNextPage: false,
          nextPage: null,
        }
      }
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
    expect(findCalls.filter((call) => call.collection === 'listing-merchant-relations')).toHaveLength(1)
  })
})
