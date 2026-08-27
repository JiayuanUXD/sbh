import {
  PRICE_DISPLAY_UNITS,
  type PriceDisplayUnit,
} from '../domain/listing-query.js'

export type { PriceDisplayUnit } from '../domain/listing-query.js'

export type MiniImage = Readonly<{
  src: string
  width?: number
  height?: number
  alt: string
  blurDataURL?: string
}>

export type MiniPrice = Readonly<{
  amount: number
  currency: 'CNY'
  businessType: 'lease' | 'sale'
  period: 'day' | 'month' | 'year' | 'one-time'
  basis: 'sqm' | 'seat' | 'total'
  displayUnit: PriceDisplayUnit
  text: string
  monthlyEstimate: number | null
}>

export type MiniListingCard = Readonly<{
  id: string
  slug: string
  title: string
  citySlug: string
  cityName: string
  price: MiniPrice | null
  area: number | null
  seats: number | null
  listingType: Readonly<{ value: string; label: string }>
  availableFrom: string | null
  building: Readonly<{ slug: string; name: string; address: string; district: string | null }> | null
  coverImage: MiniImage | null
  highlights: readonly string[]
}>

export type MiniQuickFilter = Readonly<{
  id: 'district' | 'listingType' | 'priceUnit'
  label: string
  options: readonly Readonly<{ value: string; label: string; count: number }>[]
}>

export type MiniHomeData = Readonly<{
  featuredListings: readonly MiniListingCard[]
  quickFilters: readonly MiniQuickFilter[]
  stats: Readonly<{ listings: number; buildings: number; businessAreas: number }>
}>

export type MiniListingsData = Readonly<{
  items: readonly MiniListingCard[]
  pagination: Readonly<{
    page: number
    pageSize: 24
    totalDocs: number
    totalPages: number
    hasNextPage: boolean
    hasPrevPage: boolean
  }>
  canonicalQuery: string
  currentPriceUnit: PriceDisplayUnit | null
  filters: readonly MiniQuickFilter[]
}>

const INVALID_CATALOG_RESPONSE = 'Mini API 目录响应无效'

function invalidCatalogResponse(): never {
  throw new Error(INVALID_CATALOG_RESPONSE)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    return invalidCatalogResponse()
  }
  return value
}

function requireString(value: unknown): string {
  if (typeof value !== 'string') return invalidCatalogResponse()
  return value
}

function requireBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') return invalidCatalogResponse()
  return value
}

function requireNonNegativeNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return invalidCatalogResponse()
  }
  return value
}

function requireNonNegativeInteger(value: unknown): number {
  const number = requireNonNegativeNumber(value)
  if (!Number.isSafeInteger(number)) return invalidCatalogResponse()
  return number
}

function requireNullableString(value: unknown): string | null {
  if (value === null) return null
  return requireString(value)
}

function requireNullableNonNegativeNumber(value: unknown): number | null {
  if (value === null) return null
  return requireNonNegativeNumber(value)
}

function requireArray<T>(value: unknown, parse: (item: unknown) => T): readonly T[] {
  if (!Array.isArray(value)) return invalidCatalogResponse()
  return value.map(parse)
}

function optionalNonNegativeNumber(value: unknown): number | undefined {
  if (value === undefined) return undefined
  return requireNonNegativeNumber(value)
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined
  return requireString(value)
}

function isPriceDisplayUnit(value: string): value is PriceDisplayUnit {
  return (PRICE_DISPLAY_UNITS as readonly string[]).includes(value)
}

function optionalPriceUnit(value: unknown): PriceDisplayUnit | null {
  if (value === null) return null
  const unit = requireString(value)
  if (!isPriceDisplayUnit(unit)) return invalidCatalogResponse()
  return unit
}

function parseMiniImage(value: unknown): MiniImage {
  const record = requireRecord(value)
  const width = optionalNonNegativeNumber(record.width)
  const height = optionalNonNegativeNumber(record.height)
  const blurDataURL = optionalString(record.blurDataURL)
  return {
    src: requireString(record.src),
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
    alt: requireString(record.alt),
    ...(blurDataURL === undefined ? {} : { blurDataURL }),
  }
}

function parseMiniPrice(value: unknown): MiniPrice {
  const record = requireRecord(value)
  const currency = requireString(record.currency)
  const businessType = requireString(record.businessType)
  const period = requireString(record.period)
  const basis = requireString(record.basis)
  const displayUnit = optionalPriceUnit(record.displayUnit)

  if (
    currency !== 'CNY'
    || (businessType !== 'lease' && businessType !== 'sale')
    || (period !== 'day' && period !== 'month' && period !== 'year' && period !== 'one-time')
    || (basis !== 'sqm' && basis !== 'seat' && basis !== 'total')
    || displayUnit === null
  ) {
    return invalidCatalogResponse()
  }

  return {
    amount: requireNonNegativeNumber(record.amount),
    currency,
    businessType,
    period,
    basis,
    displayUnit,
    text: requireString(record.text),
    monthlyEstimate: requireNullableNonNegativeNumber(record.monthlyEstimate),
  }
}

function parseMiniListingCard(value: unknown): MiniListingCard {
  const record = requireRecord(value)
  const listingType = requireRecord(record.listingType)
  const buildingValue = record.building
  const building = buildingValue === null
    ? null
    : (() => {
        const buildingRecord = requireRecord(buildingValue)
        return {
          slug: requireString(buildingRecord.slug),
          name: requireString(buildingRecord.name),
          address: requireString(buildingRecord.address),
          district: requireNullableString(buildingRecord.district),
        }
      })()
  const coverImage = record.coverImage === null ? null : parseMiniImage(record.coverImage)
  const price = record.price === null ? null : parseMiniPrice(record.price)

  return {
    id: requireString(record.id),
    slug: requireString(record.slug),
    title: requireString(record.title),
    citySlug: requireString(record.citySlug),
    cityName: requireString(record.cityName),
    price,
    area: requireNullableNonNegativeNumber(record.area),
    seats: requireNullableNonNegativeNumber(record.seats),
    listingType: {
      value: requireString(listingType.value),
      label: requireString(listingType.label),
    },
    availableFrom: requireNullableString(record.availableFrom),
    building,
    coverImage,
    highlights: requireArray(record.highlights, requireString),
  }
}

function parseMiniQuickFilter(value: unknown): MiniQuickFilter {
  const record = requireRecord(value)
  const id = requireString(record.id)
  if (id !== 'district' && id !== 'listingType' && id !== 'priceUnit') {
    return invalidCatalogResponse()
  }

  return {
    id,
    label: requireString(record.label),
    options: requireArray(record.options, (option) => {
      const optionRecord = requireRecord(option)
      return {
        value: requireString(optionRecord.value),
        label: requireString(optionRecord.label),
        count: requireNonNegativeInteger(optionRecord.count),
      }
    }),
  }
}

function parsePagination(value: unknown): MiniListingsData['pagination'] {
  const record = requireRecord(value)
  if (record.pageSize !== 24) return invalidCatalogResponse()
  return {
    page: requireNonNegativeInteger(record.page),
    pageSize: 24,
    totalDocs: requireNonNegativeInteger(record.totalDocs),
    totalPages: requireNonNegativeInteger(record.totalPages),
    hasNextPage: requireBoolean(record.hasNextPage),
    hasPrevPage: requireBoolean(record.hasPrevPage),
  }
}

export function parseMiniHomeData(value: unknown): MiniHomeData {
  const record = requireRecord(value)
  const stats = requireRecord(record.stats)
  return {
    featuredListings: requireArray(record.featuredListings, parseMiniListingCard),
    quickFilters: requireArray(record.quickFilters, parseMiniQuickFilter),
    stats: {
      listings: requireNonNegativeInteger(stats.listings),
      buildings: requireNonNegativeInteger(stats.buildings),
      businessAreas: requireNonNegativeInteger(stats.businessAreas),
    },
  }
}

export function parseMiniListingsData(value: unknown): MiniListingsData {
  const record = requireRecord(value)
  const items = requireArray(record.items, parseMiniListingCard)
  const currentPriceUnit = optionalPriceUnit(record.currentPriceUnit)

  if (
    currentPriceUnit !== null
    && items.some((item) => item.price !== null && item.price.displayUnit !== currentPriceUnit)
  ) {
    return invalidCatalogResponse()
  }

  return {
    items,
    pagination: parsePagination(record.pagination),
    canonicalQuery: requireString(record.canonicalQuery),
    currentPriceUnit,
    filters: requireArray(record.filters, parseMiniQuickFilter),
  }
}
