import { beforeEach, describe, expect, it, vi } from 'vitest'
const io = vi.hoisted(() => ({ getPayload: vi.fn(), readConfig: vi.fn() }))
vi.mock('payload', async (importOriginal) => ({
  ...(await importOriginal<typeof import('payload')>()),
  getPayload: io.getPayload,
}))
vi.mock('@/lib/mini-program/acceptance-runtime-config', () => ({ readAcceptanceRuntimeConfig: io.readConfig }))
import { POST, createAcceptancePermitPostHandler } from '@/app/api/mini/v1/acceptance/permits/route'
import { databaseFingerprint } from '@/domain/mini-program/acceptance-attestation'
import {
  acceptanceFixtureNamespace,
  issueAcceptanceInspectPermit,
  issueAcceptancePermit,
  issueAcceptanceRecoveryPermit,
  verifyAcceptancePermit,
  verifyAcceptanceInspectPermitToken,
  verifyAcceptanceRecoveryPermitToken,
} from '@/domain/mini-program/acceptance-permit'
import { ACCEPTANCE_DB_PROBE_SQL } from '@/lib/mini-program/acceptance-db-probe'

const key = Uint8Array.from({ length: 32 }, (_, i) => i + 1)
const operator = Uint8Array.from({ length: 32 }, (_, i) => i + 33)
const permit = Uint8Array.from({ length: 32 }, (_, i) => i + 65)
const context = {
  runId: '550e8400-e29b-41d4-a716-446655440000',
  submissionRequestId: '650e8400-e29b-41d4-a716-446655440000',
  listingSlug: 'jingan-center-100-monthly',
  fixtureNamespace: acceptanceFixtureNamespace('550e8400-e29b-41d4-a716-446655440000'),
  expectedGitCommitSha: 'a'.repeat(40),
  expectedDeploymentRevision: 'rev-1',
  expectedDbFingerprint: databaseFingerprint({ databaseName: 'sbh', serverAddress: '10.0.0.4', serverPort: 5432 }, key),
}
const writeRequest = { mode: 'write' as const, ...context }
const inspectRequest = { mode: 'inspect' as const, ...context }
const PG_NOW = 1_700_000_600_000
const config = {
  deploymentGitCommitSha: context.expectedGitCommitSha,
  deploymentRevision: context.expectedDeploymentRevision,
  attestationSecret: key,
  operatorBootstrapSecret: operator,
  permitSigningSecret: permit,
  dbFingerprintAllowlist: [context.expectedDbFingerprint],
}
const auth = Buffer.from(operator).toString('base64url')
const query = vi.fn()
function request(body: unknown = writeRequest, headers: Record<string, string> = {}) {
  return new Request('https://example.test/api/mini/v1/acceptance/permits', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-sbh-acceptance-bootstrap': auth, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}
type HandlerDeps = Readonly<{
  readConfig: () => typeof config | null
  getPayload: () => Promise<{ db: { pool?: { query: ReturnType<typeof vi.fn> } } }>
  probe: typeof vi.fn
  issueWrite: typeof issueAcceptancePermit
  issueInspect: typeof issueAcceptanceInspectPermit
  issueRecovery: typeof issueAcceptanceRecoveryPermit
  random: (size: number) => Buffer
  requestId: () => string
}>

const permitHandlerFactory = createAcceptancePermitPostHandler as unknown as (
  deps: HandlerDeps,
) => (request: Request) => Promise<Response>

function injectedHandler(
  overrides: Partial<{
    config: typeof config
    probe: typeof vi.fn
    issueWrite: typeof issueAcceptancePermit
    issueInspect: typeof issueAcceptanceInspectPermit
    issueRecovery: typeof issueAcceptanceRecoveryPermit
    dbTimeQuery: ReturnType<typeof vi.fn>
  }> = {},
) {
  const probe =
    overrides.probe ??
    vi
      .fn()
      .mockResolvedValue({
        identity: { databaseName: 'sbh', serverAddress: '10.0.0.4', serverPort: 5432 },
        fingerprint: context.expectedDbFingerprint,
      })
  const issueWrite = overrides.issueWrite ?? vi.fn(issueAcceptancePermit)
  const issueInspect = overrides.issueInspect ?? vi.fn(issueAcceptanceInspectPermit)
  const issueRecovery = overrides.issueRecovery ?? vi.fn(issueAcceptanceRecoveryPermit)
  const dbTimeQuery = overrides.dbTimeQuery ?? vi.fn().mockResolvedValue({
    rows: [{ nowMs: String(PG_NOW) }],
    rowCount: 1,
  })
  return {
    handler: permitHandlerFactory({
      readConfig: () => overrides.config ?? config,
      getPayload: vi.fn().mockResolvedValue({ db: { pool: { query: dbTimeQuery } } }),
      probe: probe as never,
      issueWrite,
      issueInspect,
      issueRecovery,
      random: () => Buffer.alloc(16, 7),
      requestId: () => 'injected-request',
    }),
    probe,
    issueWrite,
    issueInspect,
    issueRecovery,
    dbTimeQuery,
  }
}

beforeEach(() => {
  query
    .mockReset()
    .mockImplementation(async ({ text }: { text: string }) => text.includes('clock_timestamp()')
      ? { rows: [{ nowMs: String(PG_NOW) }], rowCount: 1 }
      : { rows: [{ databaseName: 'sbh', serverAddress: '10.0.0.4', serverPort: 5432 }], rowCount: 1 })
  io.getPayload.mockReset().mockResolvedValue({ db: { pool: { query } } })
  io.readConfig.mockReset().mockReturnValue(config)
})

describe('acceptance permit route', () => {
  it('认证失败/disabled/非 JSON 均不初始化 Payload', async () => {
    expect((await POST(request(writeRequest, { 'x-sbh-acceptance-bootstrap': 'wrong' }))).status).toBe(404)
    io.readConfig.mockReturnValue(null)
    expect((await POST(request(writeRequest))).status).toBe(404)
    io.readConfig.mockReturnValue(config)
    expect((await POST(request(writeRequest, { 'content-type': 'text/plain' }))).status).toBe(415)
    expect(io.getPayload).not.toHaveBeenCalled()
  })

  it('允许带 charset 的 JSON content-type', async () => {
    const response = await POST(request(writeRequest, { 'content-type': 'application/json; charset=utf-8' }))
    expect(response.status).toBe(200)
  })

  it('拒绝相似但非 JSON media type', async () => {
    const response = await POST(request(writeRequest, { 'content-type': 'application/json-malicious' }))
    expect(response.status).toBe(415)
    expect(io.getPayload).not.toHaveBeenCalled()
  })
  it('严格 body 错误与 oversized 在 Payload 前拒绝', async () => {
    expect((await POST(request('{'))).status).toBe(400)
    expect((await POST(request({ ...writeRequest, extra: true }))).status).toBe(400)
    expect((await POST(request({ ...writeRequest, runId: 'bad' }))).status).toBe(400)
    expect((await POST(request('x'.repeat(20_000), { 'content-length': '20000' }))).status).toBe(413)
    expect(io.getPayload).not.toHaveBeenCalled()
  })

  it.each([
    ['runId', { runId: 'bad' }],
    ['submissionRequestId', { submissionRequestId: 'bad' }],
    ['listingSlug', { listingSlug: 'Jingan-Center' }],
    ['fixtureNamespace', { fixtureNamespace: 'bad' }],
    ['SHA', { expectedGitCommitSha: 'bad' }],
    ['revision', { expectedDeploymentRevision: 1 }],
    ['fingerprint', { expectedDbFingerprint: 'bad' }],
  ])('字段 %s 非法时在 Payload 前拒绝', async (_label, change) => {
    const response = await POST(request({ ...writeRequest, ...change }))
    expect(response.status).toBe(400)
    expect(io.getPayload).not.toHaveBeenCalled()
  })

  it('chunked oversized body 返回 413 并取消流', async () => {
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode('x'.repeat(20_000)))
      },
      cancel() {
        cancelled = true
      },
    })
    const response = await POST(
      new Request('https://example.test/api/mini/v1/acceptance/permits', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-sbh-acceptance-bootstrap': auth },
        body: stream,
        duplex: 'half',
      } as RequestInit & { duplex: 'half' }),
    )
    expect(response.status).toBe(413)
    expect(cancelled).toBe(true)
    expect(io.getPayload).not.toHaveBeenCalled()
  })
  it('write 使用 PostgreSQL clock_timestamp 签发 exact response 与独立 receipt', async () => {
    const response = await POST(request(writeRequest))
    expect(response.status).toBe(200)
    expect(query).toHaveBeenCalledWith({ text: ACCEPTANCE_DB_PROBE_SQL, values: [] })
    const body = await response.json()
    expect(Object.keys(body).sort()).toEqual(['expiresAt', 'issuedAt', 'meta', 'ok', 'permit', 'recoveryReceipt'].sort())
    expect(verifyAcceptancePermit(body.permit, context, permit, PG_NOW + 1)).toBeTruthy()
    expect(body.issuedAt).toBe(new Date(PG_NOW).toISOString())
    expect(body.expiresAt).toBe(new Date(PG_NOW + 600_000).toISOString())
    expect(body.recoveryReceipt).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/)
    expect(query.mock.calls.some(([params]) => String(params.text).includes('clock_timestamp()'))).toBe(true)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it('inspect 只返回 inspect permit，不返回 write receipt', async () => {
    const response = await POST(request(inspectRequest))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(Object.keys(body).sort()).toEqual(['expiresAt', 'issuedAt', 'meta', 'ok', 'permit'].sort())
    expect(verifyAcceptanceInspectPermitToken(body.permit, permit, PG_NOW + 1)).toMatchObject({
      purpose: 'acceptance-inspect',
      submissionRequestId: context.submissionRequestId,
      listingSlug: context.listingSlug,
    })
    expect(verifyAcceptancePermit(body.permit, context, permit, PG_NOW + 1)).toBeNull()
  })

  it('recovery 仅在旧 receipt 按 PG time 到期后签发 locator-bound recovery permit', async () => {
    const old = issueAcceptancePermit(
      context,
      permit,
      PG_NOW - 600_000,
      () => Buffer.alloc(16, 5),
    )
    const response = await POST(request({
      mode: 'recovery',
      ...context,
      recoveryReceipt: old.recoveryReceipt,
      recoveryMode: 'known-lead',
      expectedLeadId: 'n:42',
    }))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(Object.keys(body).sort()).toEqual(['expiresAt', 'issuedAt', 'meta', 'ok', 'permit'].sort())
    expect(verifyAcceptanceRecoveryPermitToken(body.permit, permit, PG_NOW + 1)).toMatchObject({
      purpose: 'acceptance-recovery',
      runId: context.runId,
      submissionRequestId: context.submissionRequestId,
      listingSlug: context.listingSlug,
      recoveryMode: 'known-lead',
      expectedLeadId: 'n:42',
    })
    expect(verifyAcceptancePermit(body.permit, context, permit, PG_NOW + 1)).toBeNull()
  })

  it.each([
    ['receipt 未到期', (receipt: string) => receipt, PG_NOW - 599_999, context],
    ['receipt 篡改', (receipt: string) => `${receipt.slice(0, -1)}x`, PG_NOW - 600_000, context],
    ['receipt 错 run', (receipt: string) => receipt, PG_NOW - 600_000, {
      ...context,
      runId: '750e8400-e29b-41d4-a716-446655440000',
      fixtureNamespace: acceptanceFixtureNamespace('750e8400-e29b-41d4-a716-446655440000'),
    }],
    ['receipt 错 submission', (receipt: string) => receipt, PG_NOW - 600_000, {
      ...context,
      submissionRequestId: '750e8400-e29b-41d4-a716-446655440000',
    }],
    ['receipt 错 listing', (receipt: string) => receipt, PG_NOW - 600_000, {
      ...context,
      listingSlug: 'other-listing',
    }],
  ])('%s recovery fail-closed 且不返回 token', async (_label, mutate, issuedAt, requestContext) => {
    const old = issueAcceptancePermit(context, permit, issuedAt, () => Buffer.alloc(16, 5))
    const response = await POST(request({
      mode: 'recovery',
      ...requestContext,
      recoveryReceipt: mutate(old.recoveryReceipt),
      recoveryMode: 'unknown-first-write',
      expectedLeadId: null,
    }))
    expect(response.status).not.toBe(200)
    const body = await response.text()
    expect(body).not.toContain(old.recoveryReceipt)
    expect(body).not.toContain('permit')
  })

  it('无效 receipt 在 recovery issuer 前以 409 拒绝', async () => {
    const route = injectedHandler()
    const response = await route.handler(request({
      mode: 'recovery',
      ...context,
      recoveryReceipt: 'invalid.receipt',
      recoveryMode: 'unknown-first-write',
      expectedLeadId: null,
    }))
    expect(response.status).toBe(409)
    expect(route.issueRecovery).not.toHaveBeenCalled()
  })

  it('write permit 作为 wrong-purpose receipt 在 recovery issuer 前拒绝', async () => {
    const wrongPurpose = issueAcceptancePermit(
      context,
      permit,
      PG_NOW - 600_000,
      () => Buffer.alloc(16, 5),
    ).token
    const route = injectedHandler()
    const response = await route.handler(request({
      mode: 'recovery',
      ...context,
      recoveryReceipt: wrongPurpose,
      recoveryMode: 'unknown-first-write',
      expectedLeadId: null,
    }))
    expect(response.status).toBe(409)
    expect(route.issueRecovery).not.toHaveBeenCalled()
  })

  it('已验证 receipt 后 recovery issuer 的非预期异常返回 503', async () => {
    const old = issueAcceptancePermit(
      context,
      permit,
      PG_NOW - 600_000,
      () => Buffer.alloc(16, 5),
    )
    const issueRecovery = vi.fn(() => {
      throw new Error('unexpected issuer failure')
    }) as unknown as typeof issueAcceptanceRecoveryPermit
    const route = injectedHandler({ issueRecovery })
    const response = await route.handler(request({
      mode: 'recovery',
      ...context,
      recoveryReceipt: old.recoveryReceipt,
      recoveryMode: 'unknown-first-write',
      expectedLeadId: null,
    }))
    expect(response.status).toBe(503)
    expect(response.status).not.toBe(409)
    expect(await response.text()).not.toContain(old.recoveryReceipt)
  })

  it.each([
    ['unknown 带 Lead', { recoveryMode: 'unknown-first-write', expectedLeadId: 'n:42' }],
    ['known 缺 Lead', { recoveryMode: 'known-lead', expectedLeadId: null }],
    ['known 非 canonical Lead', { recoveryMode: 'known-lead', expectedLeadId: '42' }],
    ['错误 mode', { mode: 'WRITE' }],
  ])('%s 在 Payload 前拒绝', async (_label, change) => {
    const response = await POST(request({ ...writeRequest, mode: 'recovery', recoveryReceipt: 'a.b', ...change }))
    expect(response.status).toBe(400)
    expect(io.getPayload).not.toHaveBeenCalled()
  })

  it.each([
    ['SHA', { expectedGitCommitSha: 'c'.repeat(40) }],
    ['revision', { expectedDeploymentRevision: 'other-revision' }],
    ['fingerprint', { expectedDbFingerprint: 'd'.repeat(64) }],
  ])('注入 handler 的 %s mismatch 返回 409 且不 issue', async (_label, change) => {
    const { handler, issueWrite } = injectedHandler()
    const response = await handler(request({ ...writeRequest, ...change }))
    expect(response.status).toBe(409)
    expect(issueWrite).not.toHaveBeenCalled()
  })

  it('注入 handler 使用 pool 返回的 PG time，不接收本机 now 依赖', async () => {
    const { handler } = injectedHandler()
    const response = await handler(request(writeRequest))
    const body = await response.json()
    expect(body.issuedAt).toBe(new Date(PG_NOW).toISOString())
    expect(body.expiresAt).toBe(new Date(PG_NOW + 600_000).toISOString())
    expect(verifyAcceptancePermit(body.permit, context, permit, PG_NOW + 1)).toBeTruthy()
  })

  it('注入 handler 的 129 字符 auth 在认证前拒绝', async () => {
    const getPayload = vi.fn()
    const probe = vi.fn()
    const issue = vi.fn()
    const handler = permitHandlerFactory({
      readConfig: () => config,
      getPayload,
      probe: probe as never,
      issueWrite: issue as never,
      issueInspect: issueAcceptanceInspectPermit,
      issueRecovery: issueAcceptanceRecoveryPermit,
      random: () => Buffer.alloc(16, 7),
      requestId: () => 'auth-request',
    })
    const response = await handler(request(writeRequest, { 'x-sbh-acceptance-bootstrap': 'x'.repeat(129) }))
    expect(response.status).toBe(404)
    expect(getPayload).not.toHaveBeenCalled()
    expect(probe).not.toHaveBeenCalled()
    expect(issue).not.toHaveBeenCalled()
  })

  it('200/400/404/409/415/503 响应均不泄漏三类 secret', async () => {
    const secrets = [auth, Buffer.from(key).toString('base64url'), Buffer.from(permit).toString('base64url')]
    const checks: Response[] = []
    checks.push(await POST(request(writeRequest)))
    checks.push(await POST(request('{')))
    checks.push(await POST(request(writeRequest, { 'x-sbh-acceptance-bootstrap': 'wrong' })))
    const mismatch = injectedHandler()
    checks.push(await mismatch.handler(request({ ...writeRequest, expectedDeploymentRevision: 'other' })))
    checks.push(await POST(request(writeRequest, { 'content-type': 'text/plain' })))
    const failure = injectedHandler({ probe: vi.fn().mockRejectedValue(new Error('probe')) })
    checks.push(await failure.handler(request(writeRequest)))
    for (const response of checks) {
      const body = await response.text()
      for (const secret of secrets) expect(body).not.toContain(secret)
    }
  })

  it.each([
    ['probe failure', vi.fn().mockRejectedValue(new Error('db'))],
    [
      'allowlist miss',
      vi
        .fn()
        .mockResolvedValue({
          rows: [{ databaseName: 'other', serverAddress: '10.0.0.4', serverPort: 5432 }],
          rowCount: 1,
        }),
    ],
  ])('%s 返回 503', async (_label, query) => {
    io.getPayload.mockResolvedValue({ db: { pool: { query } } })
    const response = await POST(request(writeRequest))
    expect(response.status).toBe(503)
  })

  it.each([
    ['query failure', vi.fn().mockRejectedValue(new Error('clock'))],
    ['no row', vi.fn().mockResolvedValue({ rows: [], rowCount: 0 })],
    ['unsafe value', vi.fn().mockResolvedValue({ rows: [{ nowMs: '9007199254740992' }], rowCount: 1 })],
    ['wrong type', vi.fn().mockResolvedValue({ rows: [{ nowMs: PG_NOW }], rowCount: 1 })],
  ])('PG clock %s 时 503 且 issuer 零调用', async (_label, dbTimeQuery) => {
    const route = injectedHandler({ dbTimeQuery })
    const response = await route.handler(request(writeRequest))
    expect(response.status).toBe(503)
    expect(route.issueWrite).not.toHaveBeenCalled()
    expect(route.issueInspect).not.toHaveBeenCalled()
    expect(route.issueRecovery).not.toHaveBeenCalled()
    expect(await response.text()).not.toContain('permit')
  })
})
