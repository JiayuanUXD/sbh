/**
 * Public city routing is deliberately independent from profile lookup. Callers
 * provide a trusted city option, while this module only accepts already
 * canonical slugs and whitelists every path/query fragment it emits.
 */

export type CityPageType =
  | 'home'
  | 'listings'
  | 'listing-detail'
  | 'buildings'
  | 'building-detail'
  | 'news'
  | 'news-detail'
  | 'privacy'
  | 'page-detail'
  | 'entrust'
  | 'publish'
  | 'city-partner'
  | 'unknown'

const CITY_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_CITY_SLUG_LENGTH = 64
const MAX_QUERY_VALUE_LENGTH = 200
const URL_BASE = 'https://city-route.invalid'

const LISTING_QUERY_KEYS = [
  'q',
  'areaMin',
  'areaMax',
  'rentMin',
  'rentMax',
  'rentUnit',
  'pricePeriod',
  'priceBasis',
  'listingType',
  'availableBefore',
  'sort',
] as const

const BUILDING_QUERY_KEYS = ['grade'] as const

type Route = Readonly<{
  citySlug: string | null
  detailSlug: string | null
  pageType: CityPageType
  params: URLSearchParams
}>

function isCanonicalCitySlug(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_CITY_SLUG_LENGTH &&
    CITY_SLUG_PATTERN.test(value)
  )
}

function parseSourceUrl(value: unknown): URL | null {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return null
  try {
    const parsed = new URL(value, URL_BASE)
    return parsed.origin === URL_BASE ? parsed : null
  } catch {
    return null
  }
}

function canonicalPathSegment(value: string | undefined): string | null {
  if (!value || value.length > MAX_QUERY_VALUE_LENGTH) return null
  try {
    const decoded = decodeURIComponent(value)
    if (
      decoded.length === 0 ||
      decoded === '.' ||
      decoded === '..' ||
      decoded.includes('/') ||
      decoded.includes('\\') ||
      /[\u0000-\u001f\u007f]/.test(decoded)
    ) {
      return null
    }
    return encodeURIComponent(decoded)
  } catch {
    return null
  }
}

function classifyPath(pathname: string, params: URLSearchParams): Route {
  const segments = pathname.split('/').filter(Boolean)
  const route = (pageType: CityPageType, citySlug: string | null, detailSlug: string | null = null): Route => ({
    citySlug,
    detailSlug,
    pageType,
    params,
  })

  if (segments.length === 1 && segments[0] === 'news') return route('news', null)
  if (segments.length === 2 && segments[0] === 'news') {
    return canonicalPathSegment(segments[1]) ? route('news-detail', null, canonicalPathSegment(segments[1])) : route('unknown', null)
  }
  if (segments.length === 2 && segments[0] === 'pages' && segments[1] === 'privacy') {
    return route('privacy', null)
  }
  if (segments.length === 2 && segments[0] === 'pages') {
    return canonicalPathSegment(segments[1]) ? route('page-detail', null, canonicalPathSegment(segments[1])) : route('unknown', null)
  }
  if (segments.length === 1 && segments[0] === 'entrust') return route('entrust', null)
  if (segments.length === 1 && segments[0] === 'publish') return route('publish', null)
  if (segments.length === 1 && segments[0] === 'city-partner') return route('city-partner', null)

  if (segments.length === 1 && segments[0] === 'listings') return route('listings', null)
  if (segments.length === 2 && segments[0] === 'listings') {
    return canonicalPathSegment(segments[1]) ? route('listing-detail', null, canonicalPathSegment(segments[1])) : route('unknown', null)
  }
  if (segments.length === 1 && segments[0] === 'buildings') return route('buildings', null)
  if (segments.length === 2 && segments[0] === 'buildings') {
    return canonicalPathSegment(segments[1]) ? route('building-detail', null, canonicalPathSegment(segments[1])) : route('unknown', null)
  }

  const [citySlug, resource, slug, extra] = segments
  if (!isCanonicalCitySlug(citySlug) || extra) return route('unknown', null)
  if (!resource) return route('home', citySlug)
  if (resource === 'listings' && !slug) return route('listings', citySlug)
  if (resource === 'buildings' && !slug) return route('buildings', citySlug)
  if (resource === 'listings' && slug) {
    const detailSlug = canonicalPathSegment(slug)
    return detailSlug ? route('listing-detail', citySlug, detailSlug) : route('unknown', null)
  }
  if (resource === 'buildings' && slug) {
    const detailSlug = canonicalPathSegment(slug)
    return detailSlug ? route('building-detail', citySlug, detailSlug) : route('unknown', null)
  }
  return route('unknown', null)
}

function parseRoute(value: unknown): Route | null {
  const parsed = parseSourceUrl(value)
  return parsed ? classifyPath(parsed.pathname, parsed.searchParams) : null
}

function isSafeQueryValue(value: string | null): value is string {
  return (
    value !== null &&
    value.length > 0 &&
    value.length <= MAX_QUERY_VALUE_LENGTH &&
    !/[\u0000-\u001f\u007f]/.test(value)
  )
}

function selectQuery(
  params: URLSearchParams,
  allowedKeys: readonly string[],
): URLSearchParams {
  const selected = new URLSearchParams()
  for (const key of allowedKeys) {
    const value = params.get(key)
    if (isSafeQueryValue(value)) selected.set(key, value)
  }
  return selected
}

function withQuery(pathname: string, params: URLSearchParams): string {
  const query = params.toString()
  return query ? `${pathname}?${query}` : pathname
}

function leadPath(pageType: Extract<CityPageType, 'entrust' | 'publish' | 'city-partner'>, citySlug: string): string {
  const pathname = pageType === 'city-partner' ? '/city-partner' : `/${pageType}`
  return withQuery(pathname, new URLSearchParams([['city', citySlug]]))
}

/** Returns the route kind without needing a database profile lookup. */
export function getCityPageType(pathname: unknown): CityPageType {
  return parseRoute(pathname)?.pageType ?? 'unknown'
}

/** Builds the safe city-aware destination for navigation and switching controls. */
export function buildCityPath(citySlug: string, pageType: CityPageType): string | null {
  if (!isCanonicalCitySlug(citySlug)) return null
  switch (pageType) {
    case 'home':
      return `/${citySlug}`
    case 'listings':
    case 'listing-detail':
      return `/${citySlug}/listings`
    case 'buildings':
    case 'building-detail':
      return `/${citySlug}/buildings`
    case 'entrust':
    case 'publish':
    case 'city-partner':
      return leadPath(pageType, citySlug)
    case 'news':
      return '/news'
    case 'privacy':
      return '/pages/privacy'
    case 'page-detail':
      return '/pages'
    case 'news-detail':
    case 'unknown':
      return null
  }
}

/**
 * Produces the destination-city URL for a trusted city switcher option.
 * Invalid source URLs deliberately collapse to destination home; invalid
 * destination slugs produce no URL at all.
 */
export function switchCityUrl(sourceUrl: unknown, destinationCitySlug: string): string | null {
  const destinationHome = buildCityPath(destinationCitySlug, 'home')
  if (!destinationHome) return null

  const route = parseRoute(sourceUrl)
  if (!route) return destinationHome
  switch (route.pageType) {
    case 'home':
    case 'unknown':
    case 'news':
    case 'news-detail':
    case 'privacy':
    case 'page-detail':
      return destinationHome
    case 'listings':
      return withQuery(
        `/${destinationCitySlug}/listings`,
        selectQuery(route.params, LISTING_QUERY_KEYS),
      )
    case 'buildings':
      return withQuery(
        `/${destinationCitySlug}/buildings`,
        selectQuery(route.params, BUILDING_QUERY_KEYS),
      )
    case 'listing-detail':
      return `/${destinationCitySlug}/listings`
    case 'building-detail':
      return `/${destinationCitySlug}/buildings`
    case 'entrust':
    case 'publish':
    case 'city-partner':
      return leadPath(route.pageType, destinationCitySlug)
  }
}

/** Removes a valid city prefix while retaining only canonical route state. */
export function legacyCanonicalPath(sourceUrl: unknown): string | null {
  const route = parseRoute(sourceUrl)
  if (!route) return null
  switch (route.pageType) {
    case 'home':
      return route.citySlug ? '/' : null
    case 'listings':
      return withQuery('/listings', selectQuery(route.params, LISTING_QUERY_KEYS))
    case 'listing-detail':
      return route.detailSlug ? `/listings/${route.detailSlug}` : null
    case 'buildings':
      return withQuery('/buildings', selectQuery(route.params, BUILDING_QUERY_KEYS))
    case 'building-detail':
      return route.detailSlug ? `/buildings/${route.detailSlug}` : null
    case 'news':
      return '/news'
    case 'news-detail':
      return route.detailSlug ? `/news/${route.detailSlug}` : null
    case 'privacy':
      return '/pages/privacy'
    case 'page-detail':
      return route.detailSlug ? `/pages/${route.detailSlug}` : null
    case 'entrust':
    case 'publish':
    case 'city-partner': {
      const city = route.params.get('city')
      return isCanonicalCitySlug(city) ? leadPath(route.pageType, city) : `/${route.pageType}`
    }
    case 'unknown':
      return null
  }
}

/** Adds a trusted city prefix where the route is city-scoped. */
export function prefixedCanonicalPath(sourceUrl: unknown, citySlug: string): string | null {
  if (!isCanonicalCitySlug(citySlug)) return null
  const route = parseRoute(sourceUrl)
  if (!route) return null
  switch (route.pageType) {
    case 'home':
      return `/${citySlug}`
    case 'listings':
      return withQuery(`/${citySlug}/listings`, selectQuery(route.params, LISTING_QUERY_KEYS))
    case 'listing-detail':
      return route.detailSlug ? `/${citySlug}/listings/${route.detailSlug}` : null
    case 'buildings':
      return withQuery(`/${citySlug}/buildings`, selectQuery(route.params, BUILDING_QUERY_KEYS))
    case 'building-detail':
      return route.detailSlug ? `/${citySlug}/buildings/${route.detailSlug}` : null
    case 'entrust':
    case 'publish':
    case 'city-partner':
      return leadPath(route.pageType, citySlug)
    case 'news':
      return '/news'
    case 'news-detail':
      return route.detailSlug ? `/news/${route.detailSlug}` : null
    case 'privacy':
      return '/pages/privacy'
    case 'page-detail':
      return route.detailSlug ? `/pages/${route.detailSlug}` : null
    case 'unknown':
      return null
  }
}
