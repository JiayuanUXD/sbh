/**
 * OPT-068 缓存层：列表页与 facet 共用一份扫描缓存，本页卡片按 id 回捞。
 *
 * 与 opt036-facet-query-dedupe 一样**数真实调用次数**：`unstable_cache` 换成直通
 * （冷路径下界），计量点是域层 `scanListings` / `hydrateListingCards`。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const scanCalls: string[] = []
const hydrateCalls: number[][] = []

const ROWS = [
  {
    id: 1, slug: 'l-1', listingType: 'traditional-office', businessType: 'lease', area: 120,
    price: { amount: 5, currency: 'CNY', businessType: 'lease', period: 'day', basis: 'sqm', displayUnit: 'rmb-sqm-day', text: '5 元/㎡/天' },
    isFeatured: false, lastEffAt: 3, buildingId: 1, district: { id: 10, slug: 'jingan', name: '静安' }, businessDistrictId: 20, coordinates: null,
  },
  {
    id: 2, slug: 'l-2', listingType: 'coworking', businessType: 'lease', area: 80,
    price: { amount: 3, currency: 'CNY', businessType: 'lease', period: 'day', basis: 'sqm', displayUnit: 'rmb-sqm-day', text: '3 元/㎡/天' },
    isFeatured: false, lastEffAt: 2, buildingId: 2, district: { id: 11, slug: 'pudong', name: '浦东' }, businessDistrictId: 21, coordinates: null,
  },
  {
    id: 3, slug: 'l-3', listingType: 'traditional-office', businessType: 'lease', area: 200,
    price: null,
    isFeatured: false, lastEffAt: 1, buildingId: 1, district: { id: 10, slug: 'jingan', name: '静安' }, businessDistrictId: 20, coordinates: null,
  },
] as const

vi.mock('next/cache', () => ({
  unstable_cache:
    (load: (...args: unknown[]) => unknown) =>
      async (...args: unknown[]) => load(...args),
}))

vi.mock('@/domain/public-catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/domain/public-catalog')>()
  return {
    ...actual,
    scanListings: vi.fn(async (input: unknown, ctx: { city: string; businessType?: string }) => {
      scanCalls.push(`${ctx.city}|${ctx.businessType ?? 'all'}|${actual.buildCanonicalSearchParams(input as never).toString()}`)
      return ROWS
    }),
    hydrateListingCards: vi.fn(async (ids: readonly number[]) => {
      hydrateCalls.push([...ids])
      return ids.map((id) => ({ id, slug: `l-${id}` }))
    }),
  }
})

import { parseListingSearchInput } from '@/domain/public-catalog'
import {
  getCachedListingCardsByIds,
  getCachedSearchFacets,
  getCachedSearchFacetsIgnoring,
  getCachedSearchListings,
} from '@/lib/frontend/cached-queries'

const parse = (q: string) => parseListingSearchInput(new URLSearchParams(q))

beforeEach(() => {
  scanCalls.length = 0
  hydrateCalls.length = 0
})

describe('OPT-068 列表页缓存：扫描 + 本页卡片', () => {
  it('整页（列表 + 三份剥离 facet）并发只扫描一次，本页卡片按推荐序 id 回捞', async () => {
    const input = parse('')
    const [result, unitFacets, districtFacets, typeFacets] = await Promise.all([
      getCachedSearchListings('shanghai', '', input),
      getCachedSearchFacetsIgnoring('shanghai', input, ['priceUnit']),
      getCachedSearchFacetsIgnoring('shanghai', input, ['district']),
      getCachedSearchFacetsIgnoring('shanghai', input, ['listingType']),
    ])
    expect(scanCalls).toHaveLength(1)
    expect(hydrateCalls).toEqual([[1, 2, 3]])
    expect(result.docs.map((d) => d.id)).toEqual([1, 2, 3])
    expect(result.pagination.totalDocs).toBe(3)
    expect(unitFacets.rentUnits).toEqual([{ value: 'rmb-sqm-day', count: 2 }])
    expect(districtFacets.districts.map((d) => [d.slug, d.count])).toEqual([['jingan', 2], ['pudong', 1]])
    expect(typeFacets.listingTypes).toEqual([{ value: 'traditional-office', count: 2 }, { value: 'coworking', count: 1 }])
  })

  it('区域 / 类型 / 价格 / 页码 / 排序在内存里生效，扫描键不变', async () => {
    const plain = await getCachedSearchListings('shanghai', '', parse(''))
    const byDistrict = await getCachedSearchListings('shanghai', '', parse('district=jingan&sort=newest'))
    const byType = await getCachedSearchListings('shanghai', '', parse('type=coworking'))
    const byUnitRange = await getCachedSearchListings('shanghai', '', parse('priceUnit=rmb-sqm-day&priceMax=4'))
    expect(plain.docs.map((d) => d.id)).toEqual([1, 2, 3])
    expect(byDistrict.docs.map((d) => d.id)).toEqual([1, 3])
    expect(byType.docs.map((d) => d.id)).toEqual([2])
    expect(byUnitRange.docs.map((d) => d.id)).toEqual([2])
    // 直通 unstable_cache 下每次调用都会扫描，但键必须一致——同键才可能在生产上命中同一条缓存
    expect(new Set(scanCalls).size).toBe(1)
  })

  it('会进 where 的维度分键：面积 / 关键词各自一次扫描', async () => {
    await getCachedSearchListings('shanghai', '', parse(''))
    await getCachedSearchListings('shanghai', '', parse('areaMin=100'))
    await getCachedSearchListings('shanghai', '', parse('q=陆家嘴'))
    expect(new Set(scanCalls).size).toBe(3)
  })

  it('城市与频道进键：出售频道 / 别的城市不得顶替租赁频道的扫描', async () => {
    const input = parse('')
    await Promise.all([
      getCachedSearchFacets('shanghai', '', input, 'lease'),
      getCachedSearchFacets('shanghai', '', input, 'sale'),
      getCachedSearchFacets('hangzhou', '', input, 'lease'),
    ])
    expect(new Set(scanCalls).size).toBe(3)
  })

  it('空 id 列表不回捞、不进缓存', async () => {
    expect(await getCachedListingCardsByIds('shanghai', [])).toEqual([])
    expect(hydrateCalls).toEqual([])
  })

  it('越界页码：本页无 id，不回捞，但分页元数据仍完整', async () => {
    const result = await getCachedSearchListings('shanghai', '', parse('page=9'))
    expect(result.docs).toEqual([])
    expect(hydrateCalls).toEqual([])
    expect(result.pagination).toMatchObject({ page: 9, totalDocs: 3, totalPages: 1, hasPrevPage: true, hasNextPage: false })
  })
})
