import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  MiniHomeData,
  MiniListingDetailData,
  MiniListingsData,
} from '@/domain/mini-program/contracts'

const io = vi.hoisted(() => ({
  resolveCityContext: vi.fn(),
  getCachedMiniHome: vi.fn(),
  getCachedMiniListings: vi.fn(),
  getCachedMiniListingDetail: vi.fn(),
  mapMiniHome: vi.fn(),
  mapMiniListings: vi.fn(),
  mapMiniListingDetail: vi.fn(),
  getSiteConfig: vi.fn(),
}))

vi.mock('@/app/(frontend)/_lib/city-context', () => ({
  resolveCityContext: io.resolveCityContext,
}))

vi.mock('@/lib/mini-program/cached-queries', () => ({
  getCachedMiniHome: io.getCachedMiniHome,
  getCachedMiniListings: io.getCachedMiniListings,
  getCachedMiniListingDetail: io.getCachedMiniListingDetail,
}))

vi.mock('@/domain/mini-program/mappers', () => ({
  mapMiniHome: io.mapMiniHome,
  mapMiniListings: io.mapMiniListings,
  mapMiniListingDetail: io.mapMiniListingDetail,
}))

vi.mock('@/lib/frontend/site-config', () => ({
  getSiteConfig: io.getSiteConfig,
}))

import {
  getMiniHome,
  getMiniListingDetail,
  getMiniListings,
} from '@/lib/mini-program/catalog-service'

const rawHome = Object.freeze({ source: 'home' })
const rawHomeFacets = Object.freeze({ source: 'home-facets' })
const rawListingResult = Object.freeze({ source: 'listing-result' })
const rawListingFacets = Object.freeze({
  district: Object.freeze({ source: 'district-facets' }),
  listingType: Object.freeze({ source: 'listing-type-facets' }),
  priceUnit: Object.freeze({ source: 'price-unit-facets' }),
})
const rawDetail = Object.freeze({ source: 'listing-detail' })
const rawRelated = Object.freeze([{ source: 'related-listing' }])

const mappedHome: MiniHomeData = {
  featuredListings: [],
  quickFilters: [],
  stats: { listings: 3, buildings: 2, businessAreas: 1 },
}

const mappedListings: MiniListingsData = {
  items: [],
  pagination: {
    page: 2,
    pageSize: 24,
    totalDocs: 25,
    totalPages: 2,
    hasNextPage: false,
    hasPrevPage: true,
  },
  canonicalQuery: 'priceUnit=rmb-sqm-day&page=2',
  currentPriceUnit: 'rmb-sqm-day',
  filters: [],
}

const mappedDetail: MiniListingDetailData = {
  listing: {
    id: 'listing-1',
    slug: 'west-lake-office',
    title: '西湖办公室',
    citySlug: 'hangzhou',
    cityName: '杭州',
    price: null,
    area: null,
    seats: null,
    listingType: { value: 'traditional-office', label: '传统办公' },
    availableFrom: null,
    building: null,
    coverImage: null,
    highlights: [],
    gallery: [],
    factGroups: [],
    verification: { verifiedAt: null, priceVerifiedAt: null },
  },
  monthlyCost: {
    currency: 'CNY',
    period: 'month',
    propertyFeeInclusion: null,
    rent: null,
    propertyFee: null,
    total: null,
    assumptions: [],
  },
  relatedListings: [],
}

function cityContext(
  slug: string,
  serviceStatus: 'live' | 'coming-soon' = 'live',
) {
  const name = slug === 'shanghai' ? '上海' : '杭州'
  const profile = {
    cityId: 1,
    citySlug: slug,
    cityName: name,
    serviceStatus,
    switcherVisible: true,
    sortOrder: 1,
    avgResponseHours: null,
    seoTitle: `${name}办公室`,
    seoDescription: `${name}办公室目录`,
    hero: {
      eyebrow: '',
      heading: '',
      body: '',
      media: null,
      video: null,
      videoEnabled: false,
    },
    intro: { heading: '', body: '' },
    contact: { heading: '', body: '' },
    featuredRegions: [],
  }
  return { id: profile.cityId, slug, name, serviceStatus, profile }
}

describe('Mini catalog service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    io.resolveCityContext.mockImplementation(async (slug: string) => cityContext(slug))
    io.getSiteConfig.mockReturnValue({ siteOrigin: 'https://sbh.example' })
    io.getCachedMiniHome.mockResolvedValue({
      asOf: '2026-08-26T01:00:00.000Z',
      data: { home: rawHome, facets: rawHomeFacets },
    })
    io.getCachedMiniListings.mockResolvedValue({
      asOf: '2026-08-26T02:00:00.000Z',
      data: { result: rawListingResult, facets: rawListingFacets, input: {} },
    })
    io.getCachedMiniListingDetail.mockResolvedValue({
      asOf: '2026-08-26T03:00:00.000Z',
      data: { detail: rawDetail, related: rawRelated },
    })
    io.mapMiniHome.mockReturnValue(mappedHome)
    io.mapMiniListings.mockReturnValue(mappedListings)
    io.mapMiniListingDetail.mockReturnValue(mappedDetail)
  })

  it('accepts an exact lowercase live city and maps the home snapshot inputs', async () => {
    await expect(getMiniHome('shanghai')).resolves.toEqual({
      asOf: '2026-08-26T01:00:00.000Z',
      data: mappedHome,
    })

    expect(io.resolveCityContext).toHaveBeenCalledWith('shanghai')
    expect(io.getCachedMiniHome).toHaveBeenCalledWith('shanghai')
    expect(io.mapMiniHome).toHaveBeenCalledWith(rawHome, rawHomeFacets, 'https://sbh.example')
  })

  it('rejects a city that is not live before reading the home cache', async () => {
    io.resolveCityContext.mockResolvedValue(cityContext('hangzhou', 'coming-soon'))

    await expect(getMiniHome('hangzhou')).resolves.toBeNull()

    expect(io.getCachedMiniHome).not.toHaveBeenCalled()
    expect(io.mapMiniHome).not.toHaveBeenCalled()
  })

  it.each(['Shanghai', 'shanghai_1', '-shanghai', 'shanghai/']) (
    'rejects non-canonical city slug %s before city resolution',
    async (city) => {
      await expect(getMiniHome(city)).resolves.toBeNull()

      expect(io.resolveCityContext).not.toHaveBeenCalled()
      expect(io.getCachedMiniHome).not.toHaveBeenCalled()
    },
  )

  it('rejects a live resolver result whose slug is not the exact input', async () => {
    io.resolveCityContext.mockResolvedValue(cityContext('hangzhou'))

    await expect(getMiniHome('shanghai')).resolves.toBeNull()

    expect(io.getCachedMiniHome).not.toHaveBeenCalled()
  })

  it('returns null for a list city that cannot be resolved', async () => {
    io.resolveCityContext.mockResolvedValue(null)

    await expect(getMiniListings(new URL(
      'https://example.test/api/mini/v1/listings?city=unknown-city',
    ))).resolves.toBeNull()

    expect(io.getCachedMiniListings).not.toHaveBeenCalled()
    expect(io.mapMiniListings).not.toHaveBeenCalled()
  })

  it('passes existing parsed price-unit and pagination semantics into the cached query', async () => {
    const result = await getMiniListings(new URL(
      'https://example.test/api/mini/v1/listings?city=shanghai&priceUnit=rmb-sqm-day&page=2&pageSize=999&unknown=secret',
    ))

    expect(io.getCachedMiniListings).toHaveBeenCalledTimes(1)
    const input = io.getCachedMiniListings.mock.calls[0]?.[1]
    expect(input).toEqual(expect.objectContaining({
      city: 'shanghai',
      priceUnit: 'rmb-sqm-day',
      pricePeriod: 'day',
      priceBasis: 'sqm',
      page: 2,
      pageSize: 24,
    }))
    expect(input).not.toHaveProperty('unknown')
    expect(io.mapMiniListings).toHaveBeenCalledWith(
      rawListingResult,
      rawListingFacets,
      'rmb-sqm-day',
      'https://sbh.example',
    )
    expect(result).toEqual({
      asOf: '2026-08-26T02:00:00.000Z',
      data: mappedListings,
    })
  })

  it('keeps parser fallbacks for invalid list values and passes null price unit to the mapper', async () => {
    await getMiniListings(new URL(
      'https://example.test/api/mini/v1/listings?city=shanghai&priceUnit=internal&page=-8&pageSize=1&internal=true',
    ))

    const input = io.getCachedMiniListings.mock.calls[0]?.[1]
    expect(input).toEqual(expect.objectContaining({ page: 1, pageSize: 24 }))
    expect(input).toHaveProperty('priceUnit', undefined)
    expect(input).not.toHaveProperty('internal')
    expect(io.mapMiniListings).toHaveBeenCalledWith(
      rawListingResult,
      rawListingFacets,
      null,
      'https://sbh.example',
    )
  })

  it('resolves unavailable detail cities as city-not-found', async () => {
    io.resolveCityContext.mockResolvedValue(cityContext('hangzhou', 'coming-soon'))

    await expect(getMiniListingDetail('hangzhou', 'west-lake-office')).resolves.toEqual({
      status: 'city-not-found',
    })

    expect(io.getCachedMiniListingDetail).not.toHaveBeenCalled()
  })

  it.each(['West-Lake-Office', 'west_lake_office', '-west-lake-office']) (
    'resolves invalid detail slug %s as listing-not-found without reading the cache',
    async (slug) => {
      await expect(getMiniListingDetail('hangzhou', slug)).resolves.toEqual({
        status: 'listing-not-found',
      })

      expect(io.getCachedMiniListingDetail).not.toHaveBeenCalled()
    },
  )

  it('resolves an empty valid-city detail snapshot as listing-not-found', async () => {
    io.getCachedMiniListingDetail.mockResolvedValue({
      asOf: '2026-08-26T03:00:00.000Z',
      data: null,
    })

    await expect(getMiniListingDetail('hangzhou', 'missing-office')).resolves.toEqual({
      status: 'listing-not-found',
    })

    expect(io.getCachedMiniListingDetail).toHaveBeenCalledWith('hangzhou', 'missing-office')
    expect(io.mapMiniListingDetail).not.toHaveBeenCalled()
  })

  it('maps a valid live-city detail snapshot into the explicit ok resolution', async () => {
    await expect(getMiniListingDetail('hangzhou', 'west-lake-office')).resolves.toEqual({
      status: 'ok',
      snapshot: {
        asOf: '2026-08-26T03:00:00.000Z',
        data: mappedDetail,
      },
    })

    expect(io.getCachedMiniListingDetail).toHaveBeenCalledWith('hangzhou', 'west-lake-office')
    expect(io.mapMiniListingDetail).toHaveBeenCalledWith(
      rawDetail,
      rawRelated,
      'https://sbh.example',
    )
  })
})
