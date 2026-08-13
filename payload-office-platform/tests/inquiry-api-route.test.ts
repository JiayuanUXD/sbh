/**
 * F5.7 验收：/api/inquiries 路由集成测（mock Payload）
 *
 * 设计依据：specs/frontend-mvp/design.md §10 / §12.2 / §13、FP-05 §5 / §6 / §9
 *           specs/frontend-mvp/tasks/F5-inquiry.md 5.3–5.7
 *
 * 守护不变量：
 *   - 正常提交 → 200 { ok: true }，调用 payload.create 一次
 *   - 字段错误 → 422 { ok: false, errors: [...] }，不调用 payload.create
 *   - 双击（同 requestId + 同手机号 + 同目标）→ 第二次返回 200，不调用 payload.create
 *   - 失效房源 → 409 { ok: false, error: 'listing_not_found' }，不调用 payload.create
 *   - 限流 → 429 { ok: false, error: 'rate_limited' } + Retry-After
 *   - 服务失败 → 500 { ok: false, error: 'server_error' }
 *   - 非同源 → 403 { ok: false, error: 'forbidden' }
 *   - 非法 Content-Type → 415
 *   - 非法 JSON → 400
 *   - body 过大 → 413
 *   - GET → 405
 *   - 不暴露 Lead ID、内部错误或房源失效原因
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock：getPayload / assertEffectiveListing
//
// 注意：`payload` 模块的 buildConfig 等具名导出仍需保留（payload.config.ts 引用），
// 因此使用 importOriginal 部分 mock，仅覆盖 getPayload。
// ---------------------------------------------------------------------------

const payloadFindMock = vi.fn()
const payloadCreateMock = vi.fn()
const payloadFindGlobalMock = vi.fn()
const payloadLoggerInfo = vi.fn()
const payloadLoggerError = vi.fn()
const payloadLoggerWarn = vi.fn()
const resolveCityContextMock = vi.fn()

vi.mock('@/app/(frontend)/_lib/city-context', () => ({
  resolveCityContext: (slug: unknown) => resolveCityContextMock(slug),
}))

vi.mock('payload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('payload')>()
  return {
    ...actual,
    getPayload: vi.fn(async () => ({
      find: payloadFindMock,
      create: payloadCreateMock,
      findGlobal: payloadFindGlobalMock,
      logger: {
        info: payloadLoggerInfo,
        error: payloadLoggerError,
        warn: payloadLoggerWarn,
      },
      // OPT-017：route.ts 通过 payload.db.pool 拿 PG pool 构造限流依赖。
      // 测试中 createPgRateLimitDeps 已被 mock，pool 实参不会被使用，
      // 但属性访问 (payload.db).pool 在调用前求值，故提供占位避免 TypeError。
      db: { pool: {} },
    })),
  }
})

const assertEffectiveListingMock = vi.fn()
const assertEffectiveBuildingMock = vi.fn()
const createSearchContextMock = vi.fn((city: string) => ({
  asOf: new Date('2026-07-25T00:00:00Z').toISOString(),
  timezone: 'Asia/Shanghai' as const,
  channel: 'public-web' as const,
  city,
}))
vi.mock('@/domain/public-catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/domain/public-catalog')>()
  return {
    ...actual,
    assertEffectiveListing: (...args: unknown[]) => assertEffectiveListingMock(...args),
    assertEffectiveBuilding: (...args: unknown[]) => assertEffectiveBuildingMock(...args),
    createSearchContext: (city: string) => createSearchContextMock(city),
  }
})

// ---------------------------------------------------------------------------
// Mock：@/lib/rate-limit-pg
//
// OPT-017 后路由改用 PG 分布式限流（inquiry_rate_limit 表）。
// 测试不连真实 PG，注入内存版 RateLimitDeps：用 Map 模拟原子递增 + TTL 清理。
// route.ts 调用 createPgRateLimitDeps(payload.db.pool) 时 payload.db 在 mock 中
// 不存在，但因 createPgRateLimitDeps 已被此 mock 替换，pool 参数被忽略。
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

import { POST, GET } from '@/app/api/inquiries/route'
import {
  __resetRateStoreForTests,
  ratePruneRef,
} from '@/app/api/inquiries/rate-limit-state'
import { PRIVACY_POLICY_VERSION, siteConfig } from '@/lib/frontend/site-config'

// ---------------------------------------------------------------------------
// 辅助构造器
// ---------------------------------------------------------------------------

function makeValidBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    requestId: 'req-001',
    city: siteConfig.defaultCity,
    name: '张三',
    phone: '13800001111',
    company: 'ACME',
    message: '想约看',
    listingSlug: 'jingan-center-100-monthly',
    demand: { district: '静安', budget: '1-2 万', area: '100 ㎡', moveInTime: '9 月' },
    consent: { accepted: true, policyVersion: PRIVACY_POLICY_VERSION },
    source: {
      pageType: 'listing',
      path: '/listings/jingan-center-100-monthly',
      campaign: { utm_source: 'baidu', utm_medium: 'cpc' },
    },
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
  return new Request('http://localhost:3717/api/inquiries', init)
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
  payloadFindGlobalMock.mockReset()
  payloadLoggerInfo.mockReset()
  payloadLoggerError.mockReset()
  payloadLoggerWarn.mockReset()
  resolveCityContextMock.mockReset()
  resolveCityContextMock.mockImplementation(async (slug: unknown) =>
    slug === 'hangzhou'
      ? { id: 17, slug: 'hangzhou', name: '杭州市', serviceStatus: 'live', profile: {} }
      : slug === siteConfig.defaultCity
        ? { id: 1, slug: siteConfig.defaultCity, name: '上海市', serviceStatus: 'live', profile: {} }
        : null,
  )
  assertEffectiveListingMock.mockReset()
  assertEffectiveBuildingMock.mockReset()
  createSearchContextMock.mockClear()
  inMemoryRateStore.clear()
  __resetRateStoreForTests()
})

it('测试重置会清空询盘限流的跨请求清理时间戳', () => {
  ratePruneRef.value = 123

  __resetRateStoreForTests()

  expect(ratePruneRef.value).toBe(0)
})

// ---------------------------------------------------------------------------
// 正常提交
// ---------------------------------------------------------------------------

describe('POST /api/inquiries / 正常提交', () => {
  it('persists the trusted city relationship ID resolved from the submitted slug', async () => {
    payloadFindMock.mockResolvedValue({ docs: [] })
    payloadCreateMock.mockResolvedValue({ id: 1 })
    assertEffectiveListingMock.mockResolvedValue({ id: 1001 })

    const r = await run(makeReq({ body: makeValidBody({ city: 'hangzhou' }) }))

    expect(r.status).toBe(200)
    expect(resolveCityContextMock).toHaveBeenCalledWith('hangzhou')
    expect(payloadCreateMock.mock.calls[0][0].data.city).toBe(17)
    expect(createSearchContextMock).toHaveBeenCalledWith('hangzhou')
  })

  it('rejects an unknown explicit city before persistence', async () => {
    const r = await run(makeReq({ body: makeValidBody({ city: 'unknown-city' }) }))

    expect(r.status).toBe(422)
    expect(r.body).toEqual({ ok: false, errors: ['city_invalid'] })
    expect(payloadCreateMock).not.toHaveBeenCalled()
  })

  it('defaults a missing city only for the approved legacy entrust source path', async () => {
    payloadFindMock.mockResolvedValue({ docs: [] })
    payloadCreateMock.mockResolvedValue({ id: 1 })
    const body = makeValidBody({
      source: { pageType: 'entrust', path: '/entrust' },
    })
    delete body.city
    delete body.listingSlug

    const r = await run(makeReq({ body }))

    expect(r.status).toBe(200)
    expect(resolveCityContextMock).toHaveBeenCalledWith(siteConfig.defaultCity)
    expect(payloadCreateMock.mock.calls[0][0].data.city).toBe(1)
  })

  it('derives a trusted city from an existing prefixed inquiry source path when the old modal omits city', async () => {
    payloadFindMock.mockResolvedValue({ docs: [] })
    payloadCreateMock.mockResolvedValue({ id: 1 })
    const body = makeValidBody({
      source: { pageType: 'search', path: '/hangzhou/listings' },
    })
    delete body.city
    delete body.listingSlug

    const r = await run(makeReq({ body }))

    expect(r.status).toBe(200)
    expect(resolveCityContextMock).toHaveBeenCalledWith('hangzhou')
    expect(payloadCreateMock.mock.calls[0][0].data.city).toBe(17)
  })



  it('合法 body → 200 { ok: true }', async () => {
    payloadFindMock.mockResolvedValue({ docs: [] })
    payloadCreateMock.mockResolvedValue({ id: 1 })
    assertEffectiveListingMock.mockResolvedValue({ id: 1001 })

    const r = await run(makeReq({ body: makeValidBody() }))
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ ok: true, targetResolution: 'listing' })
  })

  it('调用 payload.create 一次', async () => {
    payloadFindMock.mockResolvedValue({ docs: [] })
    payloadCreateMock.mockResolvedValue({ id: 1 })
    assertEffectiveListingMock.mockResolvedValue({ id: 1001 })

    await run(makeReq({ body: makeValidBody() }))
    expect(payloadCreateMock).toHaveBeenCalledTimes(1)
  })

  it('用显式默认城市上下文复核询盘目标有效供给', async () => {
    payloadFindMock.mockResolvedValue({ docs: [] })
    payloadCreateMock.mockResolvedValue({ id: 1 })
    assertEffectiveListingMock.mockResolvedValue({ id: 1001 })

    await run(makeReq({ body: makeValidBody() }))

    expect(createSearchContextMock).toHaveBeenCalledWith(siteConfig.defaultCity)
    expect(assertEffectiveListingMock).toHaveBeenCalledWith(
      'jingan-center-100-monthly',
      expect.objectContaining({ city: siteConfig.defaultCity }),
    )
  })

  it('Lead 数据包含完整询盘上下文', async () => {
    payloadFindMock.mockResolvedValue({ docs: [] })
    payloadCreateMock.mockResolvedValue({ id: 1 })
    assertEffectiveListingMock.mockResolvedValue({ id: 1001 })

    await run(makeReq({ body: makeValidBody() }))
    expect(payloadCreateMock).toHaveBeenCalledWith({
      collection: 'leads',
      data: expect.objectContaining({
        name: '张三',
        phone: '13800001111',
        company: 'ACME',
        status: 'new',
        source: 'frontend-form',
        idempotencyKey: expect.any(String),
        sourcePageType: 'listing',
        sourcePath: '/listings/jingan-center-100-monthly',
        targetType: 'listing',
        targetListingSlug: 'jingan-center-100-monthly',
        consentAccepted: true,
        consentPolicyVersion: PRIVACY_POLICY_VERSION,
        requestId: 'req-001',
      }),
    })
  })

  it('source query/hash 中的手机号不会进入持久化或日志', async () => {
    const injectedPhone = '13900009999'
    payloadFindMock.mockResolvedValue({ docs: [] })
    payloadCreateMock.mockResolvedValue({ id: 1 })
    assertEffectiveListingMock.mockResolvedValue({ id: 1001 })

    const r = await run(makeReq({
      body: makeValidBody({
        source: {
          pageType: 'listing',
          path: `/listings/jingan-center-100-monthly?phone=${injectedPhone}#contact=${injectedPhone}`,
          campaign: {},
        },
      }),
    }))

    expect(r.status).toBe(200)
    expect(payloadCreateMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        sourcePath: '/listings/jingan-center-100-monthly',
        sourceUrl: expect.stringMatching(/\/listings\/jingan-center-100-monthly$/),
      }),
    }))
    expect(JSON.stringify(payloadCreateMock.mock.calls)).not.toContain(injectedPhone)
    expect(JSON.stringify(payloadLoggerInfo.mock.calls)).not.toContain(injectedPhone)
  })

  it('仅持久化白名单详情上下文和非权威价格快照', async () => {
    payloadFindMock.mockResolvedValue({ docs: [] })
    payloadCreateMock.mockResolvedValue({ id: 1 })
    assertEffectiveListingMock.mockResolvedValue({ id: 1001 })

    await run(makeReq({ body: makeValidBody({
      activeSupplyGroup: 'lease',
      priceSnapshot: { amount: 8.5, currency: 'CNY', period: 'day', unit: 'rmb-sqm-day' },
      source: {
        pageType: 'listing',
        path: '/listings/jingan-center-100-monthly',
        section: 'sticky-card',
        currentFilters: { group: 'lease', priceUnit: 'rmb-sqm-day' },
      },
    }) }))

    expect(payloadCreateMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        sourceSection: 'sticky-card',
        activeSupplyGroup: 'lease',
        currentFilters: { group: 'lease', priceUnit: 'rmb-sqm-day' },
        priceSnapshot: { amount: 8.5, currency: 'CNY', period: 'day', unit: 'rmb-sqm-day' },
        priceSnapshotSubmittedAt: expect.any(String),
      }),
    }))
  })

  it('通用需求（无 listingSlug）→ 不调用 assertEffectiveListing', async () => {
    payloadFindMock.mockResolvedValue({ docs: [] })
    payloadCreateMock.mockResolvedValue({ id: 1 })

    const body = makeValidBody()
    delete (body as Record<string, unknown>).listingSlug
    await run(makeReq({ body }))
    expect(assertEffectiveListingMock).not.toHaveBeenCalled()
  })

  it('响应不暴露 Lead ID', async () => {
    payloadFindMock.mockResolvedValue({ docs: [] })
    payloadCreateMock.mockResolvedValue({ id: 99999 })
    assertEffectiveListingMock.mockResolvedValue({ id: 1001 })

    const r = await run(makeReq({ body: makeValidBody() }))
    expect(r.body).toEqual({ ok: true, targetResolution: 'listing' })
    expect(JSON.stringify(r.body)).not.toContain('99999')
  })
})

// ---------------------------------------------------------------------------
// 字段错误
// ---------------------------------------------------------------------------

describe('POST /api/inquiries / 字段错误', () => {
  it('name 缺失 → 422 errors 含 name_required', async () => {
    const body = makeValidBody()
    delete (body as Record<string, unknown>).name
    const r = await run(makeReq({ body }))
    expect(r.status).toBe(422)
    expect(r.body.ok).toBe(false)
    expect(Array.isArray(r.body.errors)).toBe(true)
    expect(r.body.errors).toContain('name_required')
    expect(payloadCreateMock).not.toHaveBeenCalled()
  })

  it('非法手机号 → 422 phone_invalid', async () => {
    const body = makeValidBody({ phone: '123' })
    const r = await run(makeReq({ body }))
    expect(r.status).toBe(422)
    expect(r.body.errors).toContain('phone_invalid')
  })

  it('consent.accepted=false → 422 consent_required', async () => {
    const body = makeValidBody({ consent: { accepted: false, policyVersion: PRIVACY_POLICY_VERSION } })
    const r = await run(makeReq({ body }))
    expect(r.status).toBe(422)
    expect(r.body.errors).toContain('consent_required')
  })

  it('consent.policyVersion 不匹配 → 422 consent_version_invalid', async () => {
    const body = makeValidBody({
      consent: { accepted: true, policyVersion: 'OLD-V1' },
    })
    const r = await run(makeReq({ body }))
    expect(r.status).toBe(422)
    expect(r.body.errors).toContain('consent_version_invalid')
  })

  it('source.pageType 非法 → 422 source_page_type_invalid', async () => {
    const body = makeValidBody({
      source: { pageType: 'unknown', path: '/x', campaign: {} },
    })
    const r = await run(makeReq({ body }))
    expect(r.status).toBe(422)
    expect(r.body.errors).toContain('source_page_type_invalid')
  })

  it('source 注入未知嵌套字段 → 422 且响应、错误和日志不含 PII 形状值', async () => {
    const injectedPii = '李四13900009999'
    const r = await run(makeReq({
      body: makeValidBody({
        source: {
          pageType: 'listing',
          path: '/listings/jingan-center-100-monthly',
          campaign: {},
          injected: { profile: { contact: injectedPii } },
        },
      }),
    }))

    expect(r.status).toBe(422)
    expect(r.body.errors).toContain('source_invalid')
    expect(JSON.stringify(r.body)).not.toContain(injectedPii)
    expect(JSON.stringify(payloadLoggerInfo.mock.calls)).not.toContain(injectedPii)
    expect(JSON.stringify(payloadLoggerError.mock.calls)).not.toContain(injectedPii)
    expect(payloadCreateMock).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 双击 / 幂等
// ---------------------------------------------------------------------------

describe('POST /api/inquiries / 幂等', () => {
  it('does not change the persisted city when an idempotent replay submits another valid city', async () => {
    payloadFindMock.mockResolvedValueOnce({ docs: [{ id: 1, targetType: 'listing', city: 1 }] })

    const r = await run(makeReq({ body: makeValidBody({ city: 'hangzhou' }) }))

    expect(r.status).toBe(200)
    expect(resolveCityContextMock).toHaveBeenCalledWith('hangzhou')
    expect(payloadCreateMock).not.toHaveBeenCalled()
  })

  it('第二次同 requestId + 同手机号 + 同目标 → 200，不调用 payload.create', async () => {
    // 第一次：找不到既有 Lead，创建新 Lead
    payloadFindMock.mockResolvedValueOnce({ docs: [] })
    payloadCreateMock.mockResolvedValueOnce({ id: 1 })
    assertEffectiveListingMock.mockResolvedValue({ id: 1001 })

    const body = makeValidBody()
    const req1 = makeReq({ body })
    const r1 = await run(req1)
    expect(r1.status).toBe(200)
    expect(payloadCreateMock).toHaveBeenCalledTimes(1)

    // 第二次：找到既有 Lead（幂等命中），不再创建
    payloadFindMock.mockResolvedValueOnce({ docs: [{ id: 1, targetType: 'listing' }] })
    const req2 = makeReq({ body }) // 相同 requestId + phone + target
    const r2 = await run(req2)
    expect(r2.status).toBe(200)
    expect(r2.body).toEqual({ ok: true, targetResolution: 'listing' })
    expect(payloadCreateMock).toHaveBeenCalledTimes(1) // 仍然只调用一次
  })

  it('幂等命中时记录 inquiry_idempotent_hit 日志', async () => {
    payloadFindMock.mockResolvedValueOnce({ docs: [{ id: 1 }] })
    await run(makeReq({ body: makeValidBody() }))
    expect(payloadLoggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ idempotent: true }),
      'inquiry_idempotent_hit',
    )
  })

  it('幂等命中不调用 assertEffectiveListing（短路）', async () => {
    payloadFindMock.mockResolvedValueOnce({ docs: [{ id: 1 }] })
    await run(makeReq({ body: makeValidBody() }))
    expect(assertEffectiveListingMock).not.toHaveBeenCalled()
  })

  it('两个并发首提发生唯一约束竞争时都返回首次成功语义且只创建一条 Lead', async () => {
    let leadFindCount = 0
    let persistedLeadCount = 0
    payloadFindMock.mockImplementation(async (args: { collection?: string }) => {
      if (args.collection !== 'leads') return { docs: [] }
      leadFindCount += 1
      return leadFindCount <= 2
        ? { docs: [] }
        : { docs: [{ id: 1, targetType: 'listing' }] }
    })
    payloadCreateMock
      .mockImplementationOnce(async () => {
        persistedLeadCount += 1
        return { id: 1 }
      })
      .mockRejectedValueOnce(Object.assign(new Error('duplicate key'), {
        code: '23505',
        constraint: 'leads_idempotency_key_idx',
      }))
    assertEffectiveListingMock.mockResolvedValue({ id: 1001 })

    const body = makeValidBody()
    const [first, second] = await Promise.all([
      run(makeReq({ body })),
      run(makeReq({ body })),
    ])

    expect([first.status, second.status]).toEqual([200, 200])
    expect(first.body).toEqual({ ok: true, targetResolution: 'listing' })
    expect(second.body).toEqual({ ok: true, targetResolution: 'listing' })
    expect(payloadCreateMock).toHaveBeenCalledTimes(2)
    expect(persistedLeadCount).toBe(1)
    expect(payloadFindMock).toHaveBeenCalledTimes(3)
    expect(payloadLoggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ idempotent: true }),
      'inquiry_idempotent_hit',
    )
  })
})

// ---------------------------------------------------------------------------
// 失效房源
// ---------------------------------------------------------------------------

describe('POST /api/inquiries / 失效房源', () => {
  it('房源失效但楼盘仍有效时创建楼盘需求', async () => {
    payloadFindMock.mockImplementation(async (args: { collection?: string }) =>
      args.collection === 'listings'
        ? { docs: [{ building: { slug: 'bund-soho' } }] }
        : { docs: [] },
    )
    assertEffectiveListingMock.mockResolvedValue(null)
    assertEffectiveBuildingMock.mockResolvedValue({ id: 88, slug: 'bund-soho' })

    const r = await run(makeReq({
      body: makeValidBody({ listingSlug: 'expired', buildingSlug: 'bund-soho' }),
    }))
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ ok: true, targetResolution: 'building' })
    expect(payloadCreateMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        targetType: 'building',
        targetListingSlug: null,
        targetBuildingSlug: 'bund-soho',
        interestedListing: undefined,
      }),
    }))
  })

  it('房源和楼盘均失效时创建通用需求', async () => {
    payloadFindMock.mockImplementation(async (args: { collection?: string }) =>
      args.collection === 'listings'
        ? { docs: [{ building: { slug: 'bund-soho' } }] }
        : { docs: [] },
    )
    assertEffectiveListingMock.mockResolvedValue(null)
    assertEffectiveBuildingMock.mockResolvedValue(null)
    payloadCreateMock.mockResolvedValue({ id: 1 })

    const r = await run(makeReq({
      body: makeValidBody({ listingSlug: 'expired', buildingSlug: 'bund-soho' }),
    }))
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ ok: true, targetResolution: 'general' })
    expect(payloadCreateMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        targetType: 'none',
        targetListingSlug: null,
        targetBuildingSlug: null,
        interestedListing: undefined,
      }),
    }))
  })

  it('房源失效时忽略客户端伪造的楼盘 slug，降级为通用需求', async () => {
    payloadFindMock.mockImplementation(async (args: { collection?: string }) =>
      args.collection === 'listings'
        ? { docs: [{ building: { slug: 'real-building' } }] }
        : { docs: [] },
    )
    payloadCreateMock.mockResolvedValue({ id: 1 })
    assertEffectiveListingMock.mockResolvedValue(null)

    const r = await run(makeReq({
      body: makeValidBody({
        listingSlug: 'expired',
        buildingSlug: 'forged-building',
      }),
    }))

    expect(r.status).toBe(200)
    expect(r.body).toEqual({ ok: true, targetResolution: 'general' })
    expect(assertEffectiveBuildingMock).not.toHaveBeenCalled()
    expect(payloadCreateMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        targetType: 'none',
        targetBuildingSlug: null,
      }),
    }))
  })

  it('目标降级日志不包含价格、筛选、姓名、手机号或备注', async () => {
    payloadFindMock.mockImplementation(async (args: { collection?: string }) =>
      args.collection === 'listings'
        ? { docs: [{ building: { slug: 'bund-soho' } }] }
        : { docs: [] },
    )
    assertEffectiveListingMock.mockResolvedValue(null)
    assertEffectiveBuildingMock.mockResolvedValue({ id: 88, slug: 'bund-soho' })
    payloadCreateMock.mockResolvedValue({ id: 1 })

    await run(makeReq({ body: makeValidBody({
      listingSlug: 'expired',
      buildingSlug: 'bund-soho',
      name: '赵敏',
      phone: '13900002222',
      message: '请回电',
      activeSupplyGroup: 'lease',
      priceSnapshot: { amount: 8.5, currency: 'CNY', period: 'day', unit: 'rmb-sqm-day' },
      source: {
        pageType: 'building',
        path: '/buildings/bund-soho',
        section: 'supply-lease',
        currentFilters: { group: 'lease', priceUnit: 'rmb-sqm-day' },
      },
    }) }))
    expect(payloadLoggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        hasPriceSnapshot: true,
        section: 'supply-lease',
        targetResolution: 'building',
      }),
      'inquiry_success',
    )
    const logCall = payloadLoggerInfo.mock.calls.find((c) => c[1] === 'inquiry_success')
    expect(logCall).toBeTruthy()
    expect(JSON.stringify(logCall?.[0])).not.toContain('8.5')
    expect(JSON.stringify(logCall?.[0])).not.toContain('rmb-sqm-day')
    expect(JSON.stringify(logCall?.[0])).not.toContain('赵敏')
    expect(JSON.stringify(logCall?.[0])).not.toContain('13900002222')
    expect(JSON.stringify(logCall?.[0])).not.toContain('请回电')
  })
})

// ---------------------------------------------------------------------------
// 限流
// ---------------------------------------------------------------------------

describe('POST /api/inquiries / 限流', () => {
  it('超过 5 次/分钟 → 429 rate_limited + Retry-After', async () => {
    payloadFindMock.mockResolvedValue({ docs: [] })
    payloadCreateMock.mockResolvedValue({ id: 1 })
    assertEffectiveListingMock.mockResolvedValue({ id: 1001 })

    // 用不同 requestId 避免被幂等拦截
    const baseBody = makeValidBody()
    for (let i = 0; i < 5; i++) {
      const r = await run(
        makeReq({
          body: { ...baseBody, requestId: `req-${i}` },
          headers: { 'x-forwarded-for': '7.7.7.7' },
        }),
      )
      expect(r.status).toBe(200)
    }

    // 第 6 次：限流
    const r6 = await run(
      makeReq({
        body: { ...baseBody, requestId: 'req-6' },
        headers: { 'x-forwarded-for': '7.7.7.7' },
      }),
    )
    expect(r6.status).toBe(429)
    expect(r6.body).toEqual({ ok: false, error: 'rate_limited' })
    expect(r6.headers.get('Retry-After')).toBeTruthy()
    const retryAfter = Number(r6.headers.get('Retry-After'))
    expect(retryAfter).toBeGreaterThan(0)
  })

  it('不同 IP 互不影响', async () => {
    payloadFindMock.mockResolvedValue({ docs: [] })
    payloadCreateMock.mockResolvedValue({ id: 1 })
    assertEffectiveListingMock.mockResolvedValue({ id: 1001 })

    const baseBody = makeValidBody()
    // IP-A 用尽 5 次配额
    for (let i = 0; i < 5; i++) {
      await run(
        makeReq({
          body: { ...baseBody, requestId: `req-a-${i}` },
          headers: { 'x-forwarded-for': '8.8.8.8' },
        }),
      )
    }
    // IP-B 仍可提交
    const r = await run(
      makeReq({
        body: { ...baseBody, requestId: 'req-b-0' },
        headers: { 'x-forwarded-for': '9.9.9.9' },
      }),
    )
    expect(r.status).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// 服务失败
// ---------------------------------------------------------------------------

describe('POST /api/inquiries / 服务失败', () => {
  it('payload.create 抛错 → 500 server_error', async () => {
    payloadFindMock.mockResolvedValue({ docs: [] })
    payloadCreateMock.mockRejectedValue(new Error('DB down'))
    assertEffectiveListingMock.mockResolvedValue({ id: 1001 })

    const r = await run(makeReq({ body: makeValidBody() }))
    expect(r.status).toBe(500)
    expect(r.body).toEqual({ ok: false, error: 'server_error' })
  })

  it('服务失败时记录 inquiry_error 日志', async () => {
    payloadFindMock.mockResolvedValue({ docs: [] })
    payloadCreateMock.mockRejectedValue(new Error('DB down'))
    assertEffectiveListingMock.mockResolvedValue({ id: 1001 })

    await run(makeReq({ body: makeValidBody() }))
    expect(payloadLoggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'server_error' }),
      'inquiry_error',
    )
    expect(payloadLoggerError).toHaveBeenCalled()
  })

  it('不暴露内部错误信息', async () => {
    payloadFindMock.mockResolvedValue({ docs: [] })
    payloadCreateMock.mockRejectedValue(new Error('DB connection refused at 10.0.0.1:5432'))
    assertEffectiveListingMock.mockResolvedValue({ id: 1001 })

    const r = await run(makeReq({ body: makeValidBody() }))
    const json = JSON.stringify(r.body)
    expect(json).not.toContain('DB connection refused')
    expect(json).not.toContain('10.0.0.1')
    expect(json).not.toContain('5432')
  })
})

// ---------------------------------------------------------------------------
// 同源 / Content-Type / body 大小
// ---------------------------------------------------------------------------

describe('POST /api/inquiries / 安全边界', () => {
  it('非同源 → 403 forbidden', async () => {
    const r = await run(
      makeReq({
        body: makeValidBody(),
        headers: { origin: 'https://evil.example.com' },
      }),
    )
    expect(r.status).toBe(403)
    expect(r.body).toEqual({ ok: false, error: 'forbidden' })
  })

  it('非 JSON Content-Type → 415', async () => {
    const r = await run(
      makeReq({
        body: 'name=value',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      }),
    )
    expect(r.status).toBe(415)
  })

  it('非法 JSON → 400 invalid_json', async () => {
    const r = await run(
      makeReq({
        body: '{not valid json',
        headers: { 'content-type': 'application/json' },
      }),
    )
    expect(r.status).toBe(400)
    expect(r.body.errors).toContain('invalid_json')
  })

  it('body 过大（content-length）→ 413', async () => {
    const r = await run(
      makeReq({
        body: makeValidBody(),
        headers: { 'content-length': String(20 * 1024) },
      }),
    )
    expect(r.status).toBe(413)
    expect(r.body.errors).toContain('body_too_large')
  })
})

// ---------------------------------------------------------------------------
// GET 方法禁止
// ---------------------------------------------------------------------------

describe('GET /api/inquiries / 方法禁止', () => {
  it('GET → 405 method_not_allowed', async () => {
    const res = GET()
    const json = await res.json()
    expect(res.status).toBe(405)
    expect(json).toEqual({ ok: false, error: 'method_not_allowed' })
  })
})

// ---------------------------------------------------------------------------
// 成功日志记录
// ---------------------------------------------------------------------------

describe('POST /api/inquiries / 日志记录', () => {
  it('成功时记录 inquiry_success 日志', async () => {
    payloadFindMock.mockResolvedValue({ docs: [] })
    payloadCreateMock.mockResolvedValue({ id: 1 })
    assertEffectiveListingMock.mockResolvedValue({ id: 1001 })

    await run(makeReq({ body: makeValidBody() }))
    expect(payloadLoggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotent: false,
        errorCode: null,
      }),
      'inquiry_success',
    )
  })

  it('日志不包含完整手机号', async () => {
    payloadFindMock.mockResolvedValue({ docs: [] })
    payloadCreateMock.mockResolvedValue({ id: 1 })
    assertEffectiveListingMock.mockResolvedValue({ id: 1001 })

    await run(makeReq({ body: makeValidBody() }))
    const logCall = payloadLoggerInfo.mock.calls.find(
      (c) => c[1] === 'inquiry_success',
    )
    expect(logCall).toBeTruthy()
    if (logCall) {
      const entry = logCall[0] as Record<string, unknown>
      const json = JSON.stringify(entry)
      expect(json).not.toContain('13800001111')
      expect(entry.phoneMasked).toBe('138****1111')
    }
  })

  it('日志不包含姓名/留言正文', async () => {
    payloadFindMock.mockResolvedValue({ docs: [] })
    payloadCreateMock.mockResolvedValue({ id: 1 })
    assertEffectiveListingMock.mockResolvedValue({ id: 1001 })

    await run(makeReq({ body: makeValidBody() }))
    const logCall = payloadLoggerInfo.mock.calls.find(
      (c) => c[1] === 'inquiry_success',
    )
    expect(logCall).toBeTruthy()
    if (logCall) {
      const json = JSON.stringify(logCall[0])
      expect(json).not.toContain('张三')
      expect(json).not.toContain('想约看')
    }
  })
})

// ---------------------------------------------------------------------------
// P2 Task 4：偏好看房时段（服务端复核）
// ---------------------------------------------------------------------------

import { buildViewingSlots } from '@/domain/inquiry/viewing-slots'
import type { ServiceSchedule } from '@/domain/advisor-availability'

const VP_SCHEDULE = {
  timezone: 'Asia/Shanghai',
  weeklyHours: [
    { day: '1', start: '09:00', end: '18:00' },
    { day: '2', start: '09:00', end: '18:00' },
    { day: '3', start: '09:00', end: '18:00' },
    { day: '4', start: '09:00', end: '18:00' },
    { day: '5', start: '09:00', end: '18:00' },
  ],
  holidays: [],
  openMessage: '服务中',
  closedMessage: '非服务时段',
}

const VP_DOMAIN_SCHEDULE: ServiceSchedule = {
  timezone: 'Asia/Shanghai',
  weekly: {
    0: [],
    1: [{ start: '09:00', end: '18:00' }],
    2: [{ start: '09:00', end: '18:00' }],
    3: [{ start: '09:00', end: '18:00' }],
    4: [{ start: '09:00', end: '18:00' }],
    5: [{ start: '09:00', end: '18:00' }],
    6: [],
  },
  holidays: [],
  openMessage: '服务中',
  closedMessage: '非服务时段',
}

describe('POST /api/inquiries / 偏好看房时段', () => {
  it('合法时段 -> 落库 pending-confirmation', async () => {
    payloadFindMock.mockResolvedValue({ docs: [] })
    payloadCreateMock.mockResolvedValue({ id: 1 })
    payloadFindGlobalMock.mockResolvedValue(VP_SCHEDULE)
    assertEffectiveListingMock.mockResolvedValue({ id: 42, slug: 'jingan-center-100-monthly' })

    // 用当前时间生成一个未来合法时段
    const slot = buildViewingSlots(VP_DOMAIN_SCHEDULE, new Date().toISOString())[0]
    expect(slot).toBeTruthy()

    const r = await run(
      makeReq({
        body: makeValidBody({
          viewingPreference: {
            startsAt: slot.startsAt,
            endsAt: slot.endsAt,
            timezone: slot.timezone,
          },
        }),
      }),
    )
    expect(r.status).toBe(200)
    const created = payloadCreateMock.mock.calls[0][0].data
    expect(created.viewingPreference).toEqual({
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      timezone: slot.timezone,
      status: 'pending-confirmation',
    })
  })

  it('过期时段 -> 422 viewing_slot_invalid，不落库', async () => {
    payloadFindMock.mockResolvedValue({ docs: [] })
    payloadFindGlobalMock.mockResolvedValue(VP_SCHEDULE)
    assertEffectiveListingMock.mockResolvedValue({ id: 42, slug: 'jingan-center-100-monthly' })

    const r = await run(
      makeReq({
        body: makeValidBody({
          viewingPreference: {
            startsAt: '2020-01-06T02:00:00.000Z',
            endsAt: '2020-01-06T04:00:00.000Z',
            timezone: 'Asia/Shanghai',
          },
        }),
      }),
    )
    expect(r.status).toBe(422)
    expect(r.body.errors).toContain('viewing_slot_invalid')
    expect(payloadCreateMock).not.toHaveBeenCalled()
  })

  it('无时段 -> 正常提交，viewingPreference 为 undefined', async () => {
    payloadFindMock.mockResolvedValue({ docs: [] })
    payloadCreateMock.mockResolvedValue({ id: 1 })
    assertEffectiveListingMock.mockResolvedValue({ id: 42, slug: 'jingan-center-100-monthly' })

    const r = await run(makeReq({ body: makeValidBody() }))
    expect(r.status).toBe(200)
    const created = payloadCreateMock.mock.calls[0][0].data
    expect(created.viewingPreference).toBeUndefined()
  })
})
