import { describe, expect, it } from 'vitest'

import * as catalogContracts from '../miniprogram/services/catalog-contracts.js'
import {
  parseMiniBuildingCard,
  parseMiniBuildingDetailData,
  parseMiniBuildingsData,
  parseMiniHomeData,
  parseMiniListingDetailData,
  parseMiniListingsData,
} from '../miniprogram/services/catalog-contracts.js'

const validListing = {
  id: 'listing-1',
  slug: 'jing-an-tower-101',
  title: '静安中心 101',
  citySlug: 'shanghai',
  cityName: '上海',
  price: {
    amount: 8.5,
    currency: 'CNY',
    businessType: 'lease',
    period: 'day',
    basis: 'sqm',
    displayUnit: 'rmb-sqm-day',
    text: '8.5 元/㎡/天',
    monthlyEstimate: 25_500,
  },
  area: 100,
  seats: null,
  listingType: { value: 'traditional-office', label: '传统办公' },
  availableFrom: '2026-09-01',
  building: {
    slug: 'jing-an-tower',
    name: '静安中心',
    address: '静安区南京西路 1 号',
    district: '静安区',
  },
  coverImage: {
    src: 'https://cdn.example/listing-1.jpg',
    width: 1600,
    height: 1200,
    alt: '静安中心外观',
    blurDataURL: 'data:image/jpeg;base64,AAAA',
  },
  highlights: ['近地铁', '精装修'],
}

const validFilter = {
  id: 'district',
  label: '区域',
  options: [{ value: 'jingan', label: '静安区', count: 3 }],
}

const validBuilding = {
  id: 'building-1',
  slug: 'jing-an-center',
  name: '静安中心',
  district: '静安区',
  address: '南京西路 1 号',
  grade: 'super-grade-a',
  completedYear: 2013,
  totalFloors: 66,
  occupancyRate: null,
  activeListingCount: 3,
  priceRange: null,
  coverImage: null,
  nearestMetro: {
    station: '南京西路站',
    line: null,
    distanceMeters: null,
  },
}

const validHome = {
  featuredListings: [validListing],
  featuredBuildings: [validBuilding],
  quickFilters: [validFilter],
  stats: { listings: 3, buildings: 2, businessAreas: 1 },
  inquiryPolicy: { version: 'policy-home-v2' },
}

const validBuildings = {
  items: [validBuilding],
  inactiveItems: [{ ...validBuilding, id: 'building-2', slug: 'empty-building', activeListingCount: 0 }],
  pagination: {
    page: 1,
    pageSize: 24,
    totalDocs: 2,
    totalPages: 1,
    hasNextPage: false,
    hasPrevPage: false,
  },
  totalActiveCount: 1,
  totalInactiveCount: 1,
  districtOptions: [{ value: 'jing-an', label: '静安区', count: 2 }],
  inquiryPolicy: { version: 'policy-building-v2' },
}

const validBuildingDetail = {
  id: 'building-1',
  slug: 'jing-an-center',
  name: '静安中心',
  address: '南京西路 1 号',
  district: '静安区',
  grade: 'super-grade-a',
  completedYear: 2013,
  totalFloors: 66,
  standardFloorArea: 2_000,
  elevators: { passenger: 12, cargo: null },
  parkingSpaces: 600,
  propertyManagementCompany: '第一太平戴维斯',
  propertyFee: 38,
  gallery: [],
  activeListingCount: 3,
  groupedListings: [],
  nearestMetro: validBuilding.nearestMetro,
  comparableBuildings: [],
  inquiryPolicy: { version: 'policy-building-v2' },
}

const validListings = {
  items: [validListing],
  pagination: {
    page: 1,
    pageSize: 24,
    totalDocs: 3,
    totalPages: 1,
    hasNextPage: false,
    hasPrevPage: false,
  },
  canonicalQuery: 'district=jingan',
  currentPriceUnit: 'rmb-sqm-day',
  filters: [validFilter],
}

const validDetail = {
  listing: {
    ...validListing,
    gallery: [
      validListing.coverImage,
      {
        src: 'https://cdn.example/listing-1-interior.jpg',
        width: 1200,
        height: 900,
        alt: '办公区',
      },
    ],
    factGroups: [{
      id: 'core',
      title: '核心规格',
      facts: [
        { label: '楼层', value: '9 层', estimated: false },
        { label: '工位数', value: null, estimated: true },
      ],
    }],
    verification: {
      verifiedAt: '2026-08-20T00:00:00.000Z',
      priceVerifiedAt: '2026-08-21T00:00:00.000Z',
    },
  },
  monthlyCost: {
    currency: 'CNY',
    period: 'month',
    propertyFeeInclusion: 'excluded',
    rent: 25_500,
    propertyFee: 2_800,
    total: 28_300,
    assumptions: ['日租按 30 天折算月租'],
  },
  relatedListings: [{
    ...validListing,
    id: 'listing-2',
    slug: 'jing-an-tower-102',
    title: '静安中心 102',
  }],
  buildingInfo: validBuilding,
  inquiryPolicy: { version: '2026-08-27' },
}

describe('Mini API 目录运行时契约', () => {
  it('保留合法首页 DTO 的公开字段', () => {
    expect(parseMiniHomeData(validHome)).toEqual(validHome)
  })

  it('保留合法楼盘列表与详情 DTO 的可空事实', () => {
    expect(parseMiniBuildingsData(validBuildings)).toEqual(validBuildings)
    expect(parseMiniBuildingDetailData(validBuildingDetail, validBuildingDetail.slug)).toEqual(
      validBuildingDetail,
    )
  })

  it('楼盘详情要求严格、非空且唯一的咨询政策版本字段', () => {
    const { inquiryPolicy: _inquiryPolicy, ...missingPolicy } = validBuildingDetail

    expect(() => parseMiniBuildingDetailData(missingPolicy)).toThrow(/Mini API 目录响应无效/)
    expect(() => parseMiniBuildingDetailData({
      ...validBuildingDetail,
      inquiryPolicy: { version: '' },
    })).toThrow(/Mini API 目录响应无效/)
    expect(() => parseMiniBuildingDetailData({
      ...validBuildingDetail,
      inquiryPolicy: { version: 'policy-building-v2', extra: 'internal' },
    })).toThrow(/Mini API 目录响应无效/)
  })

  it('首页和楼盘列表仅接受严格、非空的服务端咨询政策版本', () => {
    for (const [parser, fixture] of [
      [parseMiniHomeData, validHome],
      [parseMiniBuildingsData, validBuildings],
    ] as const) {
      const { inquiryPolicy: _policy, ...missing } = fixture
      expect(() => parser(missing)).toThrow(/Mini API 目录响应无效/)
      expect(() => parser({ ...fixture, inquiryPolicy: { version: '' } })).toThrow(/Mini API 目录响应无效/)
      expect(() => parser({ ...fixture, inquiryPolicy: { version: ' policy-v2 ' } })).toThrow(/Mini API 目录响应无效/)
      expect(() => parser({ ...fixture, inquiryPolicy: { version: 'x'.repeat(129) } })).toThrow(/Mini API 目录响应无效/)
      expect(() => parser({
        ...fixture,
        inquiryPolicy: { version: fixture.inquiryPolicy.version, internal: true },
      })).toThrow(/Mini API 目录响应无效/)
    }
  })

  it('要求首页显式提供精选楼盘', () => {
    const { featuredBuildings: _featuredBuildings, ...missingFeaturedBuildings } = validHome
    expect(() => parseMiniHomeData(missingFeaturedBuildings)).toThrow(/Mini API 目录响应无效/)
  })

  it('拒绝楼盘坏枚举、非法单位、负数与非有限数', () => {
    const fixtures = [
      { ...validBuilding, grade: 'A' },
      { ...validBuilding, activeListingCount: -1 },
      { ...validBuilding, totalFloors: Number.NaN },
      { ...validBuilding, nearestMetro: { ...validBuilding.nearestMetro, distanceMeters: -1 } },
      {
        ...validBuilding,
        priceRange: {
          min: 8,
          max: 9,
          unit: '元/㎡/天',
          displayUnit: 'rmb-unknown',
          text: '8–9 元/㎡/天',
        },
      },
    ]

    for (const fixture of fixtures) {
      expect(() => parseMiniBuildingCard(fixture)).toThrow(/Mini API 目录响应无效/)
    }

    expect(() => parseMiniBuildingDetailData({
      ...validBuildingDetail,
      elevators: { passenger: Number.NaN, cargo: null },
    })).toThrow(/Mini API 目录响应无效/)
  })

  it('保留合法列表 DTO 的公开字段', () => {
    expect(parseMiniListingsData(validListings)).toEqual(validListings)
  })

  it('保留合法详情的画廊、事实、核验时间、推荐和隐私版本', () => {
    expect(parseMiniListingDetailData(validDetail, validDetail.listing.slug)).toEqual(validDetail)
  })

  it('要求房源详情显式携带完整楼盘卡或 null', () => {
    const { buildingInfo: _buildingInfo, ...missingBuildingInfo } = validDetail

    expect(() => parseMiniListingDetailData(missingBuildingInfo)).toThrow(
      /Mini API 目录响应无效/,
    )
    expect(parseMiniListingDetailData({ ...validDetail, buildingInfo: null }).buildingInfo).toBeNull()
  })

  it('穷尽映射服务端真实楼盘等级中文文案', () => {
    const formatter = Object.entries(catalogContracts)
      .find(([name]) => name === 'buildingGradeLabel')?.[1]

    expect(formatter).toBeTypeOf('function')
    if (typeof formatter !== 'function') return

    const labels: unknown[] = [
      formatter('grade-a'),
      formatter('super-grade-a'),
      formatter('creative-park'),
      formatter('serviced-office'),
    ]
    expect(labels).toEqual(['甲级', '超甲级', '创意园区', '服务式办公'])
  })

  it.each([
    { propertyFeeInclusion: 'included', total: 25_500 },
    { propertyFeeInclusion: 'excluded', total: 28_300 },
    { propertyFeeInclusion: 'confirm', total: null },
    { propertyFeeInclusion: null, total: null },
  ])('保留月度成本包含状态 $propertyFeeInclusion', (state) => {
    const detail = {
      ...validDetail,
      monthlyCost: {
        ...validDetail.monthlyCost,
        propertyFeeInclusion: state.propertyFeeInclusion,
        total: state.total,
      },
    }

    expect(parseMiniListingDetailData(detail).monthlyCost).toEqual(detail.monthlyCost)
  })

  it('只解析 API 提供的 total，不在客户端重新计算', () => {
    const detail = {
      ...validDetail,
      monthlyCost: {
        ...validDetail.monthlyCost,
        rent: 10,
        propertyFee: 5,
        total: 999,
      },
    }

    expect(parseMiniListingDetailData(detail).monthlyCost.total).toBe(999)
  })

  it('拒绝把缺少分页或价格单位不合法的列表 DTO 交给页面', () => {
    expect(() => parseMiniListingsData({ items: [], filters: [] })).toThrow()
    expect(() => parseMiniListingsData({
      ...validListings,
      currentPriceUnit: 'rmb-unknown',
    })).toThrow()
  })

  it('在当前计价单位存在时拒绝卡片携带不同价格单位', () => {
    expect(() => parseMiniListingsData({
      ...validListings,
      currentPriceUnit: 'rmb-month',
    })).toThrow(/Mini API 目录响应无效/)
  })

  it('拒绝畸形嵌套字段、负筛选计数和非固定分页大小，且异常不泄漏响应体', () => {
    const fixtures = [
      { ...validHome, featuredListings: [{ ...validListing, coverImage: { alt: '缺少图片地址' } }] },
      { ...validHome, quickFilters: [{ ...validFilter, options: [{ ...validFilter.options[0], count: -1 }] }] },
      { ...validListings, pagination: { ...validListings.pagination, pageSize: 20 } },
      { ...validListings, pagination: { ...validListings.pagination, totalDocs: -1 } },
    ]

    for (const fixture of fixtures) {
      const parser = 'featuredListings' in fixture ? parseMiniHomeData : parseMiniListingsData
      expect(() => parser(fixture)).toThrow(/Mini API 目录响应无效/)
    }

    expect(() => parseMiniListingsData({ secretResponseValue: 'must-not-leak' })).not.toThrow(/must-not-leak/)
  })

  it('拒绝详情中的非有限、负数或非数字金额', () => {
    const fixtures = [
      {
        ...validDetail,
        listing: {
          ...validDetail.listing,
          price: { ...validDetail.listing.price, amount: -1 },
        },
      },
      {
        ...validDetail,
        listing: {
          ...validDetail.listing,
          price: { ...validDetail.listing.price, monthlyEstimate: Number.POSITIVE_INFINITY },
        },
      },
      {
        ...validDetail,
        monthlyCost: { ...validDetail.monthlyCost, rent: Number.NaN },
      },
      {
        ...validDetail,
        monthlyCost: { ...validDetail.monthlyCost, propertyFee: -0.01 },
      },
      {
        ...validDetail,
        monthlyCost: { ...validDetail.monthlyCost, total: '28300' },
      },
    ]

    for (const fixture of fixtures) {
      expect(() => parseMiniListingDetailData(fixture)).toThrow(/Mini API 目录响应无效/)
    }
  })

  it('拒绝非法入驻日期或核验时间', () => {
    const fixtures = [
      {
        ...validDetail,
        listing: { ...validDetail.listing, availableFrom: '2026-02-30' },
      },
      {
        ...validDetail,
        listing: {
          ...validDetail.listing,
          verification: {
            ...validDetail.listing.verification,
            verifiedAt: 'not-a-date',
          },
        },
      },
      {
        ...validDetail,
        listing: {
          ...validDetail.listing,
          verification: {
            ...validDetail.listing.verification,
            priceVerifiedAt: '2026-08-21',
          },
        },
      },
    ]

    for (const fixture of fixtures) {
      expect(() => parseMiniListingDetailData(fixture)).toThrow(/Mini API 目录响应无效/)
    }
  })

  it('拒绝请求 slug 与响应房源不同或政策版本为空', () => {
    expect(() => parseMiniListingDetailData(validDetail, 'other-listing')).toThrow(
      /Mini API 目录响应无效/,
    )
    expect(() => parseMiniListingDetailData({
      ...validDetail,
      inquiryPolicy: { version: '' },
    })).toThrow(/Mini API 目录响应无效/)
    expect(() => parseMiniListingDetailData({
      ...validDetail,
      inquiryPolicy: { version: '   ' },
    })).toThrow(/Mini API 目录响应无效/)
  })

  it('详情解析失败不泄漏原响应', () => {
    expect(() => parseMiniListingDetailData({
      ...validDetail,
      monthlyCost: { ...validDetail.monthlyCost, total: -1 },
      secretResponseValue: 'detail-secret-must-not-leak',
    })).not.toThrow(/detail-secret-must-not-leak/)
  })
})
