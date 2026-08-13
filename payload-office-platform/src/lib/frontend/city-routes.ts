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
const URL_BASE = 'https://city-route.invalid'
const RESERVED_CITY_ROOT_SEGMENTS = new Set([
  '_next',
  'admin',
  'api',
  'buildings',
  'city-partner',
  'dev-story',
  'entrust',
  'listings',
  'media',
  'news',
  'pages',
  'publish',
  'robots',
  'sitemap',
])

const LISTING_TYPE_VALUES = new Set([
  'traditional-office',
  'serviced-office',
  'coworking',
  'full-floor',
])
const RENT_UNIT_VALUES = new Set(['rmb-sqm-day', 'rmb-month', 'rmb-seat-month'])
const PRICE_PERIOD_VALUES = new Set(['day', 'month'])
const PRICE_BASIS_VALUES = new Set(['sqm', 'seat', 'total'])
const LISTING_SORT_VALUES = new Set(['recommended', 'rent-asc', 'rent-desc', 'newest'])
const BUILDING_GRADE_VALUES = new Set([
  'grade-a',
  'super-grade-a',
  'creative-park',
  'serviced-office',
])

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

function isCitySlug(value: unknown): value is string {
  return isCanonicalCitySlug(value) && !RESERVED_CITY_ROOT_SEGMENTS.has(value)
}

function rawPathFromSource(value: string): string | null {
  const queryIndex = value.indexOf('?')
  const fragmentIndex = value.indexOf('#')
  const pathEnd = [queryIndex, fragmentIndex]
    .filter((index) => index >= 0)
    .reduce((current, index) => Math.min(current, index), value.length)
  const rawPath = value.slice(0, pathEnd)
  if (rawPath === '' || !rawPath.startsWith('/')) return null
  return rawPath
}

function hasSafeRawPathSegments(rawPath: string): boolean {
  if (rawPath === '/') return true
  if (rawPath.includes('\\') || /[\u0000-\u001f\u007f]/.test(rawPath)) return false
  const segments = rawPath.slice(1).split('/')
  if (segments.some((segment) => segment.length === 0)) return false

  for (const segment of segments) {
    let decoded: string
    try {
      decoded = decodeURIComponent(segment)
    } catch {
      return false
    }
    if (
      decoded === '.' ||
      decoded === '..' ||
      decoded.includes('/') ||
      decoded.includes('\\') ||
      /[\u0000-\u001f\u007f]/.test(decoded)
    ) {
      return false
    }
  }
  return true
}

function parseSourceUrl(value: unknown): URL | null {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return null
  const rawPath = rawPathFromSource(value)
  if (!rawPath || !hasSafeRawPathSegments(rawPath)) return null
  try {
    const parsed = new URL(value, URL_BASE)
    return parsed.origin === URL_BASE ? parsed : null
  } catch {
    return null
  }
}

function canonicalPathSegment(value: string | undefined): string | null {
  if (!value) return null
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

  if (pathname === '/') return route('home', null)
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
  if (!isCitySlug(citySlug) || extra) return route('unknown', null)
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

function readSingle(params: URLSearchParams, key: string): string | null {
  const values = params.getAll(key)
  return values.length === 1 ? values[0] ?? null : null
}

function isCanonicalInteger(value: string, max: number): boolean {
  if (!/^(?:0|[1-9]\d*)$/.test(value)) return false
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= max
}

function isCanonicalDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const [, rawYear, rawMonth, rawDay] = match
  const year = Number(rawYear)
  const month = Number(rawMonth)
  const day = Number(rawDay)
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

function validListingValue(key: (typeof LISTING_QUERY_KEYS)[number], value: string): boolean {
  switch (key) {
    case 'q':
      return value.length > 0 && value.length <= 100 && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value)
    case 'areaMin':
    case 'areaMax':
      return isCanonicalInteger(value, 1_000_000)
    case 'rentMin':
    case 'rentMax':
      return isCanonicalInteger(value, Number.MAX_SAFE_INTEGER)
    case 'rentUnit':
      return RENT_UNIT_VALUES.has(value)
    case 'pricePeriod':
      return PRICE_PERIOD_VALUES.has(value)
    case 'priceBasis':
      return PRICE_BASIS_VALUES.has(value)
    case 'listingType':
      return LISTING_TYPE_VALUES.has(value)
    case 'availableBefore':
      return isCanonicalDate(value)
    case 'sort':
      return LISTING_SORT_VALUES.has(value)
  }
}

function selectListingQuery(params: URLSearchParams): URLSearchParams {
  const selected = new URLSearchParams()
  for (const key of LISTING_QUERY_KEYS) {
    const value = readSingle(params, key)
    if (value !== null && validListingValue(key, value)) selected.set(key, value)
  }
  const areaMin = selected.get('areaMin')
  const areaMax = selected.get('areaMax')
  if (areaMin !== null && areaMax !== null && Number(areaMin) > Number(areaMax)) {
    selected.delete('areaMin')
    selected.delete('areaMax')
  }
  const rentMin = selected.get('rentMin')
  const rentMax = selected.get('rentMax')
  if (rentMin !== null && rentMax !== null && Number(rentMin) > Number(rentMax)) {
    selected.delete('rentMin')
    selected.delete('rentMax')
  }
  const sort = selected.get('sort')
  if ((sort === 'rent-asc' || sort === 'rent-desc') && !selected.has('rentUnit')) {
    selected.delete('sort')
  }
  return selected
}

function selectBuildingQuery(params: URLSearchParams): URLSearchParams {
  const value = readSingle(params, 'grade')
  return value !== null && BUILDING_GRADE_VALUES.has(value)
    ? new URLSearchParams([['grade', value]])
    : new URLSearchParams()
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
  if (!isCitySlug(citySlug)) return null
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
        selectListingQuery(route.params),
      )
    case 'buildings':
      return withQuery(
        `/${destinationCitySlug}/buildings`,
        selectBuildingQuery(route.params),
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
      return '/'
    case 'listings':
      return withQuery('/listings', selectListingQuery(route.params))
    case 'listing-detail':
      return route.detailSlug ? `/listings/${route.detailSlug}` : null
    case 'buildings':
      return withQuery('/buildings', selectBuildingQuery(route.params))
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
      const city = readSingle(route.params, 'city')
      return isCitySlug(city) ? leadPath(route.pageType, city) : `/${route.pageType}`
    }
    case 'unknown':
      return null
  }
}

/** Adds a trusted city prefix where the route is city-scoped. */
export function prefixedCanonicalPath(sourceUrl: unknown, citySlug: string): string | null {
  if (!isCitySlug(citySlug)) return null
  const route = parseRoute(sourceUrl)
  if (!route) return null
  switch (route.pageType) {
    case 'home':
      return `/${citySlug}`
    case 'listings':
      return withQuery(`/${citySlug}/listings`, selectListingQuery(route.params))
    case 'listing-detail':
      return route.detailSlug ? `/${citySlug}/listings/${route.detailSlug}` : null
    case 'buildings':
      return withQuery(`/${citySlug}/buildings`, selectBuildingQuery(route.params))
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
