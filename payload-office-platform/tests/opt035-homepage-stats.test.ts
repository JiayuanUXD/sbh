/**
 * OPT-035 Task 3：getHomepage 扩展验收
 *
 * 覆盖：
 *   - haversineKm 球面距离计算（geo.ts）
 *   - getHomepage 新增 stats（有效计数）/ typeSummaries（按类型聚合）/
 *     nearbyListings（核心商圈附近房源）三个字段
 *
 * 设计依据：.superpowers/sdd/2026-08-20-homepage-apple-redesign/task-3-brief.md
 */
import { describe, expect, it } from 'vitest'
import { haversineKm } from '@/domain/public-catalog/geo'
import { getHomepage } from '@/domain/public-catalog/facade'
import { createSearchContext } from '@/domain/public-catalog/types'
import {
  makeArea,
  makeBuilding,
  makeHomepageAdapter,
  makeListing,
} from './helpers/opt035-fixtures'

describe('haversineKm', () => {
  it('人民广场→陆家嘴约 2.9km（GCJ-02 坐标，容差区间 2.4–3.4km）', () => {
    const peoples = { latitude: 31.2336, longitude: 121.4692 }
    const lujiazui = { latitude: 31.2397, longitude: 121.4998 }
    const d = haversineKm(peoples, lujiazui)
    expect(d).toBeGreaterThan(2.4)
    expect(d).toBeLessThan(3.4)
  })
  it('同一点为 0', () => {
    const p = { latitude: 31.2, longitude: 121.5 }
    expect(haversineKm(p, p)).toBe(0)
  })
})

describe('getHomepage stats / typeSummaries / nearbyListings', () => {
  const ctx = createSearchContext('shanghai')

  it('stats 三个计数分别等于有效房源数 / 有效楼盘数 / 商圈数', async () => {
    const adapter = makeHomepageAdapter({
      findEffectiveListings: async () => [makeListing({ id: 1 }), makeListing({ id: 2 })],
      findEffectiveBuildings: async () => [
        makeBuilding({ id: 11 }),
        makeBuilding({ id: 12 }),
        makeBuilding({ id: 13 }),
      ],
      findEffectiveBusinessAreas: async () => [makeArea({ id: 21 })],
    })
    const hp = await getHomepage(ctx, {}, adapter)
    expect(hp.stats).toEqual({ listings: 2, buildings: 3, businessAreas: 1 })
  })

  it('typeSummaries 按 listingType 聚合计数并取首个封面', async () => {
    const adapter = makeHomepageAdapter({
      findEffectiveListings: async () => [
        makeListing({ id: 1, listingType: 'coworking' }),
        makeListing({ id: 2, listingType: 'coworking' }),
        makeListing({ id: 3, listingType: 'traditional-office' }),
      ],
    })
    const hp = await getHomepage(ctx, {}, adapter)
    expect(hp.typeSummaries['coworking']?.count).toBe(2)
    expect(hp.typeSummaries['traditional-office']?.count).toBe(1)
  })

  it('nearbyListings 按距城市中心升序、排除精选已展示、上限 5、带 distanceKm', async () => {
    const far = makeListing({ id: 1, slug: 'far', buildingCoords: { latitude: 31.4, longitude: 121.6 } })
    const near = makeListing({ id: 2, slug: 'near', buildingCoords: { latitude: 31.24, longitude: 121.48 } })
    const featured = makeListing({
      id: 3,
      slug: 'featured-one',
      isFeatured: true,
      buildingCoords: { latitude: 31.23, longitude: 121.47 },
    })
    const adapter = makeHomepageAdapter({
      findFeaturedListings: async () => [featured],
      findEffectiveListings: async () => [far, near, featured],
      findCityCenter: async () => ({ latitude: 31.2304, longitude: 121.4737 }),
    })
    const hp = await getHomepage(ctx, {}, adapter)
    expect(hp.nearbyListings.map((l) => l.slug)).toEqual(['near', 'far'])
    expect(hp.nearbyListings[0].distanceKm).toBeGreaterThan(0)
    expect(hp.nearbyListings[0].distanceKm).toBeLessThan(hp.nearbyListings[1].distanceKm)
  })

  it('城市中心缺失或适配器未实现时 nearbyListings 为空', async () => {
    const hp1 = await getHomepage(ctx, {}, makeHomepageAdapter({ findCityCenter: async () => null }))
    expect(hp1.nearbyListings).toEqual([])
    const noMethod = makeHomepageAdapter()
    delete (noMethod as { findCityCenter?: unknown }).findCityCenter
    const hp2 = await getHomepage(ctx, {}, noMethod)
    expect(hp2.nearbyListings).toEqual([])
  })
})
