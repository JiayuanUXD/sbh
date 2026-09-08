/** MP-108：真实 facade / mapper / 内存筛选，只隔离 DB 适配器与 Next 缓存存储。 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Listing } from '@/payload-types'
import type { ListingSearchInput, SearchContext } from '@/domain/public-catalog'

const state = vi.hoisted(() => ({
  values: new Map<string, { value: unknown; expiresAt: number }>(),
  scans: [] as Array<{ input: ListingSearchInput; ctx: SearchContext }>,
  hydrations: [] as number[][],
  docs: [] as Listing[],
}))

vi.mock('next/cache', () => ({
  // 模拟落盘后的 JSON 值；故意不缓存 pending promise，合并必须由业务缓存层完成。
  unstable_cache: (load: (...args: unknown[]) => Promise<unknown>, parts: string[], options?: { revalidate?: number }) =>
    async (...args: unknown[]) => {
      const key = JSON.stringify([parts, args])
      const cached = state.values.get(key)
      if (cached && cached.expiresAt > Date.now()) return cached.value
      const value: unknown = JSON.parse(JSON.stringify(await load(...args)))
      state.values.set(key, { value, expiresAt: Date.now() + (options?.revalidate ?? 300) * 1000 })
      return value
    },
}))

vi.mock('@/domain/public-catalog/supply-adapter', async (original) => {
  const actual = await original<typeof import('@/domain/public-catalog/supply-adapter')>()
  return {
    ...actual,
    getDefaultSupplyAdapter: () => ({
      scanEffectiveListings: async (input: ListingSearchInput, ctx: SearchContext) => {
        state.scans.push({ input, ctx })
        const { rowsFromListings } = await import('@/domain/public-catalog/listing-scan')
        return rowsFromListings(state.docs)
      },
      findEffectiveListingsByIds: async (ids: readonly number[]) => {
        state.hydrations.push([...ids])
        // DB 返回乱序，真实 mapper / hydrate 必须恢复页面顺序。
        return state.docs.filter((doc) => ids.includes(doc.id)).reverse()
      },
    }),
  }
})

import { buildCanonicalSearchParams, mapListingCard, parseListingSearchInput } from '@/domain/public-catalog'
import { getCachedListingScan } from '@/lib/frontend/cached-queries'
import { getCachedMiniListings } from '@/lib/mini-program/cached-queries'
import {
  BUILDING_JINGAN_CENTER, DISTRICT_PUDONG, LISTING_MONTHLY_STANDARD,
} from '@/test/frontend/payload-documents'

const parse = (query = '') => parseListingSearchInput(new URLSearchParams(query))
const ids = (start: number, length: number) => Array.from({ length }, (_, i) => start + i)

beforeEach(() => {
  state.values.clear()
  state.scans.length = 0
  state.hydrations.length = 0
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-07T00:00:00.000Z'))
  state.docs = ids(1, 30).map((id) => ({
    ...LISTING_MONTHLY_STANDARD, id, slug: `mini-${id}`, isFeatured: false,
    updatedAt: '2026-09-01T00:00:00.000Z',
    listingType: id <= 20 ? 'traditional-office' : 'coworking',
    rentUnit: id <= 25 ? 'rmb-month' : 'rmb-sqm-day',
    rent: id,
    building: id <= 15 ? BUILDING_JINGAN_CENTER : {
      ...BUILDING_JINGAN_CENTER, id: 201, district: DISTRICT_PUDONG,
    },
  }))
})
afterEach(() => vi.useRealTimers())

describe('Mini 列表共享单遍扫描', () => {
  it('冷请求只扫描一次，只回捞本页 24 个 ID，DTO / canonical / facet 计数不变', async () => {
    const input = parse()
    const snapshot = await getCachedMiniListings('shanghai', input)
    expect(state.scans).toHaveLength(1)
    expect(state.scans[0]).toEqual({ input, ctx: expect.objectContaining({ city: 'shanghai', businessType: 'lease' }) })
    expect(state.hydrations).toEqual([ids(1, 24)])
    expect(snapshot.asOf).toBe(state.scans[0].ctx.asOf)
    expect(snapshot.data.result.docs).toEqual(state.docs.slice(0, 24).map(mapListingCard))
    expect(snapshot.data.result.canonical).toBe(buildCanonicalSearchParams(input).toString())
    expect(snapshot.data.result.pagination).toMatchObject({ page: 1, totalDocs: 30, totalPages: 2 })
    expect(snapshot.data.facets.district.districts.map((d) => [d.slug, d.count])).toEqual([['jingan', 15], ['pudong', 15]])
    expect(snapshot.data.facets.listingType.listingTypes).toEqual([
      { value: 'traditional-office', count: 20 }, { value: 'coworking', count: 10 },
    ])
    expect(snapshot.data.facets.priceUnit.rentUnits).toEqual([
      { value: 'rmb-month', count: 25 }, { value: 'rmb-sqm-day', count: 5 },
    ])
  })

  it('两个冷请求与 Web 同输入扫描并发合并，回捞也合并', async () => {
    const [first, second, rows] = await Promise.all([
      getCachedMiniListings('shanghai', parse()),
      getCachedMiniListings('shanghai', parse()),
      getCachedListingScan('shanghai', parse()),
    ])
    expect(state.scans).toHaveLength(1)
    expect(state.hydrations).toEqual([ids(1, 24)])
    expect(rows).toHaveLength(30)
    expect(first).toEqual(second)
  })

  it('切换区域 / 类型 / 单位 / 页码 / 排序复用扫描，并保留真实扫描 asOf', async () => {
    await getCachedListingScan('shanghai', parse())
    const asOf = state.scans[0].ctx.asOf
    vi.setSystemTime(new Date('2026-09-07T00:04:00.000Z'))
    const pages = await Promise.all([
      getCachedMiniListings('shanghai', parse('page=2')),
      getCachedMiniListings('shanghai', parse('district=pudong&type=coworking&priceUnit=rmb-month&sort=price-desc')),
    ])
    expect(state.scans).toHaveLength(1)
    expect(pages.map((p) => p.asOf)).toEqual([asOf, asOf])
    expect(pages[0].data.result.docs.map((d) => d.id)).toEqual(ids(25, 6))
    expect(pages[1].data.result.docs.map((d) => d.id)).toEqual([25, 24, 23, 22, 21])
    expect(state.hydrations).toEqual([ids(25, 6), [25, 24, 23, 22, 21]])
    expect(pages[1].data.facets.district.totalDocs).toBe(5)
    expect(pages[1].data.facets.listingType.listingTypes).toEqual([
      { value: 'traditional-office', count: 5 }, { value: 'coworking', count: 5 },
    ])
    expect(pages[1].data.facets.priceUnit.rentUnits).toEqual([
      { value: 'rmb-month', count: 5 }, { value: 'rmb-sqm-day', count: 5 },
    ])
  })

  it('Mini 不给已缓存四分钟的扫描重新续五分钟的外层 TTL', async () => {
    await getCachedListingScan('shanghai', parse())
    vi.setSystemTime(new Date('2026-09-07T00:04:00.000Z'))
    await getCachedMiniListings('shanghai', parse())
    vi.setSystemTime(new Date('2026-09-07T00:06:00.000Z'))
    const refreshed = await getCachedMiniListings('shanghai', parse())
    expect(state.scans).toHaveLength(2)
    expect(refreshed.asOf).toBe('2026-09-07T00:06:00.000Z')
  })
})
