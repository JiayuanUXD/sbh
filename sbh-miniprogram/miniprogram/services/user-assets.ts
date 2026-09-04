import type { RequestOptions } from './mini-api-contracts.js'
import { request } from './request.js'
import { createSessionService } from './session.js'

const SAFE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const TOKEN = /^[A-Za-z0-9._~-]{1,4096}$/
const MIGRATION_MARKER = 'sbh_user_assets_migrated_v1'
const LEGACY_LISTINGS_KEY = 'sbh_fav_listings_v1'
const LEGACY_BUILDINGS_KEY = 'sbh_fav_buildings_v1'

const LEAD_STAGES = new Set([
  'new',
  'pending_assignment',
  'following',
  'qualified',
  'viewing',
  'negotiation',
  'converted',
  'lost',
])

export type FavoriteTarget = Readonly<{
  targetType: 'listing' | 'building'
  targetSlug: string
}>

export type UserFavoriteListing = Readonly<{
  slug: string
  title: string
  coverImage: Readonly<{ src: string; alt: string }> | null
}>

export type UserFavoriteBuilding = Readonly<{
  slug: string
  name: string
  coverImage: Readonly<{ src: string; alt: string }> | null
}>

export type UserInquiry = Readonly<{
  targetType: 'listing' | 'building' | 'general'
  targetSlug: string | null
  targetTitle: string
  submittedAt: string
  status: Readonly<{ value: string; label: string }>
}>

export type UserAssets = Readonly<{
  counts: Readonly<{ favorites: number; inquiries: number }>
  favorites: Readonly<{
    listings: readonly UserFavoriteListing[]
    buildings: readonly UserFavoriteBuilding[]
  }>
  inquiries: readonly UserInquiry[]
}>

export type UserAssetsRequestClient = <T>(options: RequestOptions<T>) => Promise<T>

export type UserAssetsService = Readonly<{
  loadUserAssets(): Promise<UserAssets>
  setFavorite(target: FavoriteTarget, favorite: boolean): Promise<UserAssets>
  refreshUserAssets(): Promise<UserAssets>
}>

export class UserAssetsError extends Error {
  readonly code: 'session_invalid' | 'favorite_unconfirmed'

  constructor(code: UserAssetsError['code']) {
    super(code)
    this.name = 'UserAssetsError'
    this.code = code
  }
}

function invalidResponse(): never {
  throw new Error('invalid user assets response')
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalidResponse()
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return invalidResponse()
  return value as Record<string, unknown>
}

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const result = record(value)
  const actual = Object.keys(result)
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) return invalidResponse()
  return result
}

function nonEmptyString(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) return invalidResponse()
  return value
}

function nullableString(value: unknown): string | null {
  return value === null ? null : nonEmptyString(value)
}

function nonNegativeNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return invalidResponse()
  return value
}

function nullableNonNegativeNumber(value: unknown): number | null {
  return value === null ? null : nonNegativeNumber(value)
}

function nullableNonNegativeInteger(value: unknown): number | null {
  const number = nullableNonNegativeNumber(value)
  if (number !== null && !Number.isSafeInteger(number)) return invalidResponse()
  return number
}

function safeSlug(value: unknown): string {
  const slug = nonEmptyString(value)
  if (!SAFE_SLUG.test(slug)) return invalidResponse()
  return slug
}

function stringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return invalidResponse()
  return value.map(nonEmptyString)
}

function optionalFiniteNumber(value: unknown): void {
  if (value !== undefined) nonNegativeNumber(value)
}

function optionalString(value: unknown): void {
  if (value !== undefined) nonEmptyString(value)
}

function parseImage(value: unknown): UserFavoriteListing['coverImage'] {
  if (value === null) return null
  const image = record(value)
  const required = ['src', 'alt']
  const optional = ['width', 'height', 'blurDataURL']
  const keys = Object.keys(image)
  if (
    required.some((key) => !Object.hasOwn(image, key))
    || keys.some((key) => !required.includes(key) && !optional.includes(key))
  ) return invalidResponse()
  const src = nonEmptyString(image.src)
  const alt = nonEmptyString(image.alt)
  optionalFiniteNumber(image.width)
  optionalFiniteNumber(image.height)
  optionalString(image.blurDataURL)
  return { src, alt }
}

function validatePrice(value: unknown): void {
  if (value === null) return
  const price = exact(value, [
    'amount', 'currency', 'businessType', 'period', 'basis', 'displayUnit', 'text', 'monthlyEstimate',
  ])
  nonNegativeNumber(price.amount)
  for (const field of ['currency', 'businessType', 'period', 'basis', 'displayUnit', 'text'] as const) {
    nonEmptyString(price[field])
  }
  nullableNonNegativeNumber(price.monthlyEstimate)
}

function validateListingType(value: unknown): void {
  const listingType = exact(value, ['value', 'label'])
  nonEmptyString(listingType.value)
  nonEmptyString(listingType.label)
}

function validateListingBuilding(value: unknown): void {
  if (value === null) return
  const building = exact(value, ['slug', 'name', 'address', 'district'])
  safeSlug(building.slug)
  nonEmptyString(building.name)
  nonEmptyString(building.address)
  nullableString(building.district)
}

function parseListingFavorite(value: unknown): UserFavoriteListing {
  const listing = exact(value, [
    'slug', 'title', 'citySlug', 'cityName', 'price', 'area', 'seats', 'listingType',
    'availableFrom', 'building', 'coverImage', 'highlights',
  ])
  const slug = safeSlug(listing.slug)
  const title = nonEmptyString(listing.title)
  safeSlug(listing.citySlug)
  nonEmptyString(listing.cityName)
  validatePrice(listing.price)
  nullableNonNegativeNumber(listing.area)
  nullableNonNegativeInteger(listing.seats)
  validateListingType(listing.listingType)
  nullableString(listing.availableFrom)
  validateListingBuilding(listing.building)
  const coverImage = parseImage(listing.coverImage)
  stringArray(listing.highlights)
  return { slug, title, coverImage }
}

function validatePriceRange(value: unknown): void {
  if (value === null) return
  const range = exact(value, ['min', 'max', 'unit', 'displayUnit', 'text'])
  const min = nonNegativeNumber(range.min)
  const max = nonNegativeNumber(range.max)
  if (min > max) return invalidResponse()
  nonEmptyString(range.unit)
  nonEmptyString(range.displayUnit)
  nonEmptyString(range.text)
}

function validateMetro(value: unknown): void {
  if (value === null) return
  const metro = exact(value, ['station', 'line', 'distanceMeters'])
  nonEmptyString(metro.station)
  nullableString(metro.line)
  nullableNonNegativeInteger(metro.distanceMeters)
}

function parseBuildingFavorite(value: unknown): UserFavoriteBuilding {
  const building = exact(value, [
    'slug', 'name', 'district', 'address', 'grade', 'completedYear', 'totalFloors',
    'occupancyRate', 'activeListingCount', 'priceRange', 'coverImage', 'nearestMetro',
  ])
  const slug = safeSlug(building.slug)
  const name = nonEmptyString(building.name)
  nullableString(building.district)
  nonEmptyString(building.address)
  nullableString(building.grade)
  nullableNonNegativeInteger(building.completedYear)
  nullableNonNegativeInteger(building.totalFloors)
  nullableNonNegativeNumber(building.occupancyRate)
  nullableNonNegativeInteger(building.activeListingCount)
  validatePriceRange(building.priceRange)
  const coverImage = parseImage(building.coverImage)
  validateMetro(building.nearestMetro)
  return { slug, name, coverImage }
}

function canonicalTimestamp(value: unknown): string {
  const timestamp = nonEmptyString(value)
  const date = new Date(timestamp)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== timestamp) return invalidResponse()
  return timestamp
}

function parseInquiry(value: unknown): UserInquiry {
  const inquiry = exact(value, ['targetType', 'targetSlug', 'targetTitle', 'submittedAt', 'status'])
  const targetType = inquiry.targetType
  if (targetType !== 'listing' && targetType !== 'building' && targetType !== 'general') {
    return invalidResponse()
  }
  const targetSlug = inquiry.targetSlug === null ? null : safeSlug(inquiry.targetSlug)
  if ((targetType === 'general') !== (targetSlug === null)) return invalidResponse()
  const status = exact(inquiry.status, ['value', 'label'])
  const statusValue = nonEmptyString(status.value)
  if (!LEAD_STAGES.has(statusValue)) return invalidResponse()
  return {
    targetType,
    targetSlug,
    targetTitle: nonEmptyString(inquiry.targetTitle),
    submittedAt: canonicalTimestamp(inquiry.submittedAt),
    status: { value: statusValue, label: nonEmptyString(status.label) },
  }
}

export function parseUserAssets(value: unknown): UserAssets {
  const root = exact(value, ['counts', 'favorites', 'inquiries'])
  const counts = exact(root.counts, ['favorites', 'inquiries'])
  const favorites = exact(root.favorites, ['listings', 'buildings'])
  if (!Array.isArray(favorites.listings) || !Array.isArray(favorites.buildings) || !Array.isArray(root.inquiries)) {
    return invalidResponse()
  }
  const listingFavorites = favorites.listings.map(parseListingFavorite)
  const buildingFavorites = favorites.buildings.map(parseBuildingFavorite)
  const inquiries = root.inquiries.map(parseInquiry)
  const favoriteCount = nonNegativeNumber(counts.favorites)
  const inquiryCount = nonNegativeNumber(counts.inquiries)
  if (
    !Number.isSafeInteger(favoriteCount)
    || !Number.isSafeInteger(inquiryCount)
    || favoriteCount !== listingFavorites.length + buildingFavorites.length
    || inquiryCount !== inquiries.length
  ) return invalidResponse()
  return {
    counts: { favorites: favoriteCount, inquiries: inquiryCount },
    favorites: { listings: listingFavorites, buildings: buildingFavorites },
    inquiries,
  }
}

function parseFavoriteConfirmation(value: unknown, expected: FavoriteTarget, favorite: boolean): void {
  const response = exact(
    value,
    favorite
      ? ['favorite', 'created', 'targetType', 'targetSlug']
      : ['favorite', 'removed', 'targetType', 'targetSlug'],
  )
  if (
    response.favorite !== favorite
    || response.targetType !== expected.targetType
    || response.targetSlug !== expected.targetSlug
    || (favorite ? typeof response.created !== 'boolean' : typeof response.removed !== 'boolean')
  ) return invalidResponse()
}

function validTarget(target: FavoriteTarget): boolean {
  return (target.targetType === 'listing' || target.targetType === 'building')
    && SAFE_SLUG.test(target.targetSlug)
}

export function isFavorite(assets: UserAssets, target: FavoriteTarget): boolean {
  const items = target.targetType === 'listing'
    ? assets.favorites.listings
    : assets.favorites.buildings
  return items.some((item) => item.slug === target.targetSlug)
}

function requestLoginCode(): Promise<Readonly<{ code: string }>> {
  return new Promise((resolve, reject) => {
    wx.login({
      success: ({ code }) => resolve({ code }),
      fail: reject,
    })
  })
}

function storageAvailable(): boolean {
  return typeof wx !== 'undefined'
    && typeof wx.getStorageSync === 'function'
    && typeof wx.setStorageSync === 'function'
    && typeof wx.removeStorageSync === 'function'
}

function legacyTargets(): readonly FavoriteTarget[] {
  if (!storageAvailable()) return []
  try {
    if (wx.getStorageSync(MIGRATION_MARKER) === true) return []
    const result: FavoriteTarget[] = []
    const append = (value: unknown, targetType: FavoriteTarget['targetType']): void => {
      if (!Array.isArray(value)) return
      for (const item of value) {
        if (typeof item !== 'object' || item === null || Array.isArray(item)) continue
        const slug = Object.getOwnPropertyDescriptor(item, 'slug')?.value
        if (typeof slug === 'string' && SAFE_SLUG.test(slug)) {
          result.push({ targetType, targetSlug: slug })
        }
      }
    }
    append(wx.getStorageSync(LEGACY_LISTINGS_KEY), 'listing')
    append(wx.getStorageSync(LEGACY_BUILDINGS_KEY), 'building')
    return [...new Map(result.map((target) => [`${target.targetType}:${target.targetSlug}`, target])).values()]
  } catch {
    return []
  }
}

function settleMigrationStorage(): void {
  if (!storageAvailable()) return
  try {
    wx.removeStorageSync(LEGACY_LISTINGS_KEY)
    wx.removeStorageSync(LEGACY_BUILDINGS_KEY)
    wx.removeStorageSync('sbh_inquiry_records_v1')
    wx.setStorageSync(MIGRATION_MARKER, true)
  } catch {
    // Storage 只记录迁移进度，失败不能改变已由服务端确认的可见状态。
  }
}

export function createUserAssetsService(dependencies: Readonly<{
  request: UserAssetsRequestClient
  ensureAnonymousContext(): Promise<string | null>
}>): UserAssetsService {
  let confirmedCache: UserAssets | null = null
  let loadInFlight: Promise<UserAssets> | null = null

  const sessionToken = async (): Promise<string> => {
    const token = await dependencies.ensureAnonymousContext()
    if (token === null || !TOKEN.test(token)) throw new UserAssetsError('session_invalid')
    return token
  }

  const readConfirmed = async (token: string): Promise<UserAssets> => {
    const assets = await dependencies.request({
      path: '/api/mini/v1/me',
      method: 'GET',
      anonymousContextToken: token,
      parse: parseUserAssets,
    })
    confirmedCache = assets
    return assets
  }

  const mutate = async (token: string, target: FavoriteTarget, favorite: boolean): Promise<void> => {
    if (!validTarget(target)) throw new TypeError('收藏目标无效')
    await dependencies.request({
      path: '/api/mini/v1/favorites',
      method: favorite ? 'PUT' : 'DELETE',
      anonymousContextToken: token,
      data: target,
      parse: (value) => parseFavoriteConfirmation(value, target, favorite),
    })
  }

  const refreshUserAssets = async (): Promise<UserAssets> => readConfirmed(await sessionToken())

  const loadUserAssets = (): Promise<UserAssets> => {
    if (loadInFlight) return loadInFlight
    const task = Promise.resolve().then(async () => {
      const token = await sessionToken()
      const initial = await readConfirmed(token)
      const candidates = legacyTargets().filter((target) => !isFavorite(initial, target))
      for (const target of candidates) await mutate(token, target, true)
      const confirmed = candidates.length > 0 ? await readConfirmed(token) : initial
      if (candidates.some((target) => !isFavorite(confirmed, target))) {
        confirmedCache = initial
        throw new UserAssetsError('favorite_unconfirmed')
      }
      settleMigrationStorage()
      return confirmedCache ?? confirmed
    }).finally(() => {
      loadInFlight = null
    })
    loadInFlight = task
    return task
  }

  const setFavorite = async (target: FavoriteTarget, favorite: boolean): Promise<UserAssets> => {
    const token = await sessionToken()
    await mutate(token, target, favorite)
    const confirmed = await readConfirmed(token)
    if (isFavorite(confirmed, target) !== favorite) {
      throw new UserAssetsError('favorite_unconfirmed')
    }
    return confirmed
  }

  return { loadUserAssets, setFavorite, refreshUserAssets }
}

const defaultSessionService = createSessionService({ login: requestLoginCode, request })
const defaultUserAssetsService = createUserAssetsService({
  request,
  ensureAnonymousContext: defaultSessionService.ensureAnonymousContext,
})

export const loadUserAssets = defaultUserAssetsService.loadUserAssets
export const setFavorite = defaultUserAssetsService.setFavorite
export const refreshUserAssets = defaultUserAssetsService.refreshUserAssets
