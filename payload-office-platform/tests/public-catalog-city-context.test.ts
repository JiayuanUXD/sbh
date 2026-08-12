import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'

const payloadState = vi.hoisted(() => ({
  find: vi.fn<(params: Record<string, unknown>) => Promise<Record<string, unknown>>>(),
  findByID: vi.fn<(params: Record<string, unknown>) => Promise<Record<string, unknown>>>(),
  query: vi.fn<(
    text: string,
    values: unknown[],
  ) => Promise<{ rows: Array<{ id?: number; bid?: number; total?: number }> }>>(),
}))

vi.mock('payload', () => ({
  getPayload: async () => ({
    find: payloadState.find,
    findByID: payloadState.findByID,
    db: { pool: { query: payloadState.query } },
  }),
}))

vi.mock('@/payload.config', () => ({ default: {} }))

import {
  assertEffectiveListing,
  createSearchContext,
  createPayloadSupplyAdapter,
  getHomepage,
  getListingBySlug,
  getRelatedListings,
  getSearchFacets,
  parseSearchInput,
  searchListings,
  type SearchContext,
} from '@/domain/public-catalog'

const AS_OF = '2026-08-13T00:00:00.000Z'

function effectiveListing(
  id: number,
  city: Readonly<{ id: number; slug: string }>,
): Record<string, unknown> {
  return {
    id,
    slug: `${city.slug}-effective-office`,
    title: `${city.slug} effective office`,
    listingType: 'traditional-office',
    rent: id,
    rentUnit: 'rmb-month',
    area: id,
    isFeatured: true,
    publicationStatus: 'published',
    reviewStatus: 'approved',
    supplyVisibilityHold: 'normal',
    gallery: [{ image: 1 }, { image: 2 }, { image: 3 }],
    building: {
      id: id * 10,
      slug: `${city.slug}-building`,
      name: `${city.slug} building`,
      status: 'published',
      operationalStatus: 'active',
      address: `${city.slug} address`,
      city: { ...city, status: 'active' },
      district: {
        id: id * 10 + 1,
        slug: `${city.slug}-district`,
        name: `${city.slug} district`,
        status: 'active',
      },
    },
  }
}

function activeRelation(
  listingId: number,
  cityId: number,
): Record<string, unknown> {
  return {
    id: listingId + 10_000,
    listing: listingId,
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    effectiveTo: null,
    merchant: {
      id: listingId + 20_000,
      status: 'active',
      qualificationStatus: 'valid',
      qualificationExpiresAt: '2027-01-01T00:00:00.000Z',
      serviceCities: [{ id: cityId }],
    },
  }
}

describe('required city in public catalog context', () => {
  const shanghai = effectiveListing(101, { id: 1, slug: 'shanghai' })
  const hangzhou = effectiveListing(202, { id: 2, slug: 'hangzhou' })
  const listings = [shanghai, hangzhou]
  const buildings = listings.map((listing) => listing.building as Record<string, unknown>)
  const context = createSearchContext('hangzhou', new Date(AS_OF))

  beforeEach(() => {
    payloadState.find.mockReset()
    payloadState.findByID.mockReset()
    payloadState.query.mockReset()
    payloadState.findByID.mockImplementation(async (params) => {
      const building = buildings.find((candidate) => candidate.id === params.id)
      return building ?? {}
    })
    payloadState.query.mockImplementation(async (text, values) => {
      if (text.includes('SUM(l.area)')) {
        const requestedIds = Array.isArray(values[1]) ? values[1].map(Number) : []
        const requestedCity = typeof values[2] === 'string' ? values[2] : null
        const rows = listings.flatMap((candidate) => {
          const building = candidate.building as { id: number; city: { slug: string } }
          if (!requestedIds.includes(building.id) || building.city.slug !== requestedCity) return []
          return [{ bid: building.id, total: Number(candidate.area) }]
        })
        return { rows }
      }
      const requestedCity = typeof values[3] === 'string' ? values[3] : null
      const buildingId = Number(values[1])
      const listing = listings.find((candidate) => {
        const building = candidate.building as { id: number; city: { slug: string } }
        return building.id === buildingId && building.city.slug === requestedCity
      })
      return listing ? { rows: [{ id: Number(listing.id) }] } : { rows: [] }
    })
    payloadState.find.mockImplementation(async (params) => {
      if (params.collection === 'listing-reports') {
        return { docs: [], hasNextPage: false, nextPage: null }
      }
      if (params.collection === 'listings') {
        const where = params.where as Record<string, unknown>
        const cityFilter = where['building.city.slug'] as { equals?: string } | undefined
        const slugFilter = where.slug as { equals?: string } | undefined
        const idFilter = where.id as { in?: number[]; not_in?: number[] } | undefined
        const docs = listings.filter((listing) => {
          const building = listing.building as { city: { slug: string } }
          return (
            (!cityFilter?.equals || building.city.slug === cityFilter.equals) &&
            (!slugFilter?.equals || listing.slug === slugFilter.equals) &&
            (!idFilter?.in || idFilter.in.includes(Number(listing.id))) &&
            (!idFilter?.not_in || !idFilter.not_in.includes(Number(listing.id)))
          )
        })
        return { docs, hasNextPage: false, nextPage: null }
      }
      if (params.collection === 'buildings') {
        const where = params.where as Record<string, unknown>
        const cityFilter = where['city.slug'] as { equals?: string } | undefined
        const slugFilter = where.slug as { equals?: string } | undefined
        const docs = buildings.filter((building) => {
          const city = building.city as { slug: string }
          return (
            (!cityFilter?.equals || city.slug === cityFilter.equals) &&
            (!slugFilter?.equals || building.slug === slugFilter.equals)
          )
        })
        return { docs, totalDocs: docs.length, hasNextPage: false, nextPage: null }
      }
      if (params.collection === 'locations') {
        const where = params.where as Record<string, unknown>
        const requestedCity = (
          (where['parent.slug'] ?? where['parent.parent.slug']) as { equals?: string } | undefined
        )?.equals
        const docs = requestedCity
          ? [{
              id: requestedCity === 'hangzhou' ? 2021 : 1011,
              slug: `${requestedCity}-district`,
              name: `${requestedCity} district`,
              type: 'district',
              status: 'active',
            }]
          : []
        return { docs, totalDocs: docs.length, hasNextPage: false, nextPage: null }
      }
      if (params.collection === 'articles' || params.collection === 'pages') {
        return { docs: [], totalDocs: 0, hasNextPage: false, nextPage: null }
      }
      if (params.collection === 'listing-merchant-relations') {
        return {
          docs: [activeRelation(101, 1), activeRelation(202, 2)],
          hasNextPage: false,
          nextPage: null,
        }
      }
      throw new Error(`unexpected collection ${String(params.collection)}`)
    })
  })

  it('requires and normalizes a non-empty city', () => {
    expectTypeOf<SearchContext>().toMatchTypeOf<{ city: string }>()
    expect(createSearchContext(' HANGZHOU ', new Date(AS_OF))).toEqual({
      asOf: AS_OF,
      timezone: 'Asia/Shanghai',
      channel: 'public-web',
      city: 'hangzhou',
    })
    expect(() => createSearchContext('   ', new Date(AS_OF))).toThrow(
      'search_context_city_required',
    )
  })

  it('keeps list and direct detail results inside the requested city', async () => {
    const adapter = createPayloadSupplyAdapter()

    const list = await adapter.findEffectiveListings(
      parseSearchInput(new URLSearchParams()),
      context,
    )
    const crossCityDetail = await adapter.findEffectiveListingBySlug(
      'shanghai-effective-office',
      context,
    )

    expect(list.map((listing) => listing.id)).toEqual([202])
    expect(crossCityDetail).toBeNull()
    const listingWheres = payloadState.find.mock.calls
      .map(([params]) => params)
      .filter((params) => params.collection === 'listings')
      .map((params) => params.where as Record<string, unknown>)
    expect(listingWheres).toContainEqual(expect.objectContaining({
      'building.city.slug': { equals: 'hangzhou' },
      slug: { equals: 'shanghai-effective-office' },
    }))
  })

  it('keeps list, detail, recommendations, homepage, facets, and inquiry validation city-scoped', async () => {
    const adapter = createPayloadSupplyAdapter()
    const input = parseSearchInput(new URLSearchParams())

    const list = await searchListings(input, context, adapter)
    const detail = await getListingBySlug('shanghai-effective-office', context, adapter)
    const recommendations = await getRelatedListings(
      'shanghai-effective-office',
      context,
      { limit: 6 },
      adapter,
    )
    const homepage = await getHomepage(context, { featuredLimit: 6 }, adapter)
    const facets = await getSearchFacets(input, context, adapter)
    const inquiry = await assertEffectiveListing(
      'shanghai-effective-office',
      context,
      adapter,
    )

    expect(list.docs.map((listing) => listing.id)).toEqual([202])
    expect(detail).toBeNull()
    expect(recommendations).toEqual([])
    expect(homepage.featuredListings.map((listing) => listing.id)).toEqual([202])
    expect(facets.totalDocs).toBe(1)
    expect(facets.districts.map((district) => district.slug)).toEqual(['hangzhou-district'])
    expect(inquiry).toBeNull()
  })

  it('applies city to building, recommendation, homepage-region, and aggregate adapter paths', async () => {
    const adapter = createPayloadSupplyAdapter()

    const crossCityBuilding = await adapter.findEffectiveBuildingBySlug(
      'shanghai-building',
      context,
    )
    const buildingsInCity = await adapter.findEffectiveBuildings(context)
    const recommendations = await adapter.findEffectiveListingsByBuilding(1010, context)
    const areaSums = await adapter.sumEffectiveLeasableAreaByBuildings([1010, 2020], context)
    await adapter.findFeaturedBuildings(context)
    await adapter.findEffectiveDistricts(context)
    await adapter.findEffectiveBusinessAreas(context)

    expect(crossCityBuilding).toBeNull()
    expect(buildingsInCity.map((building) => building.id)).toEqual([2020])
    expect(recommendations).toEqual([])
    expect([...areaSums.entries()]).toEqual([['2020', 202]])
    expect(payloadState.query.mock.calls).toEqual(expect.arrayContaining([
      [expect.stringContaining('city.slug = $4'), expect.arrayContaining(['hangzhou'])],
      [expect.stringContaining('city.slug = $3'), expect.arrayContaining(['hangzhou'])],
    ]))

    const wheres = payloadState.find.mock.calls.map(([params]) => params.where)
    expect(wheres).toContainEqual(expect.objectContaining({
      'city.slug': { equals: 'hangzhou' },
    }))
    expect(wheres).toContainEqual(expect.objectContaining({
      'parent.slug': { equals: 'hangzhou' },
    }))
    expect(wheres).toContainEqual(expect.objectContaining({
      'parent.parent.slug': { equals: 'hangzhou' },
    }))
  })
})
