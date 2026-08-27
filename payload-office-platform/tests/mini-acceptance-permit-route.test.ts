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
  issueAcceptancePermit,
  verifyAcceptancePermit,
} from '@/domain/mini-program/acceptance-permit'
import { ACCEPTANCE_DB_PROBE_SQL } from '@/lib/mini-program/acceptance-db-probe'

const key = Uint8Array.from({ length: 32 }, (_, i) => i + 1)
const operator = Uint8Array.from({ length: 32 }, (_, i) => i + 33)
const permit = Uint8Array.from({ length: 32 }, (_, i) => i + 65)
const context = {
  runId: '550e8400-e29b-41d4-a716-446655440000',
  fixtureNamespace: acceptanceFixtureNamespace('550e8400-e29b-41d4-a716-446655440000'),
  expectedGitCommitSha: 'a'.repeat(40),
  expectedDeploymentRevision: 'rev-1',
  expectedDbFingerprint: databaseFingerprint({ databaseName: 'sbh', serverAddress: '10.0.0.4', serverPort: 5432 }, key),
}
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
function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://example.test/api/mini/v1/acceptance/permits', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-sbh-acceptance-bootstrap': auth, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}
function injectedHandler(
  overrides: Partial<{ config: typeof config; probe: typeof vi.fn; issue: typeof issueAcceptancePermit }> = {},
) {
  const probe =
    overrides.probe ??
    vi
      .fn()
      .mockResolvedValue({
        identity: { databaseName: 'sbh', serverAddress: '10.0.0.4', serverPort: 5432 },
        fingerprint: context.expectedDbFingerprint,
      })
  const issue = overrides.issue ?? vi.fn(issueAcceptancePermit)
  return {
    handler: createAcceptancePermitPostHandler({
      readConfig: () => overrides.config ?? config,
      getPayload: vi.fn().mockResolvedValue({ db: { pool: { query: vi.fn() } } }),
      probe: probe as never,
      issue,
      now: () => 1_700_000_000_000,
      random: () => Buffer.alloc(16, 7),
      requestId: () => 'injected-request',
    }),
    probe,
    issue,
  }
}

beforeEach(() => {
  query
    .mockReset()
    .mockResolvedValue({ rows: [{ databaseName: 'sbh', serverAddress: '10.0.0.4', serverPort: 5432 }], rowCount: 1 })
  io.getPayload.mockReset().mockResolvedValue({ db: { pool: { query } } })
  io.readConfig.mockReset().mockReturnValue(config)
})

describe('acceptance permit route', () => {
  it('认证失败/disabled/非 JSON 均不初始化 Payload', async () => {
    expect((await POST(request(context, { 'x-sbh-acceptance-bootstrap': 'wrong' }))).status).toBe(404)
    io.readConfig.mockReturnValue(null)
    expect((await POST(request(context))).status).toBe(404)
    io.readConfig.mockReturnValue(config)
    expect((await POST(request(context, { 'content-type': 'text/plain' }))).status).toBe(415)
    expect(io.getPayload).not.toHaveBeenCalled()
  })

  it('允许带 charset 的 JSON content-type', async () => {
    const response = await POST(request(context, { 'content-type': 'application/json; charset=utf-8' }))
    expect(response.status).toBe(200)
  })

  it('拒绝相似但非 JSON media type', async () => {
    const response = await POST(request(context, { 'content-type': 'application/json-malicious' }))
    expect(response.status).toBe(415)
    expect(io.getPayload).not.toHaveBeenCalled()
  })
  it('严格 body 错误与 oversized 在 Payload 前拒绝', async () => {
    expect((await POST(request('{'))).status).toBe(400)
    expect((await POST(request({ ...context, extra: true }))).status).toBe(400)
    expect((await POST(request({ ...context, runId: 'bad' }))).status).toBe(400)
    expect((await POST(request('x'.repeat(20_000), { 'content-length': '20000' }))).status).toBe(413)
    expect(io.getPayload).not.toHaveBeenCalled()
  })

  it.each([
    ['runId', { runId: 'bad' }],
    ['fixtureNamespace', { fixtureNamespace: 'bad' }],
    ['SHA', { expectedGitCommitSha: 'bad' }],
    ['revision', { expectedDeploymentRevision: 1 }],
    ['fingerprint', { expectedDbFingerprint: 'bad' }],
  ])('字段 %s 非法时在 Payload 前拒绝', async (_label, change) => {
    const response = await POST(request({ ...context, ...change }))
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
  it('成功签发 token 并可验证，且精确执行固定 probe', async () => {
    const response = await POST(request(context))
    expect(response.status).toBe(200)
    expect(query).toHaveBeenCalledWith({ text: ACCEPTANCE_DB_PROBE_SQL, values: [] })
    const body = await response.json()
    expect(verifyAcceptancePermit(body.permit, context, permit)).toBeTruthy()
    expect(body.expiresAt).toBeTruthy()
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it.each([
    ['SHA', { expectedGitCommitSha: 'c'.repeat(40) }],
    ['revision', { expectedDeploymentRevision: 'other-revision' }],
    ['fingerprint', { expectedDbFingerprint: 'd'.repeat(64) }],
  ])('注入 handler 的 %s mismatch 返回 409 且不 issue', async (_label, change) => {
    const { handler, issue } = injectedHandler()
    const response = await handler(request({ ...context, ...change }))
    expect(response.status).toBe(409)
    expect(issue).not.toHaveBeenCalled()
  })

  it('注入 handler 固定 now/random 时 expiresAt 精确可验证', async () => {
    const { handler } = injectedHandler()
    const response = await handler(request(context))
    const body = await response.json()
    expect(body.expiresAt).toBe('2023-11-14T22:23:20.000Z')
    expect(verifyAcceptancePermit(body.permit, context, permit, 1_700_000_000_001)).toBeTruthy()
  })

  it('注入 handler 的 129 字符 auth 在认证前拒绝', async () => {
    const getPayload = vi.fn()
    const probe = vi.fn()
    const issue = vi.fn()
    const handler = createAcceptancePermitPostHandler({
      readConfig: () => config,
      getPayload,
      probe: probe as never,
      issue: issue as never,
      now: () => 1_700_000_000_000,
      random: () => Buffer.alloc(16, 7),
      requestId: () => 'auth-request',
    })
    const response = await handler(request(context, { 'x-sbh-acceptance-bootstrap': 'x'.repeat(129) }))
    expect(response.status).toBe(404)
    expect(getPayload).not.toHaveBeenCalled()
    expect(probe).not.toHaveBeenCalled()
    expect(issue).not.toHaveBeenCalled()
  })

  it('200/400/404/409/415/503 响应均不泄漏三类 secret', async () => {
    const secrets = [auth, Buffer.from(key).toString('base64url'), Buffer.from(permit).toString('base64url')]
    const checks: Response[] = []
    checks.push(await POST(request(context)))
    checks.push(await POST(request('{')))
    checks.push(await POST(request(context, { 'x-sbh-acceptance-bootstrap': 'wrong' })))
    const mismatch = injectedHandler()
    checks.push(await mismatch.handler(request({ ...context, expectedDeploymentRevision: 'other' })))
    checks.push(await POST(request(context, { 'content-type': 'text/plain' })))
    const failure = injectedHandler({ probe: vi.fn().mockRejectedValue(new Error('probe')) })
    checks.push(await failure.handler(request(context)))
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
    const response = await POST(request(context))
    expect(response.status).toBe(503)
  })
})
