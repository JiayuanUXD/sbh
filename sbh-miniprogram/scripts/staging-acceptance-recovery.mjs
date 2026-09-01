import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { createCapsuleStore } from './staging-acceptance-capsule.mjs'
import { normalizeTrialOrigin, STAGING_RUNTIME_ORIGIN } from './trial-origin.mjs'

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const NAMESPACE_PATTERN = /^mp-e2e-[0-9a-f]{16}$/
const SHA_PATTERN = /^[0-9a-f]{40}$/
const REVISION_PATTERN = /^[A-Za-z0-9._-]{1,128}$/
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/
const NUMBER_LEAD_ID_PATTERN = /^n:[1-9][0-9]*$/
const STRING_LEAD_ID_PATTERN = /^s:([A-Za-z0-9_-]+)$/
const CONTROL_PATTERN = /\p{Cc}/u
const WHITESPACE_PATTERN = /\p{White_Space}/u

const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_RESPONSE_LIMIT = 64 * 1024
const PERMIT_TTL_MS = 10 * 60_000
const MAX_LEAD_STRING_BYTES = 128

const CAPSULE_KEYS = Object.freeze([
  'schemaVersion',
  'phase',
  'runId',
  'submissionRequestId',
  'listingSlug',
  'fixtureNamespace',
  'origin',
  'expectedGitCommitSha',
  'expectedDeploymentRevision',
  'expectedDbFingerprint',
  'recoveryReceipt',
  'leadId',
])

const INSPECT_ONLY_PHASES = new Set([
  'prepared',
  'clean_start_proven',
  'cleanup_confirmed',
])

const KNOWN_LEAD_PHASES = new Set([
  'lead_observed',
  'retry_write_dispatched',
  'idempotency_verified',
  'cleanup_dispatched',
])

const PATHS = Object.freeze({
  attestation: '/api/mini/v1/acceptance/attestation',
  permit: '/api/mini/v1/acceptance/permits',
  fixture: '/api/mini/v1/acceptance/leads',
})

class SafeRecoveryError extends Error {
  constructor(code) {
    super(`staging acceptance recovery ${code}`)
    this.name = 'SafeRecoveryError'
    this.code = code
  }
}

function fail(code) {
  throw new SafeRecoveryError(code)
}

function safeError(error, fallback) {
  return error instanceof SafeRecoveryError ? error : new SafeRecoveryError(fallback)
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value, keys) {
  if (!isRecord(value)) return false
  const actual = Reflect.ownKeys(value)
  return (
    actual.length === keys.length &&
    actual.every((key) => typeof key === 'string' && keys.includes(key))
  )
}

function canonicalBase64Url(value, minimumLength, maximumLength) {
  if (
    typeof value !== 'string' ||
    value.length < minimumLength ||
    value.length > maximumLength ||
    !BASE64URL_PATTERN.test(value)
  ) return false
  try {
    return Buffer.from(value, 'base64url').toString('base64url') === value
  } catch {
    return false
  }
}

function validBootstrapSecret(value) {
  if (!canonicalBase64Url(value, 43, 86)) return false
  try {
    const bytes = Buffer.from(value, 'base64url')
    return bytes.length >= 32 && bytes.length <= 64 && new Set(bytes).size >= 16
  } catch {
    return false
  }
}

function validRecoveryReceipt(value) {
  if (typeof value !== 'string' || value.length > 4096) return false
  const parts = value.split('.')
  return (
    parts.length === 2 &&
    canonicalBase64Url(parts[0], 64, 4000) &&
    canonicalBase64Url(parts[1], 43, 43)
  )
}

function canonicalLeadId(value) {
  if (typeof value !== 'string') return false
  if (NUMBER_LEAD_ID_PATTERN.test(value)) {
    const numeric = Number(value.slice(2))
    return Number.isSafeInteger(numeric) && numeric > 0 && `n:${numeric}` === value
  }
  const match = STRING_LEAD_ID_PATTERN.exec(value)
  if (!match) return false
  try {
    const encoded = match[1]
    const bytes = Buffer.from(encoded, 'base64url')
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return (
      bytes.length >= 1 &&
      bytes.length <= MAX_LEAD_STRING_BYTES &&
      bytes.toString('base64url') === encoded &&
      Buffer.from(decoded, 'utf8').equals(bytes) &&
      !CONTROL_PATTERN.test(decoded) &&
      !WHITESPACE_PATTERN.test(decoded)
    )
  } catch {
    return false
  }
}

function validPhaseState(capsule) {
  const { phase, recoveryReceipt, leadId } = capsule
  if (phase === 'prepared') return recoveryReceipt === null && leadId === null
  if (phase === 'clean_start_proven' || phase === 'first_write_dispatched') {
    return validRecoveryReceipt(recoveryReceipt) && leadId === null
  }
  if (KNOWN_LEAD_PHASES.has(phase)) {
    return validRecoveryReceipt(recoveryReceipt) && canonicalLeadId(leadId)
  }
  if (phase === 'cleanup_confirmed') {
    return (
      (recoveryReceipt === null && leadId === null) ||
      (validRecoveryReceipt(recoveryReceipt) && (leadId === null || canonicalLeadId(leadId)))
    )
  }
  return false
}

function fixtureNamespace(runId) {
  return `mp-e2e-${createHash('sha256').update(runId).digest('hex').slice(0, 16)}`
}

function parseCapsule(value) {
  const prototype = isRecord(value) ? Object.getPrototypeOf(value) : undefined
  if (
    !hasExactKeys(value, CAPSULE_KEYS) ||
    (prototype !== Object.prototype && prototype !== null) ||
    value.schemaVersion !== 1 ||
    !UUID_V4_PATTERN.test(value.runId) ||
    !UUID_V4_PATTERN.test(value.submissionRequestId) ||
    !SLUG_PATTERN.test(value.listingSlug) ||
    value.listingSlug.length > 128 ||
    !NAMESPACE_PATTERN.test(value.fixtureNamespace) ||
    value.fixtureNamespace !== fixtureNamespace(value.runId) ||
    value.origin !== STAGING_RUNTIME_ORIGIN ||
    !SHA_PATTERN.test(value.expectedGitCommitSha) ||
    !REVISION_PATTERN.test(value.expectedDeploymentRevision) ||
    !FINGERPRINT_PATTERN.test(value.expectedDbFingerprint) ||
    !validPhaseState(value)
  ) fail('capsule_invalid')
  return Object.freeze({ ...value })
}

function parseEnvironment(environment) {
  if (!isRecord(environment) || environment.MP_E2E_ALLOW_STAGING_RECOVERY !== '1') {
    fail('config_invalid')
  }
  let normalized
  try {
    normalized = normalizeTrialOrigin(environment.MP_E2E_API_ORIGIN ?? '')
  } catch {
    fail('config_invalid')
  }
  const operatorBootstrapSecret = environment.MP_E2E_OPERATOR_BOOTSTRAP_SECRET ?? ''
  if (!validBootstrapSecret(operatorBootstrapSecret)) fail('config_invalid')
  return Object.freeze({
    origin: normalized.origin,
    apiHost: normalized.host,
    operatorBootstrapSecret,
  })
}

function parsePositiveInteger(value, fallback, upperBound) {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < 1 || value > upperBound) fail('config_invalid')
  return value
}

function cancelResponseBody(response) {
  if (!response.body) return
  try {
    void Promise.resolve(response.body.cancel()).catch(() => undefined)
  } catch {
    // Cancellation is best-effort; the caller still fails closed immediately.
  }
}

function cancelReader(reader) {
  try {
    void Promise.resolve(reader.cancel()).catch(() => undefined)
  } catch {
    // Cancellation is best-effort; the caller still fails closed immediately.
  }
}

function readWithAbort(reader, signal) {
  if (signal.aborted) return Promise.reject(new SafeRecoveryError('request_timeout'))
  return new Promise((resolveRead, rejectRead) => {
    const abort = () => rejectRead(new SafeRecoveryError('request_timeout'))
    signal.addEventListener('abort', abort, { once: true })
    reader.read().then(resolveRead, rejectRead).finally(() => {
      signal.removeEventListener('abort', abort)
    })
  })
}

async function readBoundedResponse(response, limit, signal) {
  const declaredLength = response.headers.get('content-length')
  if (declaredLength !== null) {
    if (!/^[0-9]+$/.test(declaredLength) || Number(declaredLength) > limit) {
      cancelResponseBody(response)
      fail('response_too_large')
    }
  }
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await readWithAbort(reader, signal)
      if (done) break
      total += value.byteLength
      if (total > limit) {
        cancelReader(reader)
        fail('response_too_large')
      }
      chunks.push(value)
    }
  } catch (error) {
    cancelReader(reader)
    if (error instanceof SafeRecoveryError) throw error
    fail('response_read_failed')
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // Releasing a cancelled stream is best-effort only.
    }
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

async function requestJson({ fetchImpl, origin, path, method, headers, body, timeoutMs, responseLimit }) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    let response
    try {
      response = await fetchImpl(`${origin}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'error',
        cache: 'no-store',
        signal: controller.signal,
      })
    } catch {
      fail(controller.signal.aborted ? 'request_timeout' : 'request_failed')
    }
    const mediaType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
    if (mediaType !== 'application/json') {
      cancelResponseBody(response)
      fail('response_content_type_invalid')
    }
    const bytes = await readBoundedResponse(response, responseLimit, controller.signal)
    if (response.status < 200 || response.status >= 300) fail('response_status_invalid')
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      return JSON.parse(text)
    } catch {
      fail('response_json_invalid')
    }
  } finally {
    clearTimeout(timeout)
  }
}

function hasRequestMeta(value) {
  return hasExactKeys(value, ['requestId']) && REQUEST_ID_PATTERN.test(value.requestId)
}

function parseAttestation(value, expected) {
  if (
    !hasExactKeys(value, [
      'ok',
      'staging',
      'deploymentGitCommitSha',
      'deploymentRevision',
      'fingerprint',
      'acceptanceReady',
      'meta',
    ]) ||
    value.ok !== true ||
    value.staging !== true ||
    value.acceptanceReady !== true ||
    !SHA_PATTERN.test(value.deploymentGitCommitSha) ||
    !REVISION_PATTERN.test(value.deploymentRevision) ||
    !FINGERPRINT_PATTERN.test(value.fingerprint) ||
    !hasRequestMeta(value.meta) ||
    value.deploymentGitCommitSha !== expected.expectedGitCommitSha ||
    value.deploymentRevision !== expected.expectedDeploymentRevision ||
    value.fingerprint !== expected.expectedDbFingerprint
  ) fail('attestation_invalid')
  return value
}

function canonicalIsoMilliseconds(value) {
  if (typeof value !== 'string') return null
  const milliseconds = Date.parse(value)
  if (!Number.isFinite(milliseconds)) return null
  try {
    return new Date(milliseconds).toISOString() === value ? milliseconds : null
  } catch {
    return null
  }
}

function parsePermit(value) {
  if (!hasExactKeys(value, ['ok', 'permit', 'issuedAt', 'expiresAt', 'meta'])) {
    fail('permit_invalid')
  }
  const parts = typeof value.permit === 'string' ? value.permit.split('.') : []
  const issuedAt = canonicalIsoMilliseconds(value.issuedAt)
  const expiresAt = canonicalIsoMilliseconds(value.expiresAt)
  if (
    value.ok !== true ||
    typeof value.permit !== 'string' ||
    value.permit.length > 4096 ||
    parts.length !== 2 ||
    !canonicalBase64Url(parts[0], 64, 4000) ||
    !canonicalBase64Url(parts[1], 43, 43) ||
    issuedAt === null ||
    expiresAt === null ||
    expiresAt <= issuedAt ||
    expiresAt - issuedAt !== PERMIT_TTL_MS ||
    !hasRequestMeta(value.meta)
  ) fail('permit_invalid')
  return value.permit
}

function safeCount(value) {
  return Number.isSafeInteger(value) && value >= 0
}

function parseFixtureInspect(value) {
  if (
    !hasExactKeys(value, ['ok', 'result', 'meta']) ||
    value.ok !== true ||
    !hasExactKeys(value.result, [
      'leadCount',
      'leadId',
      'followUpCount',
      'ownershipHistoryCount',
    ]) ||
    !safeCount(value.result.leadCount) ||
    !safeCount(value.result.followUpCount) ||
    !safeCount(value.result.ownershipHistoryCount) ||
    !hasRequestMeta(value.meta) ||
    (value.result.leadCount === 0 && value.result.leadId !== null) ||
    (value.result.leadCount === 1 && !canonicalLeadId(value.result.leadId)) ||
    value.result.leadCount > 1
  ) fail('fixture_response_invalid')
  return value.result
}

function parseFixtureRecovery(value) {
  if (
    !hasExactKeys(value, ['ok', 'result', 'meta']) ||
    value.ok !== true ||
    !hasExactKeys(value.result, [
      'cleaned',
      'leadCount',
      'followUpCount',
      'ownershipHistoryCount',
    ]) ||
    typeof value.result.cleaned !== 'boolean' ||
    !safeCount(value.result.leadCount) ||
    !safeCount(value.result.followUpCount) ||
    !safeCount(value.result.ownershipHistoryCount) ||
    !hasRequestMeta(value.meta)
  ) fail('fixture_response_invalid')
  return value.result
}

function permitIdentity(capsule) {
  return {
    runId: capsule.runId,
    submissionRequestId: capsule.submissionRequestId,
    listingSlug: capsule.listingSlug,
    fixtureNamespace: capsule.fixtureNamespace,
    expectedGitCommitSha: capsule.expectedGitCommitSha,
    expectedDeploymentRevision: capsule.expectedDeploymentRevision,
    expectedDbFingerprint: capsule.expectedDbFingerprint,
  }
}

function inspectBody(capsule) {
  return {
    action: 'inspect',
    submissionRequestId: capsule.submissionRequestId,
    listingSlug: capsule.listingSlug,
  }
}

function recoveryBody(capsule) {
  return {
    action: 'recover',
    submissionRequestId: capsule.submissionRequestId,
    listingSlug: capsule.listingSlug,
    recoveryReceipt: capsule.recoveryReceipt,
  }
}

function safeEmit(logger, config, event, phase, fields = {}) {
  if (typeof logger !== 'function') return
  try {
    logger(Object.freeze({ event, apiHost: config.apiHost, phase, ...fields }))
  } catch {
    // Logs are diagnostic only and cannot change recovery evidence.
  }
}

async function readActiveCapsule(lease) {
  try {
    return await lease.readActive()
  } catch {
    fail('store_failed')
  }
}

async function transitionConfirmed(lease) {
  try {
    await lease.transition('cleanup_confirmed')
  } catch {
    fail('store_failed')
  }
}

async function removeConfirmed(lease) {
  try {
    await lease.removeConfirmed()
  } catch {
    fail('store_failed')
  }
}

function validCapsuleStore(value) {
  return isRecord(value) && typeof value.acquire === 'function'
}

function validCapsuleLease(value) {
  return (
    isRecord(value) &&
    typeof value.readActive === 'function' &&
    typeof value.transition === 'function' &&
    typeof value.removeConfirmed === 'function' &&
    typeof value.release === 'function'
  )
}

export async function runStagingAcceptanceRecovery(options = {}) {
  const {
    capsuleStore,
    environment = process.env,
    fetchImpl = globalThis.fetch,
    logger,
    requestTimeoutMs,
    maxResponseBytes,
  } = options
  if (!validCapsuleStore(capsuleStore)) fail('config_invalid')

  let lease
  try {
    lease = await capsuleStore.acquire('recovery')
  } catch {
    fail('store_failed')
  }
  if (!validCapsuleLease(lease)) fail('store_failed')

  let result
  let primaryError = null
  try {
    const stored = await readActiveCapsule(lease)
    if (stored === null) {
      result = Object.freeze({ ok: true, recovered: false, clean: true, previousPhase: null })
    } else {
      const capsule = parseCapsule(stored)
      const config = parseEnvironment(environment)
      if (typeof fetchImpl !== 'function') fail('config_invalid')
      const timeoutMs = parsePositiveInteger(requestTimeoutMs, DEFAULT_TIMEOUT_MS, 60_000)
      const responseLimit = parsePositiveInteger(maxResponseBytes, DEFAULT_RESPONSE_LIMIT, 1024 * 1024)

      const json = (path, method, headers, body) => requestJson({
        fetchImpl,
        origin: config.origin,
        path,
        method,
        headers: {
          ...headers,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body,
        timeoutMs,
        responseLimit,
      })

      parseAttestation(await json(
        PATHS.attestation,
        'GET',
        { 'x-sbh-acceptance-bootstrap': config.operatorBootstrapSecret },
      ), capsule)
      safeEmit(logger, config, 'attestation_verified', capsule.phase, { attestationVerified: true })

      const inspectWithFreshPermit = async () => {
        const permit = parsePermit(await json(
          PATHS.permit,
          'POST',
          { 'x-sbh-acceptance-bootstrap': config.operatorBootstrapSecret },
          { mode: 'inspect', ...permitIdentity(capsule) },
        ))
        const inspected = parseFixtureInspect(await json(
          PATHS.fixture,
          'POST',
          { 'x-sbh-acceptance-permit': permit },
          inspectBody(capsule),
        ))
        if (
          inspected.leadCount !== 0 ||
          inspected.leadId !== null ||
          inspected.followUpCount !== 0 ||
          inspected.ownershipHistoryCount !== 0
        ) fail('inspect_not_clean')
      }

      if (INSPECT_ONLY_PHASES.has(capsule.phase)) {
        await inspectWithFreshPermit()
      } else {
        const unknownFirstWrite = capsule.phase === 'first_write_dispatched'
        const recoveryMode = unknownFirstWrite ? 'unknown-first-write' : 'known-lead'
        const expectedLeadId = unknownFirstWrite ? null : capsule.leadId
        const permit = parsePermit(await json(
          PATHS.permit,
          'POST',
          { 'x-sbh-acceptance-bootstrap': config.operatorBootstrapSecret },
          {
            mode: 'recovery',
            ...permitIdentity(capsule),
            recoveryReceipt: capsule.recoveryReceipt,
            recoveryMode,
            expectedLeadId,
          },
        ))
        const recovered = parseFixtureRecovery(await json(
          PATHS.fixture,
          'POST',
          { 'x-sbh-acceptance-permit': permit },
          recoveryBody(capsule),
        ))
        if (
          recovered.leadCount !== 0 ||
          recovered.followUpCount !== 0 ||
          recovered.ownershipHistoryCount !== 0
        ) fail('recover_not_clean')

        // A write response is not terminal evidence. A new inspect permit and
        // request establish the settled zero state under a fresh transaction.
        await inspectWithFreshPermit()
      }

      if (capsule.phase !== 'cleanup_confirmed') await transitionConfirmed(lease)
      await removeConfirmed(lease)
      safeEmit(logger, config, 'recovery_complete', capsule.phase, { clean: true })
      result = Object.freeze({
        ok: true,
        recovered: true,
        clean: true,
        previousPhase: capsule.phase,
      })
    }
  } catch (error) {
    primaryError = safeError(error, 'recovery_failed')
  }

  try {
    await lease.release()
  } catch {
    primaryError = new SafeRecoveryError('release_failed')
  }

  if (primaryError) throw primaryError
  return result
}

function consoleLogger(entry) {
  console.log(JSON.stringify(entry))
}

export async function main() {
  try {
    await runStagingAcceptanceRecovery({
      capsuleStore: createCapsuleStore(),
      environment: process.env,
      fetchImpl: globalThis.fetch,
      logger: consoleLogger,
    })
  } catch {
    console.error('staging acceptance recovery 运行失败')
    process.exitCode = 1
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main()
}
