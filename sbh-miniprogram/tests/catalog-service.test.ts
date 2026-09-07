import { describe, expect, it } from 'vitest'

import {
  parseMiniHomeData,
  parseMiniListingDetailData,
  parseMiniListingsData,
} from '../miniprogram/services/catalog-contracts.js'
import { createCatalogService, type MiniRequestClient } from '../miniprogram/services/catalog.js'
import type { RequestOptions } from '../miniprogram/services/request.js'

function createPendingRequestClient() {
  const calls: Array<Readonly<{ path: string; parse: unknown }>> = []
  const request: MiniRequestClient = <T>(options: RequestOptions<T>): Promise<T> => {
    calls.push({ path: options.path, parse: options.parse })
    return new Promise<T>(() => {})
  }
  return { calls, request }
}

const validDetail = {
  listing: {
    id: 'listing-1',
    slug: 'jing-an-tower-101',
    title: '静安中心 101',
    citySlug: 'shanghai',
    cityName: '上海',
    price: null,
    area: null,
    seats: null,
    listingType: { value: 'traditional-office', label: '传统办公' },
    availableFrom: null,
    building: null,
    coverImage: null,
    highlights: [],
    gallery: [],
    factGroups: [],
    verification: { verifiedAt: null, priceVerifiedAt: null },
  },
  monthlyCost: {
    currency: 'CNY',
    period: 'month',
    propertyFeeInclusion: null,
    rent: null,
    propertyFee: null,
    total: null,
    assumptions: [],
  },
  relatedListings: [],
  buildingInfo: null,
  inquiryPolicy: { version: '2026-08-27' },
}

describe('Mini API 目录服务', () => {
  it('首页请求对城市参数进行路径编码并交给首页契约解析', async () => {
    const { calls, request } = createPendingRequestClient()
    const catalog = createCatalogService(request)

    void catalog.getHome('shanghai & east')

    expect(calls).toEqual([{
      path: '/api/mini/v1/home?city=shanghai%20%26%20east',
      parse: parseMiniHomeData,
    }])
  })

  it('列表请求使用规范化查询且不允许覆盖城市', async () => {
    const { calls, request } = createPendingRequestClient()
    const catalog = createCatalogService(request)

    void catalog.getListings('district=jingan&page=2')

    expect(calls).toEqual([expect.objectContaining({
      path: '/api/mini/v1/listings?city=shanghai&district=jingan&page=2',
      parse: parseMiniListingsData,
    })])
  })

  it('列表查询序列化器移除城市覆盖并编码用户值', async () => {
    const { calls, request } = createPendingRequestClient()
    const catalog = createCatalogService(request)

    void catalog.getListings('city=beijing&district=%E9%9D%99%E5%AE%89&q=%23office')

    expect(calls).toEqual([expect.objectContaining({
      path: '/api/mini/v1/listings?city=shanghai&district=%E9%9D%99%E5%AE%89&q=%23office',
      parse: parseMiniListingsData,
    })])
  })

  it('列表请求无计价单位时移除价格范围并降级价格排序', () => {
    const { calls, request } = createPendingRequestClient()
    const catalog = createCatalogService(request)

    void catalog.getListings('district=jingan&priceMin=100&priceMax=200&sort=price-desc')

    expect(calls).toEqual([expect.objectContaining({
      path: '/api/mini/v1/listings?city=shanghai&district=jingan',
      parse: parseMiniListingsData,
    })])
  })

  it('详情请求固定上海并用请求 slug 约束响应解析', () => {
    const { calls, request } = createPendingRequestClient()
    const catalog = createCatalogService(request)

    void catalog.getListingDetail('jing-an-tower-101')

    expect(calls).toHaveLength(1)
    expect(calls[0]?.path).toBe(
      '/api/mini/v1/listings/jing-an-tower-101?city=shanghai',
    )
    expect(typeof calls[0]?.parse).toBe('function')
    const parse = calls[0]?.parse as (value: unknown) => unknown
    expect(parse(validDetail)).toEqual(parseMiniListingDetailData(validDetail))
    expect(() => parse({
      ...validDetail,
      listing: { ...validDetail.listing, slug: 'other-listing' },
    })).toThrow(/Mini API 目录响应无效/)
  })

  it.each([
    '',
    'Jing-An-Tower-101',
    'jing_an_tower_101',
    '-jing-an-tower-101',
    'jing-an-tower-101-',
    'jing--an-tower-101',
    '../jing-an-tower-101',
    'jing-an/tower-101',
    '静安中心',
  ])('详情请求在网络调用前拒绝非安全 slug：%s', (slug) => {
    const { calls, request } = createPendingRequestClient()
    const catalog = createCatalogService(request)

    expect(() => catalog.getListingDetail(slug)).toThrow(/房源标识无效/)
    expect(calls).toEqual([])
  })

  it('楼盘列表请求固定上海并传递查询参数', () => {
    const { calls, request } = createPendingRequestClient()
    const catalog = createCatalogService(request)

    void catalog.getBuildings('district=jingan&page=1')

    expect(calls).toEqual([
      {
        path: '/api/mini/v1/buildings?city=shanghai&district=jingan&page=1',
        parse: expect.any(Function),
      },
    ])
  })

  it('楼盘详情请求固定上海并在调用前校验安全 slug', () => {
    const { calls, request } = createPendingRequestClient()
    const catalog = createCatalogService(request)

    void catalog.getBuildingDetail('heng-long-plaza')

    expect(calls).toEqual([
      {
        path: '/api/mini/v1/buildings/heng-long-plaza?city=shanghai',
        parse: expect.any(Function),
      },
    ])

    expect(() => catalog.getBuildingDetail('Heng-Long')).toThrow(/楼盘标识无效/)
  })
})
