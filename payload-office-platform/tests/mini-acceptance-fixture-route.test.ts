import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  createLocalReq: vi.fn(),
}))

vi.mock('payload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('payload')>()
  return { ...actual, createLocalReq: io.createLocalReq }
})

import { createAcceptanceFixturePostHandler } from '@/app/api/mini/v1/acceptance/leads/route'
import { databaseFingerprint } from '@/domain/mini-program/acceptance-attestation'
import {
  computeAcceptanceFixtureLocator,
  decodeAcceptanceFixtureLeadId,
  encodeAcceptanceFixtureLeadId,
  parseAcceptanceFixtureRequest,
  type AcceptanceFixtureRequest,
} from '@/domain/mini-program/acceptance-fixture'
import {
  acceptanceRecoveryReceiptDigest,
  acceptanceFixtureNamespace,
  issueAcceptanceInspectPermit,
  issueAcceptancePermit,
  issueAcceptanceRecoveryPermit,
  signAcceptancePermitPayloadForTests,
  signAcceptanceRecoveryReceiptPayloadForTests,
} from '@/domain/mini-program/acceptance-permit'

const attestationSecret = Uint8Array.from({ length: 32 }, (_, index) => index + 1)
const operatorSecret = Uint8Array.from({ length: 32 }, (_, index) => index + 33)
const permitSecret = Uint8Array.from({ length: 32 }, (_, index) => index + 65)
const identity = { databaseName: 'sbh_staging', serverAddress: '10.0.0.4', serverPort: 5432 }
const fingerprint = databaseFingerprint(identity, attestationSecret)
const runId = '550e8400-e29b-41d4-a716-446655440000'
const submissionRequestId = '650e8400-e29b-41d4-a716-446655440000'
const listingSlug = 'jingan-center-100-monthly'
const context = {
  runId,
  submissionRequestId,
  listingSlug,
  fixtureNamespace: acceptanceFixtureNamespace(runId),
  expectedGitCommitSha: 'a'.repeat(40),
  expectedDeploymentRevision: 'revision-1',
  expectedDbFingerprint: fingerprint,
}
const nowMs = Date.now()
const databaseNowMs = nowMs + 1
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
  submissionRequestId,
  listingSlug,
} as const satisfies AcceptanceFixtureRequest
const recoverRequest = {
  action: 'recover',
  submissionRequestId,
  listingSlug,
  recoveryReceipt: `${Buffer.from('{"version":1}').toString('base64url')}.${Buffer.alloc(32, 1).toString('base64url')}`,
} as const

type LeadId = number | string
type LeadDoc = Readonly<{ id: LeadId; [key: string]: unknown }>
type PayloadDouble = Readonly<{
  db: Readonly<{
    pool: Readonly<{ query: ReturnType<typeof vi.fn> }>
    sessions?: Record<string, unknown>
    beginTransaction?: ReturnType<typeof vi.fn>
    commitTransaction?: ReturnType<typeof vi.fn>
    rollbackTransaction?: ReturnType<typeof vi.fn>
  }>
  find: ReturnType<typeof vi.fn>
  count: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
}>
type HandlerDeps = Readonly<{
  readConfig: () => typeof runtimeConfig | null
  getPayload: () => Promise<PayloadDouble>
  requestId: () => string
}>

function permitToken(changes: Partial<typeof context> = {}, issuedAt = nowMs): string {
  const candidate = { ...context, ...changes }
  return issueAcceptancePermit(candidate, permitSecret, issuedAt, () => Buffer.alloc(16, 7)).token
}

function inspectPermitToken(changes: Partial<typeof context> = {}, issuedAt = nowMs): string {
  const candidate = { ...context, ...changes }
  return issueAcceptanceInspectPermit(candidate, permitSecret, issuedAt, () => Buffer.alloc(16, 8)).token
}

function recoveryBundle(options: Readonly<{
  expectedLeadId?: string | null
  recoveryMode?: 'unknown-first-write' | 'known-lead'
  writerNonce?: number
  recoveryNonce?: number
  writerIssuedAt?: number
  recoveryIssuedAt?: number
  context?: typeof context
}> = {}) {
  const candidate = options.context ?? context
  const writer = issueAcceptancePermit(
    candidate,
    permitSecret,
    options.writerIssuedAt ?? nowMs - 600_000,
    () => Buffer.alloc(16, options.writerNonce ?? 9),
  )
  const recoveryMode = options.recoveryMode ?? 'unknown-first-write'
  const expectedLeadId = options.expectedLeadId ?? null
  const recovery = issueAcceptanceRecoveryPermit(
    candidate,
    writer.recoveryReceipt,
    { recoveryMode, expectedLeadId },
    permitSecret,
    options.recoveryIssuedAt ?? nowMs,
    () => Buffer.alloc(16, options.recoveryNonce ?? 10),
  )
  return { writer, recovery }
}

function unexpiredRecoveryBundle() {
  const writer = issueAcceptancePermit(
    context,
    permitSecret,
    nowMs,
    () => Buffer.alloc(16, 11),
  )
  const token = signAcceptancePermitPayloadForTests({
    version: 1,
    purpose: 'acceptance-recovery',
    runId: context.runId,
    submissionRequestId: context.submissionRequestId,
    listingSlug: context.listingSlug,
    fixtureNamespace: context.fixtureNamespace,
    gitSHA: context.expectedGitCommitSha,
    revision: context.expectedDeploymentRevision,
    dbFingerprint: context.expectedDbFingerprint,
    iat: nowMs,
    exp: nowMs + 600_000,
    jti: Buffer.alloc(16, 12).toString('base64url'),
    recoveryReceiptDigest: acceptanceRecoveryReceiptDigest(writer.recoveryReceipt),
    recoveryMode: 'unknown-first-write',
    expectedLeadId: null,
  }, permitSecret)
  return { writer, token }
}

function tamperSignature(token: string): string {
  const [body, signature] = token.split('.')
  if (!body || !signature) throw new Error('test token malformed')
  return `${body}.${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`
}

function recoveryTokenBoundTo(
  recovery: ReturnType<typeof recoveryBundle>['recovery'],
  recoveryReceipt: string,
): string {
  return signAcceptancePermitPayloadForTests({
    ...recovery.payload,
    recoveryReceiptDigest: acceptanceRecoveryReceiptDigest(recoveryReceipt),
  }, permitSecret)
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
  databaseNowMs: number
  lockResult: boolean
  transactionExecute: ReturnType<typeof vi.fn>
  beginTransaction: ReturnType<typeof vi.fn>
  commitTransaction: ReturnType<typeof vi.fn>
  rollbackTransaction: ReturnType<typeof vi.fn>
}> = {}) {
  const basePayload = overrides.payload ?? {
    db: { pool: { query: vi.fn() } },
    find: vi.fn().mockResolvedValue({ docs: [] }),
    count: vi.fn().mockResolvedValue({ totalDocs: 0 }),
    delete: vi.fn().mockResolvedValue({ id: 1 }),
  }
  const sessions: Record<string, { db: { execute: ReturnType<typeof vi.fn> } }> = {}
  let transactionIndex = 0
  let executeCalls = 0
  const transactionExecute = overrides.transactionExecute ?? vi.fn().mockImplementation(async () => {
    executeCalls += 1
    return executeCalls % 2 === 1
      ? { rows: [{ locked: overrides.lockResult ?? true }] }
      : { rows: [{ ...identity, nowMs: String(overrides.databaseNowMs ?? databaseNowMs) }] }
  })
  const beginTransaction = overrides.beginTransaction ?? vi.fn().mockImplementation(async () => {
    const id = `fixture-tx-${++transactionIndex}`
    sessions[id] = { db: { execute: transactionExecute } }
    return id
  })
  const commitTransaction = overrides.commitTransaction ?? vi.fn().mockImplementation(async (id: string) => {
    delete sessions[id]
  })
  const rollbackTransaction = overrides.rollbackTransaction ?? vi.fn().mockImplementation(async (id: string) => {
    delete sessions[id]
  })
  const payload = {
    ...basePayload,
    db: {
      ...basePayload.db,
      sessions,
      beginTransaction,
      commitTransaction,
      rollbackTransaction,
    },
  }
  const getPayload = vi.fn().mockResolvedValue(payload)
  const readConfig = vi.fn().mockReturnValue(
    Object.prototype.hasOwnProperty.call(overrides, 'config') ? overrides.config : runtimeConfig,
  )
  const factory = createAcceptanceFixturePostHandler as unknown as (
    deps: HandlerDeps,
  ) => (request: Request) => Promise<Response>
  return {
    handler: factory({ readConfig, getPayload, requestId: () => 'fixture-request-id' }),
    payload,
    getPayload,
    readConfig,
    transactionExecute,
    beginTransaction,
    commitTransaction,
    rollbackTransaction,
  }
}

function expectNoStore(response: Response): void {
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(response.headers.get('x-request-id')).toBe('fixture-request-id')
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>
}

describe('acceptance fixture recovery parser', () => {
  it.each<Readonly<[LeadId, string]>>([
    [42, 'n:42'],
    ['42', 's:NDI'],
  ])('canonical tagged Lead ID 可无损恢复原始 %s 标量', (leadId, tagged) => {
    expect(decodeAcceptanceFixtureLeadId(tagged)).toBe(leadId)
  })

  it('只接受 action/submissionRequestId/listingSlug/recoveryReceipt 四个自有字段', async () => {
    expect(parseAcceptanceFixtureRequest(recoverRequest)).toEqual({
      ok: true,
      data: recoverRequest,
    })
    await expect(computeAcceptanceFixtureLocator(runId, recoverRequest as AcceptanceFixtureRequest))
      .resolves.toBe(await computeAcceptanceFixtureLocator(runId, inspectRequest))
  })

  it.each([
    ['recoveryMode', 'unknown-first-write'],
    ['expectedLeadId', null],
    ['runId', runId],
    ['locator', 'a'.repeat(64)],
    ['lockKey', 1],
    ['dbFingerprint', fingerprint],
  ])('拒绝 recover body 自行扩权字段 %s', (field, value) => {
    expect(parseAcceptanceFixtureRequest({ ...recoverRequest, [field]: value }))
      .toEqual({ ok: false, error: 'invalid_request' })
  })

  it.each([
    '',
    'single-segment',
    '.signature',
    'payload.',
    'payload.signature.extra',
    `payload.${'x'.repeat(4090)}`,
  ])('拒绝非 canonical 或超限 recovery receipt: %s', (recoveryReceipt) => {
    expect(parseAcceptanceFixtureRequest({ ...recoverRequest, recoveryReceipt }))
      .toEqual({ ok: false, error: 'invalid_request' })
  })

  it('不从原型继承 recover 必填字段，也拒绝原型上的额外能力字段', () => {
    const inheritedRequired = Object.create(recoverRequest) as Record<string, unknown>
    expect(parseAcceptanceFixtureRequest(inheritedRequired))
      .toEqual({ ok: false, error: 'invalid_request' })

    const inheritedCapability = Object.create({ expectedLeadId: null }) as Record<string, unknown>
    Object.assign(inheritedCapability, recoverRequest)
    expect(parseAcceptanceFixtureRequest(inheritedCapability))
      .toEqual({ ok: false, error: 'invalid_request' })
  })
})

describe('POST acceptance fixture leads route', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(nowMs)
    vi.clearAllMocks()
    io.createLocalReq.mockResolvedValue({ context: {} })
  })
  afterEach(() => vi.useRealTimers())

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
  })

  it('lock 后同一 transaction executor 的数据库身份不匹配时回滚且零业务读写', async () => {
    const transactionExecute = vi.fn()
      .mockResolvedValueOnce({ rows: [{ locked: true }] })
      .mockResolvedValueOnce({
        rows: [{ ...identity, databaseName: 'other_staging', nowMs: String(databaseNowMs) }],
      })
    const route = setup({ transactionExecute })

    const response = await route.handler(request())

    expect(response.status).toBe(503)
    expect(transactionExecute).toHaveBeenCalledTimes(2)
    expect(route.rollbackTransaction).toHaveBeenCalledOnce()
    expect(route.payload.find).not.toHaveBeenCalled()
    expect(route.payload.count).not.toHaveBeenCalled()
    expect(route.payload.delete).not.toHaveBeenCalled()
  })

  it('执行 exact scope-action 能力矩阵，body 不能把能力升级', async () => {
    const recovery = recoveryBundle()
    const cleanupBody = {
      ...inspectRequest,
      action: 'cleanup',
      leadId: encodeAcceptanceFixtureLeadId(42),
    } as const
    const validRecoverBody = {
      ...recoverRequest,
      recoveryReceipt: recovery.writer.recoveryReceipt,
    }
    const cases = [
      ['write→inspect', permitToken(), inspectRequest, 200],
      ['inspect→inspect', inspectPermitToken(), inspectRequest, 200],
      ['recovery→inspect', recovery.recovery.token, inspectRequest, 404],
      ['write→cleanup', permitToken(), cleanupBody, 200],
      ['inspect→cleanup', inspectPermitToken(), cleanupBody, 404],
      ['recovery→cleanup', recovery.recovery.token, cleanupBody, 404],
      ['write→recover', permitToken(), validRecoverBody, 404],
      ['inspect→recover', inspectPermitToken(), validRecoverBody, 404],
      ['recovery→recover', recovery.recovery.token, validRecoverBody, 200],
    ] as const

    for (const [label, token, body, status] of cases) {
      const route = setup({ databaseNowMs: nowMs })
      const response = await route.handler(request({ token, body }))
      expect(response.status, label).toBe(status)
      if (status === 404) {
        expect(route.getPayload, label).not.toHaveBeenCalled()
      }
    }
  })

  it('三种 scope 都把 signed submission/listing 与 body 逐字交叉验证', async () => {
    const otherContext = {
      ...context,
      submissionRequestId: '750e8400-e29b-41d4-a716-446655440000',
      listingSlug: 'other-listing',
    }
    const otherRecovery = recoveryBundle({ context: otherContext })
    const cases = [
      ['write', permitToken({
        submissionRequestId: otherContext.submissionRequestId,
        listingSlug: otherContext.listingSlug,
      }), inspectRequest],
      ['inspect', inspectPermitToken({
        submissionRequestId: otherContext.submissionRequestId,
        listingSlug: otherContext.listingSlug,
      }), inspectRequest],
      ['recovery', otherRecovery.recovery.token, {
        ...recoverRequest,
        recoveryReceipt: otherRecovery.writer.recoveryReceipt,
      }],
    ] as const

    for (const [label, token, body] of cases) {
      const route = setup()
      const response = await route.handler(request({ token, body }))
      expect(response.status, label).toBe(404)
      expect(route.getPayload, label).not.toHaveBeenCalled()
    }
  })

  it('inspect/cleanup/recover 在 lock busy 时统一回滚且业务读写为零', async () => {
    const recovery = recoveryBundle()
    const cases = [
      [permitToken(), inspectRequest],
      [permitToken(), {
        ...inspectRequest,
        action: 'cleanup',
        leadId: encodeAcceptanceFixtureLeadId(42),
      }],
      [recovery.recovery.token, {
        ...recoverRequest,
        recoveryReceipt: recovery.writer.recoveryReceipt,
      }],
    ] as const

    for (const [token, body] of cases) {
      const route = setup({ lockResult: false })
      const response = await route.handler(request({ token, body }))
      expect(response.status).toBe(503)
      expect(route.rollbackTransaction).toHaveBeenCalledOnce()
      expect(route.payload.find).not.toHaveBeenCalled()
      expect(route.payload.count).not.toHaveBeenCalled()
      expect(route.payload.delete).not.toHaveBeenCalled()
      expect(route.transactionExecute).toHaveBeenCalledOnce()
    }
  })

  it('锁后 PostgreSQL 时间令 scope token 失效时零业务 action', async () => {
    const route = setup({ databaseNowMs: nowMs + 600_000 })
    const response = await route.handler(request({ token: inspectPermitToken() }))

    expect(response.status).toBe(503)
    expect(route.rollbackTransaction).toHaveBeenCalledOnce()
    expect(route.payload.find).not.toHaveBeenCalled()
    expect(route.payload.count).not.toHaveBeenCalled()
    expect(route.payload.delete).not.toHaveBeenCalled()
  })

  it('cleanup 的 initial find/count/delete/final find/count 全部顺序绑定同一 transactionID', async () => {
    const events: string[] = []
    const transactionIDs: unknown[] = []
    let findCalls = 0
    const payload: PayloadDouble = {
      db: { pool: { query: vi.fn() } },
      find: vi.fn().mockImplementation(async ({ req }) => {
        transactionIDs.push(req?.transactionID)
        events.push('find')
        findCalls += 1
        return { docs: findCalls === 1 ? [{ id: 42 }] : [] }
      }),
      count: vi.fn().mockImplementation(async ({ collection, req }) => {
        transactionIDs.push(req?.transactionID)
        events.push(`count:${collection}`)
        return { totalDocs: 0 }
      }),
      delete: vi.fn().mockImplementation(async ({ req }) => {
        transactionIDs.push(req?.transactionID)
        events.push('delete')
        return { id: 42 }
      }),
    }
    const route = setup({ payload })
    const response = await route.handler(request({ body: {
      ...inspectRequest,
      action: 'cleanup',
      leadId: encodeAcceptanceFixtureLeadId(42),
    } }))

    expect(response.status).toBe(200)
    expect(events).toEqual([
      'find',
      'count:follow-ups',
      'count:lead-ownership-history',
      'delete',
      'find',
      'count:follow-ups',
      'count:lead-ownership-history',
    ])
    expect(transactionIDs).toEqual(Array(7).fill('fixture-tx-1'))
    expect(payload.find.mock.calls.every(([args]) => args.trash === true)).toBe(true)
    expect(route.commitTransaction).toHaveBeenCalledWith('fixture-tx-1')
  })

  it('可观察 commit failure 不返回成功也不复用 session rollback；rollback failure 也 fail-closed', async () => {
    const commitTransaction = vi.fn().mockRejectedValue(new Error('commit-sensitive'))
    const commitRoute = setup({ commitTransaction })
    const commitResponse = await commitRoute.handler(request())
    expect(commitResponse.status).toBe(503)
    expect(commitRoute.rollbackTransaction).not.toHaveBeenCalled()

    const rollbackTransaction = vi.fn().mockRejectedValue(new Error('rollback-sensitive'))
    const rollbackRoute = setup({ lockResult: false, rollbackTransaction })
    const rollbackResponse = await rollbackRoute.handler(request())
    expect(rollbackResponse.status).toBe(503)
    expect(rollbackRoute.payload.find).not.toHaveBeenCalled()
  })

  it('recover 在锁内拒绝 receipt 的 wrong purpose/signature/identity/digest', async () => {
    const recovery = recoveryBundle()
    const secondWriter = recoveryBundle({ writerNonce: 21, recoveryNonce: 22 }).writer
    const otherRunId = '850e8400-e29b-41d4-a716-446655440000'
    const otherContext = {
      ...context,
      runId: otherRunId,
      fixtureNamespace: acceptanceFixtureNamespace(otherRunId),
    }
    const otherReceipt = recoveryBundle({ context: otherContext }).writer.recoveryReceipt
    const wrongPurposeReceipt = signAcceptanceRecoveryReceiptPayloadForTests({
      ...recovery.writer.recoveryReceiptPayload,
      purpose: 'acceptance-recovery-wrong-purpose',
    }, permitSecret)
    const wrongSignatureReceipt = tamperSignature(recovery.writer.recoveryReceipt)
    const cases = [
      [
        'wrong purpose',
        wrongPurposeReceipt,
        recoveryTokenBoundTo(recovery.recovery, wrongPurposeReceipt),
      ],
      [
        'wrong signature',
        wrongSignatureReceipt,
        recoveryTokenBoundTo(recovery.recovery, wrongSignatureReceipt),
      ],
      [
        'wrong identity',
        otherReceipt,
        recoveryTokenBoundTo(recovery.recovery, otherReceipt),
      ],
      ['digest mismatch', secondWriter.recoveryReceipt, recovery.recovery.token],
    ] as const

    for (const [label, recoveryReceipt, token] of cases) {
      const route = setup({ databaseNowMs: nowMs })
      const response = await route.handler(request({
        token,
        body: { ...recoverRequest, recoveryReceipt },
      }))
      expect(response.status, label).toBe(409)
      expect(route.rollbackTransaction, label).toHaveBeenCalledOnce()
      expect(route.payload.find, label).not.toHaveBeenCalled()
      expect(route.payload.count, label).not.toHaveBeenCalled()
      expect(route.payload.delete, label).not.toHaveBeenCalled()
    }
  })

  it('writer receipt 未到期拒绝；dbNow === writerExp 的边界允许 recovery', async () => {
    const early = unexpiredRecoveryBundle()
    const earlyRoute = setup({ databaseNowMs: nowMs + 1 })
    const earlyResponse = await earlyRoute.handler(request({
      token: early.token,
      body: { ...recoverRequest, recoveryReceipt: early.writer.recoveryReceipt },
    }))
    expect(earlyResponse.status).toBe(409)
    expect(earlyRoute.payload.find).not.toHaveBeenCalled()
    expect(earlyRoute.rollbackTransaction).toHaveBeenCalledOnce()

    const boundary = recoveryBundle({
      writerIssuedAt: nowMs - 600_000,
      recoveryIssuedAt: nowMs,
    })
    const boundaryRoute = setup({ databaseNowMs: nowMs })
    const boundaryResponse = await boundaryRoute.handler(request({
      token: boundary.recovery.token,
      body: { ...recoverRequest, recoveryReceipt: boundary.writer.recoveryReceipt },
    }))
    expect(boundaryResponse.status).toBe(200)
    expect(boundaryRoute.commitTransaction).toHaveBeenCalledOnce()
  })

  it('unknown-first-write 在零 Lead 时幂等成功，在唯一零关系 Lead 时收养并删除', async () => {
    const recovery = recoveryBundle()
    const body = { ...recoverRequest, recoveryReceipt: recovery.writer.recoveryReceipt }

    const zero = setup({ databaseNowMs: nowMs })
    const zeroResponse = await zero.handler(request({ token: recovery.recovery.token, body }))
    expect(zeroResponse.status).toBe(200)
    expect(await responseJson(zeroResponse)).toMatchObject({
      result: {
        cleaned: false,
        leadCount: 0,
        followUpCount: 0,
        ownershipHistoryCount: 0,
      },
    })
    expect(zero.payload.find).toHaveBeenCalledTimes(2)
    expect(zero.payload.delete).not.toHaveBeenCalled()

    let findCalls = 0
    const transactionIDs: unknown[] = []
    const payload: PayloadDouble = {
      db: { pool: { query: vi.fn() } },
      find: vi.fn().mockImplementation(async ({ req }) => {
        transactionIDs.push(req?.transactionID)
        findCalls += 1
        return { docs: findCalls === 1 ? [{ id: 42 }] : [] }
      }),
      count: vi.fn().mockImplementation(async ({ req }) => {
        transactionIDs.push(req?.transactionID)
        return { totalDocs: 0 }
      }),
      delete: vi.fn().mockImplementation(async ({ req }) => {
        transactionIDs.push(req?.transactionID)
        return { id: 42 }
      }),
    }
    const adopted = setup({ payload, databaseNowMs: nowMs })
    const adoptedResponse = await adopted.handler(request({ token: recovery.recovery.token, body }))
    expect(adoptedResponse.status).toBe(200)
    expect(await responseJson(adoptedResponse)).toMatchObject({ result: { cleaned: true } })
    expect(payload.delete).toHaveBeenCalledOnce()
    expect(transactionIDs).toEqual(Array(7).fill('fixture-tx-1'))
  })

  it('unknown-first-write 对多 Lead 或任一关系 fail-closed 且零 delete', async () => {
    const recovery = recoveryBundle()
    const body = { ...recoverRequest, recoveryReceipt: recovery.writer.recoveryReceipt }
    const multiplePayload: PayloadDouble = {
      db: { pool: { query: vi.fn() } },
      find: vi.fn().mockResolvedValue({ docs: [{ id: 1 }, { id: 2 }] }),
      count: vi.fn(),
      delete: vi.fn(),
    }
    const multiple = setup({ payload: multiplePayload, databaseNowMs: nowMs })
    expect((await multiple.handler(request({ token: recovery.recovery.token, body }))).status).toBe(409)
    expect(multiplePayload.count).not.toHaveBeenCalled()
    expect(multiplePayload.delete).not.toHaveBeenCalled()

    const relatedPayload: PayloadDouble = {
      db: { pool: { query: vi.fn() } },
      find: vi.fn().mockResolvedValue({ docs: [{ id: 42 }] }),
      count: vi.fn()
        .mockResolvedValueOnce({ totalDocs: 1 })
        .mockResolvedValueOnce({ totalDocs: 0 }),
      delete: vi.fn(),
    }
    const related = setup({ payload: relatedPayload, databaseNowMs: nowMs })
    expect((await related.handler(request({ token: recovery.recovery.token, body }))).status).toBe(409)
    expect(relatedPayload.count).toHaveBeenCalledTimes(2)
    expect(relatedPayload.delete).not.toHaveBeenCalled()
  })

  it('known-lead 只信 signed expectedLeadId：零/exact 幂等，ID change/multiple/relations 拒绝', async () => {
    const recovery = recoveryBundle({
      recoveryMode: 'known-lead',
      expectedLeadId: encodeAcceptanceFixtureLeadId(42),
    })
    const body = { ...recoverRequest, recoveryReceipt: recovery.writer.recoveryReceipt }

    const zeroEvents: string[] = []
    const zeroTransactionIDs: unknown[] = []
    const zeroPayload: PayloadDouble = {
      db: { pool: { query: vi.fn() } },
      find: vi.fn().mockImplementation(async ({ req }) => {
        zeroEvents.push('find')
        zeroTransactionIDs.push(req?.transactionID)
        return { docs: [] }
      }),
      count: vi.fn().mockImplementation(async ({ collection, where, req }) => {
        zeroEvents.push(`count:${collection}:${typeof where.lead.equals}:${String(where.lead.equals)}`)
        zeroTransactionIDs.push(req?.transactionID)
        return { totalDocs: 0 }
      }),
      delete: vi.fn(),
    }
    const zero = setup({ payload: zeroPayload, databaseNowMs: nowMs })
    expect((await zero.handler(request({ token: recovery.recovery.token, body }))).status).toBe(200)
    expect(zero.payload.delete).not.toHaveBeenCalled()
    expect(zeroEvents).toEqual([
      'find',
      'count:follow-ups:number:42',
      'count:lead-ownership-history:number:42',
      'find',
      'count:follow-ups:number:42',
      'count:lead-ownership-history:number:42',
    ])
    expect(zeroTransactionIDs).toEqual(Array(6).fill('fixture-tx-1'))

    let exactFindCalls = 0
    const exactPayload: PayloadDouble = {
      db: { pool: { query: vi.fn() } },
      find: vi.fn().mockImplementation(async () => {
        exactFindCalls += 1
        return { docs: exactFindCalls === 1 ? [{ id: 42 }] : [] }
      }),
      count: vi.fn().mockResolvedValue({ totalDocs: 0 }),
      delete: vi.fn().mockResolvedValue({ id: 42 }),
    }
    const exact = setup({ payload: exactPayload, databaseNowMs: nowMs })
    expect((await exact.handler(request({ token: recovery.recovery.token, body }))).status).toBe(200)
    expect(exactPayload.delete).toHaveBeenCalledOnce()

    for (const docs of [[{ id: 43 }], [{ id: 42 }, { id: 43 }]]) {
      const payload: PayloadDouble = {
        db: { pool: { query: vi.fn() } },
        find: vi.fn().mockResolvedValue({ docs }),
        count: vi.fn(),
        delete: vi.fn(),
      }
      const route = setup({ payload, databaseNowMs: nowMs })
      expect((await route.handler(request({ token: recovery.recovery.token, body }))).status).toBe(409)
      expect(payload.count).not.toHaveBeenCalled()
      expect(payload.delete).not.toHaveBeenCalled()
    }

    const relatedPayload: PayloadDouble = {
      db: { pool: { query: vi.fn() } },
      find: vi.fn().mockResolvedValue({ docs: [{ id: 42 }] }),
      count: vi.fn()
        .mockResolvedValueOnce({ totalDocs: 0 })
        .mockResolvedValueOnce({ totalDocs: 1 }),
      delete: vi.fn(),
    }
    const related = setup({ payload: relatedPayload, databaseNowMs: nowMs })
    expect((await related.handler(request({ token: recovery.recovery.token, body }))).status).toBe(409)
    expect(relatedPayload.delete).not.toHaveBeenCalled()
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
      trash: true,
      req: expect.any(Object),
    })
    expect(route.payload.count).not.toHaveBeenCalled()
    expect(route.payload.delete).not.toHaveBeenCalled()
  })

  it('inspect 必须包含回收站 Lead，不能把仍含 PII 的 trashed 文档报告为全零', async () => {
    const payload: PayloadDouble = {
      db: { pool: { query: vi.fn() } },
      find: vi.fn().mockImplementation(async ({ trash }) => ({
        docs: trash === true
          ? [{ id: 42, deletedAt: '2026-09-01T00:00:00.000Z', phone: '13800001111' }]
          : [],
      })),
      count: vi.fn().mockResolvedValue({ totalDocs: 0 }),
      delete: vi.fn(),
    }
    const route = setup({ payload })

    const response = await route.handler(request())

    expect(response.status).toBe(200)
    expect(await responseJson(response)).toMatchObject({
      result: {
        leadCount: 1,
        leadId: 'n:42',
        followUpCount: 0,
        ownershipHistoryCount: 0,
      },
    })
    expect(payload.find).toHaveBeenCalledWith(expect.objectContaining({ trash: true }))
    expect(payload.delete).not.toHaveBeenCalled()
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
      [{
        collection: 'follow-ups',
        where: { lead: { equals: id } },
        overrideAccess: true,
        req: expect.any(Object),
      }],
      [{
        collection: 'lead-ownership-history',
        where: { lead: { equals: id } },
        overrideAccess: true,
        req: expect.any(Object),
      }],
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
    expect(route.payload.find).toHaveBeenCalledTimes(2)
    expect(route.payload.count).toHaveBeenCalledTimes(4)
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
      trash: true,
      req: expect.any(Object),
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
    expect(payload.count).toHaveBeenCalledTimes(3)
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
