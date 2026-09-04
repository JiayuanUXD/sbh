/**
 * OPT-068 房源扫描层：行模型与纯函数。
 *
 * 列表页不再把候选集按 depth 2 整棵拉出再在内存里做一切，而是一次轻量扫描
 * 产出紧凑的 `ListingScanRow`，区域 / 类型 / 价格过滤、排序、分页、facet 全部在行上
 * 完成，只对本页 id 回捞卡片。这里锁定的是行上那些纯函数与旧路径的口径一致。
 */
import { describe, expect, it } from 'vitest'
import {
  SCAN_MEMORY_DIMENSIONS,
  applyMemoryFilters,
  buildListingScanCacheKey,
  computeFacets,
  matchesPriceFilter,
  rowFromListing,
  rowToCandidate,
  selectListingPage,
  toScanInput,
  type ListingScanRow,
} from '@/domain/public-catalog/listing-scan'
import { parseListingSearchInput, type PriceViewModel } from '@/domain/public-catalog'

const SQM_DAY: PriceViewModel = {
  amount: 5,
  currency: 'CNY',
  businessType: 'lease',
  period: 'day',
  basis: 'sqm',
  displayUnit: 'rmb-sqm-day',
  text: '5 元/㎡/天',
}

const MONTHLY: PriceViewModel = {
  amount: 20000,
  currency: 'CNY',
  businessType: 'lease',
  period: 'month',
  basis: 'total',
  displayUnit: 'rmb-month',
  text: '20000 元/月',
}

function row(over: Partial<ListingScanRow> & { id: number }): ListingScanRow {
  return {
    slug: `l-${over.id}`,
    listingType: 'traditional-office',
    businessType: 'lease',
    area: 100,
    price: SQM_DAY,
    isFeatured: false,
    lastEffAt: 1000,
    buildingId: 1,
    district: { id: 10, slug: 'jingan', name: '静安' },
    businessDistrictId: 20,
    coordinates: null,
    ...over,
  }
}

const parse = (q: string) => parseListingSearchInput(new URLSearchParams(q))

describe('OPT-068 listing scan：扫描输入与缓存键', () => {
  it('内存维度固定为区域 / 类型 / 价格单位 / 价格区间', () => {
    expect([...SCAN_MEMORY_DIMENSIONS].sort()).toEqual(['district', 'listingType', 'price', 'priceUnit'])
  })

  it('toScanInput 剥掉区域/类型/价格并归零页码与排序，其余条件原样保留', () => {
    const input = parse(
      'district=jingan&type=traditional-office&priceUnit=rmb-sqm-day&priceMax=6&areaMin=100&page=3&sort=price-asc',
    )
    const scan = toScanInput(input)
    expect(scan.district).toBeUndefined()
    expect(scan.listingType).toBeUndefined()
    expect(scan.priceUnit).toBeUndefined()
    expect(scan.priceMax).toBeUndefined()
    expect(scan.areaMin).toBe(100)
    expect(scan.page).toBe(1)
    expect(scan.sort).toBe('recommended')
  })

  it('扫描缓存键与区域/类型/价格/页码/排序无关，与面积/关键词有关', () => {
    const key = (q: string) => buildListingScanCacheKey(parse(q))
    expect(key('district=jingan&page=2&sort=newest')).toBe(key(''))
    expect(key('type=traditional-office&priceUnit=rmb-sqm-day&priceMin=3')).toBe(key(''))
    expect(key('areaMin=200')).not.toBe(key(''))
    expect(key('q=x')).not.toBe(key(''))
  })
})

describe('OPT-068 listing scan：内存过滤与 facet', () => {
  const rows = [
    row({ id: 1 }),
    row({ id: 2, district: { id: 11, slug: 'pudong', name: '浦东' } }),
    row({ id: 3, listingType: 'coworking' }),
    row({ id: 4, price: null }),
    row({ id: 5, price: { ...SQM_DAY, amount: 9 } }),
  ]
  const ids = (list: readonly ListingScanRow[]) => list.map((r) => r.id)

  it('按区域过滤', () => {
    expect(ids(applyMemoryFilters(rows, parse('district=jingan')))).toEqual([1, 3, 4, 5])
  })

  it('按类型过滤', () => {
    expect(ids(applyMemoryFilters(rows, parse('type=traditional-office')))).toEqual([1, 2, 4, 5])
  })

  it('只选单位：面议房源仍入选（单位断言对无报价无从证伪）', () => {
    expect(ids(applyMemoryFilters(rows, parse('priceUnit=rmb-sqm-day')))).toEqual([1, 2, 3, 4, 5])
  })

  it('给区间：面议不入选、超区间不入选', () => {
    expect(ids(applyMemoryFilters(rows, parse('priceUnit=rmb-sqm-day&priceMax=6')))).toEqual([1, 2, 3])
  })

  it('matchesPriceFilter 与旧 filterByPrice 同一裁定', () => {
    const ranged = parse('priceUnit=rmb-sqm-day&priceMin=3&priceMax=6')
    expect(matchesPriceFilter(SQM_DAY, ranged)).toBe(true)
    expect(matchesPriceFilter(MONTHLY, ranged)).toBe(false)
    expect(matchesPriceFilter(null, ranged)).toBe(false)
    expect(matchesPriceFilter(null, parse('priceUnit=rmb-sqm-day'))).toBe(true)
    expect(matchesPriceFilter(null, parse(''))).toBe(true)
  })

  it('computeFacets 与旧 getSearchFacets 同口径', () => {
    const facets = computeFacets([
      row({ id: 1 }),
      row({ id: 2, price: null }),
      row({ id: 3, listingType: 'coworking', district: { id: 11, slug: 'pudong', name: '浦东' } }),
    ])
    expect(facets.totalDocs).toBe(3)
    expect(facets.districts).toEqual([
      { id: 10, slug: 'jingan', name: '静安', count: 2 },
      { id: 11, slug: 'pudong', name: '浦东', count: 1 },
    ])
    expect(facets.listingTypes).toEqual([
      { value: 'traditional-office', count: 2 },
      { value: 'coworking', count: 1 },
    ])
    expect(facets.rentUnits).toEqual([{ value: 'rmb-sqm-day', count: 2 }])
  })
})

describe('OPT-068 listing scan：排序与分页', () => {
  it('推荐序 = 精选优先 → lastEffAt 降序 → id 升序；只返回本页 id', () => {
    const rows = [
      row({ id: 1, lastEffAt: 5 }),
      row({ id: 2, lastEffAt: 9 }),
      row({ id: 3, isFeatured: true, lastEffAt: 1 }),
    ]
    const page = selectListingPage(rows, parse(''))
    expect(page.ids).toEqual([3, 2, 1])
    expect(page.pagination.totalDocs).toBe(3)
    expect(page.pagination.totalPages).toBe(1)
    expect(page.filteredByRentUnit).toBe(false)
  })

  it('分页切片：第 2 页只含第 25 条起', () => {
    const rows = Array.from({ length: 30 }, (_, i) => row({ id: i + 1, lastEffAt: 30 - i }))
    const page = selectListingPage(rows, parse('page=2'))
    expect(page.ids).toEqual([25, 26, 27, 28, 29, 30])
    expect(page.pagination.page).toBe(2)
    expect(page.pagination.totalPages).toBe(2)
  })

  it('价格排序未指定单位时按首个非空单位过滤并标记 filteredByRentUnit', () => {
    const rows = [row({ id: 1 }), row({ id: 2, price: MONTHLY }), row({ id: 3, price: { ...SQM_DAY, amount: 3 } })]
    const page = selectListingPage(rows, { ...parse(''), sort: 'price-asc' })
    expect(page.ids).toEqual([3, 1])
    expect(page.filteredByRentUnit).toBe(true)
  })

  it('价格排序指定单位：单位过滤先于排序预处理，因此 filteredByRentUnit 为 false（与旧路径一致：显式选单位时「另有 N 套按别的单位报价」由 facet 提示，不由这个标志）', () => {
    const rows = [row({ id: 1 }), row({ id: 2, price: MONTHLY }), row({ id: 3, price: { ...SQM_DAY, amount: 3 } })]
    const page = selectListingPage(rows, parse('priceUnit=rmb-sqm-day&sort=price-desc'))
    expect(page.ids).toEqual([1, 3])
    expect(page.filteredByRentUnit).toBe(false)
  })
})

describe('OPT-068 listing scan：从 depth 2 文档投影行', () => {
  const raw = {
    id: 7,
    slug: 's',
    listingType: 'traditional-office',
    businessType: 'lease',
    area: 88,
    isFeatured: true,
    updatedAt: '2026-09-01T00:00:00.000Z',
    price: { amount: 4, currency: 'CNY', period: 'day', unit: 'sqm' },
    building: {
      id: 1,
      slug: 'b',
      name: 'B',
      city: { id: 2, slug: 'shanghai', name: '上海', type: 'city', status: 'active' },
      district: { id: 10, slug: 'jingan', name: '静安', type: 'district', status: 'active' },
      businessDistrict: { id: 20, slug: 'nanjingxilu', name: '南京西路', type: 'business_area', status: 'active' },
      latitude: 31.2,
      longitude: 121.4,
    },
    merchant: { id: 3, status: 'active' },
  }

  it('区域、商圈 id、价格、精选、更新时间、坐标全部投影', () => {
    const r = rowFromListing(raw)
    expect(r).not.toBeNull()
    expect(r!.id).toBe(7)
    expect(r!.slug).toBe('s')
    expect(r!.listingType).toBe('traditional-office')
    expect(r!.area).toBe(88)
    expect(r!.buildingId).toBe(1)
    expect(r!.district).toEqual({ id: 10, slug: 'jingan', name: '静安' })
    expect(r!.businessDistrictId).toBe(20)
    expect(r!.price?.displayUnit).toBe('rmb-sqm-day')
    expect(r!.price?.amount).toBe(4)
    expect(r!.isFeatured).toBe(true)
    expect(r!.lastEffAt).toBe(Date.parse('2026-09-01T00:00:00.000Z'))
    expect(r!.coordinates).toEqual({ latitude: 31.2, longitude: 121.4 })
  })

  it('缺楼盘返回 null；updatedAt 不可解析时 lastEffAt 为有限数（JSON 可序列化）', () => {
    expect(rowFromListing({ ...raw, building: null })).toBeNull()
    expect(rowFromListing({ ...raw, building: 1 })).toBeNull()
    const r = rowFromListing({ ...raw, updatedAt: 'bad' })
    expect(Number.isFinite(r!.lastEffAt)).toBe(true)
    expect(JSON.parse(JSON.stringify(r))).toEqual(r)
  })

  it('商圈 / 区域缺失或只是 id 时不报错', () => {
    const r = rowFromListing({ ...raw, building: { ...raw.building, district: 10, businessDistrict: null } })
    expect(r!.district).toBeNull()
    expect(r!.businessDistrictId).toBeNull()
  })

  it('rowToCandidate 与旧 listingToCandidate 同口径', () => {
    expect(rowToCandidate(rowFromListing(raw)!)).toEqual({
      id: 7,
      listingType: 'traditional-office',
      businessType: 'lease',
      area: 88,
      priceAmount: 4,
      priceUnit: 'rmb-sqm-day',
      buildingDistrictId: 10,
      buildingBusinessDistrictId: 20,
    })
  })
})
