import { beforeEach, describe, expect, it, vi } from 'vitest'

const payloadFindMock = vi.fn()
const payloadCreateMock = vi.fn()
const payloadLoggerError = vi.fn()
const payloadLoggerInfo = vi.fn()
const payloadLoggerWarn = vi.fn()
const payloadState: { db: unknown } = {
  db: { pool: { query: vi.fn() } },
}

vi.mock('payload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('payload')>()
  return {
    ...actual,
    getPayload: vi.fn(async () => ({
      db: payloadState.db,
      find: payloadFindMock,
      create: payloadCreateMock,
      logger: {
        error: payloadLoggerError,
        info: payloadLoggerInfo,
        warn: payloadLoggerWarn,
      },
    })),
  }
})

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
  payloadState.db = { pool: { query: vi.fn() } }
})

describe('POST /api/supply-submissions safety boundaries', () => {
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
  })

  it('does not create a submission when the default city cannot be found', async () => {
    payloadFindMock
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({ docs: [] })

    const response = await POST(request())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'server_error' })
    expect(payloadCreateMock).not.toHaveBeenCalled()
    expect(payloadLoggerError).toHaveBeenCalledWith(
      { errorCode: 'default_city_unavailable' },
      'supply_submission_default_city_unavailable',
    )
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
