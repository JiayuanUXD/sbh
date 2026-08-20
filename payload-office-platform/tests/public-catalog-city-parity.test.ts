import { beforeEach, describe, expect, it, vi } from 'vitest'

const sitemapIo = vi.hoisted(() => ({
  getCachedPublishedArticles: vi.fn(),
  getCachedPublishedPages: vi.fn(),
  getCachedSitemapBuildingsPage: vi.fn(),
  getCachedSearchBuildings: vi.fn(),
  getCachedSearchListings: vi.fn(),
  getCachedSitemapListingsPage: vi.fn(),
  listPublicCityProfiles: vi.fn(),
}))

vi.mock('next/cache', () => ({
  unstable_cache: <T extends (...args: never[]) => unknown>(loader: T) => loader,
}))
vi.mock('@/lib/frontend/site-config', () => ({
  siteConfig: { siteOrigin: 'https://example.com', defaultCity: 'shanghai' },
  getMultiCityRoutingEnabled: () => true,
  // 出售功能开关：默认关闭，让既有断言在「功能不可见」这个默认态下验证。
  // 需要验证开启态的用例请在自己的文件里单独 mock 为 true。
  getSaleChannelEnabled: () => process.env.NEXT_PUBLIC_SALE_CHANNEL_ENABLED === 'true',
}))
vi.mock('@/app/(frontend)/_lib/city-context', () => ({
  listPublicCityProfiles: sitemapIo.listPublicCityProfiles,
}))
vi.mock('@/lib/frontend/cached-queries', () => ({
  getCachedPublishedArticles: sitemapIo.getCachedPublishedArticles,
  getCachedPublishedPages: sitemapIo.getCachedPublishedPages,
  getCachedSitemapBuildingsPage: sitemapIo.getCachedSitemapBuildingsPage,
  getCachedSearchBuildings: sitemapIo.getCachedSearchBuildings,
  getCachedSearchListings: sitemapIo.getCachedSearchListings,
  getCachedSitemapListingsPage: sitemapIo.getCachedSitemapListingsPage,
}))

import sitemap from '@/app/(frontend)/sitemap'
import {
  createSearchContext,
  getDetailRecommendations,
  getHomepage,
  getListingBySlug,
  getSearchFacets,
  parseSearchInput,
  searchBuildings,
  searchListings,
  searchListingsSitemapPage,
  type SearchContext,
  type SupplyAdapter,
} from '@/domain/public-catalog'
import { isListingEffectivelySupplied } from '@/domain/review/effective-supply'
import type { Building, Listing, Location, Page } from '@/payload-types'

const AS_OF = new Date('2026-08-13T00:00:00.000Z')

function city(id: number, slug: string, name: string): Location {
  return {
    id,
    immutableCode: `CITY-${id}`,
    name,
    slug,
    status: 'active',
    type: 'city',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  }
}

function district(id: number, slug: string, owningCity: Location): Location {
  return {
    id,
    immutableCode: `DISTRICT-${id}`,
    name: `${slug} district`,
    slug,
    status: 'active',
    type: 'district',
    city: owningCity,
    parent: owningCity,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  }
}

function building(id: number, slug: string, owningCity: Location, area: Location): Building {
  return {
    id,
    name: `${slug} building`,
    slug,
    status: 'published',
    operationalStatus: 'active',
    city: owningCity,
    district: area,
    address: `${owningCity.name} address`,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  }
}

type ParityListing = Listing & Readonly<{
  _relationPeriod: Readonly<{ startsAt: string; endsAt: string | null }>
}>

function listing(
  id: number,
  slug: string,
  parent: Building,
  options: Readonly<{
    listingType?: Listing['listingType']
    /**
     * 商户启停：本文件用它造「不合格房源」。
     *
     * 必须选一个**精筛层**条件：本文件的 fake adapter 只跑
     * isListingEffectivelySupplied，并不模拟查询层谓词（发布/审核/冻结），
     * 拿查询层字段当失效条件会静默失效、把对照组变成摆设。
     */
    merchantStatus?: 'active' | 'disabled'
    rentUnit?: Listing['rentUnit']
  }> = {},
): ParityListing {
  const owningCity = typeof parent.city === 'object' ? parent.city : null
  return {
    id,
    title: `${slug} listing`,
    slug,
    listingType: options.listingType ?? 'traditional-office',
    building: parent,
    rent: id,
    rentUnit: options.rentUnit ?? 'rmb-month',
    area: 100,
    isFeatured: true,
    publicationStatus: 'published',
    reviewStatus: 'approved',
    supplyVisibilityHold: 'normal',
    merchant: {
      id: id + 10_000,
      name: `${slug} merchant`,
      type: 'OWNER',
      serviceCities: owningCity ? [owningCity] : [],
      status: options.merchantStatus ?? 'active',
      qualificationStatus: 'valid',
      qualificationExpiresAt: '2027-08-13T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    },
    gallery: Array.from({ length: 3 }, (_, index) => ({ image: index + 1 })),
    _relationPeriod: { startsAt: '2026-01-01T00:00:00.000Z', endsAt: null },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  }
}

const shanghai = city(1, 'shanghai', '上海市')
const suzhou = city(2, 'suzhou', '苏州市')
const shanghaiDistrict = district(11, 'jingan', shanghai)
const suzhouDistrict = district(21, 'gusu', suzhou)
const shanghaiBuilding = building(101, 'shanghai-center', shanghai, shanghaiDistrict)
const suzhouBuilding = building(201, 'suzhou-center', suzhou, suzhouDistrict)
const listings = [
  listing(1001, 'shanghai-one', shanghaiBuilding),
  listing(1002, 'shanghai-two', shanghaiBuilding),
  listing(2001, 'suzhou-one', suzhouBuilding),
  listing(2002, 'suzhou-two', suzhouBuilding, {
    listingType: 'coworking',
    rentUnit: 'rmb-seat-month',
  }),
  // 2026-08-19 前这两条靠「图片只有 2 张」不合格；媒体数量移出可见性后
  // 改用供给可见性冻结，保持「每城都有一条不该出现的房源」这个对照组。
  listing(3001, 'shanghai-ineligible', shanghaiBuilding, { merchantStatus: 'disabled' }),
  listing(3002, 'suzhou-ineligible', suzhouBuilding, { merchantStatus: 'disabled' }),
] as const
const buildings = [shanghaiBuilding, suzhouBuilding] as const
const districts = [shanghaiDistrict, suzhouDistrict] as const

function owningCitySlug(value: Listing): string | null {
  const parent = typeof value.building === 'object' ? value.building : null
  const owningCity = parent && typeof parent.city === 'object' ? parent.city : null
  return owningCity?.slug ?? null
}

function createParityAdapter(): SupplyAdapter {
  const cityListings = (ctx: SearchContext) => listings.filter((item) => {
    if (owningCitySlug(item) !== ctx.city) return false
    const parent = typeof item.building === 'object' ? item.building : null
    const owningCity = parent && typeof parent.city === 'object' ? parent.city : null
    const merchant = typeof item.merchant === 'object' ? item.merchant : null
    return isListingEffectivelySupplied({
      merchant: {
        status: merchant?.status,
        qualificationStatus: merchant?.qualificationStatus,
        qualificationExpiresAt: merchant?.qualificationExpiresAt,
        serviceCityIds: merchant?.serviceCities?.flatMap((candidate) =>
          typeof candidate === 'object' ? [candidate.id] : [candidate],
        ) ?? [],
      },
      buildingCityId: owningCity?.id ?? null,
      relationPeriod: item._relationPeriod,
    }, new Date(ctx.asOf)).eligible
  })
  return {
    async findEffectiveListings(_input, ctx) { return cityListings(ctx) },
    // sitemap 专用查询必须走同一个 cityListings：这组用例的意义就是「两条不同的
    // 代码路径得出同一个有效集合」，桩若返回空集，parity 断言直接退化成永真。
    async findEffectiveListingsSitemapPage(ctx, options) {
      const all = cityListings(ctx)
      const page = Math.max(1, Math.floor(options.page))
      const limit = Math.min(500, Math.max(1, Math.floor(options.limit)))
      const from = (page - 1) * limit
      const slice = all.slice(from, from + limit)
      const more = from + limit < all.length
      return {
        docs: slice.map((item) => ({
          slug: item.slug,
          updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : null,
          businessType:
            typeof item.businessType === 'string' ? item.businessType : null,
        })),
        page,
        hasNextPage: more,
        nextPage: more ? page + 1 : null,
      }
    },
    async findEffectiveListingBySlug(slug, ctx) {
      return cityListings(ctx).find((item) => item.slug === slug) ?? null
    },
    async findListingRouteIdentity() { return null },
    async findEffectiveBuildingBySlug(slug, ctx) {
      return buildings.find((item) => item.slug === slug && item.city === (ctx.city === 'shanghai' ? shanghai : suzhou)) ?? null
    },
    async findBuildingRouteIdentity() { return null },
    async findEffectiveListingsByBuilding(buildingId, ctx, excludeListingId) {
      return cityListings(ctx).filter((item) => {
        const parentId = typeof item.building === 'object' ? item.building.id : item.building
        return parentId === buildingId && item.id !== excludeListingId
      })
    },
    async aggregateEffectiveSupplyByBuildings() { return new Map() },
    async findEffectiveBuildingsNear() { return [] },
    async findEffectiveBuildings(ctx) {
      return buildings.filter((item) => typeof item.city === 'object' && item.city?.slug === ctx.city)
    },
    async findEffectiveBuildingsPage(ctx, { page, limit }) {
      const all = buildings.filter(
        (item) => typeof item.city === 'object' && item.city?.slug === ctx.city,
      )
      const docs = all.slice((page - 1) * limit, page * limit)
      return {
        docs,
        page,
        hasNextPage: page * limit < all.length,
        nextPage: page * limit < all.length ? page + 1 : null,
      }
    },
    async findFeaturedListings(ctx) { return cityListings(ctx).filter((item) => item.isFeatured) },
    async findFeaturedBuildings() { return [] },
    async findLatestArticles() { return [] },
    async findPublishedArticles() { return { docs: [], totalDocs: 0 } },
    async findPublishedArticleBySlug() { return null },
    async findEffectiveDistricts(ctx) {
      return districts.filter((item) => typeof item.city === 'object' && item.city?.slug === ctx.city)
    },
    async findEffectiveBusinessAreas() { return [] },
    async assertEffectiveListingBySlug(slug, ctx) {
      return cityListings(ctx).find((item) => item.slug === slug) ?? null
    },
    async findPublishedPageBySlug() { return null },
    async findPublishedPages() { return [] as readonly Page[] },
  }
}

describe('per-city effective listing parity matrix', () => {
  const adapter = createParityAdapter()
  const input = parseSearchInput(new URLSearchParams())

  beforeEach(() => {
    vi.clearAllMocks()
    sitemapIo.listPublicCityProfiles.mockResolvedValue([
      { citySlug: 'shanghai', serviceStatus: 'live' },
      { citySlug: 'suzhou', serviceStatus: 'live' },
    ])
    sitemapIo.getCachedSearchListings.mockImplementation(async (citySlug: string) =>
      searchListings(input, createSearchContext(citySlug, AS_OF), adapter),
    )
    sitemapIo.getCachedSitemapListingsPage.mockImplementation(
      async (citySlug: string, page: number, limit: number) =>
        searchListingsSitemapPage(createSearchContext(citySlug, AS_OF), { page, limit }, adapter),
    )
    sitemapIo.getCachedSearchBuildings.mockImplementation(async (citySlug: string) =>
      searchBuildings(createSearchContext(citySlug, AS_OF), adapter),
    )
    sitemapIo.getCachedSitemapBuildingsPage.mockResolvedValue({
      docs: [],
      hasNextPage: false,
      nextPage: null,
      page: 1,
    })
    sitemapIo.getCachedPublishedPages.mockResolvedValue([])
    sitemapIo.getCachedPublishedArticles.mockResolvedValue({ docs: [], page: 1, totalPages: 1 })
  })

  it.each([
    ['shanghai', [1001, 1002], {
      districts: [{ count: 2, slug: 'jingan' }],
      listingTypes: [{ count: 2, value: 'traditional-office' }],
      rentUnits: [{ count: 2, value: 'rmb-month' }],
    }],
    ['suzhou', [2001, 2002], {
      districts: [{ count: 2, slug: 'gusu' }],
      listingTypes: [
        { count: 1, value: 'traditional-office' },
        { count: 1, value: 'coworking' },
      ],
      rentUnits: [
        { count: 1, value: 'rmb-month' },
        { count: 1, value: 'rmb-seat-month' },
      ],
    }],
  ] as const)('%s consumers agree on the effective listing set', async (
    citySlug,
    expectedIds,
    expectedFacets,
  ) => {
    const ctx = createSearchContext(citySlug, AS_OF)
    const [home, list, facets, sitemapEntries] = await Promise.all([
      getHomepage(ctx, { featuredLimit: 8 }, adapter),
      searchListings(input, ctx, adapter),
      getSearchFacets(input, ctx, adapter),
      sitemap(),
    ])
    const detailIds = (await Promise.all(
      listings.map((item) => getListingBySlug(item.slug, ctx, adapter)),
    )).flatMap((item) => item ? [item.id] : [])
    const recommendationIds = new Set<number>()
    for (const item of list.docs) {
      const recommendations = await getDetailRecommendations(item.slug, ctx, { limit: 8 }, adapter)
      for (const recommendation of recommendations) recommendationIds.add(recommendation.card.id)
    }
    const sitemapIds = sitemapEntries.flatMap(({ url }) => {
      const slug = url.match(new RegExp(`/${citySlug}/listings/([^/?]+)$`))?.[1]
      const item = listings.find((candidate) => candidate.slug === slug)
      return item ? [item.id] : []
    })

    expect(home.featuredListings.map((item) => item.id).sort()).toEqual([...expectedIds])
    expect(list.docs.map((item) => item.id).sort()).toEqual([...expectedIds])
    expect(detailIds.sort()).toEqual([...expectedIds])
    expect([...recommendationIds].sort()).toEqual([...expectedIds])
    expect(facets.totalDocs).toBe(expectedIds.length)
    expect(facets.districts.map(({ count, slug }) => ({ count, slug }))).toEqual(
      expectedFacets.districts,
    )
    expect(facets.listingTypes).toEqual(expectedFacets.listingTypes)
    expect(facets.rentUnits).toEqual(expectedFacets.rentUnits)
    expect(sitemapIds.sort()).toEqual([...expectedIds])
  })
})
