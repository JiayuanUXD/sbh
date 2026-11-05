import { describe, expect, it } from 'vitest'
import type { Building } from '@/payload-types'

import { DEFAULT_HOMEPAGE_FEATURED_LIMIT, getHomepage } from '@/domain/public-catalog/facade'
import { createSearchContext } from '@/domain/public-catalog/types'
import {
  makeArea,
  makeBuilding,
  makeHomepageAdapter,
  makeListing,
} from './helpers/opt035-fixtures'

const ctx = createSearchContext('shanghai')

/** 每 groupSize 栋共用一个商圈，保证「同商圈上限」可被触发/可被验证。 */
function makeBuildings(count: number, groupSize = 3): Building[] {
  const baseMs = Date.UTC(2026, 6, 28, 0, 0, 0)
  return Array.from({ length: count }, (_, index) => {
    const areaId = 300 + Math.floor(index / groupSize)
    return makeBuilding({
      id: 200 + index,
      updatedAt: new Date(baseMs - index * 3_600_000).toISOString(),
      businessDistrict: makeArea({ id: areaId, name: `商圈${areaId}`, slug: `area-${areaId}` }),
    })
  })
}

function makeListings(count: number, featured: number) {
  const baseMs = Date.UTC(2026, 6, 28, 0, 0, 0)
  return Array.from({ length: count }, (_, index) => {
    const areaId = 400 + Math.floor(index / 3)
    return makeListing({
      id: 100 + index,
      isFeatured: index < featured,
      building: makeBuilding({
        id: 900 + index,
        businessDistrict: makeArea({ id: areaId, name: `商圈${areaId}`, slug: `area-${areaId}` }),
      }),
      updatedAt: new Date(baseMs - index * 3_600_000).toISOString(),
    })
  })
}

function adapterWith(buildings: Building[], listings: ReturnType<typeof makeListings>) {
  const requested: { buildings?: number; listings?: number } = {}
  const adapter = makeHomepageAdapter({
    findFeaturedBuildings: async (_ctx, limit) => {
      requested.buildings = limit
      return buildings
    },
    findFeaturedListings: async (_ctx, limit) => {
      requested.listings = limit
      return listings
    },
  })
  return { adapter, requested }
}

describe('首页桶内打散（getHomepage）', () => {
  it('默认展示 18 个楼盘与 18 套房源，候选池不设截断上限（拉取全站）', async () => {
    expect(DEFAULT_HOMEPAGE_FEATURED_LIMIT).toBe(18)
    const buildings = makeBuildings(60)
    const listings = makeListings(60, 60)
    const { adapter, requested } = adapterWith(buildings, listings)
    const hp = await getHomepage(ctx, { bucket: 700 }, adapter)
    expect(requested.buildings).toBeUndefined()
    expect(requested.listings).toBeUndefined()
    expect(hp.featuredBuildings).toHaveLength(18)
    expect(hp.featuredListings).toHaveLength(18)
    // 全站候选池：排在第 24 位之后的候选项也会被轮换抽中进入前 18 个展示位
    const tailBuildingIds = new Set(buildings.slice(24).map((b) => b.id))
    const tailListingIds = new Set(listings.slice(24).map((l) => l.id))
    expect(hp.featuredBuildings.some((b) => tailBuildingIds.has(b.id))).toBe(true)
    expect(hp.featuredListings.some((l) => tailListingIds.has(l.id))).toBe(true)
  })

  it('同一桶号结果稳定', async () => {
    const buildings = makeBuildings(48)
    const listings = makeListings(48, 48)
    const first = await getHomepage(ctx, { bucket: 800 }, adapterWith(buildings, listings).adapter)
    const second = await getHomepage(ctx, { bucket: 800 }, adapterWith(buildings, listings).adapter)
    expect(first.featuredBuildings.map((b) => b.id))
      .toEqual(second.featuredBuildings.map((b) => b.id))
    expect(first.featuredListings.map((l) => l.id))
      .toEqual(second.featuredListings.map((l) => l.id))
  })

  it('跨桶顺序变化', async () => {
    const buildings = makeBuildings(48)
    const listings = makeListings(48, 48)
    const a = await getHomepage(ctx, { bucket: 801 }, adapterWith(buildings, listings).adapter)
    const b = await getHomepage(ctx, { bucket: 802 }, adapterWith(buildings, listings).adapter)
    expect(a.featuredBuildings.map((x) => x.id))
      .not.toEqual(b.featuredBuildings.map((x) => x.id))
    expect(a.featuredListings.map((x) => x.id))
      .not.toEqual(b.featuredListings.map((x) => x.id))
  })

  it('前两个置顶位不被洗掉（楼盘与房源）', async () => {
    const buildings = makeBuildings(48)
    const listings = makeListings(48, 48)
    const hp = await getHomepage(ctx, { bucket: 803 }, adapterWith(buildings, listings).adapter)
    expect(hp.featuredBuildings.slice(0, 2).map((b) => b.id))
      .toEqual(buildings.slice(0, 2).map((b) => b.id))
    expect(hp.featuredListings.slice(0, 2).map((l) => l.id))
      .toEqual(listings.slice(0, 2).map((l) => l.id))
  })

  it('同商圈最多 2 个（供给充足时）', async () => {
    const buildings = makeBuildings(48, 3)
    const listings = makeListings(48, 48)
    const hp = await getHomepage(ctx, { bucket: 804 }, adapterWith(buildings, listings).adapter)

    const byArea = new Map<string, number>()
    for (const building of hp.featuredBuildings) {
      const slug = building.businessDistrict?.slug ?? building.district?.slug ?? building.slug
      byArea.set(slug, (byArea.get(slug) ?? 0) + 1)
    }
    // 前 2 个置顶位同属商圈 area-300，上限按「置顶已占 2 个」计，其余商圈应 ≤2
    expect(Math.max(...byArea.values())).toBeLessThanOrEqual(2)
  })

  it('精选不足时补位排在精选之后，且补位项同样在全站候选池中轮换', async () => {
    const buildings = makeBuildings(48)
    const listings = makeListings(48, 3)
    const hpA = await getHomepage(ctx, { bucket: 805 }, adapterWith(buildings, listings).adapter)
    const hpB = await getHomepage(ctx, { bucket: 806 }, adapterWith(buildings, listings).adapter)
    expect(hpA.featuredListings).toHaveLength(18)
    expect(hpA.featuredListings.slice(0, 3).every((l) => l.isFeatured)).toBe(true)
    expect(hpA.featuredListings.slice(3).every((l) => !l.isFeatured)).toBe(true)
    expect(hpA.featuredListings.slice(3).map((l) => l.id))
      .not.toEqual(hpB.featuredListings.slice(3).map((l) => l.id))
  })
})
