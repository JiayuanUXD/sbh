import { beforeEach, describe, expect, it, vi } from 'vitest'

const findMock = vi.fn()
const createMock = vi.fn()
const loggerInfo = vi.fn()
const loggerError = vi.fn()
const loggerWarn = vi.fn()
const acquireMock = vi.fn(async (_key: string, windowStart: number) => ({ count: 1, windowStart }))

const payload = {
  db: { pool: { query: vi.fn() } },
  find: findMock,
  create: createMock,
  logger: { info: loggerInfo, error: loggerError, warn: loggerWarn },
}

vi.mock('payload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('payload')>()
  return {
    ...actual,
    createLocalReq: vi.fn(async (options: { context?: unknown }) => ({
      context: options.context ?? {},
    })),
    getPayload: vi.fn(async () => payload),
  }
})

vi.mock('@/app/(frontend)/_lib/city-context', () => ({
  resolveCityContext: vi.fn(async (slug: unknown) => slug === 'hangzhou' ? {
    id: 11,
    slug: 'hangzhou',
    name: '杭州',
    serviceStatus: 'coming-soon',
    profile: {},
  } : null),
}))

vi.mock('@/lib/rate-limit-pg', () => ({
  createPgRateLimitDeps: () => ({
    acquire: acquireMock,
    pruneExpired: async () => 0,
    countKeys: async () => 0,
    keyExists: async () => false,
    now: () => 1_000,
  }),
}))

import { PRIVACY_POLICY_VERSION } from '@/lib/frontend/site-config'
import { POST } from '@/app/api/city-partner-applications/route'

function body(overrides: Record<string, unknown> = {}) {
  return {
    requestId: 'partner-req-001',
    city: 'hangzhou',
    applicantName: '张三',
    contactPhone: '13800001111',
    applicantIdentity: 'local-operations',
    consent: { accepted: true, policyVersion: PRIVACY_POLICY_VERSION },
    source: { path: '/city-partner' },
    ...overrides,
  }
}

function request(input = body(), headers: Record<string, string> = {}) {
  return new Request('https://sbh.example.com/api/city-partner-applications', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      host: 'sbh.example.com',
      origin: 'https://sbh.example.com',
      'x-forwarded-for': '198.51.100.10',
      ...headers,
    },
    body: JSON.stringify(input),
  })
}

beforeEach(() => {
  findMock.mockReset()
  createMock.mockReset()
  loggerInfo.mockReset()
  loggerError.mockReset()
  loggerWarn.mockReset()
  acquireMock.mockClear()
})

describe('POST /api/city-partner-applications', () => {
  it('creates with the server-owned stage-one capability and a PII-safe response', async () => {
    findMock.mockResolvedValue({ docs: [] })
    createMock.mockResolvedValue({ id: 99, status: 'pending' })

    const response = await POST(request())

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({ ok: true, idempotent: false })
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({
      collection: 'city-partner-applications',
      overrideAccess: true,
      data: expect.objectContaining({
        city: 11,
        contactPhone: '13800001111',
        requestId: 'partner-req-001',
        idempotencyKey: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
      req: expect.objectContaining({
        context: expect.objectContaining({ cityPartnerApplicationWriteStage: 'stage-one' }),
      }),
    }))
  })

  it('returns persistent idempotent success without exposing the record', async () => {
    findMock.mockResolvedValue({ docs: [{ id: 99 }] })

    const response = await POST(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, idempotent: true })
    expect(createMock).not.toHaveBeenCalled()
  })

  it('rereads after a matching unique race before returning idempotent success', async () => {
    findMock.mockResolvedValueOnce({ docs: [] }).mockResolvedValueOnce({ docs: [{ id: 99 }] })
    createMock.mockRejectedValue(Object.assign(new Error('safe'), {
      code: '23505',
      constraint: 'city_partner_applications_idempotency_key_idx',
    }))

    const response = await POST(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, idempotent: true })
    expect(findMock).toHaveBeenCalledTimes(2)
  })

  it('rejects an explicit invalid city with 422', async () => {
    const response = await POST(request(body({ city: 'unknown-city' })))
    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'invalid_city' })
    expect(createMock).not.toHaveBeenCalled()
  })

  it('returns 429 with Retry-After when the shared rate state denies the request', async () => {
    acquireMock.mockResolvedValueOnce({ count: 4, windowStart: 0 })
    const response = await POST(request())
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBeTruthy()
  })

  it('never exposes or logs submitted PII when create fails', async () => {
    findMock.mockResolvedValue({ docs: [] })
    createMock.mockRejectedValue(new Error('张三 13800001111 secret'))

    const response = await POST(request())
    expect(response.status).toBe(500)
    expect(JSON.stringify(await response.json())).not.toMatch(/张三|13800001111|status|assignee|id/)
    expect(JSON.stringify([loggerInfo.mock.calls, loggerError.mock.calls, loggerWarn.mock.calls]))
      .not.toMatch(/张三|13800001111|secret/)
  })
})
