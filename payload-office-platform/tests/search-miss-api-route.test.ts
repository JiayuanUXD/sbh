/**
 * OPT-126 /api/search-misses 路由集成测（mock Payload / 城市 / 搜索查询 / 限流存储）。
 *
 * 守护不变量：
 *   - 同源（缺 Origin 即拒）、严格 JSON、体积、方法；
 *   - 限流 429 + Retry-After；限流存储异常时放行（failOpen）但仍照常处理；
 *   - 结果数由服务端复核：有结果的词不入库；
 *   - 命中隐私规则的词不入库，日志里没有查询文本；
 *   - 成功与「处理了但不入库」都是 204，无响应体。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const poolQuery = vi.fn(async (_params: { text: string; values: unknown[] }) => ({ rows: [], rowCount: 1 }))
const loggerInfo = vi.fn()
const loggerWarn = vi.fn()
const loggerError = vi.fn()

vi.mock('payload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('payload')>()
  return {
    ...actual,
    getPayload: vi.fn(async () => ({
      logger: { info: loggerInfo, warn: loggerWarn, error: loggerError },
      db: { pool: { query: poolQuery } },
    })),
  }
})

vi.mock('@/payload.config', () => ({ default: {} }))

const resolveCityContext = vi.fn()
vi.mock('@/app/(frontend)/_lib/city-context', () => ({
  resolveCityContext: (slug: unknown) => resolveCityContext(slug),
}))

const listingsQuery = vi.fn()
const buildingsQuery = vi.fn()
const articlesQuery = vi.fn()
vi.mock('@/lib/frontend/cached-queries', () => ({
  getCachedSiteSearchListings: (...args: unknown[]) => listingsQuery(...args),
  getCachedSiteSearchBuildings: (...args: unknown[]) => buildingsQuery(...args),
  getCachedSiteSearchArticles: (...args: unknown[]) => articlesQuery(...args),
}))

// 限流存储：内存版；可切到「不可用」以验证 failOpen。
const rateStore = new Map<string, { count: number; windowStart: number }>()
let rateStoreDown = false
vi.mock('@/lib/rate-limit-pg', () => ({
  createPgRateLimitDeps: () => ({
    acquire: async (key: string, windowStart: number) => {
      if (rateStoreDown) throw new Error('rate store down')
      const existing = rateStore.get(key)
      if (existing && existing.windowStart === windowStart) {
        existing.count += 1
        return { count: existing.count, windowStart }
      }
      rateStore.set(key, { count: 1, windowStart })
      return { count: 1, windowStart }
    },
    pruneExpired: async () => 0,
    countKeys: async () => rateStore.size,
    keyExists: async (key: string) => rateStore.has(key),
    now: () => Date.now(),
  }),
}))

import { DELETE, GET, POST } from '@/app/(frontend)/api/search-misses/route'
import { __resetSearchMissPruneForTests } from '@/app/(frontend)/api/search-misses/prune-state'

const NO_RESULTS = {
  listings: { result: { pagination: { totalDocs: 0 } }, relaxed: false },
  buildings: { result: { totalDocs: 0 } },
  articles: { totalDocs: 0 },
}

function mockResults(r: typeof NO_RESULTS) {
  listingsQuery.mockResolvedValue(r.listings)
  buildingsQuery.mockResolvedValue(r.buildings)
  articlesQuery.mockResolvedValue(r.articles)
}

function makeReq(opts: { body?: unknown; headers?: Record<string, string | null> } = {}): Request {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    host: 'localhost:3726',
    origin: 'http://localhost:3726',
    'x-real-ip': '1.2.3.4',
  }
  for (const [k, v] of Object.entries(opts.headers ?? {})) {
    if (v === null) delete headers[k]
    else headers[k] = v
  }
  const body = opts.body === undefined ? { city: 'shanghai', q: '不存在的词' } : opts.body
  return new Request('http://localhost:3726/api/search-misses', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const upsertCalls = () => poolQuery.mock.calls.filter(([p]) => p.text.includes('INSERT INTO search_miss_terms'))
const pruneCalls = () => poolQuery.mock.calls.filter(([p]) => p.text.includes('DELETE FROM search_miss_terms'))

beforeEach(() => {
  poolQuery.mockClear()
  loggerInfo.mockReset()
  loggerWarn.mockReset()
  loggerError.mockReset()
  rateStore.clear()
  rateStoreDown = false
  __resetSearchMissPruneForTests()
  resolveCityContext.mockReset()
  listingsQuery.mockReset()
  buildingsQuery.mockReset()
  articlesQuery.mockReset()
  resolveCityContext.mockResolvedValue({ slug: 'shanghai', serviceStatus: 'live' })
  mockResults(NO_RESULTS)
})

describe('协议校验', () => {
  it('确实未命中：204 无响应体，执行一次 upsert', async () => {
    const res = await POST(makeReq())
    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')
    const calls = upsertCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0]![0].text).toContain('ON CONFLICT (city, term, miss_kind) DO UPDATE')
    expect(calls[0]![0].text).toContain('count = search_miss_terms.count + 1')
    expect(calls[0]![0].values).toEqual(['shanghai', '不存在的词', 'zero', 0])
  })

  it('非同源 403；缺 Origin 也拒（fail-closed）', async () => {
    expect((await POST(makeReq({ headers: { origin: 'http://evil.example' } }))).status).toBe(403)
    expect((await POST(makeReq({ headers: { origin: null } }))).status).toBe(403)
    expect(upsertCalls()).toHaveLength(0)
  })

  it('非 JSON Content-Type 415', async () => {
    expect((await POST(makeReq({ headers: { 'content-type': 'text/plain' } }))).status).toBe(415)
  })

  it('body 过大 413（声明长度与实际长度两条路径）', async () => {
    expect((await POST(makeReq({ headers: { 'content-length': '999999' } }))).status).toBe(413)
    expect((await POST(makeReq({ body: JSON.stringify({ city: 'shanghai', q: 'x', pad: 'p'.repeat(3000) }) }))).status).toBe(413)
  })

  it('非法 JSON / 缺字段 / q 超长 → 400', async () => {
    expect((await POST(makeReq({ body: '{not json' }))).status).toBe(400)
    expect((await POST(makeReq({ body: { city: 'shanghai' } }))).status).toBe(400)
    expect((await POST(makeReq({ body: { city: 'shanghai', q: 'x'.repeat(201) } }))).status).toBe(400)
    expect(upsertCalls()).toHaveLength(0)
  })

  it('其它方法 405', async () => {
    expect(GET().status).toBe(405)
    expect(DELETE().status).toBe(405)
  })
})

describe('服务端复核与脱敏', () => {
  it('伪造请求体带假计数、对有结果的词发请求：不入库', async () => {
    mockResults({
      listings: { result: { pagination: { totalDocs: 5 } }, relaxed: false },
      buildings: { result: { totalDocs: 1 } },
      articles: { totalDocs: 0 },
    })
    const res = await POST(makeReq({ body: { city: 'shanghai', q: '静安', count: 0, zero_result: true, missKind: 'zero' } }))
    expect(res.status).toBe(204)
    expect(upsertCalls()).toHaveLength(0)
  })

  it('复核用搜索页同一组 cached 查询，且是 page=1、规范城市 slug', async () => {
    await POST(makeReq({ body: { city: 'shanghai', q: '不存在的词' } }))
    expect(listingsQuery).toHaveBeenCalledWith('shanghai', '不存在的词', 1)
    expect(buildingsQuery).toHaveBeenCalledWith('shanghai', '不存在的词', 1)
    expect(articlesQuery).toHaveBeenCalledWith('不存在的词', 1)
  })

  it('未知 / coming-soon 城市：204 不入库，也不查结果', async () => {
    resolveCityContext.mockResolvedValue(null)
    expect((await POST(makeReq())).status).toBe(204)
    resolveCityContext.mockResolvedValue({ slug: 'chengdu', serviceStatus: 'coming-soon' })
    expect((await POST(makeReq())).status).toBe(204)
    expect(upsertCalls()).toHaveLength(0)
    expect(listingsQuery).not.toHaveBeenCalled()
  })

  it.each([
    ['13812345678', 'dropped:digits'],
    ['a@b.com', 'dropped:contact'],
    ['https://x.com', 'dropped:contact'],
    ['字'.repeat(21), 'dropped:too_long'],
  ])('隐私规则命中 %s：204、不入库、日志只有原因枚举', async (q, outcome) => {
    const res = await POST(makeReq({ body: { city: 'shanghai', q } }))
    expect(res.status).toBe(204)
    expect(upsertCalls()).toHaveLength(0)
    expect(loggerInfo).toHaveBeenCalledWith({ outcome }, 'search_miss_outcome')
    const logged = JSON.stringify([loggerInfo.mock.calls, loggerWarn.mock.calls, loggerError.mock.calls])
    expect(logged).not.toContain(q)
  })

  it('入库成功的请求，日志里同样没有查询文本', async () => {
    await POST(makeReq({ body: { city: 'shanghai', q: '不存在的词' } }))
    expect(JSON.stringify(loggerInfo.mock.calls)).not.toContain('不存在的词')
  })
})

describe('限流', () => {
  it('每 IP 每分钟 20 次，第 21 次 429 + Retry-After，且不再 upsert', async () => {
    for (let i = 0; i < 20; i += 1) expect((await POST(makeReq())).status).toBe(204)
    const res = await POST(makeReq())
    expect(res.status).toBe(429)
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect(upsertCalls()).toHaveLength(20)
  })

  it('不同 IP 互不影响；键带 search-miss: 前缀', async () => {
    for (let i = 0; i < 20; i += 1) await POST(makeReq())
    expect((await POST(makeReq({ headers: { 'x-real-ip': '5.6.7.8' } }))).status).toBe(204)
    expect([...rateStore.keys()].every((key) => key.startsWith('search-miss:'))).toBe(true)
  })

  it('限流存储不可用：放行（failOpen）并告警，请求照常处理', async () => {
    rateStoreDown = true
    const res = await POST(makeReq())
    expect(res.status).toBe(204)
    expect(loggerWarn).toHaveBeenCalled()
    expect(upsertCalls()).toHaveLength(1)
  })
})

describe('失败静默', () => {
  it('upsert 抛错：500 + 错误日志，响应无体', async () => {
    poolQuery.mockImplementationOnce(async () => {
      throw new Error('db down')
    })
    // 第一次 query 是限流？限流走 mock deps，不经 pool，所以第一次就是 upsert。
    const res = await POST(makeReq())
    expect(res.status).toBe(500)
    expect(await res.text()).toBe('')
    expect(loggerError).toHaveBeenCalled()
  })
})

describe('保留期清理（请求顺带，§9）', () => {
  it('首个处理的请求触发一次 DELETE，间隔内的后续请求不再触发', async () => {
    expect((await POST(makeReq())).status).toBe(204)
    expect((await POST(makeReq({ body: { city: 'shanghai', q: '另一个词' } }))).status).toBe(204)
    const calls = pruneCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0]![0].values).toEqual([30, 180])
  })

  it('有结果（不入库）的请求同样占用清理窗口，不重复删', async () => {
    mockResults({
      listings: { result: { pagination: { totalDocs: 5 } }, relaxed: false },
      buildings: { result: { totalDocs: 0 } },
      articles: { totalDocs: 0 },
    })
    expect((await POST(makeReq())).status).toBe(204)
    expect(upsertCalls()).toHaveLength(0)
    expect(pruneCalls()).toHaveLength(1)
  })

  it('被拒绝的请求（非同源 / 非法 body / 限流）不触发清理', async () => {
    await POST(makeReq({ headers: { origin: 'http://evil.example' } }))
    await POST(makeReq({ body: '{not json' }))
    expect(pruneCalls()).toHaveLength(0)
  })

  it('DELETE 失败：仍 204，只记 warn，不影响 upsert', async () => {
    poolQuery.mockImplementation(async (params) => {
      if (params.text.includes('DELETE FROM search_miss_terms')) throw new Error('boom')
      return { rows: [], rowCount: 1 }
    })
    try {
      const res = await POST(makeReq())
      expect(res.status).toBe(204)
      expect(upsertCalls()).toHaveLength(1)
      expect(loggerWarn).toHaveBeenCalledWith(expect.anything(), 'search_miss_prune_failed')
      expect(loggerError).not.toHaveBeenCalled()
    } finally {
      poolQuery.mockImplementation(async () => ({ rows: [], rowCount: 1 }))
    }
  })
})
