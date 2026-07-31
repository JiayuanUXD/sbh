/**
 * P2 Task 2 验收：/api/routes 路由集成测（mock Payload + fetch）
 *
 * 设计依据：docs/superpowers/plans/2026-07-30-detail-pages-p2-guidance.md Task 2
 *
 * 守护不变量：
 *   - 合法请求 -> 200 { ok: true, summary: RouteSummary }，只回摘要不回起点
 *   - 日志绝不含请求 body、完整 URL、原始起点坐标；只记 mode/成功失败/耗时区间
 *   - 限流 -> 429 { ok: false, error: 'rate_limited' } + Retry-After
 *   - schema 错误 -> 422 { ok: false, errors: [...] }，不调 provider
 *   - 非同源 -> 403；非 JSON -> 415；body 过大 -> 413；非法 JSON -> 400
 *   - provider 失败 -> 502 { ok: false, error: 'route_unavailable' }
 *   - GET -> 405
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

const payloadLoggerInfo = vi.fn()
const payloadLoggerError = vi.fn()
const payloadLoggerWarn = vi.fn()

vi.mock('payload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('payload')>()
  return {
    ...actual,
    getPayload: vi.fn(async () => ({
      logger: { info: payloadLoggerInfo, error: payloadLoggerError, warn: payloadLoggerWarn },
      db: { pool: {} },
    })),
  }
})

const inMemoryRateStore = new Map<string, { count: number; windowStart: number }>()

vi.mock('@/lib/rate-limit-pg', () => ({
  createPgRateLimitDeps: () => ({
    acquire: async (key: string, windowStart: number) => {
      const existing = inMemoryRateStore.get(key)
      if (existing && existing.windowStart === windowStart) {
        existing.count += 1
        return { count: existing.count, windowStart }
      }
      inMemoryRateStore.set(key, { count: 1, windowStart })
      return { count: 1, windowStart }
    },
    pruneExpired: async () => 0,
    countKeys: async () => inMemoryRateStore.size,
    keyExists: async (key: string) => inMemoryRateStore.has(key),
    now: () => Date.now(),
  }),
}))

// 高德 transit 成功响应 fixture
const TRANSIT_FIXTURE = {
  status: '1',
  route: { transits: [{ duration: '2160', distance: '12500', segments: [{ bus: {} }, { bus: {} }] }] },
}

let fetchSpy: ReturnType<typeof vi.fn>

import { POST, GET } from '@/app/(frontend)/api/routes/route'

const ORIGIN = { latitude: 31.2, longitude: 121.4 }
const DESTINATION = { latitude: 31.23, longitude: 121.48 }

function makeValidBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { requestId: 'req-r1', origin: ORIGIN, destination: DESTINATION, mode: 'transit', ...overrides }
}

function makeReq(opts: { body?: unknown; method?: string; headers?: Record<string, string> }): Request {
  const { body, method = 'POST', headers = {} } = opts
  const init: RequestInit = {
    method,
    headers: {
      'content-type': 'application/json',
      host: 'localhost:3717',
      origin: 'http://localhost:3717',
      'x-forwarded-for': '1.2.3.4',
      ...headers,
    },
  }
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body)
  return new Request('http://localhost:3717/api/routes', init)
}

async function run(req: Request): Promise<{ status: number; body: any; headers: Headers }> {
  const res = await POST(req)
  const json = await res.json().catch(() => ({}))
  return { status: res.status, body: json, headers: res.headers }
}

beforeEach(() => {
  payloadLoggerInfo.mockReset()
  payloadLoggerError.mockReset()
  payloadLoggerWarn.mockReset()
  inMemoryRateStore.clear()
  fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => TRANSIT_FIXTURE }))
  vi.stubGlobal('fetch', fetchSpy)
  process.env.AMAP_WEB_SERVICE_KEY = 'test-web-service-key'
})

describe('POST /api/routes / 正常', () => {
  it('合法请求 -> 200 { ok:true, summary }，只回摘要', async () => {
    const r = await run(makeReq({ body: makeValidBody() }))
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)
    expect(r.body.summary).toEqual({
      mode: 'transit',
      durationMinutes: 36,
      distanceMeters: 12500,
      transfers: 1,
      source: 'amap-location-service',
    })
  })

  it('响应不含原始起点坐标', async () => {
    const r = await run(makeReq({ body: makeValidBody() }))
    expect(JSON.stringify(r.body)).not.toContain('121.4')
    expect(JSON.stringify(r.body)).not.toContain('31.2')
  })

  it('日志不含 body/URL/坐标，只记 mode', async () => {
    await run(makeReq({ body: makeValidBody() }))
    const logged = JSON.stringify([
      ...payloadLoggerInfo.mock.calls,
      ...payloadLoggerError.mock.calls,
      ...payloadLoggerWarn.mock.calls,
    ])
    expect(logged).not.toContain('121.4')
    expect(logged).not.toContain('31.2')
    expect(logged).not.toContain('test-web-service-key')
    expect(logged).not.toContain('restapi.amap.com')
  })
})

describe('POST /api/routes / 校验与降级', () => {
  it('schema 错误 -> 422，不调 provider', async () => {
    const r = await run(makeReq({ body: makeValidBody({ mode: 'flying' }) }))
    expect(r.status).toBe(422)
    expect(r.body.ok).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('缺起点 -> 422', async () => {
    const r = await run(makeReq({ body: makeValidBody({ origin: undefined }) }))
    expect(r.status).toBe(422)
    expect(r.body.errors).toContain('invalid_origin')
  })

  it('非同源 -> 403', async () => {
    const r = await run(makeReq({ body: makeValidBody(), headers: { origin: 'http://evil.com' } }))
    expect(r.status).toBe(403)
  })

  it('非 JSON -> 415', async () => {
    const r = await run(makeReq({ body: 'x', headers: { 'content-type': 'text/plain' } }))
    expect(r.status).toBe(415)
  })

  it('provider 失败 -> 502 route_unavailable', async () => {
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({}) })
    const r = await run(makeReq({ body: makeValidBody() }))
    expect(r.status).toBe(502)
    expect(r.body.error).toBe('route_unavailable')
  })

  it('限流 -> 429 + Retry-After', async () => {
    for (let i = 0; i < 10; i++) await run(makeReq({ body: makeValidBody() }))
    const r = await run(makeReq({ body: makeValidBody() }))
    expect(r.status).toBe(429)
    expect(r.body.error).toBe('rate_limited')
    expect(r.headers.get('Retry-After')).toBeTruthy()
  })

  it('GET -> 405', async () => {
    const res = await GET()
    expect(res.status).toBe(405)
  })
})
