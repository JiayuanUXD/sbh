import { beforeEach, describe, expect, it, vi } from 'vitest'

const payloadFindMock = vi.fn()
const payloadCreateMock = vi.fn()
const payloadLoggerError = vi.fn()
const payloadLoggerInfo = vi.fn()
const payloadLoggerWarn = vi.fn()
const resolveCityContextMock = vi.fn()
const getPayloadMock = vi.fn(async (_options: unknown) => ({
  db: payloadState.db,
  find: payloadFindMock,
  create: payloadCreateMock,
  logger: {
    error: payloadLoggerError,
    info: payloadLoggerInfo,
    warn: payloadLoggerWarn,
  },
}))
const payloadState: { db: unknown } = {
  db: { pool: { query: vi.fn() } },
}

vi.mock('payload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('payload')>()
  return {
    ...actual,
    getPayload: (options: unknown) => getPayloadMock(options),
  }
})

vi.mock('@/app/(frontend)/_lib/city-context', () => ({
  resolveCityContext: (slug: unknown) => resolveCityContextMock(slug),
}))

vi.mock('@/lib/rate-limit-pg', () => ({
  createPgRateLimitDeps: () => ({
    acquire: async (_key: string, windowStart: number) => ({ count: 1, windowStart }),
    pruneExpired: async () => 0,
    countKeys: async () => 0,
    keyExists: async () => false,
    now: () => Date.now(),
  }),
}))

import { POST } from '@/app/api/supply-submissions/route'

function validBody(): Record<string, unknown> {
  return {
    requestId: 'city-guard-1',
    city: 'hangzhou',
    buildingName: '测试楼盘',
    address: '测试地址',
    areaSqm: 180,
    contactPhone: '13800001111',
    consent: { accepted: true, policyVersion: 'MVP-R1' },
    source: { path: '/publish' },
  }
}

function request(body = validBody()): Request {
  return new Request('http://localhost:3719/api/supply-submissions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      host: 'localhost:3719',
      'x-forwarded-for': '198.51.100.200',
    },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  payloadFindMock.mockReset()
  payloadCreateMock.mockReset()
  payloadLoggerError.mockReset()
  payloadLoggerInfo.mockReset()
  payloadLoggerWarn.mockReset()
  resolveCityContextMock.mockReset()
  resolveCityContextMock.mockImplementation(async (slug: unknown) =>
    slug === 'hangzhou'
      ? { id: 17, slug: 'hangzhou', name: '杭州市', serviceStatus: 'live', profile: {} }
      : slug === 'shanghai'
        ? { id: 1, slug: 'shanghai', name: '上海市', serviceStatus: 'live', profile: {} }
        : null,
  )
  getPayloadMock.mockClear()
  payloadState.db = { pool: { query: vi.fn() } }
})

describe('POST /api/supply-submissions safety boundaries', () => {
  it('does not change the persisted city when an idempotent replay submits another valid city', async () => {
    payloadFindMock.mockResolvedValueOnce({ docs: [{ id: 88, city: 1 }] })

    const response = await POST(request({ ...validBody(), city: 'hangzhou' }))

    expect(response.status).toBe(200)
    expect(resolveCityContextMock).toHaveBeenCalledWith('hangzhou')
    expect(payloadCreateMock).not.toHaveBeenCalled()
  })

  it('persists the trusted city relationship ID resolved from the submitted slug', async () => {
    payloadFindMock.mockResolvedValueOnce({ docs: [] })
    payloadCreateMock.mockResolvedValueOnce({ id: 88 })

    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(resolveCityContextMock).toHaveBeenCalledWith('hangzhou')
    expect(payloadCreateMock.mock.calls[0][0].data.city).toBe(17)
  })

  it('stores source URL as a pathname without query PII', async () => {
    const pii = '13900009999'
    payloadFindMock.mockResolvedValueOnce({ docs: [] })
    payloadCreateMock.mockResolvedValueOnce({ id: 88 })

    const response = await POST(request({
      ...validBody(),
      source: { path: `/publish?phone=${pii}#contact=${pii}` },
    }))

    expect(response.status).toBe(200)
    expect(payloadCreateMock.mock.calls[0][0].data).toEqual(expect.objectContaining({
      sourcePath: '/publish',
      sourceUrl: expect.stringMatching(/\/publish$/),
    }))
    expect(JSON.stringify(payloadCreateMock.mock.calls)).not.toContain(pii)
  })

  it('rejects an unknown explicit city before persistence', async () => {
    resolveCityContextMock.mockResolvedValueOnce(null)

    const response = await POST(request({ ...validBody(), city: 'unknown-city' }))

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({ ok: false, errors: ['city_invalid'] })
    expect(payloadCreateMock).not.toHaveBeenCalled()
  })

  it('defaults a missing city only for the approved legacy publish source path', async () => {
    const body = validBody()
    delete body.city
    payloadFindMock.mockResolvedValueOnce({ docs: [] })
    payloadCreateMock.mockResolvedValueOnce({ id: 88 })

    const response = await POST(request(body))

    expect(response.status).toBe(200)
    expect(resolveCityContextMock).toHaveBeenCalledWith('shanghai')
    expect(payloadCreateMock.mock.calls[0][0].data.city).toBe(1)
  })


  it('creates only through the dedicated route with Local API overrideAccess', async () => {
    payloadFindMock
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({ docs: [{ id: 1 }] })
    payloadCreateMock.mockResolvedValueOnce({ id: 88 })

    const response = await POST(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(payloadCreateMock).toHaveBeenCalledOnce()
    expect(payloadCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'supply-submissions',
        overrideAccess: true,
      }),
    )
    expect(getPayloadMock).toHaveBeenCalledWith({ config: expect.anything(), cron: true })
  })

  /**
   * 城市是可空的元数据字段（collection 未设 required，DB 里 city_id 允许 NULL）。
   * 解析失败必须降级留空并继续落库：否则生产库里那条 slug='shanghai' 的 location
   * 一旦被改名 / 停用，整个投放入口就会 500、房东线索全部丢失。
   */
  it('fails closed when an approved legacy request omits city and the default cannot be resolved', async () => {
    const body = validBody()
    delete body.city
    resolveCityContextMock.mockResolvedValueOnce(null)

    const response = await POST(request(body))

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({ ok: false, errors: ['city_invalid'] })
    expect(payloadCreateMock).not.toHaveBeenCalled()
  })

  it('rejects a Payload adapter without a PostgreSQL pool before creating a submission', async () => {
    payloadState.db = {}

    const response = await POST(request())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'server_error' })
    expect(payloadCreateMock).not.toHaveBeenCalled()
    expect(payloadLoggerError).toHaveBeenCalledWith(
      { errorCode: 'rate_limit_pool_unavailable' },
      'supply_submission_pool_unavailable',
    )
  })

  it('never logs an exception message that contains submitted PII', async () => {
    const pii = '13800001111 secret-address'
    payloadFindMock
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({ docs: [{ id: 1 }] })
    payloadCreateMock.mockRejectedValueOnce(new Error(pii))

    const response = await POST(request())

    expect(response.status).toBe(500)
    expect(JSON.stringify(payloadLoggerError.mock.calls)).not.toContain(pii)
  })

  it('never logs PII from a failed idempotency lookup', async () => {
    const pii = '13800001111 idempotency-failure'
    payloadFindMock
      .mockRejectedValueOnce(new Error(pii))
      .mockResolvedValueOnce({ docs: [{ id: 1 }] })
    payloadCreateMock.mockResolvedValueOnce({ id: 1 })

    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(JSON.stringify(payloadLoggerError.mock.calls)).not.toContain(pii)
  })
})
