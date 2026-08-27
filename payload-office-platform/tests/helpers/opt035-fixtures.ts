/**
 * OPT-035 首页 Apple 改版：跨测试文件共用的 fixture 构造器。
 *
 * 从 tests/opt035-homepage-stats.test.ts（Task 3）抽出，供
 * tests/opt035-platform-stats.test.ts（Task 4）复用，避免两份测试各自维护
 * 一套几乎相同的 makeListing / makeBuilding / makeArea / makeHomepageAdapter。
 *
 * 设计依据：.superpowers/sdd/2026-08-20-homepage-apple-redesign/task-4-brief.md
 */
import type { Building, Listing, Location, Media } from '@/payload-types'
import type { SupplyAdapter } from '@/domain/public-catalog/supply-adapter'

export const MEDIA_1: Media = {
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

/**
 * OPT-059 最终审查修复：带派生尺寸 + 焦点的媒体夹具。
 *
 * 供 `getHomepage` 的 `typeSummaries.cover` 回归测试用——断言它带完整
 * `variants`（而房源卡片链路的 `coverImage.variants` 仍必须是 `undefined`，
 * 见 `tests/opt035-homepage-stats.test.ts`）。
 */
export const MEDIA_WITH_SIZES: Media = {
  ...MEDIA_1,
  id: 9002,
  focalX: 30,
  focalY: 70,
  sizes: {
    thumb: { url: '/media/type-thumb.webp', width: 320 },
    card: { url: '/media/type-card.webp', width: 768 },
    hero: { url: '/media/type-hero.webp', width: 1600 },
  },
} as unknown as Media

export const CITY_SHANGHAI: Location = {
  id: 100,
  name: '上海',
  slug: 'shanghai',
  type: 'city',
  immutableCode: 'CITY-SH',
  status: 'active',
  updatedAt: '2026-07-01T00:00:00.000Z',
  createdAt: '2026-07-01T00:00:00.000Z',
}

export const DISTRICT_JINGAN: Location = {
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

export function makeBuilding(
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

export function makeArea(overrides: Partial<Location> & { id: number }): Location {
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

export type ListingOverrides = Partial<Listing> & {
  id: number
  buildingCoords?: Readonly<{ latitude: number; longitude: number }>
}

export function makeListing(overrides: ListingOverrides): Listing {
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

export function makeHomepageAdapter(over: Partial<SupplyAdapter> = {}): SupplyAdapter {
  return {
    findFeaturedListings: async () => [],
    findEffectiveListings: async () => [],
    findEffectiveDistricts: async () => [],
    findEffectiveBusinessAreas: async () => [],
    findFeaturedBuildings: async () => [],
    findEffectiveBuildings: async () => [],
    findLatestArticles: async () => [],
    findCityCenter: async () => null,
    // 其余接口方法 getHomepage / getPlatformHomepageStats 不使用，调用即失败，暴露未预期依赖
    findEffectiveListingsSitemapPage: () => { throw new Error('not used by getHomepage') },
    findEffectiveListingBySlug: () => { throw new Error('not used by getHomepage') },
    findListingRouteIdentity: () => { throw new Error('not used by getHomepage') },
    findEffectiveBuildingBySlug: () => { throw new Error('not used by getHomepage') },
    findBuildingRouteIdentity: () => { throw new Error('not used by getHomepage') },
    findEffectiveListingsByBuilding: () => { throw new Error('not used by getHomepage') },
    aggregateEffectiveSupplyByBuildings: async () => new Map(),
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
