import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'

const payloadState = vi.hoisted(() => ({
  find: vi.fn<(params: Record<string, unknown>) => Promise<Record<string, unknown>>>(),
  findByID: vi.fn<(params: Record<string, unknown>) => Promise<Record<string, unknown>>>(),
  query: vi.fn<(
    text: string,
    values: unknown[],
  ) => Promise<{ rows: Array<{ id?: number; bid?: number; total?: number; cnt?: number }> }>>(),
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
  getArticleBySlug,
  getListingBySlug,
  getPageBySlug,
  getRelatedListings,
  getSearchFacets,
  listPublishedArticles,
  listPublishedPages,
  parseSearchInput,
  resolveBuildingRouteIdentity,
  resolveListingRouteIdentity,
  searchListings,
  type ListingSearchInput,
  type SearchContext,
  type SupplyAdapter,
} from '@/domain/public-catalog'

const AS_OF = '2026-08-13T00:00:00.000Z'

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false
type Assert<Condition extends true> = Condition

type CityScopedSupplyContract = readonly [
  Assert<Equal<
    Parameters<SupplyAdapter['findEffectiveListings']>,
    [input: ListingSearchInput, ctx: SearchContext]
  >>,
  Assert<Equal<
    Parameters<SupplyAdapter['findEffectiveListingBySlug']>,
    [slug: string, ctx: SearchContext]
  >>,
  Assert<Equal<
    Parameters<SupplyAdapter['findEffectiveBuildingBySlug']>,
    [slug: string, ctx: SearchContext]
  >>,
  Assert<Equal<
    Parameters<SupplyAdapter['findEffectiveListingsByBuilding']>,
    [
      buildingId: number | string,
      ctx: SearchContext,
      excludeListingId?: number | string,
    ]
  >>,
  Assert<Equal<
    Parameters<SupplyAdapter['aggregateEffectiveSupplyByBuildings']>,
    [buildingIds: readonly (number | string)[], ctx: SearchContext]
  >>,
  Assert<Equal<
    Parameters<SupplyAdapter['findEffectiveBuildingsNear']>,
    [buildingId: number | string, ctx: SearchContext, limit: number]
  >>,
  Assert<Equal<
    Parameters<SupplyAdapter['findEffectiveBuildings']>,
    [ctx: SearchContext, limit?: number]
  >>,
  Assert<Equal<
    Parameters<SupplyAdapter['findFeaturedListings']>,
    [ctx: SearchContext, limit?: number]
  >>,
  Assert<Equal<
    Parameters<SupplyAdapter['findFeaturedBuildings']>,
    [ctx: SearchContext, limit?: number]
  >>,
  Assert<Equal<
    Parameters<SupplyAdapter['findEffectiveDistricts']>,
    [ctx: SearchContext]
  >>,
  Assert<Equal<
    Parameters<SupplyAdapter['findEffectiveBusinessAreas']>,
    [ctx: SearchContext]
  >>,
  Assert<Equal<
    Parameters<SupplyAdapter['assertEffectiveListingBySlug']>,
    [slug: string, ctx: SearchContext]
  >>,
]

type GlobalContentContract = readonly [
  Assert<Equal<Parameters<SupplyAdapter['findLatestArticles']>, [limit?: number]>>,
  Assert<Equal<
    Parameters<SupplyAdapter['findPublishedArticles']>,
    [options: Readonly<{ page?: number; pageSize?: number }>]
  >>,
  Assert<Equal<Parameters<SupplyAdapter['findPublishedArticleBySlug']>, [slug: string]>>,
  Assert<Equal<Parameters<SupplyAdapter['findPublishedPageBySlug']>, [slug: string]>>,
  Assert<Equal<Parameters<SupplyAdapter['findPublishedPages']>, [limit?: number]>>,
  Assert<Equal<Parameters<typeof getPageBySlug>, [slug: string, adapter?: SupplyAdapter]>>,
  Assert<Equal<
    Parameters<typeof listPublishedPages>,
    [options?: Readonly<{ limit?: number }>, adapter?: SupplyAdapter]
  >>,
  Assert<Equal<Parameters<typeof getArticleBySlug>, [slug: string, adapter?: SupplyAdapter]>>,
  Assert<Equal<
    Parameters<typeof listPublishedArticles>,
    [
      options?: Readonly<{ page?: number; pageSize?: number }>,
      adapter?: SupplyAdapter,
    ]
  >>,
]

const cityScopedSupplyContract: CityScopedSupplyContract = [
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
]
const globalContentContract: GlobalContentContract = [
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
]

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
    // OPT-034 起供给商户直接读 listings.merchant，不再经关系表解析。
    merchant: {
      id: id + 20_000,
      status: 'active',
      qualificationStatus: 'valid',
      qualificationExpiresAt: '2027-01-01T00:00:00.000Z',
      serviceCities: [{ id: city.id }],
    },
    building: {
      id: id * 10,
      slug: `${city.slug}-building`,
      name: `${city.slug} building`,
      status: 'published',
      operationalStatus: 'active',
      address: `${city.slug} address`,
      city: {
        ...city,
        name: city.slug === 'hangzhou' ? '杭州市' : '上海市',
        type: 'city',
        status: 'active',
      },
      district: {
        id: id * 10 + 1,
        slug: `${city.slug}-district`,
        name: `${city.slug} district`,
        status: 'active',
      },
    },
  }
}

describe('required city in public catalog context', () => {
  const shanghai = effectiveListing(101, { id: 1, slug: 'shanghai' })
  const hangzhou = effectiveListing(202, { id: 2, slug: 'hangzhou' })
  const listings = [shanghai, hangzhou]
  // 精筛淘汰：粗筛能查到（发布/审核/冻结/楼盘状态都合格），但没有供给商户
  // （merchant: null）——OPT-034 前靠"无生效关系"制造同样的效果。
  const fineIneligible: Record<string, unknown> = {
    ...effectiveListing(303, { id: 2, slug: 'hangzhou' }),
    slug: 'hangzhou-fine-ineligible',
    building: hangzhou.building,
    merchant: null,
  }
  const routeListings = [...listings, fineIneligible]
  const hangzhouNeighbor: Record<string, unknown> = {
    ...(hangzhou.building as Record<string, unknown>),
    id: 2030,
    slug: 'hangzhou-neighbor-building',
    name: 'hangzhou neighbor building',
  }
  const buildings: readonly Record<string, unknown>[] = [
    ...listings.map((listing) => listing.building as Record<string, unknown>),
    hangzhouNeighbor,
    {
      ...(hangzhou.building as Record<string, unknown>),
      id: 2040,
      slug: 'hangzhou-archived-building',
      status: 'archived',
    },
  ]
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
          return [{ bid: building.id, total: Number(candidate.area), cnt: 1 }]
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
        const docs = routeListings.filter((listing) => {
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
        const statusFilter = where.status as { equals?: string } | undefined
        const operationalStatusFilter = where.operationalStatus as { equals?: string } | undefined
        const docs = buildings.filter((building) => {
          const city = building.city as { slug: string }
          return (
            (!cityFilter?.equals || city.slug === cityFilter.equals) &&
            (!slugFilter?.equals || building.slug === slugFilter.equals) &&
            (!statusFilter?.equals || building.status === statusFilter.equals) &&
            (!operationalStatusFilter?.equals ||
              building.operationalStatus === operationalStatusFilter.equals)
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
      // OPT-034：精筛不再查 listing-merchant-relations，falls through to throw
      // below——留着这个分支反而会掩盖"又悄悄查关系表了"这类回归。
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

  it('keeps supply methods city-scoped and global content methods context-free', () => {
    expect(cityScopedSupplyContract).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
    ])
    expect(globalContentContract).toEqual([true, true, true, true, true, true, true, true, true])
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
    const aggregates = await adapter.aggregateEffectiveSupplyByBuildings([1010, 2020], context)
    await adapter.findFeaturedBuildings(context)
    await adapter.findEffectiveDistricts(context)
    await adapter.findEffectiveBusinessAreas(context)

    expect(crossCityBuilding).toBeNull()
    expect(buildingsInCity.map((building) => building.id)).toEqual([2020, 2030])
    expect(recommendations).toEqual([])
    expect([...aggregates.entries()]).toEqual([['2020', { area: 202, count: 1 }]])
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

  it('keeps nearby buildings inside Hangzhou and emits a city-scoped where', async () => {
    const adapter = createPayloadSupplyAdapter()

    const nearby = await adapter.findEffectiveBuildingsNear(2020, context, 6)

    expect(nearby.map((building) => building.id)).toEqual([2030])
    const buildingWheres = payloadState.find.mock.calls
      .map(([params]) => params)
      .filter((params) => params.collection === 'buildings')
      .map((params) => params.where as Record<string, unknown>)
    expect(buildingWheres).toContainEqual(expect.objectContaining({
      'city.slug': { equals: 'hangzhou' },
    }))
  })

  it('resolves cityless legacy route identities without returning display data', async () => {
    const adapter = createPayloadSupplyAdapter()

    await expect(
      resolveListingRouteIdentity('hangzhou-effective-office', adapter),
    ).resolves.toEqual({ slug: 'hangzhou-effective-office', citySlug: 'hangzhou' })
    await expect(
      resolveListingRouteIdentity('hidden-listing', adapter),
    ).resolves.toBeNull()
    await expect(
      resolveBuildingRouteIdentity('hangzhou-building', adapter),
    ).resolves.toEqual({ slug: 'hangzhou-building', citySlug: 'hangzhou' })

    const identity = await resolveListingRouteIdentity(
      'hangzhou-effective-office',
      adapter,
    )
    expect(identity && Object.keys(identity).sort()).toEqual(['citySlug', 'slug'])
  })

  it('uses collection-scoped minimal population for route identity reads', async () => {
    const adapter = createPayloadSupplyAdapter()

    await adapter.findListingRouteIdentity('hangzhou-effective-office')
    await adapter.findBuildingRouteIdentity('hangzhou-building')

    const listingIdentityCall = payloadState.find.mock.calls
      .map(([params]) => params)
      .find((params) =>
        params.collection === 'listings' &&
        (params.select as Record<string, unknown> | undefined)?.building === true
      )
    expect(listingIdentityCall?.depth).toBe(2)
    expect(listingIdentityCall?.select).toEqual({ slug: true, building: true })
    expect(listingIdentityCall?.populate).toEqual({
      buildings: { city: true },
      locations: { name: true, slug: true, type: true, status: true },
    })

    const buildingIdentityCall = payloadState.find.mock.calls
      .map(([params]) => params)
      .find((params) =>
        params.collection === 'buildings' &&
        (params.select as Record<string, unknown> | undefined)?.city === true
      )
    expect(buildingIdentityCall?.depth).toBe(1)
    expect(buildingIdentityCall?.select).toEqual({ slug: true, city: true })
    expect(buildingIdentityCall?.populate).toEqual({
      locations: { name: true, slug: true, type: true, status: true },
    })
  })

  it('rejects a coarse-visible listing that fails the fine effective check', async () => {
    const adapter = createPayloadSupplyAdapter()

    await expect(
      adapter.findListingRouteIdentity('hangzhou-fine-ineligible'),
    ).resolves.toBeNull()

    const listingCalls = payloadState.find.mock.calls
      .map(([params]) => params)
      .filter((params) =>
        params.collection === 'listings' &&
        ((params.where as Record<string, unknown>).slug as { equals?: string } | undefined)
          ?.equals === 'hangzhou-fine-ineligible'
      )
    expect(listingCalls).toHaveLength(2)
    expect(listingCalls[0]?.where).not.toHaveProperty('building.city.slug')
    expect(listingCalls[1]?.where).toEqual(expect.objectContaining({
      'building.city.slug': { equals: 'hangzhou' },
      slug: { equals: 'hangzhou-fine-ineligible' },
    }))
  })

  it('rejects a nonpublic building route identity', async () => {
    const adapter = createPayloadSupplyAdapter()

    await expect(
      adapter.findBuildingRouteIdentity('hangzhou-archived-building'),
    ).resolves.toBeNull()
  })

  it('populates building.city in the catalog query without a location lookup', async () => {
    const adapter = createPayloadSupplyAdapter()

    const detail = await getListingBySlug('hangzhou-effective-office', context, adapter)

    expect(detail).toMatchObject({ citySlug: 'hangzhou', cityName: '杭州市' })
    const listingCalls = payloadState.find.mock.calls
      .map(([params]) => params)
      .filter((params) => params.collection === 'listings')
    expect(listingCalls).toHaveLength(1)
    expect(listingCalls[0]).toMatchObject({ depth: 3 })
    expect(
      payloadState.find.mock.calls.filter(([params]) => params.collection === 'locations'),
    ).toHaveLength(0)
  })
})
