/**
 * P2 Task 1 单测：隐私安全的路线摘要 provider
 *
 * 设计依据：docs/superpowers/plans/2026-07-30-detail-pages-p2-guidance.md Task 1
 *
 * 守护不变量：
 *   - 路线摘要响应白名单：只含 mode/时长/距离/换乘/来源，绝不含原始起点坐标
 *   - provider 超时/HTTP/业务/解析错误映射为稳定 LocationServiceError.code
 *   - 错误信息不泄露完整请求 URL（含 Key）与坐标
 *   - 换乘 transfers 仅 transit 有意义，driving/walking 为 null
 *   - 外部响应按 unknown 解析后收窄；非法结构拒绝
 */

import { describe, expect, it } from 'vitest'
import { createAmapRouteProvider } from '@/domain/location-services/routes'
import { LocationServiceError } from '@/domain/location-services/contracts'
import type { RouteProvider } from '@/domain/location-services/routes'

const ORIGIN = { latitude: 31.2, longitude: 121.4 } as const
const DESTINATION = { latitude: 31.23, longitude: 121.48 } as const

type AmapFetchResponse = { ok: boolean; status: number; json: () => Promise<unknown> }
type FetchLike = (
  url: string,
  init?: { signal: AbortSignal; method: string },
) => Promise<AmapFetchResponse>

function mockResponse(fixture: unknown, ok = true, status = 200): FetchLike {
  return async () => ({ ok, status, json: async () => fixture })
}

// 高德 transit/integrated 响应最小结构：route.transits[0] 含 duration(秒)、distance(米)、
// segments（每个含 bus 表示换乘）。
const TRANSIT_FIXTURE = {
  status: '1',
  route: {
    transits: [
      {
        duration: '2160', // 秒 -> 36 分
        distance: '12500',
        segments: [{ bus: {} }, { bus: {} }], // 2 段 -> 1 次换乘
      },
    ],
  },
}

const DRIVING_FIXTURE = {
  status: '1',
  route: { paths: [{ duration: '1200', distance: '9800' }] },
}

function makeProvider(fetchImpl: FetchLike): RouteProvider {
  return createAmapRouteProvider({ key: 'test-key', fetchImpl })
}

describe('高德路线 provider', () => {
  it('路线摘要不包含原始起点坐标', async () => {
    const provider = makeProvider(mockResponse(TRANSIT_FIXTURE))
    const summary = await provider.route({ origin: ORIGIN, destination: DESTINATION, mode: 'transit' })
    expect(summary).toEqual({
      mode: 'transit',
      durationMinutes: 36,
      distanceMeters: 12500,
      transfers: 1,
      source: 'amap-location-service',
    })
    // 白名单：序列化后绝不含原始起点坐标片段
    expect(JSON.stringify(summary)).not.toContain('31.2')
    expect(JSON.stringify(summary)).not.toContain('121.4')
  })

  it('driving 模式 transfers 为 null', async () => {
    const provider = makeProvider(mockResponse(DRIVING_FIXTURE))
    const summary = await provider.route({ origin: ORIGIN, destination: DESTINATION, mode: 'driving' })
    expect(summary.mode).toBe('driving')
    expect(summary.durationMinutes).toBe(20)
    expect(summary.distanceMeters).toBe(9800)
    expect(summary.transfers).toBeNull()
  })

  it('缺 Key 抛 provider_missing_key', async () => {
    const provider = createAmapRouteProvider({ key: '', fetchImpl: mockResponse(TRANSIT_FIXTURE) })
    await expect(
      provider.route({ origin: ORIGIN, destination: DESTINATION, mode: 'transit' }),
    ).rejects.toMatchObject({ code: 'provider_missing_key' })
  })

  it('业务 status 非 1 抛 provider_business_error', async () => {
    const provider = makeProvider(mockResponse({ status: '0', info: 'INVALID_PARAMS' }))
    await expect(
      provider.route({ origin: ORIGIN, destination: DESTINATION, mode: 'transit' }),
    ).rejects.toMatchObject({ code: 'provider_business_error' })
  })

  it('非 2xx 抛 provider_http_error', async () => {
    const provider = makeProvider(mockResponse({}, false, 502))
    await expect(
      provider.route({ origin: ORIGIN, destination: DESTINATION, mode: 'transit' }),
    ).rejects.toMatchObject({ code: 'provider_http_error' })
  })

  it('错误信息不泄露 Key 或坐标', async () => {
    const provider = makeProvider(mockResponse({}, false, 500))
    try {
      await provider.route({ origin: ORIGIN, destination: DESTINATION, mode: 'transit' })
      expect.unreachable('应抛错')
    } catch (e) {
      expect(e).toBeInstanceOf(LocationServiceError)
      const msg = (e as LocationServiceError).message
      expect(msg).not.toContain('test-key')
      expect(msg).not.toContain('121.4')
    }
  })
})
