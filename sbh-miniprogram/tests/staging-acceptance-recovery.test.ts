import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

const scriptPath = fileURLToPath(new URL('../scripts/staging-acceptance-recovery.mjs', import.meta.url))
const packagePath = fileURLToPath(new URL('../package.json', import.meta.url))
const tempRoots: string[] = []

const recoveryModule = await import('../scripts/staging-acceptance-recovery.mjs' as never) as {
  runStagingAcceptanceRecovery: RecoveryRunner
  main: (...args: unknown[]) => Promise<unknown>
}
const trialOriginModule = await import('../scripts/trial-origin.mjs' as never) as {
  STAGING_RUNTIME_ORIGIN: string
}
const { STAGING_RUNTIME_ORIGIN } = trialOriginModule

type Phase =
  | 'prepared'
  | 'clean_start_proven'
  | 'first_write_dispatched'
  | 'lead_observed'
  | 'retry_write_dispatched'
  | 'idempotency_verified'
  | 'cleanup_dispatched'
  | 'cleanup_confirmed'

type Capsule = Readonly<{
  schemaVersion: 1
  phase: Phase
  runId: string
  submissionRequestId: string
  listingSlug: string
  fixtureNamespace: string
  origin: string
  expectedGitCommitSha: string
  expectedDeploymentRevision: string
  expectedDbFingerprint: string
  recoveryReceipt: string | null
  leadId: string | null
}>

type CapsuleLease = Readonly<{
  readActive(): Promise<Capsule | null>
  transition(nextPhase: string, patch?: Record<string, unknown>): Promise<Capsule>
  removeConfirmed(): Promise<void>
  release(): Promise<void>
}>

type CapsuleStore = Readonly<{
  acquire(mode: 'normal' | 'recovery'): Promise<CapsuleLease>
}>

type CreationCapsuleStore = Readonly<{
  acquire(mode: 'normal' | 'recovery'): Promise<CapsuleLease & Readonly<{
    createPrepared(identity: Omit<
      Capsule,
      'schemaVersion' | 'phase' | 'recoveryReceipt' | 'leadId'
    >): Promise<Capsule>
  }>>
}>

const capsuleModule = await import('../scripts/staging-acceptance-capsule.mjs' as never) as {
  createCapsuleStore: (options: { rootDir: string }) => CreationCapsuleStore
}

type RecoveryOptions = Readonly<{
  capsuleStore?: CapsuleStore
  environment?: Record<string, string | undefined>
  fetchImpl?: typeof fetch
  logger?: (entry: Readonly<Record<string, unknown>>) => void
  requestTimeoutMs?: number
  maxResponseBytes?: number
}>

type RecoveryRunner = (options?: RecoveryOptions) => Promise<Readonly<{
  ok: true
  recovered: boolean
  clean: true
  previousPhase: Phase | null
}>>

const RUN_ID = '550e8400-e29b-41d4-a716-446655440000'
const SUBMISSION_ID = '650e8400-e29b-41d4-a716-446655440000'
const LISTING_SLUG = 'jing-an-tower'
const NAMESPACE = 'mp-e2e-a3a9e1ed9732cab2'
const SHA = 'a'.repeat(40)
const REVISION = 'revision-004'
const FINGERPRINT = 'b'.repeat(64)
const BOOTSTRAP = Buffer.from(Array.from({ length: 32 }, (_, index) => index + 33)).toString('base64url')
const RECOVERY_RECEIPT = `${Buffer.alloc(48, 7).toString('base64url')}.${Buffer.alloc(32, 8).toString('base64url')}`
const LEAD_ID = 'n:42'
const ISSUED_AT = '2000-01-01T00:00:00.000Z'
const EXPIRES_AT = '2000-01-01T00:10:00.000Z'
const TOKEN_ONE = `${Buffer.alloc(48, 11).toString('base64url')}.${Buffer.alloc(32, 12).toString('base64url')}`
const TOKEN_TWO = `${Buffer.alloc(48, 13).toString('base64url')}.${Buffer.alloc(32, 14).toString('base64url')}`

const validEnvironment = Object.freeze({
  MP_E2E_ALLOW_STAGING_RECOVERY: '1',
  MP_E2E_API_ORIGIN: STAGING_RUNTIME_ORIGIN,
  MP_E2E_OPERATOR_BOOTSTRAP_SECRET: BOOTSTRAP,
})

const permitIdentity = Object.freeze({
  runId: RUN_ID,
  submissionRequestId: SUBMISSION_ID,
  listingSlug: LISTING_SLUG,
  fixtureNamespace: NAMESPACE,
  expectedGitCommitSha: SHA,
  expectedDeploymentRevision: REVISION,
  expectedDbFingerprint: FINGERPRINT,
})

const identity = Object.freeze({
  ...permitIdentity,
  origin: STAGING_RUNTIME_ORIGIN,
})

function capsuleFor(phase: Phase): Capsule {
  const hasReceipt = phase !== 'prepared'
  const hasLead = new Set<Phase>([
    'lead_observed',
    'retry_write_dispatched',
    'idempotency_verified',
    'cleanup_dispatched',
  ]).has(phase)
  return Object.freeze({
    schemaVersion: 1,
    phase,
    ...identity,
    recoveryReceipt: hasReceipt ? RECOVERY_RECEIPT : null,
    leadId: hasLead ? LEAD_ID : null,
  })
}

function capsuleHarness(initial: Capsule | null, overrides: Partial<{
  acquireError: Error
  readError: Error
  transitionError: Error
  removeError: Error
  releaseError: Error
}> = {}) {
  const events: string[] = []
  let active = initial
  const lease: CapsuleLease = {
    readActive: vi.fn(async () => {
      events.push('read')
      if (overrides.readError) throw overrides.readError
      return active
    }),
    transition: vi.fn(async (nextPhase: string, patch: Record<string, unknown> = {}) => {
      events.push(`transition:${nextPhase}:${JSON.stringify(patch)}`)
      if (overrides.transitionError) throw overrides.transitionError
      if (!active) throw new Error('missing active capsule')
      active = Object.freeze({ ...active, phase: nextPhase as Phase })
      return active
    }),
    removeConfirmed: vi.fn(async () => {
      events.push('remove')
      if (overrides.removeError) throw overrides.removeError
      active = null
    }),
    release: vi.fn(async () => {
      events.push('release')
      if (overrides.releaseError) throw overrides.releaseError
    }),
  }
  const store: CapsuleStore = {
    acquire: vi.fn(async (mode: 'normal' | 'recovery') => {
      events.push(`acquire:${mode}`)
      if (overrides.acquireError) throw overrides.acquireError
      return lease
    }),
  }
  return { store, lease, events, active: () => active }
}

function responseJson(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function attestationResponse(changes: Record<string, unknown> = {}) {
  return {
    ok: true,
    staging: true,
    deploymentGitCommitSha: SHA,
    deploymentRevision: REVISION,
    fingerprint: FINGERPRINT,
    acceptanceReady: true,
    meta: { requestId: 'attestation-request' },
    ...changes,
  }
}

function permitResponse(permit: string, changes: Record<string, unknown> = {}) {
  return {
    ok: true,
    permit,
    issuedAt: ISSUED_AT,
    expiresAt: EXPIRES_AT,
    meta: { requestId: `permit-${permit === TOKEN_ONE ? 'one' : 'two'}` },
    ...changes,
  }
}

function inspectResponse(changes: Record<string, unknown> = {}) {
  return {
    ok: true,
    result: {
      leadCount: 0,
      leadId: null,
      followUpCount: 0,
      ownershipHistoryCount: 0,
      ...changes,
    },
    meta: { requestId: 'inspect-request' },
  }
}

function recoverResponse(changes: Record<string, unknown> = {}) {
  return {
    ok: true,
    result: {
      cleaned: true,
      leadCount: 0,
      followUpCount: 0,
      ownershipHistoryCount: 0,
      ...changes,
    },
    meta: { requestId: 'recover-request' },
  }
}

type QueuedResponse =
  | unknown
  | Response
  | Error
  | ((url: string, init: RequestInit) => Response | Promise<Response>)

function fetchSequence(...queue: QueuedResponse[]) {
  const remaining = [...queue]
  const fetchImpl = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const next = remaining.shift()
    if (next === undefined) throw new Error('unexpected network request')
    if (next instanceof Error) throw next
    if (typeof next === 'function') return next(String(input), init)
    if (next instanceof Response) return next
    return responseJson(next)
  }) as unknown as typeof fetch
  return { fetchImpl, remaining }
}

function bodyAt(fetchImpl: typeof fetch, index: number): Record<string, unknown> | null {
  const body = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[index]?.[1]?.body
  return typeof body === 'string' ? JSON.parse(body) as Record<string, unknown> : null
}

function urlAt(fetchImpl: typeof fetch, index: number): string {
  return String((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[index]?.[0])
}

function headersAt(fetchImpl: typeof fetch, index: number): Record<string, string> {
  return (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[index]?.[1]?.headers ?? {}
}

async function captureFailure(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(Error)
    return error as Error
  }
  throw new Error('expected recovery failure')
}

function assertNoInquiry(fetchImpl: typeof fetch): void {
  for (const call of (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls) {
    expect(String(call[0])).not.toContain('/inquiries')
  }
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('staging acceptance recovery entrypoint', () => {
  it('提供独立 recovery CLI，并且 package 只用固定脚本启动它', () => {
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as {
      scripts?: Record<string, string>
    }
    expect(existsSync(scriptPath)).toBe(true)
    expect(packageJson.scripts?.['staging:acceptance:recover'])
      .toBe('node scripts/staging-acceptance-recovery.mjs')
    const source = readFileSync(scriptPath, 'utf8')
    expect(source).toContain('createCapsuleStore()')
    expect(source).not.toContain('staging-acceptance-runner.mjs')
  })

  it('导出可注入 recovery orchestrator 与 CLI main', async () => {
    expect(recoveryModule.runStagingAcceptanceRecovery).toBeTypeOf('function')
    expect(recoveryModule.main).toBeTypeOf('function')
  })
})

describe('staging acceptance recovery orchestration', () => {
  it('强制注入 capsuleStore，缺失时固定失败且零网络', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch
    const error = await captureFailure(recoveryModule.runStagingAcceptanceRecovery({
      environment: validEnvironment,
      fetchImpl,
    }))
    expect(error.message).toBe('staging acceptance recovery config_invalid')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('第一步 acquire(recovery)；无 active capsule 安全 no-op、release 且零网络', async () => {
    const capsule = capsuleHarness(null)
    const fetchImpl = vi.fn() as unknown as typeof fetch
    await expect(recoveryModule.runStagingAcceptanceRecovery({
      capsuleStore: capsule.store,
      environment: {},
      fetchImpl,
    })).resolves.toEqual({
      ok: true,
      recovered: false,
      clean: true,
      previousPhase: null,
    })
    expect(capsule.events).toEqual(['acquire:recovery', 'read', 'release'])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('无 active capsule 但 release 失败时零网络并固定失败', async () => {
    const capsule = capsuleHarness(null, {
      releaseError: new Error('release-sensitive'),
    })
    const fetchImpl = vi.fn() as unknown as typeof fetch
    const error = await captureFailure(recoveryModule.runStagingAcceptanceRecovery({
      capsuleStore: capsule.store,
      environment: {},
      fetchImpl,
    }))
    expect(error.message).toBe('staging acceptance recovery release_failed')
    expect(capsule.events).toEqual(['acquire:recovery', 'read', 'release'])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('active capsule 前置失败后 release 再失败时不追加动作并保留 capsule', async () => {
    const capsule = capsuleHarness(capsuleFor('first_write_dispatched'), {
      releaseError: new Error('release-sensitive'),
    })
    const network = fetchSequence(attestationResponse({ deploymentGitCommitSha: 'c'.repeat(40) }))
    const error = await captureFailure(recoveryModule.runStagingAcceptanceRecovery({
      capsuleStore: capsule.store,
      environment: validEnvironment,
      fetchImpl: network.fetchImpl,
    }))
    expect(error.message).toBe('staging acceptance recovery release_failed')
    expect(network.fetchImpl).toHaveBeenCalledOnce()
    expect(capsule.lease.transition).not.toHaveBeenCalled()
    expect(capsule.lease.removeConfirmed).not.toHaveBeenCalled()
    expect(capsule.active()?.phase).toBe('first_write_dispatched')
    expect(capsule.events.at(-1)).toBe('release')
    assertNoInquiry(network.fetchImpl)
  })

  it('terminal transition/remove 完成后 release 失败仍固定失败且不泄漏 capability', async () => {
    const capsule = capsuleHarness(capsuleFor('prepared'), {
      releaseError: new Error(`${BOOTSTRAP} ${RECOVERY_RECEIPT} ${TOKEN_ONE}`),
    })
    const logs: Readonly<Record<string, unknown>>[] = []
    const network = fetchSequence(
      attestationResponse(),
      permitResponse(TOKEN_ONE),
      inspectResponse(),
    )
    const error = await captureFailure(recoveryModule.runStagingAcceptanceRecovery({
      capsuleStore: capsule.store,
      environment: validEnvironment,
      fetchImpl: network.fetchImpl,
      logger: (entry) => logs.push(entry),
    }))
    expect(error.message).toBe('staging acceptance recovery release_failed')
    expect(network.fetchImpl).toHaveBeenCalledTimes(3)
    expect(capsule.lease.transition).toHaveBeenCalledWith('cleanup_confirmed')
    expect(capsule.lease.removeConfirmed).toHaveBeenCalledOnce()
    expect(capsule.active()).toBeNull()
    expect(capsule.events.at(-1)).toBe('release')
    const evidence = `${error.message}\n${JSON.stringify(logs)}`
    for (const secret of [BOOTSTRAP, RECOVERY_RECEIPT, TOKEN_ONE]) {
      expect(evidence).not.toContain(secret)
    }
    assertNoInquiry(network.fetchImpl)
  })

  it.each([
    ['missing flag', { ...validEnvironment, MP_E2E_ALLOW_STAGING_RECOVERY: undefined }],
    ['wrong flag', { ...validEnvironment, MP_E2E_ALLOW_STAGING_RECOVERY: '0' }],
    ['missing origin', { ...validEnvironment, MP_E2E_API_ORIGIN: undefined }],
    ['origin slash', { ...validEnvironment, MP_E2E_API_ORIGIN: `${STAGING_RUNTIME_ORIGIN}/` }],
    ['origin sibling', { ...validEnvironment, MP_E2E_API_ORIGIN: STAGING_RUNTIME_ORIGIN.replace('sbhmini-', 'other-') }],
    ['origin path', { ...validEnvironment, MP_E2E_API_ORIGIN: `${STAGING_RUNTIME_ORIGIN}/api` }],
    ['missing bootstrap', { ...validEnvironment, MP_E2E_OPERATOR_BOOTSTRAP_SECRET: undefined }],
    ['weak bootstrap', { ...validEnvironment, MP_E2E_OPERATOR_BOOTSTRAP_SECRET: 'weak' }],
  ])('%s 在 acquire/read 后、网络前固定失败并 release', async (_label, environment) => {
    const capsule = capsuleHarness(capsuleFor('prepared'))
    const fetchImpl = vi.fn() as unknown as typeof fetch
    const error = await captureFailure(recoveryModule.runStagingAcceptanceRecovery({
      capsuleStore: capsule.store,
      environment,
      fetchImpl,
    }))
    expect(error.message).toBe('staging acceptance recovery config_invalid')
    expect(capsule.events).toEqual(['acquire:recovery', 'read', 'release'])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each<Readonly<[Phase, string | null]>>([
    ['prepared', null],
    ['clean_start_proven', RECOVERY_RECEIPT],
    ['cleanup_confirmed', RECOVERY_RECEIPT],
  ])('%s 只签 inspect permit；fresh inspect 0/0/0 后才 transition/remove', async (phase, expectedReceipt) => {
    const capsule = capsuleHarness({
      ...capsuleFor(phase),
      recoveryReceipt: expectedReceipt,
    })
    const network = fetchSequence(
      attestationResponse(),
      permitResponse(TOKEN_ONE),
      inspectResponse(),
    )
    const environment = {
      ...validEnvironment,
      MP_E2E_RUN_ID: '750e8400-e29b-41d4-a716-446655440000',
      MP_E2E_EXPECTED_GIT_COMMIT_SHA: 'c'.repeat(40),
      MP_E2E_EXPECTED_DEPLOYMENT_REVISION: 'wrong-current-revision',
      MP_E2E_EXPECTED_DB_FINGERPRINT: 'd'.repeat(64),
      MP_E2E_TEST_PHONE: 'not-used',
      MP_E2E_PRIVACY_POLICY_VERSION: 'not-used',
    }

    await expect(recoveryModule.runStagingAcceptanceRecovery({
      capsuleStore: capsule.store,
      environment,
      fetchImpl: network.fetchImpl,
    })).resolves.toEqual({
      ok: true,
      recovered: true,
      clean: true,
      previousPhase: phase,
    })

    expect(urlAt(network.fetchImpl, 0)).toBe(`${STAGING_RUNTIME_ORIGIN}/api/mini/v1/acceptance/attestation`)
    expect(urlAt(network.fetchImpl, 1)).toBe(`${STAGING_RUNTIME_ORIGIN}/api/mini/v1/acceptance/permits`)
    expect(urlAt(network.fetchImpl, 2)).toBe(`${STAGING_RUNTIME_ORIGIN}/api/mini/v1/acceptance/leads`)
    expect(bodyAt(network.fetchImpl, 1)).toEqual({ mode: 'inspect', ...permitIdentity })
    expect(bodyAt(network.fetchImpl, 2)).toEqual({
      action: 'inspect',
      submissionRequestId: SUBMISSION_ID,
      listingSlug: LISTING_SLUG,
    })
    expect(headersAt(network.fetchImpl, 0)).toEqual({ 'x-sbh-acceptance-bootstrap': BOOTSTRAP })
    expect(headersAt(network.fetchImpl, 2)).toEqual({
      'content-type': 'application/json',
      'x-sbh-acceptance-permit': TOKEN_ONE,
    })
    if (phase === 'cleanup_confirmed') {
      expect(capsule.lease.transition).not.toHaveBeenCalled()
    } else {
      expect(capsule.lease.transition).toHaveBeenCalledWith('cleanup_confirmed')
    }
    expect(capsule.lease.removeConfirmed).toHaveBeenCalledOnce()
    expect(capsule.active()).toBeNull()
    expect(capsule.events.at(-1)).toBe('release')
    if (phase === 'prepared') {
      const transition = (capsule.lease.transition as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(transition).toEqual(['cleanup_confirmed'])
    }
    assertNoInquiry(network.fetchImpl)
  })

  it.each<Readonly<[Phase, string, string | null]>>([
    ['first_write_dispatched', 'unknown-first-write', null],
    ['lead_observed', 'known-lead', LEAD_ID],
    ['retry_write_dispatched', 'known-lead', LEAD_ID],
    ['idempotency_verified', 'known-lead', LEAD_ID],
    ['cleanup_dispatched', 'known-lead', LEAD_ID],
  ])('%s 使用 signed recovery mode；recover 成功后仍签全新 inspect permit 才终结', async (
    phase,
    recoveryMode,
    expectedLeadId,
  ) => {
    const capsule = capsuleHarness(capsuleFor(phase))
    const network = fetchSequence(
      attestationResponse(),
      permitResponse(TOKEN_ONE),
      recoverResponse({ cleaned: phase !== 'cleanup_dispatched' }),
      permitResponse(TOKEN_TWO),
      inspectResponse(),
    )

    await expect(recoveryModule.runStagingAcceptanceRecovery({
      capsuleStore: capsule.store,
      environment: validEnvironment,
      fetchImpl: network.fetchImpl,
    })).resolves.toMatchObject({ ok: true, recovered: true, clean: true, previousPhase: phase })

    expect(bodyAt(network.fetchImpl, 1)).toEqual({
      mode: 'recovery',
      ...permitIdentity,
      recoveryReceipt: RECOVERY_RECEIPT,
      recoveryMode,
      expectedLeadId,
    })
    expect(bodyAt(network.fetchImpl, 2)).toEqual({
      action: 'recover',
      submissionRequestId: SUBMISSION_ID,
      listingSlug: LISTING_SLUG,
      recoveryReceipt: RECOVERY_RECEIPT,
    })
    expect(bodyAt(network.fetchImpl, 3)).toEqual({ mode: 'inspect', ...permitIdentity })
    expect(bodyAt(network.fetchImpl, 4)).toEqual({
      action: 'inspect',
      submissionRequestId: SUBMISSION_ID,
      listingSlug: LISTING_SLUG,
    })
    expect(headersAt(network.fetchImpl, 2)['x-sbh-acceptance-permit']).toBe(TOKEN_ONE)
    expect(headersAt(network.fetchImpl, 4)['x-sbh-acceptance-permit']).toBe(TOKEN_TWO)
    expect([
      urlAt(network.fetchImpl, 0),
      urlAt(network.fetchImpl, 1),
      urlAt(network.fetchImpl, 2),
      urlAt(network.fetchImpl, 3),
      urlAt(network.fetchImpl, 4),
    ]).toEqual([
      `${STAGING_RUNTIME_ORIGIN}/api/mini/v1/acceptance/attestation`,
      `${STAGING_RUNTIME_ORIGIN}/api/mini/v1/acceptance/permits`,
      `${STAGING_RUNTIME_ORIGIN}/api/mini/v1/acceptance/leads`,
      `${STAGING_RUNTIME_ORIGIN}/api/mini/v1/acceptance/permits`,
      `${STAGING_RUNTIME_ORIGIN}/api/mini/v1/acceptance/leads`,
    ])
    const fetchMock = network.fetchImpl as unknown as ReturnType<typeof vi.fn>
    expect(fetchMock.mock.calls[2]?.[1]).not.toBe(fetchMock.mock.calls[4]?.[1])
    expect(capsule.lease.transition).toHaveBeenCalledWith('cleanup_confirmed')
    expect(capsule.lease.removeConfirmed).toHaveBeenCalledOnce()
    assertNoInquiry(network.fetchImpl)
  })

  it.each([
    ['git SHA', { deploymentGitCommitSha: 'c'.repeat(40) }],
    ['revision', { deploymentRevision: 'other-revision' }],
    ['fingerprint', { fingerprint: 'd'.repeat(64) }],
  ])('attestation %s 与 capsule identity 漂移时冻结并保留 capsule', async (_label, changes) => {
    const capsule = capsuleHarness(capsuleFor('first_write_dispatched'))
    const network = fetchSequence(attestationResponse(changes))
    await expect(recoveryModule.runStagingAcceptanceRecovery({
      capsuleStore: capsule.store,
      environment: validEnvironment,
      fetchImpl: network.fetchImpl,
    })).rejects.toThrow('staging acceptance recovery attestation_invalid')
    expect(network.fetchImpl).toHaveBeenCalledOnce()
    expect(capsule.lease.transition).not.toHaveBeenCalled()
    expect(capsule.lease.removeConfirmed).not.toHaveBeenCalled()
    expect(capsule.active()?.phase).toBe('first_write_dispatched')
    expect(capsule.events.at(-1)).toBe('release')
  })

  it.each([
    ['lock busy', responseJson({ ok: false, meta: { requestId: 'busy' } }, 503)],
    ['receipt not expired', responseJson({ ok: false, meta: { requestId: 'unexpired' } }, 409)],
    ['commit outcome unknown', responseJson({ ok: false, meta: { requestId: 'commit' } }, 503)],
    ['response unknown', new Error('network response leaked secret')],
  ])('%s 的 recover 未明确成功时禁止追加 inspect，并保留 capsule', async (_label, recoverFailure) => {
    const capsule = capsuleHarness(capsuleFor('first_write_dispatched'))
    const network = fetchSequence(
      attestationResponse(),
      permitResponse(TOKEN_ONE),
      recoverFailure,
    )
    await expect(recoveryModule.runStagingAcceptanceRecovery({
      capsuleStore: capsule.store,
      environment: validEnvironment,
      fetchImpl: network.fetchImpl,
    })).rejects.toThrow(/^staging acceptance recovery /)
    expect(network.fetchImpl).toHaveBeenCalledTimes(3)
    expect(capsule.lease.transition).not.toHaveBeenCalled()
    expect(capsule.lease.removeConfirmed).not.toHaveBeenCalled()
    expect(capsule.active()?.phase).toBe('first_write_dispatched')
    expect(capsule.events.at(-1)).toBe('release')
    assertNoInquiry(network.fetchImpl)
  })

  it.each([
    ['different/multiple Lead', { leadCount: 1 }],
    ['follow-up relation', { followUpCount: 1 }],
    ['ownership relation', { ownershipHistoryCount: 1 }],
  ])('recover 200 但 %s 非零时不得签 final inspect permit', async (_label, changes) => {
    const capsule = capsuleHarness(capsuleFor('lead_observed'))
    const network = fetchSequence(
      attestationResponse(),
      permitResponse(TOKEN_ONE),
      recoverResponse(changes),
    )
    await expect(recoveryModule.runStagingAcceptanceRecovery({
      capsuleStore: capsule.store,
      environment: validEnvironment,
      fetchImpl: network.fetchImpl,
    })).rejects.toThrow('staging acceptance recovery recover_not_clean')
    expect(network.fetchImpl).toHaveBeenCalledTimes(3)
    expect(capsule.lease.transition).not.toHaveBeenCalled()
    expect(capsule.lease.removeConfirmed).not.toHaveBeenCalled()
  })

  it.each([
    ['Lead remains', { leadCount: 1, leadId: LEAD_ID }],
    ['follow-up remains', { followUpCount: 1 }],
    ['ownership remains', { ownershipHistoryCount: 1 }],
  ])('fresh inspect 的 %s 时不得 transition/remove', async (_label, changes) => {
    const capsule = capsuleHarness(capsuleFor('first_write_dispatched'))
    const network = fetchSequence(
      attestationResponse(),
      permitResponse(TOKEN_ONE),
      recoverResponse(),
      permitResponse(TOKEN_TWO),
      inspectResponse(changes),
    )
    await expect(recoveryModule.runStagingAcceptanceRecovery({
      capsuleStore: capsule.store,
      environment: validEnvironment,
      fetchImpl: network.fetchImpl,
    })).rejects.toThrow('staging acceptance recovery inspect_not_clean')
    expect(capsule.lease.transition).not.toHaveBeenCalled()
    expect(capsule.lease.removeConfirmed).not.toHaveBeenCalled()
  })

  it.each([
    ['attestation extra key', attestationResponse({ extra: true }), 'attestation_invalid'],
    ['permit extra key', permitResponse(TOKEN_ONE, { extra: true }), 'permit_invalid'],
    ['permit malformed token', permitResponse('not-a-token'), 'permit_invalid'],
    ['permit noncanonical issuedAt', permitResponse(TOKEN_ONE, { issuedAt: '2000-01-01T00:00:00Z' }), 'permit_invalid'],
    ['permit expiry not after issue', permitResponse(TOKEN_ONE, { expiresAt: ISSUED_AT }), 'permit_invalid'],
    ['permit wrong TTL', permitResponse(TOKEN_ONE, { expiresAt: '2000-01-01T00:09:59.999Z' }), 'permit_invalid'],
    ['inspect extra key', { ...inspectResponse(), extra: true }, 'fixture_response_invalid'],
  ])('%s 由 exact parser fail-closed', async (label, invalid, code) => {
    const capsule = capsuleHarness(capsuleFor('prepared'))
    const queue = label.startsWith('attestation')
      ? [invalid]
      : label.startsWith('permit')
        ? [attestationResponse(), invalid]
        : [attestationResponse(), permitResponse(TOKEN_ONE), invalid]
    const network = fetchSequence(...queue)
    await expect(recoveryModule.runStagingAcceptanceRecovery({
      capsuleStore: capsule.store,
      environment: validEnvironment,
      fetchImpl: network.fetchImpl,
    })).rejects.toThrow(`staging acceptance recovery ${code}`)
    expect(capsule.lease.transition).not.toHaveBeenCalled()
    expect(capsule.lease.removeConfirmed).not.toHaveBeenCalled()
  })

  it('permit 的历史 PG issuedAt/expiresAt 只按 canonical TTL 验证，不依赖本机 Date.now', async () => {
    const capsule = capsuleHarness(capsuleFor('prepared'))
    const network = fetchSequence(
      attestationResponse(),
      permitResponse(TOKEN_ONE),
      inspectResponse(),
    )
    await expect(recoveryModule.runStagingAcceptanceRecovery({
      capsuleStore: capsule.store,
      environment: validEnvironment,
      fetchImpl: network.fetchImpl,
    })).resolves.toMatchObject({ ok: true, clean: true })
    expect(capsule.lease.removeConfirmed).toHaveBeenCalledOnce()
  })

  it('响应 content-length 超限时取消 body、零 transition/remove 并 release', async () => {
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{}'))
      },
      cancel() {
        cancelled = true
      },
    })
    const oversized = new Response(stream, {
      status: 200,
      headers: { 'content-type': 'application/json', 'content-length': '70000' },
    })
    const capsule = capsuleHarness(capsuleFor('prepared'))
    const network = fetchSequence(oversized)
    await expect(recoveryModule.runStagingAcceptanceRecovery({
      capsuleStore: capsule.store,
      environment: validEnvironment,
      fetchImpl: network.fetchImpl,
      maxResponseBytes: 1024,
    })).rejects.toThrow('staging acceptance recovery response_too_large')
    await Promise.resolve()
    expect(cancelled).toBe(true)
    expect(capsule.lease.transition).not.toHaveBeenCalled()
    expect(capsule.lease.removeConfirmed).not.toHaveBeenCalled()
    expect(capsule.events.at(-1)).toBe('release')
  })

  it('超时、错误与安全日志均不泄漏 bootstrap/receipt/permit', async () => {
    const capsule = capsuleHarness(capsuleFor('first_write_dispatched'))
    const logs: Readonly<Record<string, unknown>>[] = []
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init: RequestInit = {}) => {
      return await new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new Error(`${BOOTSTRAP} ${RECOVERY_RECEIPT} ${TOKEN_ONE}`))
        }, { once: true })
      })
    }) as unknown as typeof fetch
    const error = await captureFailure(recoveryModule.runStagingAcceptanceRecovery({
      capsuleStore: capsule.store,
      environment: validEnvironment,
      fetchImpl,
      requestTimeoutMs: 1,
      logger: (entry) => logs.push(entry),
    }))
    const evidence = `${error.message}\n${JSON.stringify(logs)}`
    for (const secret of [BOOTSTRAP, RECOVERY_RECEIPT, TOKEN_ONE]) {
      expect(evidence).not.toContain(secret)
    }
    expect(capsule.events.at(-1)).toBe('release')
  })

  it.each([
    ['transition failure', { transitionError: new Error('transition-sensitive') }],
    ['remove failure', { removeError: new Error('remove-sensitive') }],
  ])('%s 时 fixed failure、release，且不会继续任何网络', async (_label, overrides) => {
    const capsule = capsuleHarness(capsuleFor('prepared'), overrides)
    const network = fetchSequence(
      attestationResponse(),
      permitResponse(TOKEN_ONE),
      inspectResponse(),
    )
    const error = await captureFailure(recoveryModule.runStagingAcceptanceRecovery({
      capsuleStore: capsule.store,
      environment: validEnvironment,
      fetchImpl: network.fetchImpl,
    }))
    expect(error.message).toMatch(/^staging acceptance recovery /)
    expect(network.fetchImpl).toHaveBeenCalledTimes(3)
    expect(capsule.events.at(-1)).toBe('release')
  })

  it('真实 capsuleStore 的 prepared shortcut durable transition 后删除 active capsule', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'sbh-recovery-test-'))
    tempRoots.push(rootDir)
    const store = capsuleModule.createCapsuleStore({ rootDir })
    const normal = await store.acquire('normal')
    await normal.createPrepared(identity)
    await normal.release()
    const network = fetchSequence(
      attestationResponse(),
      permitResponse(TOKEN_ONE),
      inspectResponse(),
    )

    await expect(recoveryModule.runStagingAcceptanceRecovery({
      capsuleStore: store,
      environment: validEnvironment,
      fetchImpl: network.fetchImpl,
    })).resolves.toMatchObject({ ok: true, recovered: true, clean: true, previousPhase: 'prepared' })

    const verify = await store.acquire('recovery')
    await expect(verify.readActive()).resolves.toBeNull()
    await verify.release()
  })
})
