/**
 * P1 Task 6 验收：/api/corrections 路由集成测（mock Payload）
 *
 * 设计依据：docs/superpowers/plans/2026-07-30-detail-pages-p1-enhancements.md Task 6
 *           specs/work-items/FPD-P1-detail-enhancements.md §7
 *
 * 守护不变量：
 *   - 正常提交 -> 200 { ok: true }，调用 payload.create 一次
 *   - 响应形状固定 { ok: true }，不暴露记录 ID
 *   - 响应和日志不暴露提交人标识（原始 IP 不进日志/存储，仅存哈希）
 *   - 双击（同 requestId + 同目标 + 同类别）-> 第二次返回 200，不调用 payload.create
 *   - 限流 -> 429 { ok: false, error: 'rate_limited' } + Retry-After
 *   - 字段错误 -> 422 { ok: false, errors: [...] }，不调用 payload.create
 *   - 非同源 -> 403；非法 Content-Type -> 415；body 过大 -> 413；非法 JSON -> 400
 *   - GET -> 405
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock：getPayload
// ---------------------------------------------------------------------------

const payloadFindMock = vi.fn()
const payloadCreateMock = vi.fn()
const payloadLoggerInfo = vi.fn()
const payloadLoggerError = vi.fn()
const payloadLoggerWarn = vi.fn()

vi.mock('payload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('payload')>()
  return {
    ...actual,
    getPayload: vi.fn(async () => ({
      find: payloadFindMock,
      create: payloadCreateMock,
      logger: {
        info: payloadLoggerInfo,
        error: payloadLoggerError,
        warn: payloadLoggerWarn,
      },
      db: { pool: {} },
    })),
  }
})

// ---------------------------------------------------------------------------
// Mock：@/lib/rate-limit-pg（内存版 RateLimitDeps）
// ---------------------------------------------------------------------------

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
    pruneExpired: async (cutoff: number) => {
      let deleted = 0
      for (const [k, v] of [...inMemoryRateStore]) {
        if (v.windowStart < cutoff) {
          inMemoryRateStore.delete(k)
          deleted++
        }
      }
      return deleted
    },
    countKeys: async () => inMemoryRateStore.size,
    keyExists: async (key: string) => inMemoryRateStore.has(key),
    now: () => Date.now(),
  }),
}))

// ---------------------------------------------------------------------------
// 导入被测对象（在 mock 之后）
// ---------------------------------------------------------------------------

import { POST, GET } from '@/app/(frontend)/api/corrections/route'

// ---------------------------------------------------------------------------
// 辅助构造器
// ---------------------------------------------------------------------------

function makeValidBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    requestId: 'req-001',
    targetType: 'listing',
    targetSlug: 'jingan-center-100-monthly',
    category: 'price',
    description: '价格疑似有误',
    ...overrides,
  }
}

function makeReq(opts: {
  body?: unknown
  method?: string
  headers?: Record<string, string>
}): Request {
  const { body, method = 'POST', headers = {} } = opts
  const init: RequestInit = {
    method,
    headers: {
      'content-type': 'application/json',
      host: 'localhost:3717',
      'x-forwarded-for': '1.2.3.4',
      ...headers,
    },
  }
  if (body !== undefined) {
    if (typeof body === 'string') {
      init.body = body
    } else {
      init.body = JSON.stringify(body)
    }
  }
  return new Request('http://localhost:3717/api/corrections', init)
}

async function run(req: Request): Promise<{ status: number; body: any; headers: Headers }> {
  const res = await POST(req)
  const json = await res.json().catch(() => ({}))
  return { status: res.status, body: json, headers: res.headers }
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

beforeEach(() => {
  payloadFindMock.mockReset()
  payloadCreateMock.mockReset()
  payloadLoggerInfo.mockReset()
  payloadLoggerError.mockReset()
  payloadLoggerWarn.mockReset()
  inMemoryRateStore.clear()
})

// ---------------------------------------------------------------------------
// 正常提交
// ---------------------------------------------------------------------------

describe('POST /api/corrections / 正常提交', () => {
  it('合法 body -> 200 { ok: true }', async () => {
    payloadFindMock.mockResolvedValue({ docs: [] })
    payloadCreateMock.mockResolvedValue({ id: 1 })

    const r = await run(makeReq({ body: makeValidBody() }))
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ ok: true })
  })

  it('调用 payload.create 一次', async () => {
    payloadFindMock.mockResolvedValue({ docs: [] })
    payloadCreateMock.mockResolvedValue({ id: 1 })

    await run(makeReq({ body: makeValidBody() }))
    expect(payloadCreateMock).toHaveBeenCalledTimes(1)
  })

  it('不暴露记录 ID', async () => {
    payloadFindMock.mockResolvedValue({ docs: [] })
    payloadCreateMock.mockResolvedValue({ id: 999 })

    const r = await run(makeReq({ body: makeValidBody() }))
    expect(r.status).toBe(200)
    expect(JSON.stringify(r.body)).not.toContain('999')
  })

  it('响应和日志不暴露提交人标识（原始 IP 不进日志/存储）', async () => {
    payloadFindMock.mockResolvedValue({ docs: [] })
    payloadCreateMock.mockResolvedValue({ id: 1 })

    const r = await run(makeReq({
      body: makeValidBody(),
      headers: { 'x-forwarded-for': '138.1.1.1' },
    }))

    expect(r.body).toEqual({ ok: true })
    // 原始 IP 不得进入日志或持久化数据
    expect(JSON.stringify(payloadLoggerInfo.mock.calls)).not.toContain('138.1.1.1')
    expect(JSON.stringify(payloadLoggerWarn.mock.calls)).not.toContain('138.1.1.1')
    expect(JSON.stringify(payloadCreateMock.mock.calls)).not.toContain('138.1.1.1')
  })

  it('持久化 reporterIpHash 为哈希而非原始 IP', async () => {
    payloadFindMock.mockResolvedValue({ docs: [] })
    payloadCreateMock.mockResolvedValue({ id: 1 })

    await run(makeReq({
      body: makeValidBody(),
      headers: { 'x-forwarded-for': '138.1.1.1' },
    }))

    expect(payloadCreateMock).toHaveBeenCalledWith(expect.objectContaining({
      collection: 'information-corrections',
      data: expect.objectContaining({
        reporterIpHash: expect.stringMatching(/^[0-9a-f]{32}$/),
        status: 'new',
        category: 'price',
        targetType: 'listing',
        targetSlug: 'jingan-center-100-monthly',
        requestId: 'req-001',
        idempotencyKey: expect.any(String),
      }),
    }))
  })
})

// ---------------------------------------------------------------------------
// 幂等
// ---------------------------------------------------------------------------

describe('POST /api/corrections / 幂等', () => {
  it('同 requestId + 同目标 + 同类别 -> 第二次返回 200，不调 create', async () => {
    payloadFindMock.mockResolvedValue({ docs: [{ id: 7 }] })
    payloadCreateMock.mockResolvedValue({ id: 7 })

    const r = await run(makeReq({ body: makeValidBody() }))
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ ok: true })
    expect(payloadCreateMock).not.toHaveBeenCalled()
  })

  it('幂等命中也记日志且不暴露 ID', async () => {
    payloadFindMock.mockResolvedValue({ docs: [{ id: 7 }] })

    await run(makeReq({ body: makeValidBody() }))
    // 幂等日志不含记录 ID
    expect(JSON.stringify(payloadLoggerInfo.mock.calls)).not.toContain('"id":7')
  })
})

// ---------------------------------------------------------------------------
// 校验失败
// ---------------------------------------------------------------------------

describe('POST /api/corrections / 校验失败', () => {
  it('非法类别 -> 422，不调 create', async () => {
    payloadFindMock.mockResolvedValue({ docs: [] })
    const r = await run(makeReq({ body: makeValidBody({ category: 'phone' }) }))
    expect(r.status).toBe(422)
    expect(r.body.ok).toBe(false)
    expect(payloadCreateMock).not.toHaveBeenCalled()
  })

  it('description 超长 -> 422', async () => {
    payloadFindMock.mockResolvedValue({ docs: [] })
    const r = await run(makeReq({ body: makeValidBody({ description: 'a'.repeat(501) }) }))
    expect(r.status).toBe(422)
  })

  it('非同源 -> 403', async () => {
    payloadFindMock.mockResolvedValue({ docs: [] })
    const r = await run(makeReq({
      body: makeValidBody(),
      headers: { origin: 'https://evil.example.com' },
    }))
    expect(r.status).toBe(403)
    expect(payloadCreateMock).not.toHaveBeenCalled()
  })

  it('非法 Content-Type -> 415', async () => {
    payloadFindMock.mockResolvedValue({ docs: [] })
    const r = await run(makeReq({
      body: 'foo=bar',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    }))
    expect(r.status).toBe(415)
  })

  it('body 过大 -> 413', async () => {
    payloadFindMock.mockResolvedValue({ docs: [] })
    const big = { ...makeValidBody(), description: 'a'.repeat(21 * 1024) }
    const r = await run(makeReq({
      body: big,
      headers: { 'content-length': String(21 * 1024) },
    }))
    expect(r.status).toBe(413)
  })

  it('非法 JSON -> 400', async () => {
    payloadFindMock.mockResolvedValue({ docs: [] })
    const r = await run(makeReq({ body: '{not json' }))
    expect(r.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// 限流
// ---------------------------------------------------------------------------

describe('POST /api/corrections / 限流', () => {
  it('超过配额 -> 429 + Retry-After', async () => {
    payloadFindMock.mockResolvedValue({ docs: [] })
    payloadCreateMock.mockResolvedValue({ id: 1 })

    // 配额 max=3（CORRECTION_RATE_LIMIT_CONFIG），前 3 次 200，第 4 次 429
    for (let i = 0; i < 3; i++) {
      const r = await run(makeReq({ body: makeValidBody({ requestId: `req-${i}` }) }))
      expect(r.status).toBe(200)
    }
    const blocked = await run(makeReq({ body: makeValidBody({ requestId: 'req-3' }) }))
    expect(blocked.status).toBe(429)
    expect(blocked.body).toEqual({ ok: false, error: 'rate_limited' })
    expect(blocked.headers.get('retry-after')).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// 方法
// ---------------------------------------------------------------------------

describe('GET /api/corrections', () => {
  it('-> 405 + Allow: POST', async () => {
    const res = GET()
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('POST')
  })
})
