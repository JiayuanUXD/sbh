import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { Payload } from 'payload'

import type { CityPartnerDetailsInput } from '@/domain/city-partner-application/public-service'

const { completePublicCityPartnerDetails } = await vi.importActual<
  typeof import('@/domain/city-partner-application/public-service')
>('@/domain/city-partner-application/public-service')

type StoredDetails = {
  id: number
  requestId: string
  contactPhone: string
  detailsCompletedAt: string | null
  detailsFingerprint: string | null
  organizationName?: string
}

function input(organizationName: string): CityPartnerDetailsInput {
  return {
    requestId: 'partner-req-001',
    contactPhone: '13800001111',
    phoneNormalized: '13800001111',
    organizationName,
  }
}

function createTransactionalPayload(initial?: StoredDetails | readonly StoredDetails[]) {
  let stored = initial === undefined ? [] : Array.isArray(initial) ? [...initial] : [initial]
  let nextTransaction = 0
  let tail = Promise.resolve()
  const releases = new Map<string, () => void>()
  const statements: unknown[] = []
  const sessions: Record<string, { db: { execute: (statement: unknown) => Promise<unknown> }; resolve: () => Promise<void>; reject: () => Promise<void> }> = {}

  const payload = {
    db: {
      sessions,
      beginTransaction: vi.fn(async () => {
        const id = `tx-${++nextTransaction}`
        let release = () => {}
        const prior = tail
        tail = new Promise<void>((resolve) => { release = resolve })
        sessions[id] = {
          db: {
            execute: async (statement: unknown) => {
              statements.push(statement)
              await prior
              releases.set(id, release)
              return { rows: stored.map((row) => ({
                id: row.id,
                detailsCompletedAt: row.detailsCompletedAt,
                detailsFingerprint: row.detailsFingerprint,
              })) }
            },
          },
          resolve: async () => {},
          reject: async () => {},
        }
        return id
      }),
      commitTransaction: vi.fn(async (id: string) => { releases.get(id)?.() }),
      rollbackTransaction: vi.fn(async (id: string) => { releases.get(id)?.() }),
    },
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const current = stored[0]
      if (!current) throw new Error('not found')
      stored[0] = { ...current, ...data } as StoredDetails
      return stored[0]
    }),
  }

  return {
    payload: payload as unknown as Payload,
    statements,
    getStored: () => stored[0],
  }
}

describe('atomic city partner details completion', () => {
  it('serializes concurrent first completion so different facts cannot both succeed or overwrite', async () => {
    const fixture = createTransactionalPayload({
      id: 7,
      requestId: 'partner-req-001',
      contactPhone: '13800001111',
      detailsCompletedAt: null,
      detailsFingerprint: null,
    })

    const [first, second] = await Promise.all([
      completePublicCityPartnerDetails({ payload: fixture.payload, input: input('甲公司') }),
      completePublicCityPartnerDetails({ payload: fixture.payload, input: input('乙公司') }),
    ])

    expect([first, second]).toContainEqual({ kind: 'completed' })
    expect([first, second]).toContainEqual({ kind: 'conflict' })
    expect(fixture.getStored()?.organizationName).toBe('甲公司')
    expect(fixture.payload.update).toHaveBeenCalledTimes(1)
  })

  it('treats an exact retry as idempotent after the atomic completion', async () => {
    const fixture = createTransactionalPayload({
      id: 7,
      requestId: 'partner-req-001',
      contactPhone: '13800001111',
      detailsCompletedAt: null,
      detailsFingerprint: null,
    })
    expect(await completePublicCityPartnerDetails({ payload: fixture.payload, input: input('甲公司') }))
      .toEqual({ kind: 'completed' })
    expect(await completePublicCityPartnerDetails({ payload: fixture.payload, input: input('甲公司') }))
      .toEqual({ kind: 'idempotent' })
  })

  it('uses the Payload transaction session and a PostgreSQL row lock', async () => {
    const fixture = createTransactionalPayload({
      id: 7,
      requestId: 'partner-req-001',
      contactPhone: '13800001111',
      detailsCompletedAt: null,
      detailsFingerprint: null,
    })

    await completePublicCityPartnerDetails({ payload: fixture.payload, input: input('甲公司') })

    const query = new PgDialect().sqlToQuery(fixture.statements[0] as Parameters<PgDialect['sqlToQuery']>[0])
    expect(query.sql.toLowerCase()).toContain('for update')
    expect(query.sql.toLowerCase()).toContain('request_id')
    expect(query.sql.toLowerCase()).not.toContain('limit 1')
    expect(query.sql.toLowerCase()).toContain('order by id')
    expect(fixture.payload.update).toHaveBeenCalledWith(expect.objectContaining({
      overrideAccess: true,
      req: expect.objectContaining({
        transactionID: 'tx-1',
        context: expect.objectContaining({ cityPartnerApplicationWriteStage: 'stage-two' }),
      }),
    }))
    expect(fixture.payload.db.commitTransaction).toHaveBeenCalledWith('tx-1')
  })

  it('returns not_found for the wrong requestId/phone identity', async () => {
    const fixture = createTransactionalPayload()
    await expect(completePublicCityPartnerDetails({ payload: fixture.payload, input: input('甲公司') }))
      .resolves.toEqual({ kind: 'not_found' })
    expect(fixture.payload.update).not.toHaveBeenCalled()
  })

  it('locks every cross-city identity match and fails closed without updating any row', async () => {
    const shared = {
      requestId: 'partner-req-001',
      contactPhone: '13800001111',
      detailsCompletedAt: null,
      detailsFingerprint: null,
    }
    const fixture = createTransactionalPayload([
      { ...shared, id: 7 },
      { ...shared, id: 8 },
    ])

    await expect(completePublicCityPartnerDetails({ payload: fixture.payload, input: input('甲公司') }))
      .resolves.toEqual({ kind: 'identity_ambiguous' })
    expect(fixture.payload.update).not.toHaveBeenCalled()
    expect(fixture.payload.db.commitTransaction).toHaveBeenCalledWith('tx-1')
  })
})

const { detailsService, detailsAcquire, detailsLoggerError, detailsLoggerInfo } = vi.hoisted(() => ({
  detailsService: vi.fn(),
  detailsAcquire: vi.fn(async (_key: string, windowStart: number) => ({ count: 1, windowStart })),
  detailsLoggerError: vi.fn(),
  detailsLoggerInfo: vi.fn(),
}))
vi.mock('@/domain/city-partner-application/public-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/domain/city-partner-application/public-service')>()
  return { ...actual, completePublicCityPartnerDetails: detailsService }
})

vi.mock('payload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('payload')>()
  return {
    ...actual,
    createLocalReq: vi.fn(async (options: { context?: unknown }) => ({
      context: options.context ?? {},
    })),
    getPayload: vi.fn(async () => ({
      db: { pool: { query: vi.fn() } },
      logger: { info: detailsLoggerInfo, warn: vi.fn(), error: detailsLoggerError },
    })),
  }
})

vi.mock('@/lib/rate-limit-pg', () => ({
  createPgRateLimitDeps: () => ({
    acquire: detailsAcquire,
    pruneExpired: async () => 0,
    countKeys: async () => 0,
    keyExists: async () => false,
    now: () => 1_000,
  }),
}))

import { POST } from '@/app/api/city-partner-applications/details/route'

function detailsRequest() {
  return new Request('https://sbh.example.com/api/city-partner-applications/details', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      host: 'sbh.example.com',
      origin: 'https://sbh.example.com',
      'x-forwarded-for': '198.51.100.10',
    },
    body: JSON.stringify({
      requestId: 'partner-req-001',
      contactPhone: '13800001111',
      organizationName: '甲公司',
    }),
  })
}

describe('POST /api/city-partner-applications/details', () => {
  beforeEach(() => {
    detailsService.mockReset()
    detailsAcquire.mockReset()
    detailsAcquire.mockImplementation(async (_key: string, windowStart: number) => ({
      count: 1,
      windowStart,
    }))
    detailsLoggerError.mockReset()
    detailsLoggerInfo.mockReset()
  })

  it.each([
    ['not_found', 404, 'not_found'],
    ['conflict', 409, 'details_already_completed'],
    ['identity_ambiguous', 409, 'identity_ambiguous'],
  ] as const)('maps %s to a PII-safe public error', async (kind, status, error) => {
    detailsService.mockResolvedValue({ kind })
    const response = await POST(detailsRequest())
    expect(response.status).toBe(status)
    await expect(response.json()).resolves.toEqual({ ok: false, error })
  })

  it.each([
    ['completed', false],
    ['idempotent', true],
  ] as const)('maps %s to exact public success', async (kind, idempotent) => {
    detailsService.mockResolvedValue({ kind })
    const response = await POST(detailsRequest())
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, idempotent })
  })

  it('returns 429 before the details service when the persistent rate state denies', async () => {
    detailsAcquire.mockResolvedValueOnce({ count: 4, windowStart: 0 })
    const response = await POST(detailsRequest())
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBeTruthy()
    expect(detailsService).not.toHaveBeenCalled()
  })

  it('never logs submitted stage-two PII or exception content', async () => {
    detailsService.mockRejectedValue(new Error('甲公司 13800001111 private'))
    const response = await POST(detailsRequest())
    expect(response.status).toBe(500)
    expect(JSON.stringify([detailsLoggerError.mock.calls, detailsLoggerInfo.mock.calls]))
      .not.toMatch(/甲公司|13800001111|private/)
  })
})
