/**
 * P1 Task 2 单测：高德 POI provider 与缓存
 *
 * 设计依据：docs/superpowers/plans/2026-07-30-detail-pages-p1-enhancements.md Task 2
 *
 * 守护不变量：
 *   - provider 只映射合法 POI（过滤非法 location/缺字段）并限制为 limit 条
 *   - provider 超时/HTTP/业务/解析错误映射为稳定 LocationServiceError.code
 *   - provider 错误信息不泄露完整请求 URL（含 Key）
 *   - 缓存命中不调 provider；失败不缓存；TTL 24h 过期重取
 *   - 坐标仅保留小数点后 5 位作为 cache key（微差合并）
 *   - building.updated 失效清空对应 building 全部类别 POI 缓存，不影响其他 building
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createAmapLocationProvider } from '@/domain/location-services/amap-provider'
import {
  getNearbyPois,
  invalidateBuildingPois,
  clearPoiCache,
} from '@/domain/location-services/cache'
import {
  LocationServiceError,
  type LocationProvider,
  type NearbyPoi,
  type PoiCategory,
} from '@/domain/location-services/contracts'

// ---------------------------------------------------------------------------
// 高德 place/around 响应 fixture
// ---------------------------------------------------------------------------

const AMAP_POI_FIXTURE = {
  status: '1',
  count: '7',
  pois: [
    { id: 'B001', name: '中国银行(陆家嘴)', location: '121.48012,31.23015', distance: '120', direction: '东北' },
    { id: 'B002', name: '工商银行(浦东)', location: '121.48100,31.23100', distance: '230', direction: '东' },
    { id: 'B003', name: '建设银行(东方)', location: '121.47900,31.22900', distance: '310', direction: '西' },
    { id: 'B004', name: '招商银行(上海)', location: '121.48200,31.23200', distance: '450', direction: '北' },
    { id: 'B005', name: '交通银行(陆家嘴)', location: '121.47800,31.22800', distance: '520', direction: '南' },
    { id: 'B006', name: '农业银行(浦东)', location: '121.48300,31.23300', distance: '610', direction: '东北' },
    // 非法：location 缺失，应被过滤
    { id: 'B007', name: '浦发银行(坏数据)', distance: '700' },
  ],
}

type AmapFetchResponse = {
  ok: boolean
  status: number
  json: () => Promise<unknown>
}
type FetchLike = (
  url: string,
  init?: { signal: AbortSignal; method: string },
) => Promise<AmapFetchResponse>

function mockAmapResponse(fixture: unknown): FetchLike {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => fixture,
  })
}

const INPUT = {
  center: { latitude: 31.23, longitude: 121.48 },
  category: 'bank' as PoiCategory,
  limit: 5 as const,
}

// ---------------------------------------------------------------------------
// provider
// ---------------------------------------------------------------------------

describe('createAmapLocationProvider', () => {
  it('只映射合法 POI 并限制为 5 条', async () => {
    const provider = createAmapLocationProvider({
      key: 'server-key',
      fetchImpl: mockAmapResponse(AMAP_POI_FIXTURE),
    })
    const result = await provider.nearby(INPUT)
    expect(result).toHaveLength(5)
    expect(result[0]).toMatchObject({ source: 'amap-location-service' })
    // 非法 POI（B007 location 缺失）被过滤
    expect(result.find((p) => p.id === 'B007')).toBeUndefined()
    // 第 6 条合法 POI（B006）因 limit=5 被截断
    expect(result.find((p) => p.id === 'B006')).toBeUndefined()
    // 高德 location 为 "经度,纬度"，需正确拆分到 coordinates
    expect(result[0].coordinates).toMatchObject({
      latitude: 31.23015,
      longitude: 121.48012,
    })
    expect(result[0].distanceMeters).toBe(120)
    expect(result[0].direction).toBe('东北')
  })

  it('超时返回可分类错误而不是空成功', async () => {
    vi.useFakeTimers()
    try {
      const provider = createAmapLocationProvider({
        key: 'server-key',
        // 模拟真实 fetch：监听 AbortSignal，abort 时 reject AbortError
        fetchImpl: (_url, init) =>
          new Promise<AmapFetchResponse>((_resolve, reject) => {
            init.signal.addEventListener('abort', () => {
              const err = new Error('The operation was aborted')
              err.name = 'AbortError'
              reject(err)
            })
          }),
      })
      const promise = provider.nearby(INPUT)
      // 先 attach assertion，避免推进 fake timer 时产生 unhandled rejection
      const assertion = expect(promise).rejects.toMatchObject({
        code: 'provider_timeout',
      })
      await vi.advanceTimersByTimeAsync(2500)
      await assertion
    } finally {
      vi.useRealTimers()
    }
  })

  it('HTTP 非 2xx 返回 provider_http_error', async () => {
    const provider = createAmapLocationProvider({
      key: 'server-key',
      fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }),
    })
    await expect(provider.nearby(INPUT)).rejects.toMatchObject({
      code: 'provider_http_error',
    })
  })

  it('业务 status 非 1 返回 provider_business_error', async () => {
    const provider = createAmapLocationProvider({
      key: 'server-key',
      fetchImpl: mockAmapResponse({ status: '0', info: 'INVALID_USER_KEY', pois: [] }),
    })
    await expect(provider.nearby(INPUT)).rejects.toMatchObject({
      code: 'provider_business_error',
    })
  })

  it('响应结构非法返回 provider_invalid_response', async () => {
    const provider = createAmapLocationProvider({
      key: 'server-key',
      fetchImpl: mockAmapResponse({ status: '1', pois: 'not-an-array' }),
    })
    await expect(provider.nearby(INPUT)).rejects.toMatchObject({
      code: 'provider_invalid_response',
    })
  })

  it('缺 key 返回 provider_missing_key', async () => {
    const provider = createAmapLocationProvider({
      key: '',
      fetchImpl: mockAmapResponse(AMAP_POI_FIXTURE),
    })
    await expect(provider.nearby(INPUT)).rejects.toMatchObject({
      code: 'provider_missing_key',
    })
  })

  it('错误信息与堆栈不含完整请求 URL（不泄露 Key）', async () => {
    const provider = createAmapLocationProvider({
      key: 'server-key',
      fetchImpl: async () => ({ ok: false, status: 502, json: async () => ({}) }),
    })
    try {
      await provider.nearby(INPUT)
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(LocationServiceError)
      const msg = (e as Error).message
      const stack = String((e as Error).stack ?? '')
      expect(msg).not.toContain('server-key')
      expect(stack).not.toContain('server-key')
    }
  })
})

// ---------------------------------------------------------------------------
// 缓存
// ---------------------------------------------------------------------------

const SAMPLE_POI: NearbyPoi = {
  id: 'B001',
  category: 'bank',
  name: '中国银行',
  coordinates: Object.freeze({ latitude: 31.23015, longitude: 121.48012 }),
  distanceMeters: 120,
  direction: '东北',
  source: 'amap-location-service',
  fetchedAt: '2026-07-31T00:00:00.000Z',
}

function fakeProvider(pois: readonly NearbyPoi[]): {
  provider: LocationProvider
  getCalls: () => number
} {
  let calls = 0
  return {
    provider: {
      async nearby() {
        calls++
        return pois
      },
    },
    getCalls: () => calls,
  }
}

function fakeFailingProvider(): { provider: LocationProvider; getCalls: () => number } {
  let calls = 0
  return {
    provider: {
      async nearby() {
        calls++
        throw new LocationServiceError('provider_http_error', 'upstream fail')
      },
    },
    getCalls: () => calls,
  }
}

describe('getNearbyPois', () => {
  beforeEach(() => {
    clearPoiCache()
  })

  it('命中缓存不重复调 provider', async () => {
    const { provider, getCalls } = fakeProvider([SAMPLE_POI])
    const input = {
      buildingId: 'b1',
      center: { latitude: 31.23, longitude: 121.48 },
      category: 'bank' as PoiCategory,
      provider,
      now: 1000,
    }
    await getNearbyPois(input)
    await getNearbyPois(input)
    expect(getCalls()).toBe(1)
  })

  it('失败不缓存，下次仍调 provider', async () => {
    const { provider, getCalls } = fakeFailingProvider()
    const input = {
      buildingId: 'b1',
      center: { latitude: 31.23, longitude: 121.48 },
      category: 'bank' as PoiCategory,
      provider,
      now: 1000,
    }
    await expect(getNearbyPois(input)).rejects.toMatchObject({
      code: 'provider_http_error',
    })
    await expect(getNearbyPois(input)).rejects.toMatchObject({
      code: 'provider_http_error',
    })
    expect(getCalls()).toBe(2)
  })

  it('TTL 24h 过期后重取', async () => {
    const { provider, getCalls } = fakeProvider([SAMPLE_POI])
    const base = {
      buildingId: 'b1',
      center: { latitude: 31.23, longitude: 121.48 },
      category: 'bank' as PoiCategory,
      provider,
    }
    const DAY = 24 * 60 * 60 * 1000
    await getNearbyPois({ ...base, now: 1000 })
    // 24h 内（含边界前 1ms）命中
    await getNearbyPois({ ...base, now: 1000 + DAY - 1 })
    expect(getCalls()).toBe(1)
    // 24h 过期重取
    await getNearbyPois({ ...base, now: 1000 + DAY + 1 })
    expect(getCalls()).toBe(2)
  })

  it('坐标仅保留小数点后 5 位作为 key（微差合并）', async () => {
    const { provider, getCalls } = fakeProvider([SAMPLE_POI])
    await getNearbyPois({
      buildingId: 'b1',
      center: { latitude: 31.23, longitude: 121.48 },
      category: 'bank' as PoiCategory,
      provider,
      now: 1000,
    })
    // 第 6 位小数差异在 round5 后相同（31.23 / 121.48）
    await getNearbyPois({
      buildingId: 'b1',
      center: { latitude: 31.230001, longitude: 121.480001 },
      category: 'bank' as PoiCategory,
      provider,
      now: 1000,
    })
    expect(getCalls()).toBe(1)
  })

  it('invalidateBuildingPois 清空对应 building 全部类别缓存', async () => {
    const { provider, getCalls } = fakeProvider([SAMPLE_POI])
    const base = {
      buildingId: 'b1',
      center: { latitude: 31.23, longitude: 121.48 },
      provider,
      now: 1000,
    }
    await getNearbyPois({ ...base, category: 'bank' as PoiCategory })
    await getNearbyPois({ ...base, category: 'restaurant' as PoiCategory })
    expect(getCalls()).toBe(2)
    invalidateBuildingPois('b1')
    // 两类均失效，重取
    await getNearbyPois({ ...base, category: 'bank' as PoiCategory })
    expect(getCalls()).toBe(3)
  })

  it('invalidateBuildingPois 不影响其他 building', async () => {
    const { provider, getCalls } = fakeProvider([SAMPLE_POI])
    await getNearbyPois({
      buildingId: 'b1',
      center: { latitude: 31.23, longitude: 121.48 },
      category: 'bank' as PoiCategory,
      provider,
      now: 1000,
    })
    invalidateBuildingPois('b2')
    await getNearbyPois({
      buildingId: 'b1',
      center: { latitude: 31.23, longitude: 121.48 },
      category: 'bank' as PoiCategory,
      provider,
      now: 1000,
    })
    expect(getCalls()).toBe(1)
  })
})
