import { describe, expect, it } from 'vitest'
import type {
  ArticleDetailViewModel,
  BuildingDetailViewModel,
  BuildingSupplySnapshot,
  ListingDetailViewModel,
} from '@/domain/public-catalog'
import {
  buildArticleJsonLd,
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
    buildingForm: [],
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
          seatRange: null,
          immediateAvailabilityCount: 0,
          priceSortDegraded: false,
        },
      ],
      availableGroups: [
        {
          key: 'lease',
          totalEffectiveListings: 5,
          areaRange: null,
          seatRange: null,
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
        seatRange: null,
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

  it('Offer 价格走 priceSpecification 并带计价单位，顶层不写 price（单价不能被读成总价）', () => {
    const offers = buildListingJsonLd(makeListing(), ORIGIN).offers
    expect(offers).toMatchObject({
      '@type': 'Offer',
      priceCurrency: 'CNY',
      priceSpecification: { '@type': 'UnitPriceSpecification', price: 8.5, priceCurrency: 'CNY', unitText: '元/㎡/天' },
    })
    expect(offers).not.toHaveProperty('price')
  })

  it('JSON-LD 的 image 一律补成绝对 URL，站内相对路径不原样输出', () => {
    const relative = { src: '/api/media/file/cover.webp?prefix=media', alt: '封面' }
    const listing = buildListingJsonLd(makeListing({ coverImage: relative }), ORIGIN)
    const building = buildBuildingJsonLd(makeBuilding({ coverImage: relative }), EMPTY_SUPPLY, ORIGIN)
    expect(listing.image).toBe(`${ORIGIN}/api/media/file/cover.webp?prefix=media`)
    expect(building.image).toBe(`${ORIGIN}/api/media/file/cover.webp?prefix=media`)
    // 已是绝对 URL 的不改
    expect(buildListingJsonLd(makeListing(), ORIGIN).image).toBe('https://cdn.example.com/listing-cover.jpg')
  })
})

function makeArticle(overrides: Partial<ArticleDetailViewModel> = {}): ArticleDetailViewModel {
  return {
    id: 1,
    slug: 'rent-guide',
    title: '写字楼租金怎么算',
    category: 'guide',
    excerpt: '一篇讲清租金构成的指南。',
    coverImage: { src: '/api/media/file/a.webp?prefix=media', alt: '封面' },
    publishedAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-10T00:00:00.000Z',
    content: null,
    relatedBuildings: [],
    relatedDistricts: [],
    seo: null,
    ...overrides,
  }
}

describe('Article JSON-LD', () => {
  it('输出 author / publisher / dateModified / 绝对 image / mainEntityOfPage', () => {
    const jsonLd = buildArticleJsonLd(makeArticle(), ORIGIN, '商办租赁')
    expect(jsonLd).toMatchObject({
      '@type': 'Article',
      headline: '写字楼租金怎么算',
      url: `${ORIGIN}/news/rent-guide`,
      mainEntityOfPage: { '@type': 'WebPage', '@id': `${ORIGIN}/news/rent-guide` },
      datePublished: '2026-10-01T00:00:00.000Z',
      dateModified: '2026-10-10T00:00:00.000Z',
      image: `${ORIGIN}/api/media/file/a.webp?prefix=media`,
      author: { '@type': 'Organization', name: '商办租赁' },
      publisher: { '@type': 'Organization', name: '商办租赁', url: `${ORIGIN}/` },
    })
    expect(jsonLd.breadcrumb.itemListElement.map((item) => item.name)).toEqual(['首页', '资讯中心', '写字楼租金怎么算'])
  })

  it('dateModified 不晚于发布时间时不输出，缺字段时不虚构', () => {
    const same = buildArticleJsonLd(makeArticle({ updatedAt: '2026-10-01T00:00:00.000Z' }), ORIGIN, '商办租赁')
    expect(same).not.toHaveProperty('dateModified')
    // 发布流程里几秒后的二次写入也不算修改
    const justAfter = buildArticleJsonLd(makeArticle({ updatedAt: '2026-10-01T00:00:04.000Z' }), ORIGIN, '商办租赁')
    expect(justAfter).not.toHaveProperty('dateModified')
    const bare = buildArticleJsonLd(makeArticle({ excerpt: null, coverImage: null, publishedAt: null, updatedAt: null }), ORIGIN, '商办租赁')
    expect(bare).not.toHaveProperty('description')
    expect(bare).not.toHaveProperty('image')
    expect(bare).not.toHaveProperty('datePublished')
    expect(bare).not.toHaveProperty('dateModified')
  })
})
