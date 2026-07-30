import type { Metadata } from 'next'
import type {
  BuildingDetailViewModel,
  BuildingSupplyPriceRange,
  BuildingSupplySnapshot,
  ListingDetailViewModel,
  PriceViewModel,
} from '@/domain/public-catalog'
import { formatArea } from '@/lib/frontend/format'
import { normalizePublicMediaUrl } from '@/domain/public-catalog'

type BreadcrumbJsonLd = Readonly<{
  '@type': 'BreadcrumbList'
  itemListElement: readonly Readonly<{
    '@type': 'ListItem'
    position: number
    name: string
    item: string
  }>[]
}>

type OfferJsonLd = Readonly<{
  '@type': 'Offer'
  priceCurrency: 'CNY'
  price: number
  url: string
}>

type AggregateOfferJsonLd = Readonly<{
  '@type': 'AggregateOffer'
  priceCurrency: 'CNY'
  lowPrice: number
  highPrice: number
  offerCount: number
  additionalProperty: readonly Readonly<{
    '@type': 'PropertyValue'
    name: 'businessType' | 'period' | 'basis'
    value: string
  }>[]
}>

export type ListingJsonLd = Readonly<{
  '@context': 'https://schema.org'
  '@type': 'Product'
  name: string
  url: string
  description: string
  image?: string
  brand?: Readonly<{ '@type': 'Place'; name: string; address?: string }>
  offers?: OfferJsonLd
  breadcrumb: BreadcrumbJsonLd
}>

export type BuildingJsonLd = Readonly<{
  '@context': 'https://schema.org'
  '@type': 'Place'
  name: string
  url: string
  address?: string
  description?: string
  image?: string
  offers?: readonly AggregateOfferJsonLd[]
  breadcrumb: BreadcrumbJsonLd
}>

const LISTING_TYPE_LABEL: Record<ListingDetailViewModel['listingType'], string> = {
  'traditional-office': '传统办公',
  'serviced-office': '服务式办公',
  coworking: '共享办公',
  'full-floor': '整层办公',
}

function validateSiteOrigin(origin: string): string {
  const url = new URL(origin)
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    !url.hostname ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== '' ||
    origin.endsWith('/')
  ) {
    throw new Error('detail metadata requires a validated HTTP(S) site origin')
  }
  return url.origin
}

function canonicalUrl(origin: string, path: string): string {
  return `${validateSiteOrigin(origin)}${path}`
}

function safePublicMedia(src: unknown): string | undefined {
  return normalizePublicMediaUrl(src) ?? undefined
}

function listingPath(listing: ListingDetailViewModel): string {
  return `/listings/${encodeURIComponent(listing.slug)}`
}

function buildingPath(building: BuildingDetailViewModel): string {
  return `/buildings/${encodeURIComponent(building.slug)}`
}

function breadcrumbs(
  origin: string,
  terminal: Readonly<{ name: string; path: string }>,
  building?: Readonly<{ name: string; slug: string }>,
): BreadcrumbJsonLd {
  const values: Array<Readonly<{ name: string; path: string }>> = [
    { name: '首页', path: '/' },
    { name: '办公选址', path: '/listings' },
  ]
  if (building) values.push({ name: building.name, path: `/buildings/${encodeURIComponent(building.slug)}` })
  values.push(terminal)

  return {
    '@type': 'BreadcrumbList',
    itemListElement: values.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: canonicalUrl(origin, item.path),
    })),
  }
}

function isTrustworthyPrice(price: PriceViewModel | null, businessType: ListingDetailViewModel['businessType']): price is PriceViewModel {
  return price !== null &&
    price.businessType === businessType &&
    price.currency === 'CNY' &&
    Number.isFinite(price.amount) &&
    price.amount > 0
}

function listingDescription(listing: ListingDetailViewModel): string {
  return [
    listing.title,
    listing.price?.text ?? '价格面议',
    formatArea(listing.area),
    LISTING_TYPE_LABEL[listing.listingType],
  ].filter(Boolean).join('，')
}

/** Builds canonical and sharing metadata from the public listing DTO only. */
export function buildListingMetadata(listing: ListingDetailViewModel, origin: string): Metadata {
  const canonicalPath = listingPath(listing)
  const description = listingDescription(listing)
  const image = safePublicMedia(listing.coverImage?.src)

  return {
    title: listing.title,
    description,
    alternates: { canonical: canonicalPath },
    openGraph: {
      title: listing.title,
      description,
      url: canonicalUrl(origin, canonicalPath),
      type: 'website',
      ...(image ? { images: [{ url: image }] } : {}),
    },
    robots: { index: true, follow: true },
  }
}

/** Builds a Product JSON-LD document without speculative availability or reviews. */
export function buildListingJsonLd(listing: ListingDetailViewModel, origin: string): ListingJsonLd {
  const canonicalPath = listingPath(listing)
  const canonical = canonicalUrl(origin, canonicalPath)
  const image = safePublicMedia(listing.coverImage?.src)
  const building = listing.building
  const price = isTrustworthyPrice(listing.price, listing.businessType) ? listing.price : null

  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: listing.title,
    url: canonical,
    description: listingDescription(listing),
    ...(image ? { image } : {}),
    ...(building ? {
      brand: {
        '@type': 'Place',
        name: building.name,
        ...(building.address ? { address: building.address } : {}),
      },
    } : {}),
    ...(price ? {
      offers: {
        '@type': 'Offer',
        priceCurrency: price.currency,
        price: price.amount,
        url: canonical,
      },
    } : {}),
    breadcrumb: breadcrumbs(origin, { name: listing.title, path: canonicalPath }, building ?? undefined),
  }
}

/** Builds canonical and sharing metadata from the public building DTO only. */
export function buildBuildingMetadata(building: BuildingDetailViewModel, origin: string): Metadata {
  const canonicalPath = buildingPath(building)
  const description = building.summary || [building.name, building.address, building.district?.name].filter(Boolean).join('，')
  const image = safePublicMedia(building.coverImage?.src)

  return {
    title: building.name,
    ...(description ? { description } : {}),
    alternates: { canonical: canonicalPath },
    openGraph: {
      title: building.name,
      ...(description ? { description } : {}),
      url: canonicalUrl(origin, canonicalPath),
      type: 'website',
      ...(image ? { images: [{ url: image }] } : {}),
    },
    robots: { index: true, follow: true },
  }
}

function isAggregateRange(range: BuildingSupplyPriceRange): boolean {
  const expectedKey = `${range.businessType}:${range.currency}:${range.period}:${range.basis}`
  return range.key === expectedKey &&
    range.currency === 'CNY' &&
    Number.isFinite(range.min) && range.min > 0 &&
    Number.isFinite(range.max) && range.max >= range.min &&
    Number.isSafeInteger(range.count) && range.count > 0
}

function aggregateOffers(snapshot: BuildingSupplySnapshot): readonly AggregateOfferJsonLd[] {
  if (snapshot.totalEffectiveListings <= 0) return []

  const byPriceKey = new Map<string, BuildingSupplyPriceRange>()
  for (const group of snapshot.groups) {
    for (const range of group.priceRanges) {
      if (!isAggregateRange(range)) continue
      const previous = byPriceKey.get(range.key)
      byPriceKey.set(range.key, previous
        ? { ...range, min: Math.min(previous.min, range.min), max: Math.max(previous.max, range.max), count: previous.count + range.count }
        : range)
    }
  }

  return [...byPriceKey.values()].map((range) => ({
    '@type': 'AggregateOffer',
    priceCurrency: range.currency,
    lowPrice: range.min,
    highPrice: range.max,
    offerCount: range.count,
    additionalProperty: [
      { '@type': 'PropertyValue', name: 'businessType', value: range.businessType },
      { '@type': 'PropertyValue', name: 'period', value: range.period },
      { '@type': 'PropertyValue', name: 'basis', value: range.basis },
    ],
  }))
}

/** Builds a Place JSON-LD document and only includes valid current supply aggregates. */
export function buildBuildingJsonLd(
  building: BuildingDetailViewModel,
  supply: BuildingSupplySnapshot,
  origin: string,
): BuildingJsonLd {
  const canonicalPath = buildingPath(building)
  const image = safePublicMedia(building.coverImage?.src)
  const offers = aggregateOffers(supply)

  return {
    '@context': 'https://schema.org',
    '@type': 'Place',
    name: building.name,
    url: canonicalUrl(origin, canonicalPath),
    ...(building.address ? { address: building.address } : {}),
    ...(building.summary ? { description: building.summary } : {}),
    ...(image ? { image } : {}),
    ...(offers.length > 0 ? { offers } : {}),
    breadcrumb: breadcrumbs(origin, { name: building.name, path: canonicalPath }),
  }
}

/** Prevent stored public fields from closing the JSON-LD script tag. */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}
