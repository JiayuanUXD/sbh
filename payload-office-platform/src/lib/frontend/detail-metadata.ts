import type { Metadata } from 'next'
import type {
  ArticleDetailViewModel,
  BuildingDetailViewModel,
  BuildingSupplyPriceRange,
  BuildingSupplySnapshot,
  ListingDetailViewModel,
  PriceViewModel,
} from '@/domain/public-catalog'
import { formatArea, priceUnitLabel } from '@/lib/frontend/format'
import { normalizePublicMediaUrl } from '@/domain/public-catalog'
import { isPublicCitySlug } from '@/lib/frontend/city-routes'

type BreadcrumbJsonLd = Readonly<{
  '@type': 'BreadcrumbList'
  itemListElement: readonly Readonly<{
    '@type': 'ListItem'
    position: number
    name: string
    item: string
  }>[]
}>

/**
 * 价格一律放进 `priceSpecification`，不写 Offer 顶层 `price`：
 * 房源价格大多是「元/㎡/天」这类单价，顶层 `price: 4.25` 会被解读成总价 4.25 元。
 * `unitText` 把计价单位带出去，消费方才能区分单价与总价。
 */
type OfferJsonLd = Readonly<{
  '@type': 'Offer'
  priceCurrency: 'CNY'
  priceSpecification: Readonly<{
    '@type': 'UnitPriceSpecification'
    price: number
    priceCurrency: 'CNY'
    unitText?: string
  }>
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

type PostalAddressJsonLd = Readonly<{
  '@type': 'PostalAddress'
  addressLocality: string
  streetAddress?: string
}>

export type ListingJsonLd = Readonly<{
  '@context': 'https://schema.org'
  '@type': 'Product'
  name: string
  url: string
  description: string
  image?: string
  brand?: Readonly<{ '@type': 'Place'; name: string; address: PostalAddressJsonLd }>
  offers?: OfferJsonLd
  breadcrumb: BreadcrumbJsonLd
}>

export type BuildingJsonLd = Readonly<{
  '@context': 'https://schema.org'
  '@type': 'Place'
  name: string
  url: string
  address: PostalAddressJsonLd
  description?: string
  image?: string
  offers?: readonly AggregateOfferJsonLd[]
  breadcrumb: BreadcrumbJsonLd
}>

const LISTING_TYPE_LABEL: Record<ListingDetailViewModel['listingType'], string> = {
  'traditional-office': '传统办公',
  coworking: '共享办公',
  'full-floor': '整层办公',
  'serviced-office': '独栋办公',
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

/**
 * JSON-LD 的 `image` 必须是绝对 URL（Google 结构化数据要求），而公开媒体常是站内相对路径
 * （`/api/media/file/...`）。OG 图走 metadataBase 自动补全，JSON-LD 不会，所以在这里补。
 */
export function toAbsoluteMediaUrl(origin: string, src: string | undefined): string | undefined {
  if (!src) return undefined
  if (/^https?:\/\//i.test(src)) return src
  if (src.startsWith('/') && !src.startsWith('//')) return canonicalUrl(origin, src)
  return undefined
}

type DetailRouteOptions = Readonly<{ citySlug?: string }>

function routePrefix(dtoCitySlug: string, options?: DetailRouteOptions): string {
  if (!options?.citySlug) return ''
  if (options.citySlug !== dtoCitySlug || !isPublicCitySlug(options.citySlug)) {
    throw new Error('detail metadata requires a matching public city slug')
  }
  return `/${options.citySlug}`
}

function listingPath(listing: ListingDetailViewModel, options?: DetailRouteOptions): string {
  return `${routePrefix(listing.citySlug, options)}/listings/${encodeURIComponent(listing.slug)}`
}

function buildingPath(building: BuildingDetailViewModel, options?: DetailRouteOptions): string {
  return `${routePrefix(building.citySlug, options)}/buildings/${encodeURIComponent(building.slug)}`
}

function breadcrumbs(
  origin: string,
  terminal: Readonly<{ name: string; path: string }>,
  building?: Readonly<{ name: string; slug: string }>,
  cityPrefix = '',
  middle?: ReadonlyArray<Readonly<{ name: string; path: string }>>,
): BreadcrumbJsonLd {
  const values: Array<Readonly<{ name: string; path: string }>> = [
    { name: '首页', path: cityPrefix || '/' },
    ...(middle ?? [{ name: '办公选址', path: `${cityPrefix}/listings` }]),
  ]
  if (building) values.push({ name: building.name, path: `${cityPrefix}/buildings/${encodeURIComponent(building.slug)}` })
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
export function buildListingMetadata(listing: ListingDetailViewModel, origin: string, options?: DetailRouteOptions): Metadata {
  const canonicalPath = listingPath(listing, options)
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
export function buildListingJsonLd(listing: ListingDetailViewModel, origin: string, options?: DetailRouteOptions): ListingJsonLd {
  const canonicalPath = listingPath(listing, options)
  const cityPrefix = routePrefix(listing.citySlug, options)
  const canonical = canonicalUrl(origin, canonicalPath)
  const image = toAbsoluteMediaUrl(origin, safePublicMedia(listing.coverImage?.src))
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
        address: {
          '@type': 'PostalAddress',
          addressLocality: listing.cityName,
          ...(building.address ? { streetAddress: building.address } : {}),
        },
      },
    } : {}),
    ...(price ? {
      offers: {
        '@type': 'Offer',
        priceCurrency: price.currency,
        priceSpecification: {
          '@type': 'UnitPriceSpecification',
          price: price.amount,
          priceCurrency: price.currency,
          ...(priceUnitLabel(price.displayUnit) ? { unitText: priceUnitLabel(price.displayUnit) } : {}),
        },
        url: canonical,
      },
    } : {}),
    breadcrumb: breadcrumbs(origin, { name: listing.title, path: canonicalPath }, building ?? undefined, cityPrefix),
  }
}

/** Builds canonical and sharing metadata from the public building DTO only. */
export function buildBuildingMetadata(building: BuildingDetailViewModel, origin: string, options?: DetailRouteOptions): Metadata {
  const canonicalPath = buildingPath(building, options)
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
  for (const group of snapshot.availableGroups) {
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
  options?: DetailRouteOptions,
): BuildingJsonLd {
  const canonicalPath = buildingPath(building, options)
  const cityPrefix = routePrefix(building.citySlug, options)
  const image = toAbsoluteMediaUrl(origin, safePublicMedia(building.coverImage?.src))
  const offers = aggregateOffers(supply)

  return {
    '@context': 'https://schema.org',
    '@type': 'Place',
    name: building.name,
    url: canonicalUrl(origin, canonicalPath),
    address: {
      '@type': 'PostalAddress',
      addressLocality: building.cityName,
      ...(building.address ? { streetAddress: building.address } : {}),
    },
    ...(building.summary ? { description: building.summary } : {}),
    ...(image ? { image } : {}),
    ...(offers.length > 0 ? { offers } : {}),
    breadcrumb: breadcrumbs(origin, { name: building.name, path: canonicalPath }, undefined, cityPrefix),
  }
}

const MODIFIED_MIN_GAP_MS = 60 * 60 * 1000

type OrganizationJsonLd = Readonly<{ '@type': 'Organization'; name: string; url: string }>

export type ArticleJsonLd = Readonly<{
  '@context': 'https://schema.org'
  '@type': 'Article'
  headline: string
  url: string
  mainEntityOfPage: Readonly<{ '@type': 'WebPage'; '@id': string }>
  description?: string
  datePublished?: string
  dateModified?: string
  image?: string
  author: OrganizationJsonLd
  publisher: OrganizationJsonLd
  breadcrumb: BreadcrumbJsonLd
}>

/**
 * 资讯 Article JSON-LD。
 *
 * - `author` / `publisher` 都是站点主体（Organization），不虚构个人作者；后台将来加了署名字段再换。
 * - `dateModified` 只在比发布时间晚一小时以上时才输出，避免把「刚导入」伪装成「持续更新」。
 * - `image` 补成绝对 URL（相对路径在 Google 富媒体结果测试里是无效值）。
 */
export function buildArticleJsonLd(
  article: ArticleDetailViewModel,
  origin: string,
  siteName: string,
): ArticleJsonLd {
  const path = `/news/${encodeURIComponent(article.slug)}`
  const url = canonicalUrl(origin, path)
  const image = toAbsoluteMediaUrl(origin, safePublicMedia(article.coverImage?.src))
  const publisher: OrganizationJsonLd = { '@type': 'Organization', name: siteName, url: canonicalUrl(origin, '/') }
  const published = article.publishedAt ? Date.parse(article.publishedAt) : Number.NaN
  const modified = article.updatedAt ? Date.parse(article.updatedAt) : Number.NaN
  // 发布后一小时内的写入属于发布流程本身（保存后补字段、批量导入），不算「修改」，
  // 否则每篇新文章都会带一个几秒之后的 dateModified，等于声称它刚被更新过。
  const showModified = Number.isFinite(modified) && (!Number.isFinite(published) || modified - published > MODIFIED_MIN_GAP_MS)

  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title,
    url,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    ...(article.excerpt ? { description: article.excerpt } : {}),
    ...(article.publishedAt ? { datePublished: article.publishedAt } : {}),
    ...(showModified && article.updatedAt ? { dateModified: article.updatedAt } : {}),
    ...(image ? { image } : {}),
    author: publisher,
    publisher,
    breadcrumb: breadcrumbs(
      origin,
      { name: article.title, path },
      undefined,
      '',
      [{ name: '资讯中心', path: '/news' }],
    ),
  }
}

/** Prevent stored public fields from closing the JSON-LD script tag. */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}
