import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'

type CacheRegistration = Readonly<{
  keyParts: readonly string[]
  tags: readonly string[]
  revalidate?: number
}>

const cacheState = vi.hoisted(() => ({
  registrations: [] as CacheRegistration[],
  homepageCities: [] as string[],
}))

vi.mock('next/cache', () => ({
  unstable_cache: (
    load: (...args: unknown[]) => unknown,
    keyParts: readonly string[],
    options: Readonly<{ tags?: readonly string[]; revalidate?: number }> = {},
  ) => {
    cacheState.registrations.push({
      keyParts: [...keyParts],
      tags: [...(options.tags ?? [])],
      revalidate: options.revalidate,
    })
    const values = new Map<string, unknown>()
    return async (...args: unknown[]) => {
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
    buildListingSearchSource: vi.fn(async (_input, ctx) => ({ citySlug: ctx.city })),
    getBuildingBySlug: vi.fn(async (_slug, ctx) => ({ citySlug: ctx.city })),
    getBuildingDetail: vi.fn(async (_slug, ctx) => ({ citySlug: ctx.city })),
    getDetailRecommendations: vi.fn(async (_slug, ctx) => [{ citySlug: ctx.city }]),
    getHomepage: vi.fn(async (ctx) => {
      cacheState.homepageCities.push(ctx.city)
      return { featuredListings: [{ citySlug: ctx.city }] }
    }),
    getListingBySlug: vi.fn(async (_slug, ctx) => ({ citySlug: ctx.city })),
    getListingDistrictOptions: vi.fn(async (ctx) => [{ citySlug: ctx.city }]),
    getRelatedBuildings: vi.fn(async (_slug, ctx) => [{ citySlug: ctx.city }]),
    getRelatedListings: vi.fn(async (_slug, ctx) => [{ citySlug: ctx.city }]),
    getSearchFacets: vi.fn(async (_input, ctx) => ({ citySlug: ctx.city })),
    paginateListingSearchSource: vi.fn((source) => source),
    searchBuildings: vi.fn(async (ctx) => [{ citySlug: ctx.city }]),
  }
})

import {
  getCachedArticleBySlug,
  getCachedBuildingBySlug,
  getCachedBuildingDetail,
  getCachedDetailRecommendations,
  getCachedHomepage,
  getCachedListingBySlug,
  getCachedListingDistrictOptions,
  getCachedPageBySlug,
  getCachedPublishedArticles,
  getCachedPublishedPages,
  getCachedRelatedBuildings,
  getCachedRelatedListings,
  getCachedSearchBuildings,
  getCachedSearchFacets,
  getCachedSearchListings,
} from '@/lib/frontend/cached-queries'
import { parseSearchInput } from '@/domain/public-catalog'

describe('per-city public catalog caches', () => {
  beforeEach(() => {
    cacheState.homepageCities.length = 0
  })

  it('keeps Shanghai and Hangzhou homepage values isolated after both caches are warm', async () => {
    const shanghai = await getCachedHomepage('shanghai')
    const hangzhou = await getCachedHomepage('hangzhou')
    const shanghaiAgain = await getCachedHomepage('shanghai')

    expect(shanghai).toEqual({ featuredListings: [{ citySlug: 'shanghai' }] })
    expect(hangzhou).toEqual({ featuredListings: [{ citySlug: 'hangzhou' }] })
    expect(shanghaiAgain).toEqual(shanghai)
    expect(cacheState.homepageCities).toEqual(['shanghai', 'hangzhou'])

    const homepageCaches = cacheState.registrations.filter(
      ({ keyParts }) => keyParts[0] === 'homepage',
    )
    expect(homepageCaches).toEqual(expect.arrayContaining([
      expect.objectContaining({
        keyParts: ['homepage', 'shanghai'],
        tags: expect.arrayContaining(['public:home:shanghai']),
        revalidate: 300,
      }),
      expect.objectContaining({
        keyParts: ['homepage', 'hangzhou'],
        tags: expect.arrayContaining(['public:home:hangzhou']),
        revalidate: 300,
      }),
    ]))
  })

  it('requires city first and registers every supply cache with city key, city tag, and backstop', async () => {
    type RequiredCityContracts = readonly [
      Parameters<typeof getCachedHomepage>,
      Parameters<typeof getCachedListingBySlug>,
      Parameters<typeof getCachedRelatedListings>,
      Parameters<typeof getCachedDetailRecommendations>,
      Parameters<typeof getCachedRelatedBuildings>,
      Parameters<typeof getCachedSearchBuildings>,
      Parameters<typeof getCachedBuildingDetail>,
      Parameters<typeof getCachedBuildingBySlug>,
      Parameters<typeof getCachedSearchListings>,
      Parameters<typeof getCachedListingDistrictOptions>,
      Parameters<typeof getCachedSearchFacets>,
    ]
    expectTypeOf<RequiredCityContracts>().toMatchTypeOf<readonly [
      [citySlug: string],
      [citySlug: string, slug: string],
      [citySlug: string, listingSlug: string, limit?: number],
      [citySlug: string, listingSlug: string, limit?: number],
      [citySlug: string, buildingSlug: string, limit?: number],
      [citySlug: string],
      [citySlug: string, slug: string],
      [citySlug: string, slug: string],
      [citySlug: string, canonicalQuery: string, input: ReturnType<typeof parseSearchInput>],
      [citySlug: string],
      [citySlug: string, canonicalQuery: string, input: ReturnType<typeof parseSearchInput>],
    ]>()

    const input = parseSearchInput(new URLSearchParams())
    await Promise.all([
      getCachedHomepage('suzhou'),
      getCachedListingBySlug('suzhou', 'listing'),
      getCachedRelatedListings('suzhou', 'listing', 3),
      getCachedDetailRecommendations('suzhou', 'listing', 3),
      getCachedRelatedBuildings('suzhou', 'building', 3),
      getCachedSearchBuildings('suzhou'),
      getCachedBuildingDetail('suzhou', 'building'),
      getCachedBuildingBySlug('suzhou', 'building'),
      getCachedSearchListings('suzhou', '', input),
      getCachedListingDistrictOptions('suzhou'),
      getCachedSearchFacets('suzhou', '', input),
    ])

    const supplyKeys = [
      'homepage',
      'listing-by-slug',
      'related-listings',
      'detail-recommendations',
      'related-buildings',
      'search-buildings',
      'building-detail',
      'building-by-slug',
      'listing-search-source',
      'listing-district-options',
      'search-facets',
    ]
    for (const resource of supplyKeys) {
      const registration = cacheState.registrations.find(
        ({ keyParts }) => keyParts[0] === resource && keyParts[1] === 'suzhou',
      )
      expect(registration, resource).toBeDefined()
      expect(registration?.tags.some((tag) => tag.endsWith(':suzhou')), resource).toBe(true)
      expect(registration?.revalidate, resource).toBe(300)
    }
  })

  it('keeps page and article cache contracts global', () => {
    expectTypeOf(getCachedPageBySlug).parameters.toEqualTypeOf<[slug: string]>()
    expectTypeOf(getCachedPublishedPages).parameters.toEqualTypeOf<[limit?: number]>()
    expectTypeOf(getCachedPublishedArticles).parameters.toEqualTypeOf<[
      page?: number,
      pageSize?: number,
    ]>()
    expectTypeOf(getCachedArticleBySlug).parameters.toEqualTypeOf<[slug: string]>()
  })
})
