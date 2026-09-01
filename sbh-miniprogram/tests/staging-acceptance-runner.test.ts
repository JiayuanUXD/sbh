import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const miniRoot = resolve(import.meta.dirname, '..')
const runnerPath = resolve(miniRoot, 'scripts/staging-acceptance-runner.mjs')
const RUN_ID = '550e8400-e29b-41d4-a716-446655440000'
const SUBMISSION_ID = '650e8400-e29b-41d4-a716-446655440000'
const SHA = 'a'.repeat(40)
const FINGERPRINT = 'b'.repeat(64)
const REVISION = 'deploy-2026-08-28'
const BOOTSTRAP = Buffer.from(Array.from({ length: 32 }, (_, index) => index + 33)).toString('base64url')
const PERMIT_BODY = Buffer.alloc(192, 7).toString('base64url')
const PERMIT_SIGNATURE = Buffer.alloc(32, 11).toString('base64url')
const PERMIT = `${PERMIT_BODY}.${PERMIT_SIGNATURE}`
const LEAD_ID = 'n:42'
const FIXTURE_NAMESPACE = `mp-e2e-${createHash('sha256').update(RUN_ID).digest('hex').slice(0, 16)}`
const validEnvironment = {
  MP_E2E_ALLOW_STAGING_WRITE: '1',
  MP_E2E_API_ORIGIN: 'https://sbhmini-305971-11-1253925058.sh.run.tcloudbase.com',
  MP_E2E_EXPECTED_GIT_COMMIT_SHA: SHA,
  MP_E2E_EXPECTED_DEPLOYMENT_REVISION: REVISION,
  MP_E2E_EXPECTED_DB_FINGERPRINT: FINGERPRINT,
  MP_E2E_RUN_ID: RUN_ID,
  MP_E2E_OPERATOR_BOOTSTRAP_SECRET: BOOTSTRAP,
  MP_E2E_LISTING_SLUG: 'jing-an-tower',
  MP_E2E_TEST_PHONE: '13800138000',
  MP_E2E_PRIVACY_POLICY_VERSION: '2026-08-28.v1',
}

type FetchCall = Readonly<{ url: string; init: RequestInit }>
type RunResult = Readonly<{
  ok: true
  manifest: Readonly<{
    cleanStartProven: boolean
    cleanupAttempted: boolean
    clean: boolean
  }>
}>
type RunnerModule = Readonly<{
  runStagingAcceptance(options: Readonly<{
    environment: Record<string, string>
    fetchImpl: typeof fetch
    randomUUID: () => string
    logger?: (entry: Readonly<Record<string, unknown>>) => void
    requestTimeoutMs?: number
    maxResponseBytes?: number
    registerSignal?: (
      signal: 'SIGINT' | 'SIGTERM',
      handler: () => Promise<void>,
    ) => void | (() => void)
  }>): Promise<RunResult>
}>

const { runStagingAcceptance } = await import('../scripts/staging-acceptance-runner.mjs' as never) as RunnerModule

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' },
  })
}

function requestBody(call: FetchCall): unknown {
  expect(typeof call.init.body).toBe('string')
  return JSON.parse(call.init.body as string)
}

function fixtureResult(
  leadCount: number,
  leadId: string | null = null,
  followUpCount = 0,
  ownershipHistoryCount = 0,
) {
  return {
    ok: true,
    result: { leadCount, leadId, followUpCount, ownershipHistoryCount },
    meta: { requestId: crypto.randomUUID() },
  }
}

function attestationResponse(override: Record<string, unknown> = {}) {
  return jsonResponse({
    ok: true,
    staging: true,
    deploymentGitCommitSha: SHA,
    deploymentRevision: REVISION,
    fingerprint: FINGERPRINT,
    acceptanceReady: true,
    meta: { requestId: crypto.randomUUID() },
    ...override,
  })
}

function permitResponse(override: Record<string, unknown> = {}) {
  return jsonResponse({
    ok: true,
    permit: PERMIT,
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    meta: { requestId: crypto.randomUUID() },
    ...override,
  })
}

function inquiryResponse(acceptedExisting: boolean, override: Record<string, unknown> = {}) {
  return jsonResponse({
    ok: true,
    data: {
      accepted: true,
      acceptedExisting,
      targetResolution: 'listing',
      acceptance: {
        runId: RUN_ID,
        fixtureNamespace: FIXTURE_NAMESPACE,
        leadLocator: { collection: 'leads', idempotencyKey: 'f'.repeat(64) },
      },
      ...override,
    },
    meta: { requestId: crypto.randomUUID() },
  })
}

function cleanupResponse(cleaned = true) {
  return jsonResponse({
    ok: true,
    result: { cleaned, leadCount: 0, followUpCount: 0, ownershipHistoryCount: 0 },
    meta: { requestId: crypto.randomUUID() },
  })
}

type ScriptStep = (call: FetchCall) => Response | Promise<Response>
function scriptedFetch(steps: ScriptStep[]) {
  const calls: FetchCall[] = []
  const fetchImpl = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const call = { url: String(input), init }
    calls.push(call)
    const step = steps.shift()
    if (!step) throw new Error('unexpected fake request')
    return step(call)
  })
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls, remaining: steps }
}

const respond = (response: Response): ScriptStep => () => response

function happyFakeFetch(leadId = LEAD_ID) {
  const calls: FetchCall[] = []
  let leadPresent = false
  let inquiryCount = 0
  const fetchImpl = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const call = { url: String(input), init }
    calls.push(call)
    const path = new URL(call.url).pathname
    if (path.endsWith('/attestation')) {
      return attestationResponse()
    }
    if (path.endsWith('/permits')) {
      return permitResponse()
    }
    if (path.endsWith('/inquiries')) {
      const acceptedExisting = inquiryCount > 0
      inquiryCount += 1
      leadPresent = true
      return inquiryResponse(acceptedExisting)
    }
    if (path.endsWith('/leads')) {
      const body = requestBody(call) as { action: string; leadId?: string }
      if (body.action === 'cleanup') {
        expect(body.leadId).toBe(leadId)
        leadPresent = false
        return jsonResponse({
          ok: true,
          result: {
            cleaned: true,
            leadCount: 0,
            followUpCount: 0,
            ownershipHistoryCount: 0,
          },
          meta: { requestId: crypto.randomUUID() },
        })
      }
      return jsonResponse(fixtureResult(leadPresent ? 1 : 0, leadPresent ? leadId : null))
    }
    throw new Error('unexpected fake request')
  })
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls }
}

describe('staging acceptance runner entrypoint', () => {
  it('exists and is exposed only as an explicit package script', () => {
    expect(existsSync(runnerPath)).toBe(true)

    const packageJson = JSON.parse(readFileSync(resolve(miniRoot, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>
    }

    expect(packageJson.scripts?.['staging:acceptance:run']).toBe(
      'node scripts/staging-acceptance-runner.mjs',
    )
    expect(packageJson.scripts?.test).not.toContain('staging:acceptance:run')
    expect(packageJson.scripts?.build ?? '').not.toContain('staging:acceptance:run')
    expect(packageJson.scripts?.['project:check']).not.toContain('staging:acceptance:run')
    expect(readFileSync(runnerPath, 'utf8')).not.toMatch(/process\.exit\s*\(/)
  })

  it.each([
    ['listing uppercase', { MP_E2E_LISTING_SLUG: 'Jing-An-Tower' }],
    ['listing path', { MP_E2E_LISTING_SLUG: '../jing-an-tower' }],
    ['phone', { MP_E2E_TEST_PHONE: '12800138000' }],
    ['policy empty', { MP_E2E_PRIVACY_POLICY_VERSION: '' }],
    ['policy whitespace', { MP_E2E_PRIVACY_POLICY_VERSION: 'bad policy' }],
    ['policy too long', { MP_E2E_PRIVACY_POLICY_VERSION: 'a'.repeat(101) }],
  ])('额外环境非法时在零网络阶段 fail closed：%s', async (_label, override) => {
    const fetchImpl = vi.fn()
    await expect(runStagingAcceptance({
      environment: { ...validEnvironment, ...override },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      randomUUID: () => SUBMISSION_ID,
    })).rejects.toThrow()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each([
    ['arbitrary HTTPS', 'https://staging.example.com'],
    ['old placeholder', 'https://sbhmini.ap-shanghai.run.tcloudbase.com'],
    ['sibling service', 'https://sbhmini-305971-12-1253925058.sh.run.tcloudbase.com'],
    ['canonicalized variant', 'HTTPS://SBHMINI-305971-11-1253925058.SH.RUN.TCLOUDBASE.COM:443/'],
  ])('非唯一 staging origin 在零网络阶段 fail closed：%s', async (_label, origin) => {
    const fetchImpl = vi.fn()
    const randomUUID = vi.fn(() => SUBMISSION_ID)
    await expect(runStagingAcceptance({
      environment: { ...validEnvironment, MP_E2E_API_ORIGIN: origin },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      randomUUID,
    })).rejects.toThrow()
    expect(randomUUID).not.toHaveBeenCalled()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('submission UUID 只从注入生成器取得一次，拒绝非 lowercase UUIDv4 且零网络', async () => {
    const fetchImpl = vi.fn()
    const randomUUID = vi.fn(() => SUBMISSION_ID.toUpperCase())
    await expect(runStagingAcceptance({
      environment: { ...validEnvironment, MP_E2E_SUBMISSION_REQUEST_ID: RUN_ID },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      randomUUID,
    })).rejects.toThrow('staging acceptance submission_id_invalid')
    expect(randomUUID).toHaveBeenCalledOnce()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('完成完整写入、幂等重提和 finally 精确清理，且每个请求固定同源和安全 fetch 选项', async () => {
    const { fetchImpl, calls } = happyFakeFetch()
    const output: Array<Readonly<Record<string, unknown>>> = []

    const randomUUID = vi.fn(() => SUBMISSION_ID)
    const result = await runStagingAcceptance({
      environment: validEnvironment,
      fetchImpl,
      randomUUID,
      logger: (entry) => output.push(entry),
    })

    expect(result).toEqual({
      ok: true,
      manifest: expect.objectContaining({
        cleanStartProven: true,
        cleanupAttempted: true,
        clean: true,
      }),
    })
    expect(randomUUID).toHaveBeenCalledOnce()
    expect(calls.map((call) => `${call.init.method} ${new URL(call.url).pathname}`)).toEqual([
      'GET /api/mini/v1/acceptance/attestation',
      'POST /api/mini/v1/acceptance/permits',
      'POST /api/mini/v1/acceptance/leads',
      'POST /api/mini/v1/inquiries',
      'POST /api/mini/v1/acceptance/leads',
      'POST /api/mini/v1/inquiries',
      'POST /api/mini/v1/acceptance/leads',
      'POST /api/mini/v1/acceptance/leads',
      'POST /api/mini/v1/acceptance/leads',
      'POST /api/mini/v1/acceptance/leads',
    ])
    for (const call of calls) {
      expect(new URL(call.url).origin).toBe(validEnvironment.MP_E2E_API_ORIGIN)
      expect(call.init.redirect).toBe('error')
      expect((call.init as RequestInit & { cache?: string }).cache).toBe('no-store')
      expect(call.init.signal).toBeInstanceOf(AbortSignal)
    }

    const headers = calls.map((call) => new Headers(call.init.headers))
    expect(headers[0].get('x-sbh-acceptance-bootstrap')).toBe(BOOTSTRAP)
    expect(headers[1].get('x-sbh-acceptance-bootstrap')).toBe(BOOTSTRAP)
    for (const index of [2, 3, 4, 5, 6, 7, 8, 9]) {
      expect(headers[index].get('x-sbh-acceptance-permit')).toBe(PERMIT)
    }
    expect(requestBody(calls[1])).toEqual({
      runId: RUN_ID,
      fixtureNamespace: expect.stringMatching(/^mp-e2e-[0-9a-f]{16}$/),
      expectedGitCommitSha: SHA,
      expectedDeploymentRevision: REVISION,
      expectedDbFingerprint: FINGERPRINT,
    })
    expect(requestBody(calls[2])).toEqual({
      action: 'inspect',
      submissionRequestId: SUBMISSION_ID,
      listingSlug: validEnvironment.MP_E2E_LISTING_SLUG,
    })
    const inquiryBody = {
      submissionRequestId: SUBMISSION_ID,
      listingSlug: validEnvironment.MP_E2E_LISTING_SLUG,
      buildingSlug: null,
      moveInTime: null,
      phone: validEnvironment.MP_E2E_TEST_PHONE,
      consent: { accepted: true, policyVersion: validEnvironment.MP_E2E_PRIVACY_POLICY_VERSION },
      priceSnapshot: null,
    }
    expect(requestBody(calls[3])).toEqual(inquiryBody)
    expect(requestBody(calls[5])).toEqual(inquiryBody)
    expect(requestBody(calls[8])).toEqual({
      action: 'cleanup',
      submissionRequestId: SUBMISSION_ID,
      listingSlug: validEnvironment.MP_E2E_LISTING_SLUG,
      leadId: LEAD_ID,
    })

    const formatted = JSON.stringify(output)
    for (const secret of [BOOTSTRAP, PERMIT, RUN_ID, SUBMISSION_ID, LEAD_ID, 'f'.repeat(64),
      validEnvironment.MP_E2E_TEST_PHONE, FINGERPRINT, SHA]) {
      expect(formatted).not.toContain(secret)
    }
    expect(formatted).toContain('sbhmini-305971-11-1253925058.sh.run.tcloudbase.com')
    expect(formatted).toContain(RUN_ID.slice(0, 8))
    for (const entry of output) {
      expect(Object.keys(entry).every((key) => [
        'event', 'apiHost', 'runIdSummary', 'fixtureNamespace', 'locatorHash',
        'attestationVerified', 'permitIssued', 'cleanStartProven', 'firstWriteVerified',
        'idempotencyVerified', 'cleanupAttempted', 'clean', 'leadCount', 'followUpCount',
        'ownershipHistoryCount',
      ].includes(key))).toBe(true)
    }
  })

  it.each([
    ['first response says existing', inquiryResponse(true)],
    ['acceptance run mismatch', inquiryResponse(false, {
      acceptance: {
        runId: SUBMISSION_ID,
        fixtureNamespace: FIXTURE_NAMESPACE,
        leadLocator: { collection: 'leads', idempotencyKey: 'f'.repeat(64) },
      },
    })],
    ['acceptance namespace mismatch', inquiryResponse(false, {
      acceptance: {
        runId: RUN_ID,
        fixtureNamespace: 'mp-e2e-0000000000000000',
        leadLocator: { collection: 'leads', idempotencyKey: 'f'.repeat(64) },
      },
    })],
  ])('%s 的首次有效响应被拒绝，但仍 inspect、收养并清理实际写入', async (_label, invalidInquiry) => {
    const scenario = scriptedFetch([
      respond(attestationResponse()),
      respond(permitResponse()),
      respond(jsonResponse(fixtureResult(0))),
      respond(invalidInquiry),
      respond(jsonResponse(fixtureResult(1, LEAD_ID))),
      respond(cleanupResponse()),
      respond(jsonResponse(fixtureResult(0))),
    ])
    await expect(runStagingAcceptance({
      environment: validEnvironment,
      fetchImpl: scenario.fetchImpl,
      randomUUID: () => SUBMISSION_ID,
    })).rejects.toThrow('staging acceptance inquiry_response_invalid')
    expect(scenario.remaining).toHaveLength(0)
  })

  it.each([
    ['staging false', { staging: false }],
    ['not ready', { acceptanceReady: false }],
    ['SHA mismatch', { deploymentGitCommitSha: 'c'.repeat(40) }],
    ['revision mismatch', { deploymentRevision: 'other-revision' }],
    ['fingerprint mismatch', { fingerprint: 'd'.repeat(64) }],
    ['unexpected key', { unexpected: true }],
  ])('attestation 身份严格拒绝：%s', async (_label, override) => {
    const scenario = scriptedFetch([respond(attestationResponse(override))])
    await expect(runStagingAcceptance({
      environment: validEnvironment,
      fetchImpl: scenario.fetchImpl,
      randomUUID: () => SUBMISSION_ID,
    })).rejects.toThrow('staging acceptance attestation_invalid')
    expect(scenario.calls).toHaveLength(1)
  })

  it('重提 receipt locator 变化时冻结，但只按已 inspect 的 Lead ID 清理', async () => {
    const changedReceipt = inquiryResponse(true, {
      acceptance: {
        runId: RUN_ID,
        fixtureNamespace: FIXTURE_NAMESPACE,
        leadLocator: { collection: 'leads', idempotencyKey: 'e'.repeat(64) },
      },
    })
    const scenario = scriptedFetch([
      respond(attestationResponse()),
      respond(permitResponse()),
      respond(jsonResponse(fixtureResult(0))),
      respond(inquiryResponse(false)),
      respond(jsonResponse(fixtureResult(1, LEAD_ID))),
      respond(changedReceipt),
      respond(jsonResponse(fixtureResult(1, LEAD_ID))),
      respond(cleanupResponse()),
      respond(jsonResponse(fixtureResult(0))),
    ])
    await expect(runStagingAcceptance({
      environment: validEnvironment,
      fetchImpl: scenario.fetchImpl,
      randomUUID: () => SUBMISSION_ID,
    })).rejects.toThrow('staging acceptance fixture_locator_changed')
    expect(scenario.remaining).toHaveLength(0)
  })

  it('string-tagged Payload ID 保持不透明并原样用于 cleanup', async () => {
    const stringLeadId = 's:NDI'
    const scenario = scriptedFetch([
      respond(attestationResponse()),
      respond(permitResponse()),
      respond(jsonResponse(fixtureResult(0))),
      respond(inquiryResponse(false)),
      respond(jsonResponse(fixtureResult(1, stringLeadId))),
      respond(inquiryResponse(true)),
      respond(jsonResponse(fixtureResult(1, stringLeadId))),
      respond(jsonResponse(fixtureResult(1, stringLeadId))),
      respond(cleanupResponse()),
      respond(jsonResponse(fixtureResult(0))),
    ])
    const result = await runStagingAcceptance({
      environment: validEnvironment,
      fetchImpl: scenario.fetchImpl,
      randomUUID: () => SUBMISSION_ID,
    })
    expect(result.manifest.clean).toBe(true)
    const cleanup = scenario.calls.find((call) =>
      new URL(call.url).pathname.endsWith('/leads') &&
      (requestBody(call) as { action?: string }).action === 'cleanup')
    expect(requestBody(cleanup!)).toMatchObject({ leadId: stringLeadId })
  })

  it('首次 inquiry transport 结果未知时先用同 body 对账，再收养唯一 ID 并清理', async () => {
    const scenario = scriptedFetch([
      respond(attestationResponse()),
      respond(permitResponse()),
      respond(jsonResponse(fixtureResult(0))),
      async () => { throw new Error(`upstream leaked ${validEnvironment.MP_E2E_TEST_PHONE}`) },
      respond(inquiryResponse(false)),
      respond(jsonResponse(fixtureResult(1, LEAD_ID))),
      respond(cleanupResponse()),
      respond(jsonResponse(fixtureResult(0))),
    ])

    await expect(runStagingAcceptance({
      environment: validEnvironment,
      fetchImpl: scenario.fetchImpl,
      randomUUID: () => SUBMISSION_ID,
    })).rejects.toThrow('staging acceptance request_failed')

    expect(scenario.remaining).toHaveLength(0)
    expect(scenario.calls.filter((call) => new URL(call.url).pathname.endsWith('/inquiries'))).toHaveLength(2)
    expect(requestBody(scenario.calls[3])).toEqual(requestBody(scenario.calls[4]))
    const cleanupCalls = scenario.calls.filter((call) =>
      new URL(call.url).pathname.endsWith('/leads') &&
      (requestBody(call) as { action: string }).action === 'cleanup')
    expect(cleanupCalls).toHaveLength(1)
    expect(requestBody(cleanupCalls[0])).toMatchObject({ leadId: LEAD_ID })
  })

  it('首次 inquiry 与对账都 transport 未知时冻结，即使即时 inspect 会是 0 也不宣称 clean', async () => {
    const output: Array<Readonly<Record<string, unknown>>> = []
    const scenario = scriptedFetch([
      respond(attestationResponse()),
      respond(permitResponse()),
      respond(jsonResponse(fixtureResult(0))),
      async () => { throw new Error('first transport unknown') },
      async (call) => {
        if (new URL(call.url).pathname.endsWith('/inquiries')) throw new Error('reconciliation unknown')
        return jsonResponse(fixtureResult(0))
      },
    ])

    await expect(runStagingAcceptance({
      environment: validEnvironment,
      fetchImpl: scenario.fetchImpl,
      randomUUID: () => SUBMISSION_ID,
      logger: (entry) => output.push(entry),
    })).rejects.toThrow('staging acceptance cleanup_failed')

    expect(new URL(scenario.calls[4].url).pathname).toBe('/api/mini/v1/inquiries')
    expect(output.some((entry) => entry.event === 'cleanup_complete')).toBe(false)
    expect(output.some((entry) => entry.clean === true)).toBe(false)
  })

  it('首次 inquiry 明确失败且数据库仍为 0 时只核验无需清理，不继续重试', async () => {
    const scenario = scriptedFetch([
      respond(attestationResponse()),
      respond(permitResponse()),
      respond(jsonResponse(fixtureResult(0))),
      respond(jsonResponse({ ok: false, error: { code: 'inquiry_submit_failed' } }, 503)),
      respond(jsonResponse(fixtureResult(0))),
    ])

    await expect(runStagingAcceptance({
      environment: validEnvironment,
      fetchImpl: scenario.fetchImpl,
      randomUUID: () => SUBMISSION_ID,
    })).rejects.toThrow('staging acceptance response_status_invalid')
    expect(scenario.remaining).toHaveLength(0)
    expect(scenario.calls.filter((call) => new URL(call.url).pathname.endsWith('/inquiries'))).toHaveLength(1)
    expect(scenario.calls.some((call) =>
      new URL(call.url).pathname.endsWith('/leads') &&
      (requestBody(call) as { action: string }).action === 'cleanup')).toBe(false)
  })

  it('幂等重提失败后仍按首次取得的不可变 ID 清理', async () => {
    const scenario = scriptedFetch([
      respond(attestationResponse()),
      respond(permitResponse()),
      respond(jsonResponse(fixtureResult(0))),
      respond(inquiryResponse(false)),
      respond(jsonResponse(fixtureResult(1, LEAD_ID))),
      respond(jsonResponse({ ok: false }, 503)),
      respond(jsonResponse(fixtureResult(1, LEAD_ID))),
      respond(cleanupResponse()),
      respond(jsonResponse(fixtureResult(0))),
    ])

    await expect(runStagingAcceptance({
      environment: validEnvironment,
      fetchImpl: scenario.fetchImpl,
      randomUUID: () => SUBMISSION_ID,
    })).rejects.toThrow('staging acceptance response_status_invalid')
    expect(scenario.remaining).toHaveLength(0)
    expect(scenario.calls.filter((call) =>
      new URL(call.url).pathname.endsWith('/leads') &&
      (requestBody(call) as { action?: string }).action === 'cleanup')).toHaveLength(1)
  })

  it('重提 transport 结果未知时先对账同一 locator，再清理首次已取得的 ID', async () => {
    const scenario = scriptedFetch([
      respond(attestationResponse()),
      respond(permitResponse()),
      respond(jsonResponse(fixtureResult(0))),
      respond(inquiryResponse(false)),
      respond(jsonResponse(fixtureResult(1, LEAD_ID))),
      async () => { throw new Error('retry transport unknown') },
      respond(inquiryResponse(true)),
      respond(jsonResponse(fixtureResult(1, LEAD_ID))),
      respond(cleanupResponse()),
      respond(jsonResponse(fixtureResult(0))),
    ])

    await expect(runStagingAcceptance({
      environment: validEnvironment,
      fetchImpl: scenario.fetchImpl,
      randomUUID: () => SUBMISSION_ID,
    })).rejects.toThrow('staging acceptance request_failed')
    expect(scenario.remaining).toHaveLength(0)
    expect(requestBody(scenario.calls[5])).toEqual(requestBody(scenario.calls[6]))
  })

  it('起点非 0 时立即冻结且绝不调用 inquiry 或 cleanup', async () => {
    const scenario = scriptedFetch([
      respond(attestationResponse()),
      respond(permitResponse()),
      respond(jsonResponse(fixtureResult(1, LEAD_ID))),
    ])
    await expect(runStagingAcceptance({
      environment: validEnvironment,
      fetchImpl: scenario.fetchImpl,
      randomUUID: () => SUBMISSION_ID,
    })).rejects.toThrow('staging acceptance clean_start_not_empty')
    expect(scenario.calls).toHaveLength(3)
    expect(scenario.calls.some((call) => new URL(call.url).pathname.endsWith('/inquiries'))).toBe(false)
  })

  it.each([
    ['multiple leads', fixtureResult(2, null)],
    ['follow-up exists', fixtureResult(1, LEAD_ID, 1, 0)],
    ['ownership history exists', fixtureResult(1, LEAD_ID, 0, 1)],
  ])('%s 时冻结，且不猜 ID、不删除', async (_label, unsafeFixture) => {
    const scenario = scriptedFetch([
      respond(attestationResponse()),
      respond(permitResponse()),
      respond(jsonResponse(fixtureResult(0))),
      respond(inquiryResponse(false)),
      respond(jsonResponse(unsafeFixture)),
      respond(jsonResponse(unsafeFixture)),
    ])
    await expect(runStagingAcceptance({
      environment: validEnvironment,
      fetchImpl: scenario.fetchImpl,
      randomUUID: () => SUBMISSION_ID,
    })).rejects.toThrow('staging acceptance cleanup_failed')
    expect(scenario.calls.some((call) =>
      new URL(call.url).pathname.endsWith('/leads') &&
      (requestBody(call) as { action?: string }).action === 'cleanup')).toBe(false)
  })

  it('重提后的 Lead ID 变化时冻结，finally 也不能用变化后的 ID 删除', async () => {
    const changedLeadId = 'n:43'
    const scenario = scriptedFetch([
      respond(attestationResponse()),
      respond(permitResponse()),
      respond(jsonResponse(fixtureResult(0))),
      respond(inquiryResponse(false)),
      respond(jsonResponse(fixtureResult(1, LEAD_ID))),
      respond(inquiryResponse(true)),
      respond(jsonResponse(fixtureResult(1, changedLeadId))),
      respond(jsonResponse(fixtureResult(1, changedLeadId))),
    ])
    await expect(runStagingAcceptance({
      environment: validEnvironment,
      fetchImpl: scenario.fetchImpl,
      randomUUID: () => SUBMISSION_ID,
    })).rejects.toThrow('staging acceptance cleanup_failed')
    expect(scenario.calls.some((call) =>
      new URL(call.url).pathname.endsWith('/leads') &&
      (requestBody(call) as { action?: string }).action === 'cleanup')).toBe(false)
  })

  it.each([
    ['cleanup 503', respond(jsonResponse({ ok: false }, 503)), undefined],
    ['cleanup residual', respond(cleanupResponse()), respond(jsonResponse(fixtureResult(1, LEAD_ID)))],
  ])('%s 覆盖场景成功并冻结', async (_label, cleanupStep, finalStep) => {
    const steps: ScriptStep[] = [
      respond(attestationResponse()),
      respond(permitResponse()),
      respond(jsonResponse(fixtureResult(0))),
      respond(inquiryResponse(false)),
      respond(jsonResponse(fixtureResult(1, LEAD_ID))),
      respond(inquiryResponse(true)),
      respond(jsonResponse(fixtureResult(1, LEAD_ID))),
      respond(jsonResponse(fixtureResult(1, LEAD_ID))),
      cleanupStep,
    ]
    if (finalStep) steps.push(finalStep)
    const scenario = scriptedFetch(steps)
    await expect(runStagingAcceptance({
      environment: validEnvironment,
      fetchImpl: scenario.fetchImpl,
      randomUUID: () => SUBMISSION_ID,
    })).rejects.toThrow('staging acceptance cleanup_failed')
    expect(scenario.remaining).toHaveLength(0)
  })

  it('SIGINT 与 SIGTERM 和 finally 并发时共享同一个 cleanup promise', async () => {
    const handlers = new Map<string, () => Promise<void>>()
    const removers: Array<ReturnType<typeof vi.fn>> = []
    const registerSignal = vi.fn((signal: 'SIGINT' | 'SIGTERM', handler: () => Promise<void>) => {
      handlers.set(signal, handler)
      const remove = vi.fn()
      removers.push(remove)
      return remove
    })
    let markInquiryStarted: (() => void) | undefined
    const inquiryStarted = new Promise<void>((resolveStarted) => { markInquiryStarted = resolveStarted })
    let resolveInquiry: ((response: Response) => void) | undefined
    const pendingInquiry = new Promise<Response>((resolveResponse) => { resolveInquiry = resolveResponse })
    const scenario = scriptedFetch([
      respond(attestationResponse()),
      respond(permitResponse()),
      respond(jsonResponse(fixtureResult(0))),
      () => {
        markInquiryStarted?.()
        return pendingInquiry
      },
      respond(jsonResponse(fixtureResult(1, LEAD_ID))),
      respond(cleanupResponse()),
      respond(jsonResponse(fixtureResult(0))),
    ])

    const run = runStagingAcceptance({
      environment: validEnvironment,
      fetchImpl: scenario.fetchImpl,
      randomUUID: () => SUBMISSION_ID,
      registerSignal,
    })
    await inquiryStarted
    const signalCleanups = [handlers.get('SIGINT')?.(), handlers.get('SIGTERM')?.()]
    await Promise.resolve()
    expect(scenario.calls).toHaveLength(4)
    resolveInquiry?.(inquiryResponse(false))

    await Promise.all(signalCleanups)
    await expect(run).rejects.toThrow('staging acceptance interrupted')

    expect(registerSignal.mock.calls.map(([signal]) => signal)).toEqual(['SIGINT', 'SIGTERM'])
    expect(removers.every((remove) => remove.mock.calls.length === 1)).toBe(true)
    expect(scenario.calls.filter((call) =>
      new URL(call.url).pathname.endsWith('/leads') &&
      (requestBody(call) as { action?: string }).action === 'cleanup')).toHaveLength(1)
    expect(scenario.remaining).toHaveLength(0)
  })

  it('最后一次 adopt/safeEmit 后到达的 signal 仍清理并让 direct caller 返回 interrupted', async () => {
    const handlers = new Map<string, () => Promise<void>>()
    let lateSignal: Promise<void> | undefined
    const { fetchImpl, calls } = happyFakeFetch()
    const run = runStagingAcceptance({
      environment: validEnvironment,
      fetchImpl,
      randomUUID: () => SUBMISSION_ID,
      registerSignal(signal, handler) { handlers.set(signal, handler) },
      logger(entry) {
        if (entry.event === 'idempotency_verified') lateSignal = handlers.get('SIGTERM')?.()
      },
    })

    await expect(run).rejects.toThrow('staging acceptance interrupted')
    await lateSignal
    expect(calls.filter((call) =>
      new URL(call.url).pathname.endsWith('/leads') &&
      (requestBody(call) as { action?: string }).action === 'cleanup')).toHaveLength(1)
  })

  it('拒绝过期 permit，且不进入 fixture 或 inquiry', async () => {
    const scenario = scriptedFetch([
      respond(attestationResponse()),
      respond(permitResponse({ expiresAt: new Date(Date.now() - 1_000).toISOString() })),
    ])
    await expect(runStagingAcceptance({
      environment: validEnvironment,
      fetchImpl: scenario.fetchImpl,
      randomUUID: () => SUBMISSION_ID,
    })).rejects.toThrow('staging acceptance permit_invalid')
    expect(scenario.calls).toHaveLength(2)
  })

  it.each([
    ['three segments', `${PERMIT}.junk`],
    ['noncanonical padding', `${PERMIT_BODY}=.${PERMIT_SIGNATURE}`],
    ['empty body', `.${PERMIT_SIGNATURE}`],
    ['unreasonably short body', `YQ.${PERMIT_SIGNATURE}`],
  ])('拒绝非 canonical 两段 permit：%s', async (_label, permit) => {
    const scenario = scriptedFetch([
      respond(attestationResponse()),
      respond(permitResponse({ permit })),
    ])
    await expect(runStagingAcceptance({
      environment: validEnvironment,
      fetchImpl: scenario.fetchImpl,
      randomUUID: () => SUBMISSION_ID,
    })).rejects.toThrow('staging acceptance permit_invalid')
    expect(scenario.calls).toHaveLength(2)
  })

  it('拒绝可 canonical base64url 但原始 bytes 非 UTF-8 的 string tagged Lead ID', async () => {
    const invalidUtf8LeadId = `s:${Buffer.from([0xff]).toString('base64url')}`
    const { fetchImpl, calls } = happyFakeFetch(invalidUtf8LeadId)
    await expect(runStagingAcceptance({
      environment: validEnvironment,
      fetchImpl,
      randomUUID: () => SUBMISSION_ID,
    })).rejects.toThrow('staging acceptance cleanup_failed')
    expect(calls.some((call) =>
      new URL(call.url).pathname.endsWith('/leads') &&
      (requestBody(call) as { action?: string }).action === 'cleanup')).toBe(false)
  })

  it.each([
    ['redirect', () => jsonResponse({ ok: false }, 302)],
    ['invalid json', () => new Response('{not-json', { status: 200, headers: { 'content-type': 'application/json' } })],
  ])('%s 不会被跟随或放宽解析', async (_label, responseFactory) => {
    const scenario = scriptedFetch([respond(responseFactory())])
    await expect(runStagingAcceptance({
      environment: validEnvironment,
      fetchImpl: scenario.fetchImpl,
      randomUUID: () => SUBMISSION_ID,
    })).rejects.toThrow()
    expect(scenario.calls).toHaveLength(1)
    expect(scenario.calls[0].init.redirect).toBe('error')
  })

  it('fetch 阶段超时会主动 abort 且不继续', async () => {
    let aborted = false
    const scenario = scriptedFetch([
      (call) => new Promise<Response>((_resolve, reject) => {
        call.init.signal?.addEventListener('abort', () => {
          aborted = true
          reject(new DOMException('aborted', 'AbortError'))
        }, { once: true })
      }),
    ])
    await expect(runStagingAcceptance({
      environment: validEnvironment,
      fetchImpl: scenario.fetchImpl,
      randomUUID: () => SUBMISSION_ID,
      requestTimeoutMs: 10,
    })).rejects.toThrow('staging acceptance request_failed')
    expect(aborted).toBe(true)
  })

  it('响应体读取也受同一超时控制', async () => {
    let cancelled = false
    const scenario = scriptedFetch([
      (call) => new Response(new ReadableStream<Uint8Array>({
        start() { expect(call.init.signal).toBeInstanceOf(AbortSignal) },
        cancel() { cancelled = true },
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    ])
    await expect(runStagingAcceptance({
      environment: validEnvironment,
      fetchImpl: scenario.fetchImpl,
      randomUUID: () => SUBMISSION_ID,
      requestTimeoutMs: 10,
    })).rejects.toThrow()
    expect(cancelled).toBe(true)
  }, 500)

  it('Content-Length 和流式累计任一超限都会 cancel，且不解析残缺 JSON', async () => {
    for (const mode of ['content-length', 'stream'] as const) {
      let cancelled = false
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new TextEncoder().encode('x'.repeat(64)))
          if (mode === 'content-length') controller.close()
        },
        cancel() { cancelled = true },
      })
      const headers: Record<string, string> = { 'content-type': 'application/json' }
      if (mode === 'content-length') headers['content-length'] = '64'
      const scenario = scriptedFetch([respond(new Response(stream, { status: 200, headers }))])
      await expect(runStagingAcceptance({
        environment: validEnvironment,
        fetchImpl: scenario.fetchImpl,
        randomUUID: () => SUBMISSION_ID,
        maxResponseBytes: 32,
      })).rejects.toThrow('staging acceptance response_too_large')
      expect(cancelled).toBe(true)
    }
  })

  it.each(['invalid-content-type', 'declared-oversized'] as const)(
    '%s 分支不会等待永不 resolve 的 body.cancel',
    async (mode) => {
      let cancelCalled = false
      const stream = new ReadableStream<Uint8Array>({
        cancel() {
          cancelCalled = true
          return new Promise<void>(() => undefined)
        },
      })
      const headers: Record<string, string> = {
        'content-type': mode === 'invalid-content-type' ? 'text/plain' : 'application/json',
      }
      if (mode === 'declared-oversized') headers['content-length'] = '64'
      const scenario = scriptedFetch([respond(new Response(stream, { status: 200, headers }))])

      await expect(runStagingAcceptance({
        environment: validEnvironment,
        fetchImpl: scenario.fetchImpl,
        randomUUID: () => SUBMISSION_ID,
        requestTimeoutMs: 20,
        maxResponseBytes: 32,
      })).rejects.toThrow(
        mode === 'invalid-content-type'
          ? 'staging acceptance response_content_type_invalid'
          : 'staging acceptance response_too_large',
      )
      expect(cancelCalled).toBe(true)
    },
    500,
  )

  it('logger 抛错不改变成功与清理结果', async () => {
    const { fetchImpl } = happyFakeFetch()
    const result = await runStagingAcceptance({
      environment: validEnvironment,
      fetchImpl,
      randomUUID: () => SUBMISSION_ID,
      logger: () => { throw new Error(`logger leaked ${BOOTSTRAP}`) },
    })
    expect(result.manifest.clean).toBe(true)
  })

  it('纯 import 不触发网络，CLI 配置失败只输出固定脱敏错误', () => {
    const importProbe = spawnSync(process.execPath, [
      '--input-type=module',
      '--eval',
      `globalThis.fetch=()=>{throw new Error('network called')};await import(${JSON.stringify(new URL(`file://${runnerPath}`).href)})`,
    ], { encoding: 'utf8' })
    expect(importProbe.status).toBe(0)

    const cli = spawnSync(process.execPath, [runnerPath], {
      env: { ...process.env, ...validEnvironment, MP_E2E_PRIVACY_POLICY_VERSION: '' },
      encoding: 'utf8',
    })
    const output = `${cli.stdout}${cli.stderr}`
    expect(cli.status).not.toBe(0)
    expect(output).toContain('staging acceptance 运行失败')
    for (const secret of [BOOTSTRAP, RUN_ID, SUBMISSION_ID, validEnvironment.MP_E2E_TEST_PHONE,
      FINGERPRINT, SHA]) {
      expect(output).not.toContain(secret)
    }
  })
})
