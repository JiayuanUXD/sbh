import { unstable_cache } from 'next/cache'

import {
  buildCanonicalSearchParams,
  createSearchContext,
  facetsTag,
  getHomepage,
  getListingBySlug,
  getRelatedListings,
  getSearchFacetsIgnoring,
  homeTag,
  LISTINGS_CATEGORY_TAG,
  listingsCityTag,
  parseListingSearchInput,
  searchListings,
  type HomepageData,
  type ListingCardViewModel,
  type ListingDetailViewModel,
  type ListingSearchInput,
  type ListingSearchResult,
  type SearchFacets,
} from '@/domain/public-catalog'
import type { MiniSnapshot } from '@/domain/mini-program/contracts'
import type { MiniListingFacetBundle } from '@/domain/mini-program/mappers'

type HomeSnapshot = Readonly<{
  home: HomepageData
  facets: SearchFacets
}>

type ListingSnapshot = Readonly<{
  result: ListingSearchResult
  facets: MiniListingFacetBundle
  input: ListingSearchInput
}>

type DetailSnapshot = Readonly<{
  detail: ListingDetailViewModel
  related: readonly ListingCardViewModel[]
}>

function miniCacheTags(city: string): string[] {
  return [
    LISTINGS_CATEGORY_TAG,
    listingsCityTag(city),
    homeTag(city),
    facetsTag(city),
  ]
}

/** Memoizes cache function factories only; resolved query data remains owned by Next. */
function memoizeByCity<T>(create: (city: string) => T): (city: string) => T {
  const factories = new Map<string, T>()
  return (city) => {
    const existing = factories.get(city)
    if (existing !== undefined) return existing
    const created = create(city)
    factories.set(city, created)
    return created
  }
}

function parseEmptyInput(): ListingSearchInput {
  return parseListingSearchInput(new URLSearchParams())
}

const getCachedMiniHomeByCity = memoizeByCity((city) => unstable_cache(
  async (): Promise<MiniSnapshot<HomeSnapshot>> => {
    const context = createSearchContext(city, new Date(), 'lease')
    const input = { ...parseEmptyInput(), page: 1 } satisfies ListingSearchInput
    const [home, facets] = await Promise.all([
      getHomepage(context),
      getSearchFacetsIgnoring(input, context, ['priceUnit']),
    ])
    return { asOf: context.asOf, data: { home, facets } }
  },
  ['mini-v1-home', city],
  { tags: miniCacheTags(city), revalidate: 300 },
))

export function getCachedMiniHome(city: string): Promise<MiniSnapshot<HomeSnapshot>> {
  return getCachedMiniHomeByCity(city)()
}

const getCachedMiniListingsByCity = memoizeByCity((city) => unstable_cache(
  async (
    canonical: string,
    input: ListingSearchInput,
  ): Promise<MiniSnapshot<ListingSnapshot>> => {
    void canonical
    const context = createSearchContext(city, new Date(), 'lease')
    const [result, district, listingType, priceUnit] = await Promise.all([
      searchListings(input, context),
      getSearchFacetsIgnoring(input, context, ['district']),
      getSearchFacetsIgnoring(input, context, ['listingType']),
      getSearchFacetsIgnoring(input, context, ['priceUnit']),
    ])
    return {
      asOf: context.asOf,
      data: {
        result,
        facets: { district, listingType, priceUnit },
        input,
      },
    }
  },
  ['mini-v1-listings', city],
  { tags: miniCacheTags(city), revalidate: 300 },
))

export function getCachedMiniListings(
  city: string,
  input: ListingSearchInput,
): Promise<MiniSnapshot<ListingSnapshot>> {
  const canonical = buildCanonicalSearchParams(input).toString()
  return getCachedMiniListingsByCity(city)(canonical, input)
}

const getCachedMiniListingDetailByCity = memoizeByCity((city) => unstable_cache(
  async (slug: string): Promise<MiniSnapshot<DetailSnapshot | null>> => {
    const context = createSearchContext(city, new Date(), 'lease')
    const detail = await getListingBySlug(slug, context)
    const related = detail
      ? await getRelatedListings(slug, context, { limit: 4 })
      : []
    return {
      asOf: context.asOf,
      data: detail ? { detail, related } : null,
    }
  },
  ['mini-v1-listing-detail', city],
  { tags: miniCacheTags(city), revalidate: 300 },
))

export function getCachedMiniListingDetail(
  city: string,
  slug: string,
): Promise<MiniSnapshot<DetailSnapshot | null>> {
  return getCachedMiniListingDetailByCity(city)(slug)
}
