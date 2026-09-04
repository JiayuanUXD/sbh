import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type CacheRegistration = {
  keyParts: readonly string[]
  options: Readonly<{ tags?: readonly string[]; revalidate?: number }>
  calls: unknown[][]
}

const cacheState = vi.hoisted(() => ({
  registrations: [] as CacheRegistration[],
  contexts: [] as Array<Readonly<{
    asOf: string
    timezone: 'Asia/Shanghai'
    channel: 'public-web'
    city: string
    businessType?: 'lease' | 'sale'
  }>>,
}))

vi.mock('next/cache', () => ({
  unstable_cache: (
    load: (...args: unknown[]) => unknown,
    keyParts: readonly string[],
    options: Readonly<{ tags?: readonly string[]; revalidate?: number }> = {},
  ) => {
    const calls: unknown[][] = []
    cacheState.registrations.push({ keyParts: [...keyParts], options, calls })
    const values = new Map<string, unknown>()

    return async (...args: unknown[]) => {
      calls.push(args)
      const key = JSON.stringify(args)
      if (values.has(key)) return values.get(key)
      const value = await load(...args)
      values.set(key, value)
      return value
    }
  },
}))

vi.mock('@/domain/public-catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/domain/public-catalog')>()
  return {
    ...actual,
    createSearchContext: vi.fn((city: string, now: Date, businessType: 'lease' | 'sale') => {
      const context = actual.createSearchContext(city, now, businessType)
      cacheState.contexts.push(context)
      return context
    }),
    getHomepage: vi.fn(async (context) => ({ kind: 'home', city: context.city })),
    getListingBySlug: vi.fn(async (slug, context) => (
      slug === 'missing' ? null : { kind: 'detail', slug, city: context.city }
    )),
    getRelatedListings: vi.fn(async (_slug, context, options) => ([{
      kind: 'related',
      city: context.city,
      limit: options?.limit,
    }])),
    getSearchFacetsIgnoring: vi.fn(async (_input, context, dimensions) => ({
      kind: 'facets',
      city: context.city,
      dimensions,
    })),
    searchListings: vi.fn(async (input, context) => ({
      kind: 'listings',
      city: context.city,
      page: input.page,
    })),
    searchBuildingsFiltered: vi.fn(async (input, context) => ({
      kind: 'buildings',
      city: context.city,
      page: input.page,
    })),
    getBuildingDetail: vi.fn(async (slug, context) => ({
      building: slug === 'missing'
        ? null
        : { kind: 'building-detail', slug, city: context.city },
      supply: { groups: [] },
    })),
    getRelatedBuildings: vi.fn(async (_slug, context, options) => ([{
      kind: 'related-building',
      city: context.city,
      limit: options?.limit,
    }])),
  }
})

import {
  buildCanonicalSearchParams,
  createSearchContext,
  getHomepage,
  getListingBySlug,
  getRelatedListings,
  getSearchFacetsIgnoring,
  parseBuildingSearchInput,
  parseListingSearchInput,
  searchListings,
} from '@/domain/public-catalog'
import {
  getCachedMiniBuildingDetail,
  getCachedMiniBuildings,
  getCachedMiniHome,
  getCachedMiniListingDetail,
  getCachedMiniListings,
} from '@/lib/mini-program/cached-queries'

function registration(resource: string, city: string): CacheRegistration {
  const match = cacheState.registrations.find(({ keyParts }) => (
    keyParts[0] === resource && keyParts[1] === city
  ))
  expect(match, `${resource}:${city}`).toBeDefined()
  return match as CacheRegistration
}

describe('Mini API cached queries', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-26T00:00:00.000Z'))
    vi.clearAllMocks()
    cacheState.registrations.length = 0
    cacheState.contexts.length = 0
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('caches the home data and its real Public Catalog asOf for 300 seconds', async () => {
    const first = await getCachedMiniHome('shanghai')
    vi.setSystemTime(new Date('2026-08-26T00:04:00.000Z'))
    const cached = await getCachedMiniHome('shanghai')

    expect(first.asOf).toBe('2026-08-26T00:00:00.000Z')
    expect(cached).toEqual(first)
    expect(createSearchContext).toHaveBeenCalledTimes(1)
    expect(createSearchContext).toHaveBeenCalledWith('shanghai', expect.any(Date), 'lease')
    expect(getHomepage).toHaveBeenCalledWith(cacheState.contexts[0])
    expect(getSearchFacetsIgnoring).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1 }),
      cacheState.contexts[0],
      ['priceUnit'],
    )

    const homeCache = registration('mini-v1-home', 'shanghai')
    expect(homeCache.options.revalidate).toBe(300)
    expect(homeCache.options.tags).toEqual(expect.arrayContaining([
      'public:listings',
      'public:listings:city:shanghai',
      'public:home:shanghai',
      'public:facets:shanghai',
    ]))
  })

  it('puts the canonical listing query in the stable cache call and computes self-omitting facets', async () => {
    const input = parseListingSearchInput(new URLSearchParams(
      'district=jing-an&priceUnit=rmb-sqm-day',
    ))
    const canonical = buildCanonicalSearchParams(input).toString()
    const first = await getCachedMiniListings('hangzhou', input)
    vi.setSystemTime(new Date('2026-08-26T00:04:00.000Z'))
    const cached = await getCachedMiniListings('hangzhou', input)

    expect(first.asOf).toBe('2026-08-26T00:00:00.000Z')
    expect(cached).toEqual(first)
    expect(createSearchContext).toHaveBeenCalledTimes(1)
    expect(searchListings).toHaveBeenCalledWith(input, cacheState.contexts[0])
    expect(getSearchFacetsIgnoring).toHaveBeenCalledTimes(3)
    expect(getSearchFacetsIgnoring).toHaveBeenNthCalledWith(1, input, cacheState.contexts[0], ['district'])
    expect(getSearchFacetsIgnoring).toHaveBeenNthCalledWith(2, input, cacheState.contexts[0], ['listingType'])
    expect(getSearchFacetsIgnoring).toHaveBeenNthCalledWith(3, input, cacheState.contexts[0], ['priceUnit'])
    expect(first.data.facets).toEqual({
      district: { kind: 'facets', city: 'hangzhou', dimensions: ['district'] },
      listingType: { kind: 'facets', city: 'hangzhou', dimensions: ['listingType'] },
      priceUnit: { kind: 'facets', city: 'hangzhou', dimensions: ['priceUnit'] },
    })

    const listingsCache = registration('mini-v1-listings', 'hangzhou')
    expect(listingsCache.calls).toEqual([[canonical, input], [canonical, input]])
    expect(listingsCache.options.revalidate).toBe(300)
    expect(listingsCache.options.tags).toEqual(expect.arrayContaining([
      'public:listings',
      'public:listings:city:hangzhou',
      'public:home:hangzhou',
      'public:facets:hangzhou',
    ]))
  })

  it('uses the Public Catalog detail entry point, returns null truthfully, and limits related listings to four', async () => {
    const missing = await getCachedMiniListingDetail('suzhou', 'missing')
    const found = await getCachedMiniListingDetail('suzhou', 'found')
    vi.setSystemTime(new Date('2026-08-26T00:04:00.000Z'))
    const cachedFound = await getCachedMiniListingDetail('suzhou', 'found')

    expect(missing).toMatchObject({
      asOf: '2026-08-26T00:00:00.000Z',
      data: null,
    })
    expect(getListingBySlug).toHaveBeenCalledWith('missing', cacheState.contexts[0])
    expect(getRelatedListings).not.toHaveBeenCalledWith(
      'missing',
      expect.anything(),
      expect.anything(),
    )
    expect(found.data).toMatchObject({
      detail: { slug: 'found' },
      related: [{ limit: 4 }],
    })
    expect(cachedFound).toEqual(found)
    expect(createSearchContext).toHaveBeenCalledTimes(2)
    expect(getRelatedListings).toHaveBeenCalledWith('found', cacheState.contexts[1], { limit: 4 })

    const detailCache = registration('mini-v1-listing-detail', 'suzhou')
    expect(detailCache.calls).toEqual([['missing'], ['found'], ['found']])
    expect(detailCache.options).toMatchObject({ revalidate: 300 })
  })

  it('keeps the same canonical resource isolated across cities', async () => {
    const input = parseListingSearchInput(new URLSearchParams('page=1'))
    const guangzhou = await getCachedMiniListings('guangzhou', input)
    const shenzhen = await getCachedMiniListings('shenzhen', input)
    const guangzhouDetail = await getCachedMiniListingDetail('guangzhou', 'central-office')
    const shenzhenDetail = await getCachedMiniListingDetail('shenzhen', 'central-office')

    expect(guangzhou.data.result).toMatchObject({ city: 'guangzhou' })
    expect(shenzhen.data.result).toMatchObject({ city: 'shenzhen' })
    expect(guangzhouDetail.data?.detail).toMatchObject({ city: 'guangzhou' })
    expect(shenzhenDetail.data?.detail).toMatchObject({ city: 'shenzhen' })
    expect(registration('mini-v1-listings', 'guangzhou')).not.toBe(
      registration('mini-v1-listings', 'shenzhen'),
    )
    expect(registration('mini-v1-listing-detail', 'guangzhou')).not.toBe(
      registration('mini-v1-listing-detail', 'shenzhen'),
    )
  })

  it('adds building category and city tags to building list and detail caches', async () => {
    const input = parseBuildingSearchInput(new URLSearchParams('page=1'))

    await getCachedMiniBuildings('shanghai', input)
    await getCachedMiniBuildingDetail('shanghai', 'jing-an-center')

    for (const resource of ['mini-v1-buildings', 'mini-v1-building-detail']) {
      expect(registration(resource, 'shanghai').options.tags).toEqual(expect.arrayContaining([
        'public:buildings',
        'public:buildings:city:shanghai',
      ]))
    }
  })
})
