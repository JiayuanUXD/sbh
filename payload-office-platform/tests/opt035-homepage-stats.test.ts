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
import type { SupplyAdapter } from '@/domain/public-catalog/supply-adapter'
import type { Building, Listing, Location, Media } from '@/payload-types'

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

// ---------------------------------------------------------------------------
// getHomepage：stats / typeSummaries / nearbyListings（构造工具抄 f7-6 测试
// 的 makeValidListing / 生产等价基线，仅保留能通过 mapListingCard 映射的最小字段）
// ---------------------------------------------------------------------------

const MEDIA_1: Media = {
  id: 9001,
  alt: '图1',
  url: '/media/m1.jpg',
  filename: 'm1.jpg',
  mimeType: 'image/jpeg',
  updatedAt: '2026-07-01T00:00:00.000Z',
  createdAt: '2026-07-01T00:00:00.000Z',
  width: 1280,
  height: 960,
}

const CITY_SHANGHAI: Location = {
  id: 100,
  name: '上海',
  slug: 'shanghai',
  type: 'city',
  immutableCode: 'CITY-SH',
  status: 'active',
  updatedAt: '2026-07-01T00:00:00.000Z',
  createdAt: '2026-07-01T00:00:00.000Z',
}

const DISTRICT_JINGAN: Location = {
  id: 1,
  name: '静安',
  slug: 'jingan',
  type: 'district',
  immutableCode: 'TEST-1',
  status: 'active',
  parent: 100,
  updatedAt: '2026-07-01T00:00:00.000Z',
  createdAt: '2026-07-01T00:00:00.000Z',
}

function makeBuilding(
  overrides: Partial<Building> & { id: number },
): Building {
  return {
    name: `楼盘${overrides.id}`,
    slug: `building-${overrides.id}`,
    status: 'published',
    operationalStatus: 'active',
    buildingType: 'office_building',
    grade: 'grade-a',
    verificationStatus: 'verified',
    city: CITY_SHANGHAI,
    district: DISTRICT_JINGAN,
    address: '上海市静安区南京西路 1788 号',
    coverImage: MEDIA_1,
    gallery: null,
    amenities: null,
    summary: '',
    description: null,
    updatedAt: '2026-07-10T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as unknown as Building
}

function makeArea(overrides: Partial<Location> & { id: number }): Location {
  return {
    name: `商圈${overrides.id}`,
    slug: `area-${overrides.id}`,
    type: 'business_area',
    immutableCode: `AREA-${overrides.id}`,
    status: 'active',
    parent: DISTRICT_JINGAN.id,
    updatedAt: '2026-07-01T00:00:00.000Z',
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  } as unknown as Location
}

type ListingOverrides = Partial<Listing> & {
  id: number
  buildingCoords?: Readonly<{ latitude: number; longitude: number }>
}

function makeListing(overrides: ListingOverrides): Listing {
  const { buildingCoords, ...rest } = overrides
  const building = makeBuilding({
    id: 1000 + overrides.id,
    ...(buildingCoords
      ? { latitude: buildingCoords.latitude, longitude: buildingCoords.longitude }
      : {}),
  })
  return {
    title: `房源${overrides.id}`,
    slug: `listing-${overrides.id}`,
    status: 'available',
    listingType: 'traditional-office',
    building,
    rent: 25000,
    rentUnit: 'rmb-month',
    area: 100,
    seats: 12,
    availableFrom: '2026-08-01',
    isFeatured: false,
    coverImage: MEDIA_1,
    gallery: [{ image: MEDIA_1, id: 'g1' }],
    highlights: [{ text: '亮点', id: 'h1' }],
    description: null,
    publicationStatus: 'published',
    reviewStatus: 'approved',
    supplyVisibilityHold: 'normal',
    updatedAt: '2026-07-15T00:00:00.000Z',
    createdAt: '2026-06-01T00:00:00.000Z',
    ...rest,
  } as unknown as Listing
}

function makeHomepageAdapter(over: Partial<SupplyAdapter> = {}): SupplyAdapter {
  return {
    findFeaturedListings: async () => [],
    findEffectiveListings: async () => [],
    findEffectiveDistricts: async () => [],
    findEffectiveBusinessAreas: async () => [],
    findFeaturedBuildings: async () => [],
    findEffectiveBuildings: async () => [],
    findLatestArticles: async () => [],
    findCityCenter: async () => null,
    // 其余接口方法 getHomepage 不使用，调用即失败，暴露未预期依赖
    findEffectiveListingsSitemapPage: () => { throw new Error('not used by getHomepage') },
    findEffectiveListingBySlug: () => { throw new Error('not used by getHomepage') },
    findListingRouteIdentity: () => { throw new Error('not used by getHomepage') },
    findEffectiveBuildingBySlug: () => { throw new Error('not used by getHomepage') },
    findBuildingRouteIdentity: () => { throw new Error('not used by getHomepage') },
    findEffectiveListingsByBuilding: () => { throw new Error('not used by getHomepage') },
    sumEffectiveLeasableAreaByBuildings: async () => new Map(),
    findEffectiveBuildingsNear: () => { throw new Error('not used by getHomepage') },
    findEffectiveBuildingsPage: () => { throw new Error('not used by getHomepage') },
    assertEffectiveListingBySlug: () => { throw new Error('not used by getHomepage') },
    findPublishedPageBySlug: () => { throw new Error('not used by getHomepage') },
    findPublishedPages: () => { throw new Error('not used by getHomepage') },
    findPublishedArticles: () => { throw new Error('not used by getHomepage') },
    findPublishedArticleBySlug: () => { throw new Error('not used by getHomepage') },
    ...over,
  } as SupplyAdapter
}

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
