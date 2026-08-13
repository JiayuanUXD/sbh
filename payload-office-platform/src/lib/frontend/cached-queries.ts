import { unstable_cache } from 'next/cache'

import {
  ARTICLES_CATEGORY_TAG as PUBLIC_ARTICLES_CATEGORY_TAG,
  BUILDINGS_CATEGORY_TAG,
  LISTINGS_CATEGORY_TAG,
  SITEMAP_TAG,
  buildCanonicalSearchParams,
  buildListingSearchSource,
  buildingsCityTag,
  createSearchContext,
  facetsTag,
  getArticleBySlug,
  getBuildingBySlug,
  getBuildingDetail,
  getDetailRecommendations,
  getHomepage,
  getListingBySlug,
  getListingDistrictOptions,
  getPageBySlug,
  getRelatedBuildings,
  getRelatedListings,
  getSearchFacets,
  homeTag,
  listPublishedArticles,
  listPublishedPages,
  listingsCityTag,
  paginateListingSearchSource,
  searchBuildings,
  searchBuildingsPage,
  type ListingSearchInput,
} from '@/domain/public-catalog'

const PAGES_CATEGORY_TAG = 'public:pages'
export const ARTICLES_CATEGORY_TAG = PUBLIC_ARTICLES_CATEGORY_TAG

function canonicalCitySlug(citySlug: string): string {
  return createSearchContext(citySlug).city
}

/** Private factory memoization; callers only receive typed public wrappers. */
function memoizeByCity<T>(create: (citySlug: string) => T): (citySlug: string) => T {
  const cache = new Map<string, T>()
  return (citySlug) => {
    const existing = cache.get(citySlug)
    if (existing !== undefined) return existing
    const created = create(citySlug)
    cache.set(citySlug, created)
    return created
  }
}

function listingCacheTags(citySlug: string): string[] {
  return [
    LISTINGS_CATEGORY_TAG,
    listingsCityTag(citySlug),
    homeTag(citySlug),
    SITEMAP_TAG,
  ]
}

function buildingCacheTags(citySlug: string): string[] {
  return [
    BUILDINGS_CATEGORY_TAG,
    buildingsCityTag(citySlug),
    homeTag(citySlug),
    SITEMAP_TAG,
  ]
}

function mixedSupplyCacheTags(citySlug: string): string[] {
  return [...listingCacheTags(citySlug), ...buildingCacheTags(citySlug)]
}

const getCachedHomepageByCity = memoizeByCity((citySlug) =>
  unstable_cache(
    async () => getHomepage(createSearchContext(citySlug)),
    ['homepage', citySlug],
    {
      tags: [
        ...mixedSupplyCacheTags(citySlug),
        ARTICLES_CATEGORY_TAG,
        facetsTag(citySlug),
      ],
      revalidate: 300,
    },
  ),
)

export function getCachedHomepage(citySlug: string) {
  const city = canonicalCitySlug(citySlug)
  return getCachedHomepageByCity(city)()
}

const getCachedListingBySlugByCity = memoizeByCity((citySlug) =>
  unstable_cache(
    async (slug: string) => getListingBySlug(slug, createSearchContext(citySlug)),
    ['listing-by-slug', citySlug],
    { tags: listingCacheTags(citySlug), revalidate: 300 },
  ),
)

export function getCachedListingBySlug(citySlug: string, slug: string) {
  const city = canonicalCitySlug(citySlug)
  return getCachedListingBySlugByCity(city)(slug)
}

const getCachedRelatedListingsByCity = memoizeByCity((citySlug) =>
  unstable_cache(
    async (listingSlug: string, limit: number = 6) =>
      getRelatedListings(listingSlug, createSearchContext(citySlug), { limit }),
    ['related-listings', citySlug],
    { tags: mixedSupplyCacheTags(citySlug), revalidate: 300 },
  ),
)

export function getCachedRelatedListings(
  citySlug: string,
  listingSlug: string,
  limit: number = 6,
) {
  const city = canonicalCitySlug(citySlug)
  return getCachedRelatedListingsByCity(city)(listingSlug, limit)
}

const getCachedDetailRecommendationsByCity = memoizeByCity((citySlug) =>
  unstable_cache(
    async (listingSlug: string, limit: number = 6) =>
      getDetailRecommendations(listingSlug, createSearchContext(citySlug), { limit }),
    ['detail-recommendations', citySlug],
    { tags: mixedSupplyCacheTags(citySlug), revalidate: 300 },
  ),
)

export function getCachedDetailRecommendations(
  citySlug: string,
  listingSlug: string,
  limit: number = 6,
) {
  const city = canonicalCitySlug(citySlug)
  return getCachedDetailRecommendationsByCity(city)(listingSlug, limit)
}

const getCachedRelatedBuildingsByCity = memoizeByCity((citySlug) =>
  unstable_cache(
    async (buildingSlug: string, limit: number = 6) =>
      getRelatedBuildings(buildingSlug, createSearchContext(citySlug), { limit }),
    ['related-buildings', citySlug],
    { tags: mixedSupplyCacheTags(citySlug), revalidate: 300 },
  ),
)

export function getCachedRelatedBuildings(
  citySlug: string,
  buildingSlug: string,
  limit: number = 6,
) {
  const city = canonicalCitySlug(citySlug)
  return getCachedRelatedBuildingsByCity(city)(buildingSlug, limit)
}

const getCachedSearchBuildingsByCity = memoizeByCity((citySlug) =>
  unstable_cache(
    async () => searchBuildings(createSearchContext(citySlug)),
    ['search-buildings', citySlug],
    { tags: mixedSupplyCacheTags(citySlug), revalidate: 300 },
  ),
)

export function getCachedSearchBuildings(citySlug: string) {
  const city = canonicalCitySlug(citySlug)
  return getCachedSearchBuildingsByCity(city)()
}

type SitemapBuildingPageLoader = () => ReturnType<typeof searchBuildingsPage>

const getCachedSitemapBuildingsPageByCity = memoizeByCity((citySlug) => {
  const pages = new Map<string, SitemapBuildingPageLoader>()
  return (page: number, limit: number) => {
    const cacheKey = `${page}:${limit}`
    const existing = pages.get(cacheKey)
    if (existing) return existing()
    const load = unstable_cache(
      async () => searchBuildingsPage(
        createSearchContext(citySlug),
        { page, limit },
      ),
      ['sitemap-buildings-page', citySlug, `page:${page}`, `limit:${limit}`],
      {
        tags: [
          ...buildingCacheTags(citySlug),
          `${buildingsCityTag(citySlug)}:page:${page}:limit:${limit}`,
        ],
        revalidate: 300,
      },
    )
    pages.set(cacheKey, load)
    return load()
  }
})

export function getCachedSitemapBuildingsPage(
  citySlug: string,
  page: number,
  limit: number,
) {
  const city = canonicalCitySlug(citySlug)
  const normalizedPage = Math.max(1, Math.floor(page))
  const normalizedLimit = Math.min(500, Math.max(1, Math.floor(limit)))
  return getCachedSitemapBuildingsPageByCity(city)(normalizedPage, normalizedLimit)
}

const getCachedBuildingDetailByCity = memoizeByCity((citySlug) =>
  unstable_cache(
    async (slug: string) => getBuildingDetail(slug, createSearchContext(citySlug)),
    ['building-detail', citySlug],
    {
      tags: [...mixedSupplyCacheTags(citySlug), facetsTag(citySlug)],
      revalidate: 300,
    },
  ),
)

export function getCachedBuildingDetail(citySlug: string, slug: string) {
  const city = canonicalCitySlug(citySlug)
  return getCachedBuildingDetailByCity(city)(slug)
}

const getCachedBuildingBySlugByCity = memoizeByCity((citySlug) =>
  unstable_cache(
    async (slug: string) => getBuildingBySlug(slug, createSearchContext(citySlug)),
    ['building-by-slug', citySlug],
    { tags: buildingCacheTags(citySlug), revalidate: 300 },
  ),
)

export function getCachedBuildingBySlug(citySlug: string, slug: string) {
  const city = canonicalCitySlug(citySlug)
  return getCachedBuildingBySlugByCity(city)(slug)
}

export function buildListingSearchSourceCacheKey(input: ListingSearchInput): string {
  return buildCanonicalSearchParams({ ...input, page: 1 }).toString()
}

const getCachedListingSearchSourceByCity = memoizeByCity((citySlug) =>
  unstable_cache(
    async (sourceCacheKey: string, input: ListingSearchInput) => {
      void sourceCacheKey
      return buildListingSearchSource(input, createSearchContext(citySlug))
    },
    ['listing-search-source', citySlug],
    {
      tags: [...listingCacheTags(citySlug), facetsTag(citySlug)],
      revalidate: 300,
    },
  ),
)

export async function getCachedSearchListings(
  citySlug: string,
  canonicalQuery: string,
  input: ListingSearchInput,
) {
  void canonicalQuery
  const city = canonicalCitySlug(citySlug)
  const sourceInput = { ...input, page: 1 }
  const sourceCacheKey = buildListingSearchSourceCacheKey(input)
  const source = await getCachedListingSearchSourceByCity(city)(sourceCacheKey, sourceInput)
  return paginateListingSearchSource(source, input)
}

const getCachedListingDistrictOptionsByCity = memoizeByCity((citySlug) =>
  unstable_cache(
    async () => getListingDistrictOptions(createSearchContext(citySlug)),
    ['listing-district-options', citySlug],
    {
      tags: [...mixedSupplyCacheTags(citySlug), facetsTag(citySlug)],
      revalidate: 300,
    },
  ),
)

export function getCachedListingDistrictOptions(citySlug: string) {
  const city = canonicalCitySlug(citySlug)
  return getCachedListingDistrictOptionsByCity(city)()
}

const getCachedSearchFacetsByCity = memoizeByCity((citySlug) =>
  unstable_cache(
    async (canonicalQuery: string, input: ListingSearchInput) => {
      void canonicalQuery
      return getSearchFacets(input, createSearchContext(citySlug))
    },
    ['search-facets', citySlug],
    {
      tags: [...listingCacheTags(citySlug), facetsTag(citySlug)],
      revalidate: 300,
    },
  ),
)

export function getCachedSearchFacets(
  citySlug: string,
  canonicalQuery: string,
  input: ListingSearchInput,
) {
  const city = canonicalCitySlug(citySlug)
  return getCachedSearchFacetsByCity(city)(canonicalQuery, input)
}

// Articles and pages intentionally remain global in Plan 2.
export const getCachedPageBySlug = unstable_cache(
  async (slug: string) => getPageBySlug(slug),
  ['page-by-slug'],
  { tags: [PAGES_CATEGORY_TAG, SITEMAP_TAG] },
)

export const getCachedPublishedPages = unstable_cache(
  async (limit: number = 500) => listPublishedPages({ limit }),
  ['published-pages'],
  { tags: [PAGES_CATEGORY_TAG, SITEMAP_TAG] },
)

export const getCachedPublishedArticles = unstable_cache(
  async (page: number = 1, pageSize: number = 12) =>
    listPublishedArticles({ page, pageSize }),
  ['published-articles'],
  {
    tags: [ARTICLES_CATEGORY_TAG, SITEMAP_TAG],
    revalidate: 300,
  },
)

export const getCachedArticleBySlug = unstable_cache(
  async (slug: string) => getArticleBySlug(slug),
  ['article-by-slug'],
  {
    tags: [ARTICLES_CATEGORY_TAG, SITEMAP_TAG],
    revalidate: 300,
  },
)
