import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createAcceptanceFixturePostHandler } from '@/app/api/mini/v1/acceptance/leads/route'
import { databaseFingerprint } from '@/domain/mini-program/acceptance-attestation'
import {
  computeAcceptanceFixtureLocator,
  encodeAcceptanceFixtureLeadId,
  type AcceptanceFixtureRequest,
} from '@/domain/mini-program/acceptance-fixture'
import {
  acceptanceFixtureNamespace,
  issueAcceptancePermit,
} from '@/domain/mini-program/acceptance-permit'

const attestationSecret = Uint8Array.from({ length: 32 }, (_, index) => index + 1)
const operatorSecret = Uint8Array.from({ length: 32 }, (_, index) => index + 33)
const permitSecret = Uint8Array.from({ length: 32 }, (_, index) => index + 65)
const identity = { databaseName: 'sbh_staging', serverAddress: '10.0.0.4', serverPort: 5432 }
const fingerprint = databaseFingerprint(identity, attestationSecret)
const runId = '550e8400-e29b-41d4-a716-446655440000'
const context = {
  runId,
  fixtureNamespace: acceptanceFixtureNamespace(runId),
  expectedGitCommitSha: 'a'.repeat(40),
  expectedDeploymentRevision: 'revision-1',
  expectedDbFingerprint: fingerprint,
}
const runtimeConfig = {
  deploymentGitCommitSha: context.expectedGitCommitSha,
  deploymentRevision: context.expectedDeploymentRevision,
  attestationSecret,
  operatorBootstrapSecret: operatorSecret,
  permitSigningSecret: permitSecret,
  dbFingerprintAllowlist: [fingerprint],
}
const inspectRequest = {
  action: 'inspect',
  submissionRequestId: '650e8400-e29b-41d4-a716-446655440000',
  listingSlug: 'jingan-center-100-monthly',
} as const satisfies AcceptanceFixtureRequest

type LeadId = number | string
type LeadDoc = Readonly<{ id: LeadId; [key: string]: unknown }>
type PayloadDouble = Readonly<{
  db: Readonly<{ pool: Readonly<{ query: ReturnType<typeof vi.fn> }> }>
  find: ReturnType<typeof vi.fn>
  count: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
}>
type HandlerDeps = Readonly<{
  readConfig: () => typeof runtimeConfig | null
  getPayload: () => Promise<PayloadDouble>
  probe: ReturnType<typeof vi.fn>
  requestId: () => string
}>

function permitToken(changes: Partial<typeof context> = {}): string {
  const candidate = { ...context, ...changes }
  return issueAcceptancePermit(candidate, permitSecret, Date.now(), () => Buffer.alloc(16, 7)).token
}

function request(options: Readonly<{
  body?: unknown
  token?: string | null
  headers?: Readonly<Record<string, string>>
}> = {}): Request {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(options.headers ?? {}),
  }
  if (options.token !== null) headers['x-sbh-acceptance-permit'] = options.token ?? permitToken()
  const body = options.body ?? inspectRequest
  return new Request('https://example.test/api/mini/v1/acceptance/leads', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function setup(overrides: Partial<{
  config: typeof runtimeConfig | null
  payload: PayloadDouble
  probe: ReturnType<typeof vi.fn>
}> = {}) {
  const payload = overrides.payload ?? {
    db: { pool: { query: vi.fn() } },
    find: vi.fn().mockResolvedValue({ docs: [] }),
    count: vi.fn().mockResolvedValue({ totalDocs: 0 }),
    delete: vi.fn().mockResolvedValue({ id: 1 }),
  }
  const getPayload = vi.fn().mockResolvedValue(payload)
  const probe = overrides.probe ?? vi.fn().mockResolvedValue({ identity, fingerprint })
  const readConfig = vi.fn().mockReturnValue(
    Object.prototype.hasOwnProperty.call(overrides, 'config') ? overrides.config : runtimeConfig,
  )
  const factory = createAcceptanceFixturePostHandler as unknown as (
    deps: HandlerDeps,
  ) => (request: Request) => Promise<Response>
  return {
    handler: factory({ readConfig, getPayload, probe, requestId: () => 'fixture-request-id' }),
    payload,
    getPayload,
    probe,
    readConfig,
  }
}

function expectNoStore(response: Response): void {
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(response.headers.get('x-request-id')).toBe('fixture-request-id')
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>
}

describe('POST acceptance fixture leads route', () => {
  beforeEach(() => vi.clearAllMocks())

  it('提供独立受保护的 leads route', () => {
    const route = fileURLToPath(new URL(
      '../src/app/api/mini/v1/acceptance/leads/route.ts',
      import.meta.url,
    ))
    expect(existsSync(route)).toBe(true)
  })

  it('导出 Node force-dynamic POST factory 供合同测试注入依赖', async () => {
    const route = await import('@/app/api/mini/v1/acceptance/leads/route') as Record<string, unknown>
    expect(route.runtime).toBe('nodejs')
    expect(route.dynamic).toBe('force-dynamic')
    expect(route.POST).toBeTypeOf('function')
    expect(route.createAcceptanceFixturePostHandler).toBeTypeOf('function')
  })

  it.each([
    ['missing', null, undefined],
    ['empty', '', undefined],
    ['oversized', 'x'.repeat(4097), undefined],
    ['invalid', `${permitToken()}x`, undefined],
    ['disabled/production', permitToken(), null],
    ['SHA mismatch', permitToken({ expectedGitCommitSha: 'c'.repeat(40) }), undefined],
    ['revision mismatch', permitToken({ expectedDeploymentRevision: 'revision-2' }), undefined],
    ['allowlist mismatch', permitToken({ expectedDbFingerprint: 'd'.repeat(64) }), undefined],
  ])('%s permit 同形 404 且认证前零 Payload', async (_label, token, config) => {
    const route = config === null ? setup({ config: null }) : setup()
    const response = await route.handler(request({
      token,
      headers: token === null ? { 'x-sbh-acceptance-bootstrap': 'must-not-authorize' } : undefined,
    }))

    expect(response.status).toBe(404)
    expect(await response.text()).toBe('Not Found')
    expectNoStore(response)
    expect(route.getPayload).not.toHaveBeenCalled()
    expect(route.probe).not.toHaveBeenCalled()
  })

  it.each([
    ['content type', { headers: { 'content-type': 'text/plain' } }, 415],
    ['invalid JSON', { body: '{' }, 400],
    ['extra key', { body: { ...inspectRequest, idempotencyKey: 'attacker' } }, 400],
    ['invalid schema', { body: { ...inspectRequest, submissionRequestId: 'bad' } }, 400],
    [
      'raw cleanup lead ID',
      { body: { ...inspectRequest, action: 'cleanup', leadId: '42' } },
      400,
    ],
    [
      'oversized body',
      { body: 'x'.repeat(20_000), headers: { 'content-length': '20000' } },
      413,
    ],
  ])('%s 在 Payload 前严格拒绝', async (_label, options, status) => {
    const route = setup()
    const response = await route.handler(request(options))
    expect(response.status).toBe(status)
    expectNoStore(response)
    expect(route.getPayload).not.toHaveBeenCalled()
    expect(route.probe).not.toHaveBeenCalled()
  })

  it('actual DB probe 必须与 permit fingerprint 精确一致后才查询', async () => {
    const probe = vi.fn().mockResolvedValue({ identity, fingerprint: 'd'.repeat(64) })
    const route = setup({ probe })
    const response = await route.handler(request())

    expect(response.status).toBe(409)
    expectNoStore(response)
    expect(probe).toHaveBeenCalledWith(
      route.payload.db.pool,
      attestationSecret,
      runtimeConfig.dbFingerprintAllowlist,
    )
    expect(route.payload.find).not.toHaveBeenCalled()
  })

  it('probe 异常返回脱敏 503 且不查询业务集合', async () => {
    const token = permitToken()
    const route = setup({ probe: vi.fn().mockRejectedValue(new Error(`probe ${token}`)) })
    const response = await route.handler(request({ token }))
    const text = await response.text()

    expect(response.status).toBe(503)
    expectNoStore(response)
    expect(text).not.toContain(token)
    expect(route.payload.find).not.toHaveBeenCalled()
  })

  it('inspect 0 条只返回全零且 locator 由服务端复算', async () => {
    const route = setup()
    const response = await route.handler(request())
    const locator = await computeAcceptanceFixtureLocator(runId, inspectRequest)

    expect(response.status).toBe(200)
    expectNoStore(response)
    expect(await responseJson(response)).toEqual({
      ok: true,
      result: {
        leadCount: 0,
        leadId: null,
        followUpCount: 0,
        ownershipHistoryCount: 0,
      },
      meta: { requestId: 'fixture-request-id' },
    })
    expect(route.payload.find).toHaveBeenCalledWith({
      collection: 'leads',
      where: { idempotencyKey: { equals: locator } },
      limit: 2,
      depth: 0,
      overrideAccess: true,
    })
    expect(route.payload.count).not.toHaveBeenCalled()
    expect(route.payload.delete).not.toHaveBeenCalled()
  })

  it.each<Readonly<[string, LeadId, string]>>([
    ['number', 42, 'n:42'],
    ['string', '42', 's:NDI'],
  ])('inspect 1 条 %s ID 只返回 tagged ID 与精确关系计数', async (_label, id, encodedId) => {
    const payload: PayloadDouble = {
      db: { pool: { query: vi.fn() } },
      find: vi.fn().mockResolvedValue({
        docs: [{ id, name: '敏感姓名', phone: '13800001111', idempotencyKey: 'sensitive-key' }],
      }),
      count: vi.fn().mockImplementation(async ({ collection }: { collection: string }) => ({
        totalDocs: collection === 'follow-ups' ? 2 : 3,
      })),
      delete: vi.fn(),
    }
    const route = setup({ payload })
    const token = permitToken()
    const response = await route.handler(request({ token }))
    const body = await responseJson(response)
    const serialized = JSON.stringify(body)

    expect(response.status).toBe(200)
    expectNoStore(response)
    expect(body).toMatchObject({
      result: {
        leadCount: 1,
        leadId: encodedId,
        followUpCount: 2,
        ownershipHistoryCount: 3,
      },
    })
    expect(payload.count.mock.calls).toEqual([
      [{ collection: 'follow-ups', where: { lead: { equals: id } }, overrideAccess: true }],
      [{ collection: 'lead-ownership-history', where: { lead: { equals: id } }, overrideAccess: true }],
    ])
    for (const forbidden of [
      '敏感姓名',
      '13800001111',
      'sensitive-key',
      'idempotencyKey',
      token,
      Buffer.from(attestationSecret).toString('base64url'),
      Buffer.from(permitSecret).toString('base64url'),
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
    expect(payload.delete).not.toHaveBeenCalled()
  })

  it('inspect >1 条返回 409 且不猜测 ID、不查关系', async () => {
    const payload: PayloadDouble = {
      db: { pool: { query: vi.fn() } },
      find: vi.fn().mockResolvedValue({ docs: [{ id: 1 }, { id: 2 }] }),
      count: vi.fn(),
      delete: vi.fn(),
    }
    const route = setup({ payload })
    const response = await route.handler(request())
    expect(response.status).toBe(409)
    expectNoStore(response)
    expect(await response.text()).not.toContain('n:1')
    expect(payload.count).not.toHaveBeenCalled()
    expect(payload.delete).not.toHaveBeenCalled()
  })

  it('cleanup 0 条幂等返回 cleaned=false 且零 delete', async () => {
    const route = setup()
    const response = await route.handler(request({
      body: { ...inspectRequest, action: 'cleanup', leadId: encodeAcceptanceFixtureLeadId(42) },
    }))
    expect(response.status).toBe(200)
    expect(await responseJson(response)).toEqual({
      ok: true,
      result: {
        cleaned: false,
        leadCount: 0,
        followUpCount: 0,
        ownershipHistoryCount: 0,
      },
      meta: { requestId: 'fixture-request-id' },
    })
    expect(route.payload.count).not.toHaveBeenCalled()
    expect(route.payload.delete).not.toHaveBeenCalled()
  })

  it('cleanup 必须以 encode(actual id) 与 token 精确比较，禁止 number/string 混淆', async () => {
    const payload: PayloadDouble = {
      db: { pool: { query: vi.fn() } },
      find: vi.fn().mockResolvedValue({ docs: [{ id: 42 }] }),
      count: vi.fn(),
      delete: vi.fn(),
    }
    const route = setup({ payload })
    const response = await route.handler(request({
      body: { ...inspectRequest, action: 'cleanup', leadId: encodeAcceptanceFixtureLeadId('42') },
    }))
    expect(response.status).toBe(409)
    expect(payload.count).not.toHaveBeenCalled()
    expect(payload.delete).not.toHaveBeenCalled()
  })

  it.each([
    ['follow-ups', 1, 0],
    ['ownership history', 0, 1],
  ])('cleanup 有 %s 关系时冻结且零 delete', async (_label, followUpCount, historyCount) => {
    const payload: PayloadDouble = {
      db: { pool: { query: vi.fn() } },
      find: vi.fn().mockResolvedValue({ docs: [{ id: 42 }] }),
      count: vi.fn()
        .mockResolvedValueOnce({ totalDocs: followUpCount })
        .mockResolvedValueOnce({ totalDocs: historyCount }),
      delete: vi.fn(),
    }
    const route = setup({ payload })
    const response = await route.handler(request({
      body: { ...inspectRequest, action: 'cleanup', leadId: encodeAcceptanceFixtureLeadId(42) },
    }))
    expect(response.status).toBe(409)
    expectNoStore(response)
    expect(payload.count).toHaveBeenCalledTimes(2)
    expect(payload.delete).not.toHaveBeenCalled()
  })

  it.each<Readonly<[string, LeadId]>>([
    ['number', 42],
    ['string', '42'],
  ])('cleanup 精确命中 %s ID 时硬删原始 ID 并复查为零', async (_label, id) => {
    const idLabel = `${typeof id}:${String(id)}`
    const events: string[] = []
    let findCalls = 0
    const payload: PayloadDouble = {
      db: { pool: { query: vi.fn() } },
      find: vi.fn().mockImplementation(async () => {
        events.push('find:leads')
        findCalls += 1
        return { docs: findCalls === 1 ? [{ id }] : [] }
      }),
      count: vi.fn().mockImplementation(async ({ collection, where }) => {
        events.push(`count:${collection}:${typeof where.lead.equals}:${String(where.lead.equals)}`)
        return { totalDocs: 0 }
      }),
      delete: vi.fn().mockImplementation(async ({ id: deletedId }) => {
        events.push(`delete:leads:${typeof deletedId}:${String(deletedId)}`)
        return { id: deletedId }
      }),
    }
    const route = setup({ payload })
    const response = await route.handler(request({
      body: { ...inspectRequest, action: 'cleanup', leadId: encodeAcceptanceFixtureLeadId(id) },
    }))

    expect(response.status).toBe(200)
    expectNoStore(response)
    expect(payload.delete).toHaveBeenCalledWith({
      collection: 'leads',
      id,
      overrideAccess: true,
    })
    expect(payload.find).toHaveBeenCalledTimes(2)
    expect(payload.count).toHaveBeenCalledTimes(4)
    expect(events).toEqual([
      'find:leads',
      `count:follow-ups:${idLabel}`,
      `count:lead-ownership-history:${idLabel}`,
      `delete:leads:${idLabel}`,
      'find:leads',
      `count:follow-ups:${idLabel}`,
      `count:lead-ownership-history:${idLabel}`,
    ])
    expect(await responseJson(response)).toEqual({
      ok: true,
      result: {
        cleaned: true,
        leadCount: 0,
        followUpCount: 0,
        ownershipHistoryCount: 0,
      },
      meta: { requestId: 'fixture-request-id' },
    })
  })

  it.each([
    ['follow-ups', 1, 0],
    ['ownership history', 0, 1],
  ])('delete 后 %s 新增关系时必须 503，不能返回 cleaned=true', async (_label, postFollowUps, postHistory) => {
    const payload: PayloadDouble = {
      db: { pool: { query: vi.fn() } },
      find: vi.fn()
        .mockResolvedValueOnce({ docs: [{ id: 42 }] })
        .mockResolvedValueOnce({ docs: [] }),
      count: vi.fn()
        .mockResolvedValueOnce({ totalDocs: 0 })
        .mockResolvedValueOnce({ totalDocs: 0 })
        .mockResolvedValueOnce({ totalDocs: postFollowUps })
        .mockResolvedValueOnce({ totalDocs: postHistory }),
      delete: vi.fn().mockResolvedValue({ id: 42 }),
    }
    const route = setup({ payload })
    const response = await route.handler(request({
      body: { ...inspectRequest, action: 'cleanup', leadId: encodeAcceptanceFixtureLeadId(42) },
    }))
    const text = await response.text()

    expect(response.status).toBe(503)
    expectNoStore(response)
    expect(text).not.toContain('cleaned')
    expect(payload.delete).toHaveBeenCalledOnce()
    expect(payload.find).toHaveBeenCalledTimes(2)
    expect(payload.count).toHaveBeenCalledTimes(4)
  })

  it('delete 后关系复查异常返回脱敏 503', async () => {
    const token = permitToken()
    const payload: PayloadDouble = {
      db: { pool: { query: vi.fn() } },
      find: vi.fn()
        .mockResolvedValueOnce({ docs: [{ id: 42 }] })
        .mockResolvedValueOnce({ docs: [] }),
      count: vi.fn()
        .mockResolvedValueOnce({ totalDocs: 0 })
        .mockResolvedValueOnce({ totalDocs: 0 })
        .mockRejectedValueOnce(new Error(`post relation ${token}`))
        .mockResolvedValueOnce({ totalDocs: 0 }),
      delete: vi.fn().mockResolvedValue({ id: 42 }),
    }
    const route = setup({ payload })
    const response = await route.handler(request({
      token,
      body: { ...inspectRequest, action: 'cleanup', leadId: encodeAcceptanceFixtureLeadId(42) },
    }))
    const text = await response.text()

    expect(response.status).toBe(503)
    expectNoStore(response)
    expect(text).not.toContain(token)
    expect(text).not.toContain('cleaned')
    expect(payload.delete).toHaveBeenCalledOnce()
    expect(payload.find).toHaveBeenCalledTimes(2)
    expect(payload.count).toHaveBeenCalledTimes(4)
  })

  it.each([
    ['lead query', 'find'],
    ['relation query', 'count'],
    ['delete', 'delete'],
  ] as const)('%s 异常统一脱敏 503', async (_label, operation) => {
    const token = permitToken()
    const payload: PayloadDouble = {
      db: { pool: { query: vi.fn() } },
      find: operation === 'find'
        ? vi.fn().mockRejectedValue(new Error(`find ${token}`))
        : vi.fn().mockResolvedValue({ docs: [{ id: 42 }] }),
      count: operation === 'count'
        ? vi.fn().mockRejectedValue(new Error(`count ${token}`))
        : vi.fn().mockResolvedValue({ totalDocs: 0 }),
      delete: operation === 'delete'
        ? vi.fn().mockRejectedValue(new Error(`delete ${token}`))
        : vi.fn().mockResolvedValue({ id: 42 }),
    }
    const route = setup({ payload })
    const response = await route.handler(request({
      token,
      body: { ...inspectRequest, action: 'cleanup', leadId: encodeAcceptanceFixtureLeadId(42) },
    }))
    const text = await response.text()
    expect(response.status).toBe(503)
    expectNoStore(response)
    expect(text).not.toContain(token)
    expect(text).not.toContain('13800001111')
  })

  it('delete 后按 key 复查仍存在时返回 503', async () => {
    const payload: PayloadDouble = {
      db: { pool: { query: vi.fn() } },
      find: vi.fn().mockResolvedValue({ docs: [{ id: 42 }] }),
      count: vi.fn().mockResolvedValue({ totalDocs: 0 }),
      delete: vi.fn().mockResolvedValue({ id: 42 }),
    }
    const route = setup({ payload })
    const response = await route.handler(request({
      body: { ...inspectRequest, action: 'cleanup', leadId: encodeAcceptanceFixtureLeadId(42) },
    }))
    expect(response.status).toBe(503)
    expect(payload.delete).toHaveBeenCalledOnce()
    expect(payload.find).toHaveBeenCalledTimes(2)
  })

  it('delete 后复查查询异常时返回脱敏 503', async () => {
    const token = permitToken()
    const payload: PayloadDouble = {
      db: { pool: { query: vi.fn() } },
      find: vi.fn()
        .mockResolvedValueOnce({ docs: [{ id: 42 }] })
        .mockRejectedValueOnce(new Error(`recheck ${token}`)),
      count: vi.fn().mockResolvedValue({ totalDocs: 0 }),
      delete: vi.fn().mockResolvedValue({ id: 42 }),
    }
    const route = setup({ payload })
    const response = await route.handler(request({
      token,
      body: { ...inspectRequest, action: 'cleanup', leadId: encodeAcceptanceFixtureLeadId(42) },
    }))
    const text = await response.text()
    expect(response.status).toBe(503)
    expectNoStore(response)
    expect(text).not.toContain(token)
    expect(payload.delete).toHaveBeenCalledOnce()
    expect(payload.find).toHaveBeenCalledTimes(2)
  })
})
