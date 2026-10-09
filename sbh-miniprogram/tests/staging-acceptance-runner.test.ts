import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const miniRoot = resolve(import.meta.dirname, '..')
const runnerPath = resolve(miniRoot, 'scripts/staging-acceptance-runner.mjs')
const capsulePath = resolve(miniRoot, 'scripts/staging-acceptance-capsule.mjs')
const sigkillChildPath = resolve(miniRoot, 'tests/fixtures/staging-acceptance-sigkill-child.mjs')
const RUN_ID = '550e8400-e29b-41d4-a716-446655440000'
const SUBMISSION_ID = '650e8400-e29b-41d4-a716-446655440000'
const SHA = 'a'.repeat(40)
const FINGERPRINT = 'b'.repeat(64)
const REVISION = 'deploy-2026-08-28'
const BOOTSTRAP = Buffer.from(Array.from({ length: 32 }, (_, index) => index + 33)).toString('base64url')
const PERMIT_BODY = Buffer.alloc(192, 7).toString('base64url')
const PERMIT_SIGNATURE = Buffer.alloc(32, 11).toString('base64url')
const PERMIT = `${PERMIT_BODY}.${PERMIT_SIGNATURE}`
const RECOVERY_RECEIPT = `${Buffer.alloc(192, 13).toString('base64url')}.${Buffer.alloc(32, 17).toString('base64url')}`
const ISSUED_AT = '2027-01-15T08:00:00.000Z'
const EXPIRES_AT = '2027-01-15T08:10:00.000Z'
const token = (byte: number) => `${Buffer.alloc(192, byte).toString('base64url')}.${Buffer.alloc(32, byte + 1).toString('base64url')}`
const INSPECT_PERMITS = [token(21), token(23), token(25), token(27)] as const
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
type CapsulePhase =
  | 'prepared'
  | 'clean_start_proven'
  | 'first_write_dispatched'
  | 'lead_observed'
  | 'retry_write_dispatched'
  | 'idempotency_verified'
  | 'cleanup_dispatched'
  | 'cleanup_confirmed'
type CapsuleIdentity = Readonly<{
  runId: string
  submissionRequestId: string
  listingSlug: string
  fixtureNamespace: string
  origin: string
  expectedGitCommitSha: string
  expectedDeploymentRevision: string
  expectedDbFingerprint: string
}>
type CapsuleRecord = CapsuleIdentity & Readonly<{
  schemaVersion: 1
  phase: CapsulePhase
  recoveryReceipt: string | null
  leadId: string | null
}>
type CapsuleLease = Readonly<{
  readActive: () => Promise<CapsuleRecord | null>
  createPrepared: (identity: CapsuleIdentity) => Promise<CapsuleRecord>
  transition: (
    nextPhase: CapsulePhase,
    patch?: Readonly<Record<string, unknown>>,
  ) => Promise<CapsuleRecord>
  removeConfirmed: () => Promise<void>
  release: () => Promise<void>
}>
type CapsuleStore = Readonly<{
  acquire: (mode: 'normal' | 'recovery') => Promise<CapsuleLease>
}>
type RunnerOptions = Readonly<{
  environment: Record<string, string>
  fetchImpl: typeof fetch
  capsuleStore: CapsuleStore
  randomUUID: () => string
  logger?: (entry: Readonly<Record<string, unknown>>) => void
  requestTimeoutMs?: number
  maxResponseBytes?: number
  registerSignal?: (
    signal: 'SIGINT' | 'SIGTERM',
    handler: () => Promise<void>,
  ) => void | (() => void)
}>
type RunnerModule = Readonly<{
  runStagingAcceptance(options: RunnerOptions): Promise<RunResult>
}>
type CapsuleModule = Readonly<{
  createCapsuleStore(options: Readonly<{ rootDir: string }>): CapsuleStore
}>

const { runStagingAcceptance: runStagingAcceptanceRaw } = await import(
  '../scripts/staging-acceptance-runner.mjs' as never
) as RunnerModule
const { createCapsuleStore } = await import(
  '../scripts/staging-acceptance-capsule.mjs' as never
) as CapsuleModule

function childHasClosed(child: ChildProcessWithoutNullStreams) {
  return child.exitCode !== null || child.signalCode !== null
}

function waitForChildOutput(
  child: ChildProcessWithoutNullStreams,
  expected: string,
  timeoutMs = 3_000,
) {
  return new Promise<void>((resolveOutput, rejectOutput) => {
    let output = ''
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.stdout.off('data', onData)
      child.off('close', onClose)
      child.off('error', onError)
      if (error) rejectOutput(error)
      else resolveOutput()
    }
    const onData = (chunk: Buffer | string) => {
      output = `${output}${String(chunk)}`.slice(-4_096)
      if (output.includes(expected)) finish()
    }
    const onClose = () => finish(new Error('sigkill child closed before checkpoint'))
    const onError = () => finish(new Error('sigkill child failed before checkpoint'))
    const timer = setTimeout(
      () => finish(new Error('sigkill child checkpoint timeout')),
      timeoutMs,
    )
    child.stdout.on('data', onData)
    child.once('close', onClose)
    child.once('error', onError)
  })
}

function waitForChildClose(child: ChildProcessWithoutNullStreams, timeoutMs = 3_000) {
  if (childHasClosed(child)) return Promise.resolve()
  return new Promise<void>((resolveClose, rejectClose) => {
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.off('close', onClose)
      child.off('error', onError)
      if (error) rejectClose(error)
      else resolveClose()
    }
    const onClose = () => finish()
    const onError = () => finish(new Error('sigkill child close failed'))
    const timer = setTimeout(() => finish(new Error('sigkill child close timeout')), timeoutMs)
    child.once('close', onClose)
    child.once('error', onError)
  })
}

async function terminateChild(child: ChildProcessWithoutNullStreams | null) {
  if (!child) return
  if (!childHasClosed(child)) child.kill('SIGKILL')
  try {
    await waitForChildClose(child, 1_000)
  } catch {
    child.stdout.destroy()
    child.stderr.destroy()
    if (!childHasClosed(child)) child.kill('SIGKILL')
    child.unref()
    await waitForChildClose(child, 250).catch(() => undefined)
  }
}

function bounded<T>(promise: Promise<T>, label: string, timeoutMs = 1_000) {
  return new Promise<T>((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(
      () => rejectPromise(new Error(`${label} timeout`)),
      timeoutMs,
    )
    promise.then(
      (value) => {
        clearTimeout(timeout)
        resolvePromise(value)
      },
      (error: unknown) => {
        clearTimeout(timeout)
        rejectPromise(error)
      },
    )
  })
}

function capsuleHarness(options: Readonly<{
  events?: string[]
  acquireError?: Error
  createPreparedError?: Error
  failTransition?: CapsulePhase
  removeConfirmedError?: Error
  releaseError?: Error
  releaseBarrier?: Promise<void>
  onReleaseStarted?: () => void
  afterTransition?: (phase: CapsulePhase) => void
}> = {}) {
  const normalNextPhase: Partial<Record<CapsulePhase, CapsulePhase>> = {
    prepared: 'clean_start_proven',
    clean_start_proven: 'first_write_dispatched',
    first_write_dispatched: 'lead_observed',
    lead_observed: 'retry_write_dispatched',
    retry_write_dispatched: 'idempotency_verified',
    idempotency_verified: 'cleanup_dispatched',
    cleanup_dispatched: 'cleanup_confirmed',
  }
  const events = options.events ?? []
  let active: CapsuleRecord | null = null
  const lease: CapsuleLease = {
    readActive: vi.fn(async () => active),
    createPrepared: vi.fn(async (identity) => {
      events.push('capsule:prepared')
      if (options.createPreparedError) throw options.createPreparedError
      active = Object.freeze({
        schemaVersion: 1,
        phase: 'prepared',
        ...identity,
        recoveryReceipt: null,
        leadId: null,
      })
      return active as CapsuleRecord
    }),
    transition: vi.fn(async (nextPhase, patch = {}) => {
      events.push(`capsule:${nextPhase}`)
      if (!active) throw new Error('missing capsule')
      if (nextPhase !== nextPhaseFor(active.phase)) throw new Error('invalid capsule transition')
      if (options.failTransition === nextPhase) throw new Error(`secret persist ${nextPhase}`)
      active = Object.freeze({ ...active, phase: nextPhase, ...patch }) as CapsuleRecord
      options.afterTransition?.(nextPhase)
      return active
    }),
    removeConfirmed: vi.fn(async () => {
      events.push('capsule:removed')
      if (options.removeConfirmedError) throw options.removeConfirmedError
      active = null
    }),
    release: vi.fn(async () => {
      options.onReleaseStarted?.()
      if (options.releaseBarrier) await options.releaseBarrier
      if (options.releaseError) throw options.releaseError
      events.push('capsule:released')
    }),
  }
  function nextPhaseFor(phase: CapsulePhase) {
    return normalNextPhase[phase]
  }
  const store: CapsuleStore = {
    acquire: vi.fn(async (mode) => {
      events.push(`capsule:acquire:${mode}`)
      if (options.acquireError) throw options.acquireError
      return lease
    }),
  }
  return { store, lease, events, active: () => active }
}

function runStagingAcceptance(options: Omit<RunnerOptions, 'capsuleStore'> & { capsuleStore?: CapsuleStore }) {
  const { capsuleStore = capsuleHarness().store, ...rest } = options
  return runStagingAcceptanceRaw({ ...rest, capsuleStore })
}

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
    recoveryReceipt: RECOVERY_RECEIPT,
    issuedAt: ISSUED_AT,
    expiresAt: EXPIRES_AT,
    meta: { requestId: crypto.randomUUID() },
    ...override,
  })
}

function inspectPermitResponse(
  inspectPermit = INSPECT_PERMITS[0],
  override: Record<string, unknown> = {},
) {
  return jsonResponse({
    ok: true,
    permit: inspectPermit,
    issuedAt: ISSUED_AT,
    expiresAt: EXPIRES_AT,
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
function scriptedFetch(steps: ScriptStep[], options: Readonly<{ autoInspectPermits?: boolean }> = {}) {
  const calls: FetchCall[] = []
  let inspectPermitIndex = 0
  const fetchImpl = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const call = { url: String(input), init }
    calls.push(call)
    if (
      options.autoInspectPermits !== false &&
      new URL(call.url).pathname.endsWith('/permits') &&
      (requestBody(call) as { mode?: string }).mode === 'inspect'
    ) {
      const inspectPermit = INSPECT_PERMITS[inspectPermitIndex] ?? token(31 + inspectPermitIndex * 2)
      inspectPermitIndex += 1
      return inspectPermitResponse(inspectPermit)
    }
    const step = steps.shift()
    if (!step) throw new Error('unexpected fake request')
    return step(call)
  })
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls, remaining: steps }
}

const respond = (response: Response): ScriptStep => () => response

function happyFakeFetch(leadId = LEAD_ID, events: string[] = []) {
  const calls: FetchCall[] = []
  let leadPresent = false
  let inquiryCount = 0
  let inspectPermitIndex = 0
  const fetchImpl = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const call = { url: String(input), init }
    calls.push(call)
    const path = new URL(call.url).pathname
    if (path.endsWith('/attestation')) {
      events.push('http:attestation')
      return attestationResponse()
    }
    if (path.endsWith('/permits')) {
      const body = requestBody(call) as { mode?: string }
      events.push(`http:permit:${body.mode ?? 'missing'}`)
      if (body.mode === 'write') return permitResponse()
      if (body.mode === 'inspect') {
        const inspectPermit = INSPECT_PERMITS[inspectPermitIndex] ?? token(31 + inspectPermitIndex * 2)
        inspectPermitIndex += 1
        return inspectPermitResponse(inspectPermit)
      }
      throw new Error('unexpected permit mode')
    }
    if (path.endsWith('/inquiries')) {
      events.push(`http:inquiry:${inquiryCount + 1}`)
      const acceptedExisting = inquiryCount > 0
      inquiryCount += 1
      leadPresent = true
      return inquiryResponse(acceptedExisting)
    }
    if (path.endsWith('/leads')) {
      const body = requestBody(call) as { action: string; leadId?: string }
      events.push(`http:fixture:${body.action}`)
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
    const source = readFileSync(runnerPath, 'utf8')
    expect(source).not.toMatch(/process\.exit\s*\(/)
    expect(source).toMatch(/import \{ createCapsuleStore \} from '\.\/staging-acceptance-capsule\.mjs'/)
    expect(source).toMatch(/capsuleStore:\s*createCapsuleStore\(\)/)
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

  it('direct runner 强制注入 capsuleStore，缺失时 UUID 与网络均为零', async () => {
    const fetchImpl = vi.fn()
    const randomUUID = vi.fn(() => SUBMISSION_ID)
    await expect(runStagingAcceptanceRaw({
      environment: validEnvironment,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      randomUUID,
    } as unknown as RunnerOptions)).rejects.toThrow('staging acceptance runner_config_invalid')
    expect(randomUUID).not.toHaveBeenCalled()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('normal lock/unresolved 在 UUID 与网络前失败', async () => {
    for (const code of ['lock_active', 'unresolved']) {
      const fetchImpl = vi.fn()
      const randomUUID = vi.fn(() => SUBMISSION_ID)
      const capsule = capsuleHarness({ acquireError: new Error(`capsule ${code} secret`) })
      await expect(runStagingAcceptance({
        environment: validEnvironment,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        randomUUID,
        capsuleStore: capsule.store,
      })).rejects.toThrow('staging acceptance scenario_failed')
      expect(capsule.store.acquire).toHaveBeenCalledWith('normal')
      expect(randomUUID).not.toHaveBeenCalled()
      expect(fetchImpl).not.toHaveBeenCalled()
    }
  })

  it('createPrepared 以完整 identity 在 attestation 前 durable，失败时网络为零', async () => {
    const events: string[] = []
    const capsule = capsuleHarness({ events })
    const fetchImpl = vi.fn(async () => {
      events.push('http:unexpected')
      throw new Error('network must follow prepared')
    })
    await expect(runStagingAcceptance({
      environment: validEnvironment,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      randomUUID: () => SUBMISSION_ID,
      capsuleStore: capsule.store,
    })).rejects.toThrow()

    expect(events.slice(0, 3)).toEqual([
      'capsule:acquire:normal',
      'capsule:prepared',
      'http:unexpected',
    ])
    expect(capsule.lease.createPrepared).toHaveBeenCalledWith({
      runId: RUN_ID,
      submissionRequestId: SUBMISSION_ID,
      listingSlug: validEnvironment.MP_E2E_LISTING_SLUG,
      fixtureNamespace: FIXTURE_NAMESPACE,
      origin: validEnvironment.MP_E2E_API_ORIGIN,
      expectedGitCommitSha: SHA,
      expectedDeploymentRevision: REVISION,
      expectedDbFingerprint: FINGERPRINT,
    })
    expect(capsule.active()).toMatchObject({ phase: 'prepared', recoveryReceipt: null, leadId: null })
    expect(capsule.lease.removeConfirmed).not.toHaveBeenCalled()

    const failed = capsuleHarness({ createPreparedError: new Error(`secret ${RECOVERY_RECEIPT}`) })
    const zeroNetwork = vi.fn()
    await expect(runStagingAcceptance({
      environment: validEnvironment,
      fetchImpl: zeroNetwork as unknown as typeof fetch,
      randomUUID: () => SUBMISSION_ID,
      capsuleStore: failed.store,
    })).rejects.toThrow('staging acceptance scenario_failed')
    expect(zeroNetwork).not.toHaveBeenCalled()
    expect(failed.lease.release).toHaveBeenCalledOnce()
  })

  it('子进程在 first dispatch durable 后被 SIGKILL，recovery 仍读取完整 canonical capsule', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'sbh-runner-sigkill-'))
    let child: ChildProcessWithoutNullStreams | null = null
    let recoveryLease: CapsuleLease | null = null
    try {
      child = spawn(process.execPath, [sigkillChildPath, rootDir], {
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      await waitForChildOutput(child, 'first-write-dispatch-durable\n')
      expect(child.kill('SIGKILL')).toBe(true)
      await waitForChildClose(child)

      const recoveryStore = createCapsuleStore({ rootDir })
      recoveryLease = await recoveryStore.acquire('recovery')
      const capsule = await recoveryLease.readActive()
      expect(capsule).toEqual({
        schemaVersion: 1,
        phase: 'first_write_dispatched',
        runId: RUN_ID,
        submissionRequestId: SUBMISSION_ID,
        listingSlug: validEnvironment.MP_E2E_LISTING_SLUG,
        fixtureNamespace: FIXTURE_NAMESPACE,
        origin: validEnvironment.MP_E2E_API_ORIGIN,
        expectedGitCommitSha: SHA,
        expectedDeploymentRevision: REVISION,
        expectedDbFingerprint: FINGERPRINT,
        recoveryReceipt: RECOVERY_RECEIPT,
        leadId: null,
      })
      expect(JSON.parse(readFileSync(join(rootDir, 'active.json'), 'utf8'))).toEqual(capsule)
    } finally {
      if (recoveryLease) await recoveryLease.release().catch(() => undefined)
      await terminateChild(child)
      rmSync(rootDir, { recursive: true, force: true })
    }
  }, 10_000)

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

  it('完整流程按 durable phase 编排，只签一张 writer permit并以 fresh inspect terminal', async () => {
    const events: string[] = []
    const capsule = capsuleHarness({ events })
    const { fetchImpl, calls } = happyFakeFetch(LEAD_ID, events)
    const output: Array<Readonly<Record<string, unknown>>> = []
    const randomUUID = vi.fn(() => SUBMISSION_ID)

    const result = await runStagingAcceptance({
      environment: validEnvironment,
      fetchImpl,
      randomUUID,
      logger: (entry) => output.push(entry),
      capsuleStore: capsule.store,
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
      'POST /api/mini/v1/acceptance/permits',
      'POST /api/mini/v1/acceptance/leads',
      'POST /api/mini/v1/inquiries',
      'POST /api/mini/v1/acceptance/permits',
      'POST /api/mini/v1/acceptance/leads',
      'POST /api/mini/v1/acceptance/leads',
      'POST /api/mini/v1/acceptance/permits',
      'POST /api/mini/v1/acceptance/leads',
    ])
    for (const call of calls) {
      expect(new URL(call.url).origin).toBe(validEnvironment.MP_E2E_API_ORIGIN)
      expect(call.init.redirect).toBe('error')
      expect((call.init as RequestInit & { cache?: string }).cache).toBe('no-store')
      expect(call.init.signal).toBeInstanceOf(AbortSignal)
    }

    const headers = calls.map((call) => new Headers(call.init.headers))
    for (const index of [0, 1, 4, 7, 10]) {
      expect(headers[index].get('x-sbh-acceptance-bootstrap')).toBe(BOOTSTRAP)
    }
    for (const index of [2, 3, 6, 9]) {
      expect(headers[index].get('x-sbh-acceptance-permit')).toBe(PERMIT)
    }
    expect(headers[5].get('x-sbh-acceptance-permit')).toBe(INSPECT_PERMITS[0])
    expect(headers[8].get('x-sbh-acceptance-permit')).toBe(INSPECT_PERMITS[1])
    expect(headers[11].get('x-sbh-acceptance-permit')).toBe(INSPECT_PERMITS[2])

    const permitIdentity = {
      runId: RUN_ID,
      submissionRequestId: SUBMISSION_ID,
      listingSlug: validEnvironment.MP_E2E_LISTING_SLUG,
      fixtureNamespace: FIXTURE_NAMESPACE,
      expectedGitCommitSha: SHA,
      expectedDeploymentRevision: REVISION,
      expectedDbFingerprint: FINGERPRINT,
    }
    expect(requestBody(calls[1])).toEqual({ mode: 'write', ...permitIdentity })
    for (const index of [4, 7, 10]) {
      expect(requestBody(calls[index])).toEqual({ mode: 'inspect', ...permitIdentity })
    }
    const expectedInspectBody = {
      action: 'inspect',
      submissionRequestId: SUBMISSION_ID,
      listingSlug: validEnvironment.MP_E2E_LISTING_SLUG,
    }
    for (const index of [2, 5, 8, 11]) expect(requestBody(calls[index])).toEqual(expectedInspectBody)
    const expectedInquiryBody = {
      submissionRequestId: SUBMISSION_ID,
      listingSlug: validEnvironment.MP_E2E_LISTING_SLUG,
      buildingSlug: null,
      moveInTime: null,
      phone: validEnvironment.MP_E2E_TEST_PHONE,
      consent: { accepted: true, policyVersion: validEnvironment.MP_E2E_PRIVACY_POLICY_VERSION },
      priceSnapshot: null,
    }
    expect(requestBody(calls[3])).toEqual(expectedInquiryBody)
    expect(requestBody(calls[6])).toEqual(expectedInquiryBody)
    expect(requestBody(calls[9])).toEqual({
      action: 'cleanup',
      submissionRequestId: SUBMISSION_ID,
      listingSlug: validEnvironment.MP_E2E_LISTING_SLUG,
      leadId: LEAD_ID,
    })

    expect(events).toEqual([
      'capsule:acquire:normal',
      'capsule:prepared',
      'http:attestation',
      'http:permit:write',
      'http:fixture:inspect',
      'capsule:clean_start_proven',
      'capsule:first_write_dispatched',
      'http:inquiry:1',
      'http:permit:inspect',
      'http:fixture:inspect',
      'capsule:lead_observed',
      'capsule:retry_write_dispatched',
      'http:inquiry:2',
      'http:permit:inspect',
      'http:fixture:inspect',
      'capsule:idempotency_verified',
      'capsule:cleanup_dispatched',
      'http:fixture:cleanup',
      'http:permit:inspect',
      'http:fixture:inspect',
      'capsule:cleanup_confirmed',
      'capsule:removed',
      'capsule:released',
    ])
    const transitionCalls = vi.mocked(capsule.lease.transition).mock.calls
    expect(transitionCalls.map(([phase]) => phase)).toEqual([
      'clean_start_proven',
      'first_write_dispatched',
      'lead_observed',
      'retry_write_dispatched',
      'idempotency_verified',
      'cleanup_dispatched',
      'cleanup_confirmed',
    ])
    expect(transitionCalls[0]?.[1]).toEqual({ recoveryReceipt: RECOVERY_RECEIPT })
    expect(transitionCalls[2]?.[1]).toEqual({ leadId: LEAD_ID })
    expect(capsule.lease.removeConfirmed).toHaveBeenCalledOnce()
    expect(capsule.lease.release).toHaveBeenCalledOnce()
    expect(capsule.active()).toBeNull()

    const formatted = JSON.stringify({ output, manifest: result.manifest })
    for (const secret of [BOOTSTRAP, PERMIT, RECOVERY_RECEIPT, ...INSPECT_PERMITS,
      SUBMISSION_ID, 'f'.repeat(64), validEnvironment.MP_E2E_TEST_PHONE, FINGERPRINT, SHA]) {
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
  ])('%s 的首次响应被拒绝，但仍 inspect 并持久化实际 Lead 给 recovery', async (_label, invalidInquiry) => {
    const capsule = capsuleHarness()
    const scenario = scriptedFetch([
      respond(attestationResponse()),
      respond(permitResponse()),
      respond(jsonResponse(fixtureResult(0))),
      respond(invalidInquiry),
      respond(jsonResponse(fixtureResult(1, LEAD_ID))),
    ])
    await expect(runStagingAcceptance({
      environment: validEnvironment,
      fetchImpl: scenario.fetchImpl,
      randomUUID: () => SUBMISSION_ID,
      capsuleStore: capsule.store,
    })).rejects.toThrow('staging acceptance inquiry_response_invalid')
    expect(scenario.remaining).toHaveLength(0)
    expect(capsule.active()).toMatchObject({ phase: 'lead_observed', leadId: LEAD_ID })
    expect(scenario.calls.some((call) =>
      new URL(call.url).pathname.endsWith('/leads') &&
      (requestBody(call) as { action?: string }).action === 'cleanup')).toBe(false)
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

  it('重提 receipt locator 变化时冻结并保留 retry capsule，不做 normal cleanup', async () => {
    const changedReceipt = inquiryResponse(true, {
      acceptance: {
        runId: RUN_ID,
        fixtureNamespace: FIXTURE_NAMESPACE,
        leadLocator: { collection: 'leads', idempotencyKey: 'e'.repeat(64) },
      },
    })
    const capsule = capsuleHarness()
    const scenario = scriptedFetch([
      respond(attestationResponse()),
      respond(permitResponse()),
      respond(jsonResponse(fixtureResult(0))),
      respond(inquiryResponse(false)),
      respond(jsonResponse(fixtureResult(1, LEAD_ID))),
      respond(changedReceipt),
      respond(jsonResponse(fixtureResult(1, LEAD_ID))),
    ])
    await expect(runStagingAcceptance({
      environment: validEnvironment,
      fetchImpl: scenario.fetchImpl,
      randomUUID: () => SUBMISSION_ID,
      capsuleStore: capsule.store,
    })).rejects.toThrow('staging acceptance fixture_locator_changed')
    expect(scenario.remaining).toHaveLength(0)
    expect(capsule.active()).toMatchObject({ phase: 'retry_write_dispatched', leadId: LEAD_ID })
    expect(scenario.calls.some((call) =>
      new URL(call.url).pathname.endsWith('/leads') &&
      (requestBody(call) as { action?: string }).action === 'cleanup')).toBe(false)
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

  it('首次 inquiry transport 结果未知时禁止普通 inspect/reconcile/cleanup 并保留 dispatch capsule', async () => {
    const capsule = capsuleHarness()
    const scenario = scriptedFetch([
      respond(attestationResponse()),
      respond(permitResponse()),
      respond(jsonResponse(fixtureResult(0))),
      async () => { throw new Error(`upstream leaked ${validEnvironment.MP_E2E_TEST_PHONE}`) },
    ])

    await expect(runStagingAcceptance({
      environment: validEnvironment,
      fetchImpl: scenario.fetchImpl,
      randomUUID: () => SUBMISSION_ID,
      capsuleStore: capsule.store,
    })).rejects.toThrow('staging acceptance request_failed')

    expect(scenario.remaining).toHaveLength(0)
    expect(scenario.calls.filter((call) => new URL(call.url).pathname.endsWith('/inquiries'))).toHaveLength(1)
    expect(scenario.calls).toHaveLength(4)
    const cleanupCalls = scenario.calls.filter((call) =>
      new URL(call.url).pathname.endsWith('/leads') &&
      (requestBody(call) as { action: string }).action === 'cleanup')
    expect(cleanupCalls).toHaveLength(0)
    expect(capsule.active()).toMatchObject({
      phase: 'first_write_dispatched',
      recoveryReceipt: RECOVERY_RECEIPT,
      leadId: null,
    })
    expect(capsule.lease.removeConfirmed).not.toHaveBeenCalled()
  })

  it('首次 inquiry 响应 JSON 不可读时同样不追加 inspect，即使假服务会返回 0', async () => {
    const output: Array<Readonly<Record<string, unknown>>> = []
    const capsule = capsuleHarness()
    const scenario = scriptedFetch([
      respond(attestationResponse()),
      respond(permitResponse()),
      respond(jsonResponse(fixtureResult(0))),
      respond(new Response('{invalid', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })),
      respond(jsonResponse(fixtureResult(0))),
    ])

    await expect(runStagingAcceptance({
      environment: validEnvironment,
      fetchImpl: scenario.fetchImpl,
      randomUUID: () => SUBMISSION_ID,
      logger: (entry) => output.push(entry),
      capsuleStore: capsule.store,
    })).rejects.toThrow('staging acceptance response_json_invalid')

    expect(scenario.remaining).toHaveLength(1)
    expect(scenario.calls).toHaveLength(4)
    expect(output.some((entry) => entry.event === 'cleanup_complete')).toBe(false)
    expect(output.some((entry) => entry.clean === true)).toBe(false)
    expect(capsule.active()).toMatchObject({ phase: 'first_write_dispatched' })
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

  it('幂等重提明确失败后保留 durable Lead，不做 normal cleanup', async () => {
    const capsule = capsuleHarness()
    const scenario = scriptedFetch([
      respond(attestationResponse()),
      respond(permitResponse()),
      respond(jsonResponse(fixtureResult(0))),
      respond(inquiryResponse(false)),
      respond(jsonResponse(fixtureResult(1, LEAD_ID))),
      respond(jsonResponse({ ok: false }, 503)),
      respond(jsonResponse(fixtureResult(1, LEAD_ID))),
    ])

    await expect(runStagingAcceptance({
      environment: validEnvironment,
      fetchImpl: scenario.fetchImpl,
      randomUUID: () => SUBMISSION_ID,
      capsuleStore: capsule.store,
    })).rejects.toThrow('staging acceptance response_status_invalid')
    expect(scenario.remaining).toHaveLength(0)
    expect(scenario.calls.filter((call) =>
      new URL(call.url).pathname.endsWith('/leads') &&
      (requestBody(call) as { action?: string }).action === 'cleanup')).toHaveLength(0)
    expect(capsule.active()).toMatchObject({ phase: 'retry_write_dispatched', leadId: LEAD_ID })
  })

  it('重提 transport 结果未知时即使已有 durable Lead 也禁止 inspect/cleanup并保留 capsule', async () => {
    const capsule = capsuleHarness()
    const scenario = scriptedFetch([
      respond(attestationResponse()),
      respond(permitResponse()),
      respond(jsonResponse(fixtureResult(0))),
      respond(inquiryResponse(false)),
      respond(jsonResponse(fixtureResult(1, LEAD_ID))),
      async () => { throw new Error('retry transport unknown') },
    ])

    await expect(runStagingAcceptance({
      environment: validEnvironment,
      fetchImpl: scenario.fetchImpl,
      randomUUID: () => SUBMISSION_ID,
      capsuleStore: capsule.store,
    })).rejects.toThrow('staging acceptance request_failed')
    expect(scenario.remaining).toHaveLength(0)
    const inquiries = scenario.calls.filter((call) => new URL(call.url).pathname.endsWith('/inquiries'))
    expect(inquiries).toHaveLength(2)
    expect(scenario.calls.at(-1)).toBe(inquiries[1])
    expect(capsule.active()).toMatchObject({
      phase: 'retry_write_dispatched',
      leadId: LEAD_ID,
      recoveryReceipt: RECOVERY_RECEIPT,
    })
    expect(capsule.lease.removeConfirmed).not.toHaveBeenCalled()
  })

  it.each([
    ['first_write_dispatched', 0, [
      respond(attestationResponse()),
      respond(permitResponse()),
      respond(jsonResponse(fixtureResult(0))),
    ]],
    ['retry_write_dispatched', 1, [
      respond(attestationResponse()),
      respond(permitResponse()),
      respond(jsonResponse(fixtureResult(0))),
      respond(inquiryResponse(false)),
      respond(jsonResponse(fixtureResult(1, LEAD_ID))),
    ]],
  ] as const)(
    '%s 落盘时到达 signal，必须在下一次 inquiry fetch 前同步停止',
    async (interruptPhase, expectedInquiries, steps) => {
      let signalHandler: (() => Promise<void>) | undefined
      let signalPromise: Promise<void> | undefined
      const capsule = capsuleHarness({
        afterTransition(phase) {
          if (phase === interruptPhase) signalPromise = signalHandler?.()
        },
      })
      const scenario = scriptedFetch([...steps])

      await expect(runStagingAcceptance({
        environment: validEnvironment,
        fetchImpl: scenario.fetchImpl,
        randomUUID: () => SUBMISSION_ID,
        capsuleStore: capsule.store,
        registerSignal(_signal, handler) { signalHandler = handler },
      })).rejects.toThrow('staging acceptance interrupted')
      await signalPromise

      expect(scenario.remaining).toHaveLength(0)
      expect(scenario.calls.filter((call) =>
        new URL(call.url).pathname.endsWith('/inquiries'))).toHaveLength(expectedInquiries)
      expect(capsule.active()).toMatchObject({ phase: interruptPhase })
    },
  )

  it.each([
    ['clean_start_proven', 'prepared', 0, [
      respond(attestationResponse()),
      respond(permitResponse()),
      respond(jsonResponse(fixtureResult(0))),
    ]],
    ['first_write_dispatched', 'clean_start_proven', 0, [
      respond(attestationResponse()),
      respond(permitResponse()),
      respond(jsonResponse(fixtureResult(0))),
    ]],
    ['lead_observed', 'first_write_dispatched', 1, [
      respond(attestationResponse()),
      respond(permitResponse()),
      respond(jsonResponse(fixtureResult(0))),
      respond(inquiryResponse(false)),
      respond(jsonResponse(fixtureResult(1, LEAD_ID))),
    ]],
  ] as const)(
    '%s checkpoint 持久化失败后禁止后续 inquiry，Lead 未 durable 时不 cleanup',
    async (failTransition, expectedPhase, expectedInquiries, steps) => {
      const capsule = capsuleHarness({ failTransition })
      const scenario = scriptedFetch([...steps])
      await expect(runStagingAcceptance({
        environment: validEnvironment,
        fetchImpl: scenario.fetchImpl,
        randomUUID: () => SUBMISSION_ID,
        capsuleStore: capsule.store,
      })).rejects.toThrow('staging acceptance scenario_failed')

      expect(scenario.remaining).toHaveLength(0)
      expect(scenario.calls.filter((call) =>
        new URL(call.url).pathname.endsWith('/inquiries'))).toHaveLength(expectedInquiries)
      expect(scenario.calls.some((call) =>
        new URL(call.url).pathname.endsWith('/leads') &&
        (requestBody(call) as { action?: string }).action === 'cleanup')).toBe(false)
      expect(capsule.active()).toMatchObject({ phase: expectedPhase, leadId: null })
      expect(capsule.lease.removeConfirmed).not.toHaveBeenCalled()
    },
  )

  it.each([
    ['retry_write_dispatched', 'lead_observed', 1, [
      respond(attestationResponse()),
      respond(permitResponse()),
      respond(jsonResponse(fixtureResult(0))),
      respond(inquiryResponse(false)),
      respond(jsonResponse(fixtureResult(1, LEAD_ID))),
    ]],
    ['cleanup_dispatched', 'idempotency_verified', 2, [
      respond(attestationResponse()),
      respond(permitResponse()),
      respond(jsonResponse(fixtureResult(0))),
      respond(inquiryResponse(false)),
      respond(jsonResponse(fixtureResult(1, LEAD_ID))),
      respond(inquiryResponse(true)),
      respond(jsonResponse(fixtureResult(1, LEAD_ID))),
    ]],
    ['idempotency_verified', 'retry_write_dispatched', 2, [
      respond(attestationResponse()),
      respond(permitResponse()),
      respond(jsonResponse(fixtureResult(0))),
      respond(inquiryResponse(false)),
      respond(jsonResponse(fixtureResult(1, LEAD_ID))),
      respond(inquiryResponse(true)),
      respond(jsonResponse(fixtureResult(1, LEAD_ID))),
    ]],
  ] as const)(
    '%s checkpoint 失败时不再 inquiry 或 cleanup，并保留旧 durable phase',
    async (failTransition, expectedPhase, expectedInquiries, steps) => {
      const capsule = capsuleHarness({ failTransition })
      const scenario = scriptedFetch([...steps])
      await expect(runStagingAcceptance({
        environment: validEnvironment,
        fetchImpl: scenario.fetchImpl,
        randomUUID: () => SUBMISSION_ID,
        capsuleStore: capsule.store,
      })).rejects.toThrow('staging acceptance scenario_failed')

      expect(scenario.remaining).toHaveLength(0)
      expect(scenario.calls.filter((call) =>
        new URL(call.url).pathname.endsWith('/inquiries'))).toHaveLength(expectedInquiries)
      expect(scenario.calls.filter((call) =>
        new URL(call.url).pathname.endsWith('/leads') &&
        (requestBody(call) as { action?: string }).action === 'cleanup')).toHaveLength(0)
      expect(capsule.active()).toMatchObject({ phase: expectedPhase, leadId: LEAD_ID })
      expect(capsule.lease.removeConfirmed).not.toHaveBeenCalled()
    },
  )

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
    ['multiple leads', fixtureResult(2, null), 'staging acceptance fixture_ambiguous'],
    ['follow-up exists', fixtureResult(1, LEAD_ID, 1, 0), 'staging acceptance fixture_relations_present'],
    ['ownership history exists', fixtureResult(1, LEAD_ID, 0, 1), 'staging acceptance fixture_relations_present'],
  ])('%s 时冻结，且不猜 ID、不删除', async (_label, unsafeFixture, expectedError) => {
    const scenario = scriptedFetch([
      respond(attestationResponse()),
      respond(permitResponse()),
      respond(jsonResponse(fixtureResult(0))),
      respond(inquiryResponse(false)),
      respond(jsonResponse(unsafeFixture)),
    ])
    await expect(runStagingAcceptance({
      environment: validEnvironment,
      fetchImpl: scenario.fetchImpl,
      randomUUID: () => SUBMISSION_ID,
    })).rejects.toThrow(expectedError)
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
    ])
    await expect(runStagingAcceptance({
      environment: validEnvironment,
      fetchImpl: scenario.fetchImpl,
      randomUUID: () => SUBMISSION_ID,
    })).rejects.toThrow('staging acceptance fixture_owner_changed')
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

  it.each([
    ['cleanup_confirmed checkpoint', { failTransition: 'cleanup_confirmed' as const }, 'cleanup_dispatched'],
    ['confirmed capsule remove', { removeConfirmedError: new Error('secret remove failure') }, 'cleanup_confirmed'],
  ])('%s 持久化失败时返回固定错误并保留可恢复 capsule', async (_label, harnessOptions, expectedPhase) => {
    const capsule = capsuleHarness(harnessOptions)
    const scenario = scriptedFetch([
      respond(attestationResponse()),
      respond(permitResponse()),
      respond(jsonResponse(fixtureResult(0))),
      respond(inquiryResponse(false)),
      respond(jsonResponse(fixtureResult(1, LEAD_ID))),
      respond(inquiryResponse(true)),
      respond(jsonResponse(fixtureResult(1, LEAD_ID))),
      respond(cleanupResponse()),
      respond(jsonResponse(fixtureResult(0))),
    ])

    await expect(runStagingAcceptance({
      environment: validEnvironment,
      fetchImpl: scenario.fetchImpl,
      randomUUID: () => SUBMISSION_ID,
      capsuleStore: capsule.store,
    })).rejects.toThrow('staging acceptance scenario_failed')

    expect(scenario.remaining).toHaveLength(0)
    expect(capsule.active()).toMatchObject({ phase: expectedPhase, leadId: LEAD_ID })
    expect(scenario.calls.filter((call) =>
      new URL(call.url).pathname.endsWith('/leads') &&
      (requestBody(call) as { action?: string }).action === 'cleanup')).toHaveLength(1)
  })

  it('active capsule 已有前置失败且 release 也失败时保留 capsule、零额外动作并只返回固定错误', async () => {
    const releaseSecret = `release leaked ${RECOVERY_RECEIPT}`
    const capsule = capsuleHarness({ releaseError: new Error(releaseSecret) })
    const scenario = scriptedFetch([
      respond(attestationResponse({ staging: false })),
    ])
    let observedError: unknown

    try {
      await runStagingAcceptance({
        environment: validEnvironment,
        fetchImpl: scenario.fetchImpl,
        randomUUID: () => SUBMISSION_ID,
        capsuleStore: capsule.store,
      })
    } catch (error) {
      observedError = error
    }

    expect(observedError).toBeInstanceOf(Error)
    const message = observedError instanceof Error ? observedError.message : ''
    expect(message).toBe('staging acceptance attestation_invalid')
    expect(message).not.toContain(releaseSecret)
    expect(message).not.toContain(RECOVERY_RECEIPT)
    expect(scenario.remaining).toHaveLength(0)
    expect(scenario.calls).toHaveLength(1)
    expect(capsule.active()).toMatchObject({ phase: 'prepared', recoveryReceipt: null, leadId: null })
    expect(capsule.lease.transition).not.toHaveBeenCalled()
    expect(capsule.lease.removeConfirmed).not.toHaveBeenCalled()
    expect(capsule.lease.release).toHaveBeenCalledOnce()
  })

  it('terminal capsule 已删除但 release 失败时返回固定错误，不重复请求、transition 或 remove', async () => {
    const releaseSecret = `release leaked ${PERMIT}`
    const capsule = capsuleHarness({ releaseError: new Error(releaseSecret) })
    const { fetchImpl, calls } = happyFakeFetch()
    let observedError: unknown

    try {
      await runStagingAcceptance({
        environment: validEnvironment,
        fetchImpl,
        randomUUID: () => SUBMISSION_ID,
        capsuleStore: capsule.store,
      })
    } catch (error) {
      observedError = error
    }

    expect(observedError).toBeInstanceOf(Error)
    const message = observedError instanceof Error ? observedError.message : ''
    expect(message).toBe('staging acceptance scenario_failed')
    expect(message).not.toContain(releaseSecret)
    expect(message).not.toContain(PERMIT)
    expect(calls).toHaveLength(12)
    expect(capsule.active()).toBeNull()
    expect(capsule.lease.transition).toHaveBeenCalledTimes(7)
    expect(capsule.lease.removeConfirmed).toHaveBeenCalledOnce()
    expect(capsule.lease.release).toHaveBeenCalledOnce()
  })

  it('首次写入中 SIGINT/SIGTERM 与 finally 共享 finalize promise，保留 dispatch capsule且不清理', async () => {
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
    const capsule = capsuleHarness()
    const scenario = scriptedFetch([
      respond(attestationResponse()),
      respond(permitResponse()),
      respond(jsonResponse(fixtureResult(0))),
      () => {
        markInquiryStarted?.()
        return pendingInquiry
      },
    ])

    const run = runStagingAcceptance({
      environment: validEnvironment,
      fetchImpl: scenario.fetchImpl,
      randomUUID: () => SUBMISSION_ID,
      registerSignal,
      capsuleStore: capsule.store,
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
      (requestBody(call) as { action?: string }).action === 'cleanup')).toHaveLength(0)
    expect(scenario.remaining).toHaveLength(0)
    expect(capsule.active()).toMatchObject({ phase: 'first_write_dispatched', leadId: null })
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

  it('release 窗口的 late signal 复用既有 finalize，release 完成后才注销 listeners', async () => {
    const events: string[] = []
    let markReleaseStarted: (() => void) | undefined
    const releaseStarted = new Promise<void>((resolveStarted) => { markReleaseStarted = resolveStarted })
    let allowRelease: (() => void) | undefined
    const releaseBarrier = new Promise<void>((resolveRelease) => { allowRelease = resolveRelease })
    const capsule = capsuleHarness({
      events,
      releaseBarrier,
      onReleaseStarted() {
        events.push('capsule:release_started')
        markReleaseStarted?.()
      },
    })
    const handlers = new Map<string, () => Promise<void>>()
    const removers: Array<ReturnType<typeof vi.fn>> = []
    const registerSignal = vi.fn((signal: 'SIGINT' | 'SIGTERM', handler: () => Promise<void>) => {
      handlers.set(signal, handler)
      const remove = vi.fn(() => { events.push(`signal:removed:${signal}`) })
      removers.push(remove)
      return remove
    })
    const { fetchImpl, calls } = happyFakeFetch()

    const run = runStagingAcceptance({
      environment: validEnvironment,
      fetchImpl,
      randomUUID: () => SUBMISSION_ID,
      capsuleStore: capsule.store,
      registerSignal,
    })
    await bounded(releaseStarted, 'release start')

    expect(removers.every((remove) => remove.mock.calls.length === 0)).toBe(true)
    const requestCount = calls.length
    const transitionCount = vi.mocked(capsule.lease.transition).mock.calls.length
    const removeCount = vi.mocked(capsule.lease.removeConfirmed).mock.calls.length
    const lateSignal = handlers.get('SIGTERM')?.()
    expect(lateSignal).toBeInstanceOf(Promise)
    await bounded(lateSignal ?? Promise.reject(new Error('late signal missing')), 'late signal')

    expect(calls).toHaveLength(requestCount)
    expect(capsule.lease.transition).toHaveBeenCalledTimes(transitionCount)
    expect(capsule.lease.removeConfirmed).toHaveBeenCalledTimes(removeCount)
    expect(capsule.lease.release).toHaveBeenCalledOnce()
    expect(removers.every((remove) => remove.mock.calls.length === 0)).toBe(true)

    allowRelease?.()
    await expect(bounded(run, 'runner release')).rejects.toThrow('staging acceptance interrupted')

    expect(removers.every((remove) => remove.mock.calls.length === 1)).toBe(true)
    const releasedIndex = events.indexOf('capsule:released')
    expect(releasedIndex).toBeGreaterThan(events.indexOf('capsule:release_started'))
    expect(events.indexOf('signal:removed:SIGINT')).toBeGreaterThan(releasedIndex)
    expect(events.indexOf('signal:removed:SIGTERM')).toBeGreaterThan(releasedIndex)
    expect(calls).toHaveLength(requestCount)
    expect(capsule.lease.transition).toHaveBeenCalledTimes(transitionCount)
    expect(capsule.lease.removeConfirmed).toHaveBeenCalledTimes(removeCount)
  })

  it('write permit 拒绝缺 receipt/issuedAt 的旧响应，且不进入 fixture 或 inquiry', async () => {
    const legacyResponse = jsonResponse({
      ok: true,
      permit: PERMIT,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      meta: { requestId: crypto.randomUUID() },
    })
    const scenario = scriptedFetch([
      respond(attestationResponse()),
      respond(legacyResponse),
    ])
    await expect(runStagingAcceptance({
      environment: validEnvironment,
      fetchImpl: scenario.fetchImpl,
      randomUUID: () => SUBMISSION_ID,
    })).rejects.toThrow('staging acceptance permit_invalid')
    expect(scenario.calls).toHaveLength(2)
  })

  it.each([
    ['receipt missing', { recoveryReceipt: undefined }],
    ['receipt noncanonical', { recoveryReceipt: `${RECOVERY_RECEIPT}=` }],
    ['issuedAt noncanonical', { issuedAt: '2027-01-15T08:00:00Z' }],
    ['expiry not after issue', { expiresAt: ISSUED_AT }],
    ['TTL one millisecond short', { expiresAt: '2027-01-15T08:09:59.999Z' }],
    ['TTL one millisecond long', { expiresAt: '2027-01-15T08:10:00.001Z' }],
    ['TTL too long', { expiresAt: '2027-01-15T08:20:00.000Z' }],
    ['unexpected key', { unexpected: true }],
  ])('write permit exact PG-time response 拒绝：%s', async (_label, override) => {
    const scenario = scriptedFetch([
      respond(attestationResponse()),
      respond(permitResponse(override)),
    ])
    await expect(runStagingAcceptance({
      environment: validEnvironment,
      fetchImpl: scenario.fetchImpl,
      randomUUID: () => SUBMISSION_ID,
    })).rejects.toThrow('staging acceptance permit_invalid')
    expect(scenario.calls).toHaveLength(2)
  })

  it('fresh inspect permit exact response 禁止携带 recoveryReceipt', async () => {
    const scenario = scriptedFetch([
      respond(attestationResponse()),
      respond(permitResponse()),
      respond(jsonResponse(fixtureResult(0))),
      respond(inquiryResponse(false)),
      respond(inspectPermitResponse(INSPECT_PERMITS[0], { recoveryReceipt: RECOVERY_RECEIPT })),
    ], { autoInspectPermits: false })
    await expect(runStagingAcceptance({
      environment: validEnvironment,
      fetchImpl: scenario.fetchImpl,
      randomUUID: () => SUBMISSION_ID,
    })).rejects.toThrow('staging acceptance permit_invalid')
    expect(scenario.calls.filter((call) =>
      new URL(call.url).pathname.endsWith('/inquiries'))).toHaveLength(1)
  })

  it('permit PG issued/expires 只做相对 canonical 校验，不使用本机 Date.now 作安全判断', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.parse(EXPIRES_AT) + 365 * 24 * 60 * 60_000)
    try {
      const { fetchImpl } = happyFakeFetch()
      await expect(runStagingAcceptance({
        environment: validEnvironment,
        fetchImpl,
        randomUUID: () => SUBMISSION_ID,
      })).resolves.toMatchObject({ ok: true, manifest: { clean: true } })
    } finally {
      now.mockRestore()
    }
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
    })).rejects.toThrow('staging acceptance fixture_response_invalid')
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
