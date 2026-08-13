import { beforeEach, describe, expect, it, vi } from 'vitest'

const sitemapIo = vi.hoisted(() => ({
  getCachedPublishedArticles: vi.fn(),
  getCachedPublishedPages: vi.fn(),
  getCachedSearchBuildings: vi.fn(),
  getCachedSearchListings: vi.fn(),
  listPublicCityProfiles: vi.fn(),
}))

vi.mock('next/cache', () => ({
  unstable_cache: <T extends (...args: never[]) => unknown>(loader: T) => loader,
}))
vi.mock('@/lib/frontend/site-config', () => ({
  siteConfig: { siteOrigin: 'https://example.com', defaultCity: 'shanghai' },
}))
vi.mock('@/app/(frontend)/_lib/city-context', () => ({
  listPublicCityProfiles: sitemapIo.listPublicCityProfiles,
}))
vi.mock('@/lib/frontend/cached-queries', () => ({
  getCachedPublishedArticles: sitemapIo.getCachedPublishedArticles,
  getCachedPublishedPages: sitemapIo.getCachedPublishedPages,
  getCachedSearchBuildings: sitemapIo.getCachedSearchBuildings,
  getCachedSearchListings: sitemapIo.getCachedSearchListings,
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
  mediaCount = 3,
): ParityListing {
  const owningCity = typeof parent.city === 'object' ? parent.city : null
  return {
    id,
    title: `${slug} listing`,
    slug,
    listingType: 'traditional-office',
    building: parent,
    rent: id,
    rentUnit: 'rmb-month',
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
      status: 'active',
      qualificationStatus: 'valid',
      qualificationExpiresAt: '2027-08-13T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    },
    gallery: Array.from({ length: mediaCount }, (_, index) => ({ image: index + 1 })),
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
  listing(2002, 'suzhou-two', suzhouBuilding),
  listing(3001, 'shanghai-ineligible', shanghaiBuilding, 2),
  listing(3002, 'suzhou-ineligible', suzhouBuilding, 2),
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
      mediaCount: item.gallery?.length ?? 0,
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
    async sumEffectiveLeasableAreaByBuildings() { return new Map() },
    async findEffectiveBuildingsNear() { return [] },
    async findEffectiveBuildings(ctx) {
      return buildings.filter((item) => typeof item.city === 'object' && item.city?.slug === ctx.city)
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
    sitemapIo.getCachedSearchBuildings.mockImplementation(async (citySlug: string) =>
      searchBuildings(createSearchContext(citySlug, AS_OF), adapter),
    )
    sitemapIo.getCachedPublishedPages.mockResolvedValue([])
    sitemapIo.getCachedPublishedArticles.mockResolvedValue({ docs: [], page: 1, totalPages: 1 })
  })

  it.each([
    ['shanghai', [1001, 1002]],
    ['suzhou', [2001, 2002]],
  ] as const)('%s consumers agree on the effective listing set', async (citySlug, expectedIds) => {
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
    expect(sitemapIds.sort()).toEqual([...expectedIds])
  })
})
