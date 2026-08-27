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
  MEDIA_WITH_SIZES,
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

  // --- 最终审查修复 A：typeSummaries 的 srcset 链路 -------------------------
  //
  // `HomeTypeCards` 消费 `typeSummaries[type].cover`，靠它发 srcset。此前这个
  // 封面直接复用 `mapListingCard` 产出的卡片封面——那条链路为了守住 OPT-047 的
  // 2MB 缓存红线，刻意把 `variants` 设成了 undefined，导致类型卡永远发不出
  // srcset（连 sizes 也因为 Media.tsx 的 `sizes={srcSet ? sizes : undefined}`
  // 一并消失），页面 200、无报错、静默失效。facade 现在对 typeSummaries 的封面
  // 走 `mapListingCoverFull` 单独重新投影，这里锁住两头：typeSummaries 的封面
  // 必须带 variants，而房源卡片链路（featuredListings）的封面必须继续不带——
  // 两条一起断言，防止后来者用「把 variants 加回卡片」的方式误修 A。
  it('typeSummaries.cover 带完整 variants，同一份数据下房源卡片链路的 coverImage.variants 仍是 undefined', async () => {
    const listing = makeListing({ id: 1, listingType: 'coworking', coverImage: MEDIA_WITH_SIZES })
    const adapter = makeHomepageAdapter({
      findFeaturedListings: async () => [listing],
      findEffectiveListings: async () => [listing],
    })
    const hp = await getHomepage(ctx, {}, adapter)

    expect(hp.typeSummaries['coworking']?.cover?.variants).toEqual([
      { src: '/media/type-thumb.webp', width: 320 },
      { src: '/media/type-card.webp', width: 768 },
      { src: '/media/type-hero.webp', width: 1600 },
    ])
    expect(hp.typeSummaries['coworking']?.cover?.focal).toEqual({ x: 30, y: 70 })

    // 反向断言：锁住 OPT-047 的红线——卡片链路（featuredListings 的封面走
    // mapListingCard）不能因为这次修复被顺带打开。
    expect(hp.featuredListings[0]?.coverImage?.variants).toBeUndefined()
  })

  it('typeSummaries.cover 的完整封面口径与卡片链路一致：房源自身无封面时回退楼盘封面', async () => {
    const building = makeBuilding({ id: 2001, coverImage: MEDIA_WITH_SIZES })
    const listing = makeListing({
      id: 2,
      listingType: 'full-floor',
      building,
      coverImage: null,
    })
    const adapter = makeHomepageAdapter({
      findEffectiveListings: async () => [listing],
    })
    const hp = await getHomepage(ctx, {}, adapter)

    expect(hp.typeSummaries['full-floor']?.cover?.variants).toEqual([
      { src: '/media/type-thumb.webp', width: 320 },
      { src: '/media/type-card.webp', width: 768 },
      { src: '/media/type-hero.webp', width: 1600 },
    ])
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
