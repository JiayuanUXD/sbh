import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  calls: [] as { city: string; businessType?: string; asOf: string; page: number }[],
  entries: [] as { key: string; value: unknown }[],
  malformed: false,
  emptyFirst: false,
  parallel: false,
  active: 0,
  maxActive: 0,
  badPage: 0,
}))

vi.mock('next/cache', () => ({
  unstable_cache: (
    load: (...args: unknown[]) => Promise<unknown>,
    keyParts: readonly string[],
  ) => {
    const values = new Map<string, unknown>()
    return async (...args: unknown[]) => {
      const key = JSON.stringify([keyParts, args])
      if (values.has(key)) return values.get(key)
      const value = await load(...args)
      values.set(key, value)
      if (keyParts[0] === 'listing-scan-page') state.entries.push({ key, value })
      return value
    }
  },
}))

vi.mock('@/domain/public-catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/domain/public-catalog')>()
  return {
    ...actual,
    scanListingsPage: vi.fn(async (
      _input: unknown,
      ctx: { city: string; businessType?: string; asOf: string },
      page: number,
    ) => {
      state.active++
      state.maxActive = Math.max(state.maxActive, state.active)
      await Promise.resolve()
      state.active--
      state.calls.push({ ...ctx, page })
      // 模拟扫描期间墙钟变化，后续页仍须使用第一页的快照时点。
      vi.setSystemTime(new Date(Date.now() + 60_000))
      return {
        rows: state.emptyFirst && page === 1 ? [] : Array.from(
          { length: page === 11 ? 1 : 1000 },
          (_, index) => ({
            id: (page - 1) * 1000 + index + 1,
            slug: `listing-${ctx.city}-${page}-${index}`,
            listingType: 'traditional-office',
            businessType: ctx.businessType ?? 'lease',
            area: 100,
            price: {
              amount: 5, currency: 'CNY', businessType: 'lease', period: 'day',
              basis: 'sqm', displayUnit: 'rmb-sqm-day', text: '5 元/平方米/天',
            },
            isFeatured: false,
            lastEffAt: 0,
            buildingId: 10,
            district: { id: 101, slug: 'jing-an', name: '静安区' },
            businessDistrictId: 201,
            coordinates: { latitude: 31.23, longitude: 121.47 },
          }),
        ),
        nextPage: state.malformed || page === state.badPage ? page : page === 11 ? null : page + 1,
        totalPages: state.parallel ? 11 : undefined,
      }
    }),
  }
})

import { parseListingSearchInput } from '@/domain/public-catalog'
import { getCachedListingScanSnapshot } from '@/lib/frontend/cached-queries'

const input = parseListingSearchInput(new URLSearchParams())

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-11T00:00:00.000Z'))
  state.calls.length = 0
  state.entries.length = 0
  state.malformed = false
  state.emptyFirst = false
  state.parallel = false
  state.active = 0
  state.maxActive = 0
  state.badPage = 0
})

afterEach(() => vi.useRealTimers())

describe('房源全量扫描分页缓存', () => {
  it('已知总页数时有界并发读取，合并顺序及快照时点不变', async () => {
    state.parallel = true
    const result = await getCachedListingScanSnapshot('chengdu', input)
    expect(result.rows).toHaveLength(10001)
    expect(result.rows.map(row => row.id)).toEqual(Array.from({ length: 10001 }, (_, i) => i + 1))
    expect(new Set(state.calls.map(call => call.asOf))).toEqual(new Set([result.asOf]))
    expect(state.maxActive).toBeGreaterThan(1)
    expect(state.maxActive).toBeLessThanOrEqual(4)
  })

  it('并发分页有缺页时拒绝返回部分扫描结果', async () => {
    state.parallel = true
    state.badPage = 5
    await expect(getCachedListingScanSnapshot('wuhan', input))
      .rejects.toThrow('房源扫描分页未按顺序推进')
    expect(state.calls.map(call => call.page)).toEqual([1, 2, 3, 4, 5])
  })

  it('超过 5000 条与 2MB 的整城结果逐页缓存，复用同一 asOf，热读无查询', async () => {
    const first = await getCachedListingScanSnapshot('shanghai', input)
    expect(first.rows).toHaveLength(10001)
    expect(first.rows.at(-1)?.id).toBe(10001)
    expect(state.calls.map((call) => call.page)).toEqual(Array.from({ length: 11 }, (_, i) => i + 1))
    expect(new Set(state.calls.map((call) => call.asOf))).toEqual(new Set([first.asOf]))
    expect(Buffer.byteLength(JSON.stringify(first))).toBeGreaterThan(2 * 1024 * 1024)
    expect(state.entries).toHaveLength(11)
    for (const entry of state.entries) {
      expect(Buffer.byteLength(JSON.stringify(entry.value))).toBeLessThan(2 * 1024 * 1024)
      expect(entry.key).toContain('snapshot-v3')
    }
    const cached = await getCachedListingScanSnapshot('shanghai', input)
    expect(cached).toEqual(first)
    expect(state.calls).toHaveLength(11)
  })

  it('精筛空页仍翻页，并发请求合并，城市与频道各自隔离', async () => {
    state.emptyFirst = true
    const [lease, duplicate, sale, otherCity] = await Promise.all([
      getCachedListingScanSnapshot('hangzhou', input),
      getCachedListingScanSnapshot('hangzhou', input),
      getCachedListingScanSnapshot('hangzhou', input, 'sale'),
      getCachedListingScanSnapshot('suzhou', input),
    ])
    expect(lease.rows).toHaveLength(9001)
    expect(duplicate).toBe(lease)
    expect(sale.rows.every((row) => row.businessType === 'sale')).toBe(true)
    expect(otherCity.rows.every((row) => row.slug.includes('suzhou'))).toBe(true)
    expect(state.calls).toHaveLength(33)
    for (const snapshot of [lease, sale, otherCity]) {
      const matching = state.calls.filter((call) => call.asOf === snapshot.asOf)
      expect(matching.length).toBeGreaterThanOrEqual(11)
    }
  })

  it('分页未推进时拒绝返回部分结果', async () => {
    state.malformed = true
    await expect(getCachedListingScanSnapshot('beijing', input))
      .rejects.toThrow('房源扫描分页未按顺序推进')
    expect(state.calls).toHaveLength(1)
  })
})
