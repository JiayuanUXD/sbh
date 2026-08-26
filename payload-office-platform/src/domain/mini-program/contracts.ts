import type { PriceDisplayUnit, PriceViewBasis, PriceViewPeriod } from '@/domain/public-catalog'

export type MiniErrorCode =
  | 'invalid_request'
  | 'city_not_found'
  | 'listing_not_found'
  | 'rate_limited'
  | 'service_unavailable'

export type MiniPrice = Readonly<{
  amount: number
  currency: 'CNY'
  businessType: 'lease' | 'sale'
  period: PriceViewPeriod
  basis: PriceViewBasis
  displayUnit: PriceDisplayUnit
  text: string
  monthlyEstimate: number | null
}>

export type MiniImage = Readonly<{
  src: string
  width?: number
  height?: number
  alt: string
  blurDataURL?: string
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
  building: Readonly<{
    slug: string
    name: string
    address: string
    district: string | null
  }> | null
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
    verification: Readonly<{ verifiedAt: string | null; priceVerifiedAt: string | null }>
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
}>

export type MiniApiSuccess<T> = Readonly<{
  ok: true
  data: T
  meta: Readonly<{ requestId: string; asOf: string; maxAgeSeconds: 300 }>
}>

export type MiniApiFailure = Readonly<{
  ok: false
  error: Readonly<{ code: MiniErrorCode; message: string; fields?: readonly string[] }>
  meta: Readonly<{ requestId: string }>
}>

export type MiniSnapshot<T> = Readonly<{ asOf: string; data: T }>

export type MiniDetailResolution =
  | Readonly<{ status: 'ok'; snapshot: MiniSnapshot<MiniListingDetailData> }>
  | Readonly<{ status: 'city-not-found' }>
  | Readonly<{ status: 'listing-not-found' }>
