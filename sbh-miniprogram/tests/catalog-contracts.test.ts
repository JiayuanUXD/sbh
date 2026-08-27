import { describe, expect, it } from 'vitest'

import {
  parseMiniHomeData,
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

const validHome = {
  featuredListings: [validListing],
  quickFilters: [validFilter],
  stats: { listings: 3, buildings: 2, businessAreas: 1 },
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

describe('Mini API 目录运行时契约', () => {
  it('保留合法首页 DTO 的公开字段', () => {
    expect(parseMiniHomeData(validHome)).toEqual(validHome)
  })

  it('保留合法列表 DTO 的公开字段', () => {
    expect(parseMiniListingsData(validListings)).toEqual(validListings)
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
})
