import { describe, expect, it } from 'vitest'
import type { Building } from '@/payload-types'

import { getHomepage } from '@/domain/public-catalog/facade'
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
  return Array.from({ length: count }, (_, index) => {
    const areaId = 300 + Math.floor(index / groupSize)
    return makeBuilding({
      id: 200 + index,
      updatedAt: `2026-07-${String(28 - (index % 28)).padStart(2, '0')}T00:00:00.000Z`,
      businessDistrict: makeArea({ id: areaId, name: `商圈${areaId}`, slug: `area-${areaId}` }),
    })
  })
}

function makeListings(count: number, featured: number) {
  return Array.from({ length: count }, (_, index) => {
    const areaId = 400 + Math.floor(index / 3)
    return makeListing({
      id: 100 + index,
      isFeatured: index < featured,
      building: makeBuilding({
        id: 900 + index,
        businessDistrict: makeArea({ id: areaId, name: `商圈${areaId}`, slug: `area-${areaId}` }),
      }),
      updatedAt: `2026-07-${String(28 - (index % 28)).padStart(2, '0')}T00:00:00.000Z`,
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
  it('候选池按展示张数的 3 倍（至少 24）拉取', async () => {
    const { adapter, requested } = adapterWith(makeBuildings(30), makeListings(30, 30))
    await getHomepage(ctx, { bucket: 700 }, adapter)
    expect(requested.buildings).toBe(24)
    expect(requested.listings).toBe(24)
  })

  it('同一桶号结果稳定', async () => {
    const buildings = makeBuildings(24)
    const listings = makeListings(24, 24)
    const first = await getHomepage(ctx, { bucket: 800 }, adapterWith(buildings, listings).adapter)
    const second = await getHomepage(ctx, { bucket: 800 }, adapterWith(buildings, listings).adapter)
    expect(first.featuredBuildings.map((b) => b.id))
      .toEqual(second.featuredBuildings.map((b) => b.id))
    expect(first.featuredListings.map((l) => l.id))
      .toEqual(second.featuredListings.map((l) => l.id))
  })

  it('跨桶顺序变化', async () => {
    const buildings = makeBuildings(24)
    const listings = makeListings(24, 24)
    const a = await getHomepage(ctx, { bucket: 801 }, adapterWith(buildings, listings).adapter)
    const b = await getHomepage(ctx, { bucket: 802 }, adapterWith(buildings, listings).adapter)
    expect(a.featuredBuildings.map((x) => x.id))
      .not.toEqual(b.featuredBuildings.map((x) => x.id))
    expect(a.featuredListings.map((x) => x.id))
      .not.toEqual(b.featuredListings.map((x) => x.id))
  })

  it('前两个置顶位不被洗掉（楼盘与房源）', async () => {
    const buildings = makeBuildings(24)
    const listings = makeListings(24, 24)
    const hp = await getHomepage(ctx, { bucket: 803 }, adapterWith(buildings, listings).adapter)
    expect(hp.featuredBuildings.slice(0, 2).map((b) => b.id))
      .toEqual(buildings.slice(0, 2).map((b) => b.id))
    expect(hp.featuredListings.slice(0, 2).map((l) => l.id))
      .toEqual(listings.slice(0, 2).map((l) => l.id))
  })

  it('同商圈最多 2 个（供给充足时）', async () => {
    const buildings = makeBuildings(24, 3)
    const listings = makeListings(24, 24)
    const hp = await getHomepage(ctx, { bucket: 804 }, adapterWith(buildings, listings).adapter)

    const byArea = new Map<string, number>()
    for (const building of hp.featuredBuildings) {
      const slug = building.businessDistrict?.slug ?? building.district?.slug ?? building.slug
      byArea.set(slug, (byArea.get(slug) ?? 0) + 1)
    }
    // 前 2 个置顶位同属商圈 area-300，上限按「置顶已占 2 个」计，其余商圈应 ≤2
    expect(Math.max(...byArea.values())).toBeLessThanOrEqual(2)
  })

  it('精选不足时补位排在精选之后', async () => {
    const buildings = makeBuildings(24)
    const listings = makeListings(24, 3)
    const hp = await getHomepage(ctx, { bucket: 805 }, adapterWith(buildings, listings).adapter)
    expect(hp.featuredListings).toHaveLength(8)
    expect(hp.featuredListings.slice(0, 3).every((l) => l.isFeatured)).toBe(true)
    expect(hp.featuredListings.slice(3).every((l) => !l.isFeatured)).toBe(true)
  })
})
