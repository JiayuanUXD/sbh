/**
 * Public city routing is deliberately independent from profile lookup. Callers
 * provide a trusted city option, while this module only accepts already
 * canonical slugs and whitelists every path/query fragment it emits.
 */

import { parseListingSearchInput } from '@/domain/public-catalog/search-params'
import type { ListingSearchInput } from '@/domain/public-catalog/types'

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
const PERCENT_ENCODED_OCTET = /%[0-9A-Fa-f]{2}/
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

const PRICE_PERIOD_VALUES = new Set(['day', 'month'])
const PRICE_BASIS_VALUES = new Set(['sqm', 'seat', 'total'])
const BUILDING_GRADE_VALUES = new Set([
  'grade-a',
  'super-grade-a',
  'creative-park',
  'serviced-office',
])

const LISTING_QUERY_KEYS = [
  'type',
  'areaMin',
  'areaMax',
  'rentMin',
  'rentMax',
  'rentUnit',
  'pricePeriod',
  'priceBasis',
  'availableBefore',
  'q',
  'sort',
] as const

const BUILDING_QUERY_KEYS = ['grade'] as const

type Route = Readonly<{
  citySlug: string | null
  detailSlug: string | null
  pageType: CityPageType
  params: URLSearchParams
}>

type ParsedSourceUrl = Readonly<{
  params: URLSearchParams
  pathname: string
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

function hasSafeDecodedLayers(segment: string): boolean {
  let decoded = segment
  for (let depth = 0; depth < 4; depth += 1) {
    if (decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\') || /[\u0000-\u001f\u007f]/.test(decoded)) {
      return false
    }
    if (!decoded.includes('%')) return true
    try {
      decoded = decodeURIComponent(decoded)
    } catch {
      // The original request must be valid percent-encoding. A literal percent
      // becomes acceptable only after one complete, safe decoding layer.
      if (depth === 0) return false
      // A malformed suffix must not hide another complete escape which may
      // still decode to a traversal/control token on a later layer.
      return !PERCENT_ENCODED_OCTET.test(decoded)
    }
  }
  // More decodable layers may conceal a dangerous token beyond the bounded
  // scan, so fail closed rather than treating it as a literal percent.
  return !decoded.includes('%')
}

function hasSafeRawPathSegments(rawPath: string): boolean {
  if (rawPath === '/') return true
  if (rawPath.includes('\\') || /[\u0000-\u001f\u007f]/.test(rawPath)) return false
  const segments = rawPath.slice(1).split('/')
  if (segments.some((segment) => segment.length === 0)) return false
  return segments.every(hasSafeDecodedLayers)
}

function parseSourceUrl(value: unknown): ParsedSourceUrl | null {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return null
  const rawPath = rawPathFromSource(value)
  if (!rawPath || !hasSafeRawPathSegments(rawPath)) return null
  try {
    const parsed = new URL(value, URL_BASE)
    // Classification deliberately uses the URL pathname token as serialized,
    // not the recursively decoded guard input. Encoded aliases must never be
    // able to claim city or static route ownership.
    return parsed.origin === URL_BASE ? { pathname: parsed.pathname, params: parsed.searchParams } : null
  } catch {
    return null
  }
}

function canonicalPathSegment(value: string | undefined): string | null {
  if (!value) return null
  let decoded: string
  try {
    decoded = decodeURIComponent(value)
  } catch {
    decoded = value
  }
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
  return parsed ? classifyPath(parsed.pathname, parsed.params) : null
}

function readSingle(params: URLSearchParams, key: string): string | null {
  const values = params.getAll(key)
  return values.length === 1 ? values[0] ?? null : null
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

function selectFuturePriceValue(
  params: URLSearchParams,
  key: 'pricePeriod' | 'priceBasis',
): string | null {
  const value = readSingle(params, key)
  if (value === null) return null
  return key === 'pricePeriod'
    ? PRICE_PERIOD_VALUES.has(value) ? value : null
    : PRICE_BASIS_VALUES.has(value) ? value : null
}

function singleListingParams(params: URLSearchParams): URLSearchParams {
  const selected = new URLSearchParams()
  for (const key of LISTING_QUERY_KEYS) {
    if (key === 'pricePeriod' || key === 'priceBasis') continue
    const value = readSingle(params, key)
    if (value !== null) selected.set(key, value)
  }
  return selected
}

function appendCanonicalListingQuery(
  selected: URLSearchParams,
  input: ListingSearchInput,
  pricePeriod: string | null,
  priceBasis: string | null,
): void {
  const listingType = input.listingType?.[0]
  if (listingType) selected.set('type', listingType)
  if (input.areaMin !== undefined) selected.set('areaMin', String(input.areaMin))
  if (input.areaMax !== undefined) selected.set('areaMax', String(input.areaMax))
  if (input.rentMin !== undefined) selected.set('rentMin', String(input.rentMin))
  if (input.rentMax !== undefined) selected.set('rentMax', String(input.rentMax))
  if (input.rentUnit) selected.set('rentUnit', input.rentUnit)
  if (pricePeriod) selected.set('pricePeriod', pricePeriod)
  if (priceBasis) selected.set('priceBasis', priceBasis)
  if (input.availableBefore) selected.set('availableBefore', input.availableBefore)
  if (input.q) selected.set('q', input.q)
  if (input.sort && input.sort !== 'recommended') selected.set('sort', input.sort)
}

function selectListingQuery(params: URLSearchParams): URLSearchParams {
  const input = parseListingSearchInput(singleListingParams(params))
  const selected = new URLSearchParams()
  appendCanonicalListingQuery(
    selected,
    input,
    selectFuturePriceValue(params, 'pricePeriod'),
    selectFuturePriceValue(params, 'priceBasis'),
  )
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
