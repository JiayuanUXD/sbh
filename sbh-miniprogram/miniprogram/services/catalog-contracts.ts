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

export type MiniBuildingCard = Readonly<{
  id: string
  slug: string
  name: string
  district: string | null
  address: string
  grade: 'A' | 'B' | 'C' | null
  completedYear: number | null
  totalFloors: number | null
  occupancyRate: number | null
  activeListingCount: number
  priceRange: Readonly<{
    min: number
    max: number
    unit: string
    displayUnit: PriceDisplayUnit
    text: string
  }> | null
  coverImage: MiniImage | null
  nearestMetro: Readonly<{
    line: string
    station: string
    distanceMeters: number
  }> | null
}>

export type MiniBuildingsData = Readonly<{
  items: readonly MiniBuildingCard[]
  inactiveItems: readonly MiniBuildingCard[]
  pagination: Readonly<{
    page: number
    pageSize: number
    totalDocs: number
    totalPages: number
    hasNextPage: boolean
    hasPrevPage: boolean
  }>
  totalActiveCount: number
  totalInactiveCount: number
}>

export type MiniBuildingDetailData = Readonly<{
  id: string
  slug: string
  name: string
  address: string
  district: string | null
  grade: 'A' | 'B' | 'C' | null
  completedYear: number | null
  totalFloors: number | null
  standardFloorArea: number | null
  elevators: Readonly<{
    passenger: number
    cargo: number
  }> | null
  parkingSpaces: number | null
  propertyManagementCompany: string | null
  propertyFee: number | null
  gallery: readonly MiniImage[]
  activeListingCount: number
  groupedListings: readonly Readonly<{
    areaRange: string
    count: number
    items: readonly MiniListingCard[]
  }>[]
  nearestMetro: Readonly<{
    line: string
    station: string
    distanceMeters: number
  }> | null
  comparableBuildings: readonly MiniBuildingCard[]
}>

export type MiniHomeData = Readonly<{
  featuredListings: readonly MiniListingCard[]
  featuredBuildings?: readonly MiniBuildingCard[]
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

export type MiniFactGroup = Readonly<{
  id: string
  title: string
  facts: readonly Readonly<{
    label: string
    value: string | null
    estimated: boolean
  }>[]
}>

export type MiniListingDetailData = Readonly<{
  listing: MiniListingCard & Readonly<{
    gallery: readonly MiniImage[]
    factGroups: readonly MiniFactGroup[]
    verification: Readonly<{
      verifiedAt: string | null
      priceVerifiedAt: string | null
    }>
  }>
  monthlyCost: Readonly<{
    currency: 'CNY'
    period: 'month'
    propertyFeeInclusion: 'included' | 'excluded' | 'confirm' | null
    rent: number | null
    propertyFee: number | null
    total: number | null
    assumptions: readonly string[]
  }>
  relatedListings: readonly MiniListingCard[]
  inquiryPolicy: Readonly<{ version: string }>
}>

const INVALID_CATALOG_RESPONSE = 'Mini API 目录响应无效'
const SAFE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

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

function requireNonEmptyString(value: unknown): string {
  const string = requireString(value)
  if (!string.trim()) return invalidCatalogResponse()
  return string
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

function requireSafeSlug(value: unknown): string {
  const slug = requireString(value)
  if (!SAFE_SLUG_PATTERN.test(slug)) return invalidCatalogResponse()
  return slug
}

function requireNullableDateOnly(value: unknown): string | null {
  if (value === null) return null
  const date = requireString(value)
  if (!DATE_ONLY_PATTERN.test(date)) return invalidCatalogResponse()
  const parsed = new Date(`${date}T00:00:00.000Z`)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    return invalidCatalogResponse()
  }
  return date
}

function requireNullableIsoTimestamp(value: unknown): string | null {
  if (value === null) return null
  const timestamp = requireString(value)
  const parsed = new Date(timestamp)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== timestamp) {
    return invalidCatalogResponse()
  }
  return timestamp
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

function parseMiniFactGroup(value: unknown): MiniFactGroup {
  const record = requireRecord(value)
  return {
    id: requireString(record.id),
    title: requireString(record.title),
    facts: requireArray(record.facts, (fact) => {
      const factRecord = requireRecord(fact)
      return {
        label: requireString(factRecord.label),
        value: requireNullableString(factRecord.value),
        estimated: requireBoolean(factRecord.estimated),
      }
    }),
  }
}

function parsePropertyFeeInclusion(
  value: unknown,
): MiniListingDetailData['monthlyCost']['propertyFeeInclusion'] {
  if (value === null) return null
  const inclusion = requireString(value)
  if (inclusion !== 'included' && inclusion !== 'excluded' && inclusion !== 'confirm') {
    return invalidCatalogResponse()
  }
  return inclusion
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

export function parseMiniListingDetailData(
  value: unknown,
  expectedSlug?: string,
): MiniListingDetailData {
  const record = requireRecord(value)
  const listingRecord = requireRecord(record.listing)
  const listingCard = parseMiniListingCard(listingRecord)
  const listingSlug = requireSafeSlug(listingCard.slug)
  if (expectedSlug !== undefined && listingSlug !== requireSafeSlug(expectedSlug)) {
    return invalidCatalogResponse()
  }
  requireNullableDateOnly(listingCard.availableFrom)
  if (listingCard.building) requireSafeSlug(listingCard.building.slug)

  const verificationRecord = requireRecord(listingRecord.verification)
  const monthlyCostRecord = requireRecord(record.monthlyCost)
  const currency = requireString(monthlyCostRecord.currency)
  const period = requireString(monthlyCostRecord.period)
  if (currency !== 'CNY' || period !== 'month') return invalidCatalogResponse()

  const relatedListings = requireArray(record.relatedListings, (item) => {
    const related = parseMiniListingCard(item)
    requireSafeSlug(related.slug)
    requireNullableDateOnly(related.availableFrom)
    if (related.building) requireSafeSlug(related.building.slug)
    return related
  })
  const inquiryPolicyRecord = requireRecord(record.inquiryPolicy)

  return {
    listing: {
      ...listingCard,
      slug: listingSlug,
      gallery: requireArray(listingRecord.gallery, parseMiniImage),
      factGroups: requireArray(listingRecord.factGroups, parseMiniFactGroup),
      verification: {
        verifiedAt: requireNullableIsoTimestamp(verificationRecord.verifiedAt),
        priceVerifiedAt: requireNullableIsoTimestamp(verificationRecord.priceVerifiedAt),
      },
    },
    monthlyCost: {
      currency,
      period,
      propertyFeeInclusion: parsePropertyFeeInclusion(
        monthlyCostRecord.propertyFeeInclusion,
      ),
      rent: requireNullableNonNegativeNumber(monthlyCostRecord.rent),
      propertyFee: requireNullableNonNegativeNumber(monthlyCostRecord.propertyFee),
      total: requireNullableNonNegativeNumber(monthlyCostRecord.total),
      assumptions: requireArray(monthlyCostRecord.assumptions, requireString),
    },
    relatedListings,
    inquiryPolicy: {
      version: requireNonEmptyString(inquiryPolicyRecord.version),
    },
  }
}

export function parseMiniBuildingCard(value: unknown): MiniBuildingCard {
  const record = requireRecord(value)
  const coverImage = record.coverImage === null || record.coverImage === undefined ? null : parseMiniImage(record.coverImage)
  const nearestMetro = record.nearestMetro === null || record.nearestMetro === undefined
    ? null
    : (() => {
        const m = requireRecord(record.nearestMetro)
        return {
          line: requireString(m.line),
          station: requireString(m.station),
          distanceMeters: requireNonNegativeInteger((m as any).distanceMeters ?? 0),
        }
      })()

  return {
    id: requireString(record.id),
    slug: requireSafeSlug(requireString(record.slug)),
    name: requireString(record.name),
    district: requireNullableString(record.district),
    address: requireString(record.address),
    grade: (record.grade as 'A' | 'B' | 'C') ?? null,
    completedYear: record.completedYear !== null && record.completedYear !== undefined ? requireNonNegativeInteger(record.completedYear) : null,
    totalFloors: record.totalFloors !== null && record.totalFloors !== undefined ? requireNonNegativeInteger(record.totalFloors) : null,
    occupancyRate: record.occupancyRate !== null && record.occupancyRate !== undefined ? requireNonNegativeInteger(record.occupancyRate) : null,
    activeListingCount: requireNonNegativeInteger(record.activeListingCount ?? 0),
    priceRange: record.priceRange === null || record.priceRange === undefined ? null : (() => {
      const p = requireRecord(record.priceRange)
      return {
        min: requireNonNegativeNumber(p.min),
        max: requireNonNegativeNumber(p.max),
        unit: requireString(p.unit),
        displayUnit: requireString(p.displayUnit) as PriceDisplayUnit,
        text: requireString(p.text),
      }
    })(),
    coverImage,
    nearestMetro,
  }
}

export function parseMiniBuildingsData(value: unknown): MiniBuildingsData {
  const record = requireRecord(value)
  const pagination = requireRecord(record.pagination)
  return {
    items: requireArray(record.items, parseMiniBuildingCard),
    inactiveItems: requireArray(record.inactiveItems ?? [], parseMiniBuildingCard),
    pagination: {
      page: requireNonNegativeInteger(pagination.page),
      pageSize: requireNonNegativeInteger(pagination.pageSize),
      totalDocs: requireNonNegativeInteger(pagination.totalDocs),
      totalPages: requireNonNegativeInteger(pagination.totalPages),
      hasNextPage: requireBoolean(pagination.hasNextPage),
      hasPrevPage: requireBoolean(pagination.hasPrevPage),
    },
    totalActiveCount: requireNonNegativeInteger(record.totalActiveCount ?? 0),
    totalInactiveCount: requireNonNegativeInteger(record.totalInactiveCount ?? 0),
  }
}

export function parseMiniBuildingDetailData(
  value: unknown,
  expectedSlug?: string,
): MiniBuildingDetailData {
  const record = requireRecord(value)
  const slug = requireSafeSlug(requireString(record.slug))
  if (expectedSlug !== undefined && slug !== requireSafeSlug(expectedSlug)) {
    return invalidCatalogResponse()
  }

  return {
    id: requireString(record.id),
    slug,
    name: requireString(record.name),
    address: requireString(record.address),
    district: requireNullableString(record.district),
    grade: (record.grade as 'A' | 'B' | 'C') ?? null,
    completedYear: record.completedYear !== null && record.completedYear !== undefined ? requireNonNegativeInteger(record.completedYear) : null,
    totalFloors: record.totalFloors !== null && record.totalFloors !== undefined ? requireNonNegativeInteger(record.totalFloors) : null,
    standardFloorArea: record.standardFloorArea !== null && record.standardFloorArea !== undefined ? requireNonNegativeNumber(record.standardFloorArea) : null,
    elevators: record.elevators ? { passenger: Number((record.elevators as any).passenger) || 0, cargo: Number((record.elevators as any).cargo) || 0 } : null,
    parkingSpaces: record.parkingSpaces !== null && record.parkingSpaces !== undefined ? requireNonNegativeInteger(record.parkingSpaces) : null,
    propertyManagementCompany: requireNullableString(record.propertyManagementCompany),
    propertyFee: record.propertyFee !== null && record.propertyFee !== undefined ? requireNonNegativeNumber(record.propertyFee) : null,
    gallery: requireArray(record.gallery ?? [], parseMiniImage),
    activeListingCount: requireNonNegativeInteger(record.activeListingCount ?? 0),
    groupedListings: requireArray(record.groupedListings ?? [], (group) => {
      const g = requireRecord(group)
      return {
        areaRange: requireString(g.areaRange),
        count: requireNonNegativeInteger(g.count),
        items: requireArray(g.items, parseMiniListingCard),
      }
    }),
    nearestMetro: record.nearestMetro
      ? {
          line: requireString((record.nearestMetro as any).line),
          station: requireString((record.nearestMetro as any).station),
          distanceMeters: Number((record.nearestMetro as any).distanceMeters) || 0,
        }
      : null,
    comparableBuildings: requireArray(record.comparableBuildings ?? [], parseMiniBuildingCard),
  }
}

