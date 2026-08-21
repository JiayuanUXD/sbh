import { describe, expect, it } from 'vitest'
import type {
  BuildingDetailViewModel,
  BuildingSupplySnapshot,
  ListingDetailViewModel,
} from '@/domain/public-catalog'
import {
  buildBuildingJsonLd,
  buildBuildingMetadata,
  buildListingJsonLd,
  buildListingMetadata,
  serializeJsonLd,
} from '@/lib/frontend/detail-metadata'

const ORIGIN = 'https://office.example.com'

function makeListing(overrides: Partial<ListingDetailViewModel> = {}): ListingDetailViewModel {
  return {
    id: 101,
    slug: 'jingan-center-101',
    title: '静安中心 101 室',
    citySlug: 'shanghai',
    cityName: '上海市',
    price: {
      amount: 8.5,
      currency: 'CNY',
      businessType: 'lease',
      period: 'day',
      basis: 'sqm',
      displayUnit: 'rmb-sqm-day',
      text: '8.5 元/㎡/天',
    },
    area: 101,
    floor: null,
    businessType: 'lease',
    decorationStatus: 'fully_fitted',
    listingType: 'traditional-office',
    availableFrom: null,
    isFeatured: false,
    building: {
      id: 88,
      slug: 'jingan-center',
      name: '静安中心',
      citySlug: 'shanghai',
      cityName: '上海市',
      address: '南京西路 100 号',
      district: { id: 8, slug: 'jingan', name: '静安区' },
    },
    coverImage: { src: 'https://cdn.example.com/listing-cover.jpg', alt: '办公区' },
    highlights: [],
    stableSortKey: '101',
    seats: null,
    gallery: [],
    mediaItems: [],
    factGroups: [],
    amenityGroups: [],
    verification: { verifiedAt: null, priceVerifiedAt: null },
    description: null,
    ...overrides,
  }
}

function makeBuilding(overrides: Partial<BuildingDetailViewModel> = {}): BuildingDetailViewModel {
  return {
    id: 88,
    slug: 'jingan-center',
    name: '静安中心',
    citySlug: 'shanghai',
    cityName: '上海市',
    address: '南京西路 100 号',
    district: { id: 8, slug: 'jingan', name: '静安区' },
    coverImage: { src: 'https://cdn.example.com/building-cover.jpg', alt: '楼盘外立面' },
    gallery: [],
    mediaItems: [],
    factGroups: [],
    amenityGroups: [],
    verification: { verifiedAt: null, priceVerifiedAt: null },
    amenities: [],
    summary: '静安区甲级办公楼',
    description: null,
    ...overrides,
  }
}

const EMPTY_SUPPLY: BuildingSupplySnapshot = {
  asOf: '2026-07-30T10:00:00.000Z',
  totalEffectiveListings: 0,
  resultCount: 0,
  validationErrors: [],
  groups: [],
  availableGroups: [],
}

describe('detail metadata and JSON-LD', () => {
  it('uses DTO cityName as JSON-LD address locality', () => {
    const listing = makeListing({ citySlug: 'hangzhou', cityName: '杭州市' })
    const building = makeBuilding({ citySlug: 'hangzhou', cityName: '杭州市' })

    expect(buildListingJsonLd(listing, ORIGIN).brand?.address).toMatchObject({
      addressLocality: '杭州市',
    })
    expect(buildBuildingJsonLd(building, EMPTY_SUPPLY, ORIGIN).address).toMatchObject({
      addressLocality: '杭州市',
    })
  })

  it('无可信价格时 Product 不输出 offers', () => {
    const jsonLd = buildListingJsonLd(makeListing({ price: null }), ORIGIN)

    expect(jsonLd).toMatchObject({ '@type': 'Product' })
    expect(jsonLd).not.toHaveProperty('offers')
  })

  it('楼盘 AggregateOffer 按完整价格 key 分组', () => {
    const supply: BuildingSupplySnapshot = {
      ...EMPTY_SUPPLY,
      totalEffectiveListings: 5,
      resultCount: 0,
      groups: [
        {
          key: 'lease',
          listings: [],
          priceRanges: [
            {
              key: 'lease:CNY:day:sqm',
              businessType: 'lease', currency: 'CNY', period: 'day', basis: 'sqm',
              displayUnit: 'rmb-sqm-day', min: 7, max: 9, count: 2,
            },
            {
              key: 'lease:CNY:month:total',
              businessType: 'lease', currency: 'CNY', period: 'month', basis: 'total',
              displayUnit: 'rmb-month', min: 12000, max: 15000, count: 3,
            },
          ],
          areaRange: null,
          immediateAvailabilityCount: 0,
        },
      ],
      availableGroups: [
        {
          key: 'lease',
          totalEffectiveListings: 5,
          areaRange: null,
          immediateAvailabilityCount: 0,
          priceRanges: [
            {
              key: 'lease:CNY:day:sqm',
              businessType: 'lease', currency: 'CNY', period: 'day', basis: 'sqm',
              displayUnit: 'rmb-sqm-day', min: 7, max: 9, count: 2,
            },
            {
              key: 'lease:CNY:month:total',
              businessType: 'lease', currency: 'CNY', period: 'month', basis: 'total',
              displayUnit: 'rmb-month', min: 12000, max: 15000, count: 3,
            },
          ],
        },
      ],
    }

    const jsonLd = buildBuildingJsonLd(makeBuilding(), supply, ORIGIN)

    expect(jsonLd.offers).toHaveLength(2)
    expect(jsonLd.offers).toEqual(expect.arrayContaining([
      expect.objectContaining({ lowPrice: 7, highPrice: 9, offerCount: 2 }),
      expect.objectContaining({ lowPrice: 12000, highPrice: 15000, offerCount: 3 }),
    ]))
  })

  it('楼盘 AggregateOffer 只使用未筛选统一公开聚合，不随结果行变化', () => {
    const availableGroups: BuildingSupplySnapshot['availableGroups'] = [
      {
        key: 'lease',
        totalEffectiveListings: 2,
        areaRange: { min: 80, max: 180 },
        immediateAvailabilityCount: 1,
        priceRanges: [{
          key: 'lease:CNY:day:sqm',
          businessType: 'lease',
          currency: 'CNY',
          period: 'day',
          basis: 'sqm',
          displayUnit: 'rmb-sqm-day',
          min: 7,
          max: 9,
          count: 2,
        }],
      },
    ]
    const unfiltered: BuildingSupplySnapshot = {
      ...EMPTY_SUPPLY,
      totalEffectiveListings: 2,
      resultCount: 2,
      groups: [],
      availableGroups,
    }
    const filtered: BuildingSupplySnapshot = {
      ...unfiltered,
      resultCount: 0,
      groups: [],
    }

    expect(buildBuildingJsonLd(makeBuilding(), filtered, ORIGIN).offers)
      .toEqual(buildBuildingJsonLd(makeBuilding(), unfiltered, ORIGIN).offers)
  })

  it('metadata 使用 validated origin、canonical、公开封面与 BreadcrumbList', () => {
    const listing = makeListing()
    const metadata = buildListingMetadata(listing, ORIGIN)
    const jsonLd = buildListingJsonLd(listing, ORIGIN)

    expect(metadata.alternates?.canonical).toBe('/listings/jingan-center-101')
    expect(metadata.openGraph?.url).toBe(`${ORIGIN}/listings/jingan-center-101`)
    expect(metadata.openGraph?.images).toEqual([{ url: 'https://cdn.example.com/listing-cover.jpg' }])
    expect(jsonLd.breadcrumb).toMatchObject({ '@type': 'BreadcrumbList' })
    expect(jsonLd).not.toHaveProperty('aggregateRating')
    expect(jsonLd).not.toHaveProperty('availability')
    expect(jsonLd).not.toHaveProperty('review')

    const buildingMetadata = buildBuildingMetadata(makeBuilding(), ORIGIN)
    expect(buildingMetadata.alternates?.canonical).toBe('/buildings/jingan-center')
  })

  it('scopes prefixed-city canonical, OpenGraph and JSON-LD URLs to the supplied city', () => {
    const options = { citySlug: 'shanghai' }
    const listing = makeListing()
    const building = makeBuilding()
    const listingMetadata = buildListingMetadata(listing, ORIGIN, options)
    const listingJsonLd = buildListingJsonLd(listing, ORIGIN, options)
    const buildingMetadata = buildBuildingMetadata(building, ORIGIN, options)
    const buildingJsonLd = buildBuildingJsonLd(building, EMPTY_SUPPLY, ORIGIN, options)
    expect(listingMetadata.alternates?.canonical).toBe('/shanghai/listings/jingan-center-101')
    expect(listingMetadata.openGraph?.url).toBe(`${ORIGIN}/shanghai/listings/jingan-center-101`)
    expect(listingJsonLd.url).toBe(`${ORIGIN}/shanghai/listings/jingan-center-101`)
    expect(listingJsonLd.breadcrumb.itemListElement[0]?.item).toBe(`${ORIGIN}/shanghai`)
    expect(listingJsonLd.breadcrumb.itemListElement.at(-2)?.item).toBe(`${ORIGIN}/shanghai/buildings/jingan-center`)
    expect(buildingMetadata.alternates?.canonical).toBe('/shanghai/buildings/jingan-center')
    expect(buildingJsonLd.url).toBe(`${ORIGIN}/shanghai/buildings/jingan-center`)
  })

  it('rejects reserved or DTO-mismatched city metadata prefixes', () => {
    const listing = makeListing()
    const building = makeBuilding()
    expect(() => buildListingMetadata(listing, ORIGIN, { citySlug: 'news' })).toThrow('matching public city slug')
    expect(() => buildListingJsonLd(listing, ORIGIN, { citySlug: 'hangzhou' })).toThrow('matching public city slug')
    expect(() => buildBuildingMetadata(building, ORIGIN, { citySlug: '..' })).toThrow('matching public city slug')
    expect(() => buildBuildingJsonLd(building, EMPTY_SUPPLY, ORIGIN, { citySlug: 'hangzhou' })).toThrow('matching public city slug')
  })

  it('空供给楼盘不输出 offers，且 JSON-LD 序列化转义注入字符串', () => {
    const building = makeBuilding({ name: '</script><script>window.pwned=1</script>' })
    const jsonLd = buildBuildingJsonLd(building, EMPTY_SUPPLY, ORIGIN)
    const serialized = serializeJsonLd(jsonLd)

    expect(jsonLd).not.toHaveProperty('offers')
    expect(serialized).not.toContain('</script>')
    expect(serialized).toContain('\\u003c/script>')
  })

  it('将每个 CMS slug 编码为单一路径段，防止 canonical/JSON-LD 注入 query 或 fragment', () => {
    const unsafeBuilding = makeBuilding({ slug: '静安?group=lease#supply/100%' })
    const unsafeListing = makeListing({
      slug: '101?phone=13800001111#overview/100%',
      building: {
        id: unsafeBuilding.id,
        slug: unsafeBuilding.slug,
        name: unsafeBuilding.name,
        citySlug: unsafeBuilding.citySlug,
        cityName: unsafeBuilding.cityName,
        address: unsafeBuilding.address,
        ...(unsafeBuilding.district ? { district: unsafeBuilding.district } : {}),
        ...(unsafeBuilding.coverImage ? { coverImage: unsafeBuilding.coverImage } : {}),
        ...(unsafeBuilding.summary ? { summary: unsafeBuilding.summary } : {}),
      },
    })
    const listingMetadata = buildListingMetadata(unsafeListing, ORIGIN)
    const listingJsonLd = buildListingJsonLd(unsafeListing, ORIGIN)
    const buildingMetadata = buildBuildingMetadata(unsafeBuilding, ORIGIN)
    const buildingJsonLd = buildBuildingJsonLd(unsafeBuilding, EMPTY_SUPPLY, ORIGIN)
    const encodedListingSlug = encodeURIComponent(unsafeListing.slug)
    const encodedBuildingSlug = encodeURIComponent(unsafeBuilding.slug)
    const listingPath = `/listings/${encodedListingSlug}`
    const buildingPath = `/buildings/${encodedBuildingSlug}`

    expect(listingMetadata.alternates?.canonical).toBe(listingPath)
    expect(listingMetadata.openGraph?.url).toBe(`${ORIGIN}${listingPath}`)
    expect(listingJsonLd.url).toBe(`${ORIGIN}${listingPath}`)
    expect(listingJsonLd.breadcrumb.itemListElement.at(-2)?.item).toBe(`${ORIGIN}${buildingPath}`)
    expect(listingJsonLd.breadcrumb.itemListElement.at(-1)?.item).toBe(`${ORIGIN}${listingPath}`)
    expect(buildingMetadata.alternates?.canonical).toBe(buildingPath)
    expect(buildingJsonLd.url).toBe(`${ORIGIN}${buildingPath}`)
    expect(buildingJsonLd.breadcrumb.itemListElement.at(-1)?.item).toBe(`${ORIGIN}${buildingPath}`)
    expect(listingJsonLd.url).not.toContain('?phone=')
    expect(listingJsonLd.url).not.toContain('#overview')
  })
})
