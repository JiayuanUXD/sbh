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
  countLeaseListings,
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

type AvailableGroup = BuildingSupplySnapshot['availableGroups'][number]
type PriceRange = AvailableGroup['priceRanges'][number]

function availabilityGroup(key: AvailableGroup['key'], total: number, overrides: Partial<AvailableGroup> = {}): AvailableGroup {
  return {
    key,
    totalEffectiveListings: total,
    areaRange: null,
    seatRange: null,
    immediateAvailabilityCount: 0,
    priceRanges: [],
    ...overrides,
  }
}

function supplyOf(...availableGroups: AvailableGroup[]): BuildingSupplySnapshot {
  return {
    ...EMPTY_SUPPLY,
    totalEffectiveListings: availableGroups.reduce((sum, group) => sum + group.totalEffectiveListings, 0),
    availableGroups,
  }
}

const leaseSupply = (count: number, overrides: Partial<AvailableGroup> = {}) =>
  supplyOf(availabilityGroup('lease', count, overrides))

/** 元/㎡/天：楼盘里唯一可以跨房源比较的租金口径。 */
const dayPrice = (min: number, max: number, count = 1): PriceRange => ({
  key: 'lease:CNY:day:sqm',
  businessType: 'lease', currency: 'CNY', period: 'day', basis: 'sqm',
  displayUnit: 'rmb-sqm-day', min, max, count,
})

/** 元/月（总价）：和单价不能混着写成一个区间。 */
const monthPrice = (min: number, max: number, count = 1): PriceRange => ({
  key: 'lease:CNY:month:total',
  businessType: 'lease', currency: 'CNY', period: 'month', basis: 'total',
  displayUnit: 'rmb-month', min, max, count,
})

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

describe('详情页 <title> 模板（带「出租 / 出售」「租金」等搜索意图词）', () => {
  // 页面 <title> 末尾由 layout 的 template 追加「 · 商办租赁」，这里只断言页面自己的那一段。
  it('房源：运营标题 + 业务类型词 + 「城市区县」，楼盘名已在标题里就不重复', () => {
    const metadata = buildListingMetadata(makeListing(), ORIGIN)
    expect(metadata.title).toBe('静安中心 101 室 办公室出租 · 上海静安区')
  })

  it('房源：运营标题没带楼盘名时把楼盘名补在最前面', () => {
    const metadata = buildListingMetadata(makeListing({ title: '精装修 101 室' }), ORIGIN)
    expect(metadata.title).toBe('静安中心 精装修 101 室 办公室出租 · 上海静安区')
  })

  it('房源：运营标题已带「出租」就不再追加业务类型词', () => {
    const metadata = buildListingMetadata(makeListing({ title: '静安中心 101 室出租' }), ORIGIN)
    expect(metadata.title).toBe('静安中心 101 室出租 · 上海静安区')
  })

  it('房源：出售房源写「出售」，不能被标成出租', () => {
    const metadata = buildListingMetadata(makeListing({ businessType: 'sale' }), ORIGIN)
    expect(metadata.title).toBe('静安中心 101 室 办公室出售 · 上海静安区')
  })

  it.each([
    ['traditional-office', '办公室出租'],
    ['coworking', '共享办公出租'],
    ['full-floor', '整层办公室出租'],
    ['serviced-office', '独栋办公出租'],
  ] as const)('房源：%s 类型用「%s」', (listingType, phrase) => {
    const metadata = buildListingMetadata(makeListing({ listingType }), ORIGIN)
    expect(metadata.title).toBe(`静安中心 101 室 ${phrase} · 上海静安区`)
  })

  it('房源：没有楼盘或区县时只带城市；城市名去掉「市」后缀', () => {
    expect(buildListingMetadata(makeListing({ building: null }), ORIGIN).title)
      .toBe('静安中心 101 室 办公室出租 · 上海')

    const noDistrict = makeListing({
      building: { ...makeListing().building!, district: undefined },
    })
    expect(buildListingMetadata(noDistrict, ORIGIN).title).toBe('静安中心 101 室 办公室出租 · 上海')

    const hangzhou = makeListing({ citySlug: 'hangzhou', cityName: '杭州' })
    expect(buildListingMetadata(hangzhou, ORIGIN).title).toBe('静安中心 101 室 办公室出租 · 杭州静安区')
  })

  it('房源：只改 <title>，OG 标题与 JSON-LD name 仍是运营标题', () => {
    const listing = makeListing()
    expect(buildListingMetadata(listing, ORIGIN).openGraph?.title).toBe(listing.title)
    expect(buildListingJsonLd(listing, ORIGIN).name).toBe(listing.title)
  })

  it('楼盘：租赁房源 > 0 才写「写字楼出租」，并带「城市区县 + 租金与房源」', () => {
    const metadata = buildBuildingMetadata(makeBuilding(), ORIGIN, { supply: leaseSupply(3) })
    expect(metadata.title).toBe('静安中心写字楼出租 · 上海静安区租金与房源')
  })

  it('楼盘：没有租赁房源（或调用方没传数量）时不声称「出租」', () => {
    const empty = buildBuildingMetadata(makeBuilding(), ORIGIN, { supply: leaseSupply(0) })
    expect(empty.title).toBe('静安中心写字楼 · 上海静安区')
    const unknown = buildBuildingMetadata(makeBuilding(), ORIGIN)
    expect(unknown.title).toBe('静安中心写字楼 · 上海静安区')
  })

  it('楼盘：缺区县只带城市；与城市前缀路由选项可同时传入', () => {
    const noDistrict = makeBuilding({ district: undefined })
    expect(buildBuildingMetadata(noDistrict, ORIGIN, { supply: leaseSupply(1) }).title)
      .toBe('静安中心写字楼出租 · 上海租金与房源')

    const prefixed = buildBuildingMetadata(makeBuilding(), ORIGIN, { citySlug: 'shanghai', supply: leaseSupply(1) })
    expect(prefixed.title).toBe('静安中心写字楼出租 · 上海静安区租金与房源')
    expect(prefixed.alternates?.canonical).toBe('/shanghai/buildings/jingan-center')
  })

  it('楼盘：楼盘名本身已带「写字楼」时不重复（浏览器里核对 seed 数据时发现的）', () => {
    const building = makeBuilding({ name: '陆家嘴江景甲级写字楼' })
    expect(buildBuildingMetadata(building, ORIGIN, { supply: leaseSupply(2) }).title)
      .toBe('陆家嘴江景甲级写字楼出租 · 上海静安区租金与房源')
    expect(buildBuildingMetadata(building, ORIGIN, { supply: leaseSupply(0) }).title)
      .toBe('陆家嘴江景甲级写字楼 · 上海静安区')
  })

  it('楼盘：只改 <title>，OG 标题与 JSON-LD name 仍是楼盘名', () => {
    const building = makeBuilding()
    const metadata = buildBuildingMetadata(building, ORIGIN, { supply: leaseSupply(3) })
    expect(metadata.openGraph?.title).toBe(building.name)
    expect(buildBuildingJsonLd(building, EMPTY_SUPPLY, ORIGIN).name).toBe(building.name)
  })

  it('countLeaseListings 只数 lease 组：出售 / 共享办公不算，也不看带筛选的 groups', () => {
    const mixed = supplyOf(availabilityGroup('lease', 5), availabilityGroup('sale', 2), availabilityGroup('coworking', 1))
    expect(countLeaseListings(mixed)).toBe(5)
    // 只有出售 / 共享办公：总数 > 0，但不能据此写「写字楼出租」
    expect(countLeaseListings(supplyOf(availabilityGroup('sale', 2), availabilityGroup('coworking', 1)))).toBe(0)
    expect(countLeaseListings(EMPTY_SUPPLY)).toBe(0)
    expect(countLeaseListings(undefined)).toBe(0)
  })
})

describe('详情页 description 模板（把真实事实写进摘要，不堆关键词）', () => {
  // —— 房源 ——
  it('房源：地域 + 楼盘 + 面积 + 品类出租，再带租金与装修', () => {
    expect(buildListingMetadata(makeListing(), ORIGIN).description)
      .toBe('上海静安区静安中心 101㎡办公室出租，租金 8.5 元/㎡/天，拎包入住。')
  })

  it('房源：楼层、工位数按有无追加；没填面积就不写面积；工位数是前台「工位估算」，写「约」', () => {
    const listing = makeListing({ listingType: 'coworking', area: null, floor: '12', seats: 42 })
    expect(buildListingMetadata(listing, ORIGIN).description)
      .toBe('上海静安区静安中心共享办公出租，租金 8.5 元/㎡/天，拎包入住，12 层，约 42 个工位。')
  })

  it('房源：楼层不是数字开头（如「高区」）时原样写，不加「层」', () => {
    expect(buildListingMetadata(makeListing({ floor: '高区' }), ORIGIN).description)
      .toBe('上海静安区静安中心 101㎡办公室出租，租金 8.5 元/㎡/天，拎包入住，高区。')
    expect(buildListingMetadata(makeListing({ floor: '9-12' }), ORIGIN).description)
      .toContain('，9-12 层。')
  })

  it('房源：出售房源写「出售」与「售价」；无价格写「价格面议」', () => {
    const sale = makeListing({
      businessType: 'sale',
      price: { ...makeListing().price!, businessType: 'sale', text: '1200 万元' },
    })
    expect(buildListingMetadata(sale, ORIGIN).description)
      .toBe('上海静安区静安中心 101㎡办公室出售，售价 1200 万元，拎包入住。')

    expect(buildListingMetadata(makeListing({ price: null }), ORIGIN).description)
      .toBe('上海静安区静安中心 101㎡办公室出租，价格面议，拎包入住。')
  })

  it('房源：没有装修信息、没有楼盘时只写有的事实', () => {
    const listing = makeListing({ building: null, decorationStatus: null })
    expect(buildListingMetadata(listing, ORIGIN).description)
      .toBe('上海101㎡办公室出租，租金 8.5 元/㎡/天。')
  })

  it('房源：超过长度上限就丢掉后面优先级低的事实，前面的不被截断', () => {
    // 上限 120：头部「上海静安区 + 90 字楼盘名 + ' 101㎡办公室出租'」共 105 字，
    // 加租金 13 字 = 118 放得下，再加装修 5 字 = 123 超了，所以装修及其后的事实被丢掉。
    const longName = '某'.repeat(90)
    const base = makeListing()
    const listing = makeListing({ building: { ...base.building!, name: longName }, title: `${longName} 101 室` })
    const description = buildListingMetadata(listing, ORIGIN).description!
    expect(description).toContain(`上海静安区${longName} 101㎡办公室出租`)
    expect(description).toContain('租金 8.5 元/㎡/天')
    expect(description).not.toContain('拎包入住')
    expect(description.endsWith('。')).toBe(true)
  })

  it('房源：OG 描述与 JSON-LD 描述和页面 description 是同一句', () => {
    const listing = makeListing()
    const metadata = buildListingMetadata(listing, ORIGIN)
    expect(metadata.openGraph?.description).toBe(metadata.description)
    expect(buildListingJsonLd(listing, ORIGIN).description).toBe(metadata.description)
  })

  // —— 楼盘 ——
  it('楼盘：没有运营简介时，生成「位置 + 在租套数 + 租金区间 + 面积区间」', () => {
    const supply = leaseSupply(12, { priceRanges: [dayPrice(4.25, 8.5, 12)], areaRange: { min: 100, max: 800 } })
    const metadata = buildBuildingMetadata(makeBuilding({ summary: '' }), ORIGIN, { supply })
    expect(metadata.description)
      .toBe('静安中心位于上海静安区南京西路 100 号，现有 12 套在租办公室，租金 4.25–8.50 元/㎡/天（挂牌价），面积 100–800㎡。')
  })

  it('楼盘：区间两端相同就写单个数；多个同口径区间合并取极值', () => {
    const single = leaseSupply(2, { priceRanges: [dayPrice(4.25, 4.25, 2)], areaRange: { min: 300, max: 300 } })
    expect(buildBuildingMetadata(makeBuilding({ summary: '' }), ORIGIN, { supply: single }).description)
      .toBe('静安中心位于上海静安区南京西路 100 号，现有 2 套在租办公室，租金 4.25 元/㎡/天（挂牌价），面积 300㎡。')

    const merged = leaseSupply(5, { priceRanges: [dayPrice(7, 9, 2), dayPrice(5, 6, 3)] })
    expect(buildBuildingMetadata(makeBuilding({ summary: '' }), ORIGIN, { supply: merged }).description)
      .toContain('租金 5.00–9.00 元/㎡/天（挂牌价）')
  })

  it('楼盘：只有「元/月」这类总价口径时不写租金（不同口径不能并成一个区间）', () => {
    const supply = leaseSupply(3, { priceRanges: [monthPrice(12000, 15000, 3)], areaRange: { min: 100, max: 200 } })
    const description = buildBuildingMetadata(makeBuilding({ summary: '' }), ORIGIN, { supply }).description
    expect(description).toBe('静安中心位于上海静安区南京西路 100 号，现有 3 套在租办公室，面积 100–200㎡。')
    expect(description).not.toContain('租金')
  })

  it('楼盘：有运营简介就原样放最前面，真实事实追加在后；简介末尾的句号不重复', () => {
    const supply = leaseSupply(12, { priceRanges: [dayPrice(4.25, 8.5, 12)] })
    expect(buildBuildingMetadata(makeBuilding({ summary: '静安区甲级办公楼。' }), ORIGIN, { supply }).description)
      .toBe('静安区甲级办公楼，现有 12 套在租办公室，租金 4.25–8.50 元/㎡/天（挂牌价）。')
  })

  it('楼盘：没有租赁房源（或没传供给）时不编造——有简介原样，没简介只写位置', () => {
    expect(buildBuildingMetadata(makeBuilding(), ORIGIN, { supply: leaseSupply(0) }).description).toBe('静安区甲级办公楼')
    expect(buildBuildingMetadata(makeBuilding(), ORIGIN).description).toBe('静安区甲级办公楼')
    expect(buildBuildingMetadata(makeBuilding({ summary: '' }), ORIGIN, { supply: leaseSupply(0) }).description)
      .toBe('静安中心位于上海静安区南京西路 100 号。')
    // 只有出售房源：同样不能写「在租办公室」
    const saleOnly = supplyOf(availabilityGroup('sale', 4, { areaRange: { min: 100, max: 200 } }))
    expect(buildBuildingMetadata(makeBuilding({ summary: '' }), ORIGIN, { supply: saleOnly }).description)
      .toBe('静安中心位于上海静安区南京西路 100 号。')
  })

  it('楼盘：地址已带城市 / 区县时不重复加前缀；没有地址只写区域', () => {
    const noSummary = { summary: '' }
    expect(buildBuildingMetadata(makeBuilding({ ...noSummary, address: '上海市静安区南京西路 100 号' }), ORIGIN).description)
      .toBe('静安中心位于上海市静安区南京西路 100 号。')
    expect(buildBuildingMetadata(makeBuilding({ ...noSummary, address: '静安区南京西路 100 号' }), ORIGIN).description)
      .toBe('静安中心位于静安区南京西路 100 号。')
    expect(buildBuildingMetadata(makeBuilding({ ...noSummary, address: '' }), ORIGIN).description)
      .toBe('静安中心位于上海静安区。')
  })

  it('楼盘：OG 描述与页面 description 是同一句，JSON-LD 的 description 不动', () => {
    const supply = leaseSupply(12, { priceRanges: [dayPrice(4.25, 8.5, 12)] })
    const building = makeBuilding({ summary: '' })
    const metadata = buildBuildingMetadata(building, ORIGIN, { supply })
    expect(metadata.openGraph?.description).toBe(metadata.description)
    expect(buildBuildingJsonLd(building, supply, ORIGIN)).not.toHaveProperty('description')
  })
})

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
