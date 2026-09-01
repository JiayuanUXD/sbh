import { createHash, randomUUID as nodeRandomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { parsePreflightEnvironment } from './staging-acceptance-preflight.mjs'
import { createCapsuleStore } from './staging-acceptance-capsule.mjs'

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const CN_MOBILE_PATTERN = /^1[3-9][0-9]{9}$/
const POLICY_VERSION_PATTERN = /^[A-Za-z0-9._-]{1,100}$/
const SHA_PATTERN = /^[0-9a-f]{40}$/
const REVISION_PATTERN = /^[A-Za-z0-9._-]{1,128}$/
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/
const LOCATOR_PATTERN = /^[0-9a-f]{64}$/
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/
const NUMBER_LEAD_ID_PATTERN = /^n:[1-9][0-9]*$/
const STRING_LEAD_ID_PATTERN = /^s:([A-Za-z0-9_-]+)$/
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/
const CONTROL_PATTERN = /\p{Cc}/u
const WHITESPACE_PATTERN = /\p{White_Space}/u

const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_RESPONSE_LIMIT = 64 * 1024
const MAX_LEAD_STRING_BYTES = 128

const PATHS = Object.freeze({
  attestation: '/api/mini/v1/acceptance/attestation',
  permit: '/api/mini/v1/acceptance/permits',
  fixture: '/api/mini/v1/acceptance/leads',
  inquiry: '/api/mini/v1/inquiries',
})

class SafeRunnerError extends Error {
  constructor(code) {
    super(`staging acceptance ${code}`)
    this.name = 'SafeRunnerError'
    this.code = code
  }
}

class FrozenRunnerError extends SafeRunnerError {
  constructor(code = 'frozen') {
    super(code)
    this.name = 'FrozenRunnerError'
  }
}

function fail(code) {
  throw new SafeRunnerError(code)
}

function freeze(code) {
  throw new FrozenRunnerError(code)
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value, keys) {
  if (!isRecord(value)) return false
  const actual = Reflect.ownKeys(value)
  return actual.length === keys.length && actual.every((key) => typeof key === 'string' && keys.includes(key))
}

function hasRequestMeta(value) {
  return hasExactKeys(value, ['requestId']) && REQUEST_ID_PATTERN.test(value.requestId)
}

function safeCount(value) {
  return Number.isSafeInteger(value) && value >= 0
}

function canonicalLeadId(value) {
  if (typeof value !== 'string') return false
  if (NUMBER_LEAD_ID_PATTERN.test(value)) {
    const numeric = Number(value.slice(2))
    return Number.isSafeInteger(numeric) && numeric > 0 && `n:${numeric}` === value
  }
  const match = STRING_LEAD_ID_PATTERN.exec(value)
  if (!match) return false
  const encoded = match[1]
  const decoded = Buffer.from(encoded, 'base64url')
  if (decoded.toString('base64url') !== encoded) return false
  const id = decoded.toString('utf8')
  const bytes = Buffer.from(id, 'utf8')
  return (
    bytes.length >= 1 &&
    bytes.length <= MAX_LEAD_STRING_BYTES &&
    bytes.toString('utf8') === id &&
    bytes.toString('base64url') === encoded &&
    !CONTROL_PATTERN.test(id) &&
    !WHITESPACE_PATTERN.test(id)
  )
}

function parseRunnerEnvironment(environment) {
  const preflight = parsePreflightEnvironment(environment)
  const listingSlug = environment.MP_E2E_LISTING_SLUG ?? ''
  const phone = environment.MP_E2E_TEST_PHONE ?? ''
  const policyVersion = environment.MP_E2E_PRIVACY_POLICY_VERSION ?? ''
  if (!SLUG_PATTERN.test(listingSlug)) fail('listing_config_invalid')
  if (!CN_MOBILE_PATTERN.test(phone)) fail('phone_config_invalid')
  if (!POLICY_VERSION_PATTERN.test(policyVersion)) fail('policy_config_invalid')
  return Object.freeze({ ...preflight, listingSlug, phone, policyVersion })
}

function parsePositiveInteger(value, fallback, upperBound) {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < 1 || value > upperBound) fail('runner_config_invalid')
  return value
}

function cancelResponseBody(response) {
  if (!response.body) return
  try {
    void Promise.resolve(response.body.cancel()).catch(() => undefined)
  } catch {
    // Cancellation is best-effort and must not delay a bounded failure.
  }
}

function cancelReader(reader) {
  try {
    void Promise.resolve(reader.cancel()).catch(() => undefined)
  } catch {
    // Cancellation is best-effort and must not delay a bounded failure.
  }
}

function readWithAbort(reader, signal) {
  if (signal.aborted) return Promise.reject(new SafeRunnerError('request_timeout'))
  return new Promise((resolveRead, rejectRead) => {
    const abort = () => rejectRead(new SafeRunnerError('request_timeout'))
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
    if (error instanceof SafeRunnerError) throw error
    fail('response_read_failed')
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // Releasing a failed or cancelled stream is best-effort only.
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
    clearTimeout(timeout)
    fail('request_failed')
  }
  try {
    const mediaType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
    if (mediaType !== 'application/json') {
      cancelResponseBody(response)
      fail('response_content_type_invalid')
    }
    const bytes = await readBoundedResponse(response, responseLimit, controller.signal)
    if (response.status < 200 || response.status >= 300) fail('response_status_invalid')
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return JSON.parse(text)
  } catch (error) {
    if (error instanceof SafeRunnerError) throw error
    fail('response_json_invalid')
  } finally {
    clearTimeout(timeout)
  }
}

function parseAttestation(value, expected) {
  if (
    !hasExactKeys(value, [
      'ok', 'staging', 'deploymentGitCommitSha', 'deploymentRevision',
      'fingerprint', 'acceptanceReady', 'meta',
    ]) ||
    value.ok !== true || value.staging !== true || value.acceptanceReady !== true ||
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
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) return null
  return milliseconds
}

function parsePermit(value, mode) {
  const issuedAt = canonicalIsoMilliseconds(value?.issuedAt)
  const expiresAt = canonicalIsoMilliseconds(value?.expiresAt)
  const parts = typeof value?.permit === 'string' ? value.permit.split('.') : []
  const [body, signature] = parts
  const expectedKeys = mode === 'write'
    ? ['ok', 'permit', 'recoveryReceipt', 'issuedAt', 'expiresAt', 'meta']
    : ['ok', 'permit', 'issuedAt', 'expiresAt', 'meta']
  if (
    (mode !== 'write' && mode !== 'inspect') ||
    !hasExactKeys(value, expectedKeys) ||
    value.ok !== true || typeof value.permit !== 'string' ||
    value.permit.length > 4096 || parts.length !== 2 ||
    !canonicalBase64Url(body, 64, 4000) || !canonicalBase64Url(signature, 43, 43) ||
    issuedAt === null || expiresAt === null || expiresAt <= issuedAt ||
    expiresAt - issuedAt !== 10 * 60_000 ||
    !hasRequestMeta(value.meta)
  ) fail('permit_invalid')
  if (mode === 'inspect') return Object.freeze({ permit: value.permit })
  const receiptParts = typeof value.recoveryReceipt === 'string'
    ? value.recoveryReceipt.split('.')
    : []
  const [receiptBody, receiptSignature] = receiptParts
  if (
    typeof value.recoveryReceipt !== 'string' || value.recoveryReceipt.length > 4096 ||
    receiptParts.length !== 2 ||
    !canonicalBase64Url(receiptBody, 64, 4000) ||
    !canonicalBase64Url(receiptSignature, 43, 43)
  ) fail('permit_invalid')
  return Object.freeze({ permit: value.permit, recoveryReceipt: value.recoveryReceipt })
}

function canonicalBase64Url(value, minimumLength, maximumLength) {
  if (
    typeof value !== 'string' || value.length < minimumLength ||
    value.length > maximumLength || !BASE64URL_PATTERN.test(value)
  ) return false
  try {
    return Buffer.from(value, 'base64url').toString('base64url') === value
  } catch {
    return false
  }
}

function parseFixtureInspect(value) {
  if (
    !hasExactKeys(value, ['ok', 'result', 'meta']) || value.ok !== true ||
    !hasExactKeys(value.result, [
      'leadCount', 'leadId', 'followUpCount', 'ownershipHistoryCount',
    ]) ||
    !safeCount(value.result.leadCount) || !safeCount(value.result.followUpCount) ||
    !safeCount(value.result.ownershipHistoryCount) || !hasRequestMeta(value.meta)
  ) fail('fixture_response_invalid')
  if (value.result.leadCount === 0 && value.result.leadId !== null) fail('fixture_response_invalid')
  if (value.result.leadCount === 1 && !canonicalLeadId(value.result.leadId)) fail('fixture_response_invalid')
  if (value.result.leadCount > 1) freeze('fixture_ambiguous')
  return value.result
}

function parseFixtureCleanup(value) {
  if (
    !hasExactKeys(value, ['ok', 'result', 'meta']) || value.ok !== true ||
    !hasExactKeys(value.result, [
      'cleaned', 'leadCount', 'followUpCount', 'ownershipHistoryCount',
    ]) || typeof value.result.cleaned !== 'boolean' ||
    !safeCount(value.result.leadCount) || !safeCount(value.result.followUpCount) ||
    !safeCount(value.result.ownershipHistoryCount) || !hasRequestMeta(value.meta)
  ) fail('cleanup_response_invalid')
  return value.result
}

function parseInquiry(value, expected, acceptedExisting) {
  if (
    !hasExactKeys(value, ['ok', 'data', 'meta']) || value.ok !== true ||
    !hasExactKeys(value.data, [
      'accepted', 'acceptedExisting', 'targetResolution', 'acceptance',
    ]) || value.data.accepted !== true || value.data.acceptedExisting !== acceptedExisting ||
    value.data.targetResolution !== 'listing' ||
    !hasExactKeys(value.data.acceptance, ['runId', 'fixtureNamespace', 'leadLocator']) ||
    value.data.acceptance.runId !== expected.runId ||
    value.data.acceptance.fixtureNamespace !== expected.fixtureNamespace ||
    !hasExactKeys(value.data.acceptance.leadLocator, ['collection', 'idempotencyKey']) ||
    value.data.acceptance.leadLocator.collection !== 'leads' ||
    !LOCATOR_PATTERN.test(value.data.acceptance.leadLocator.idempotencyKey) ||
    !hasRequestMeta(value.meta)
  ) fail('inquiry_response_invalid')
  return value.data
}

function isWriteOutcomeUnknown(error) {
  return error instanceof SafeRunnerError && [
    'request_failed',
    'request_timeout',
    'response_read_failed',
    'response_too_large',
    'response_content_type_invalid',
    'response_json_invalid',
  ].includes(error.code)
}

function locatorSummary(locator) {
  return createHash('sha256').update(locator).digest('hex').slice(0, 16)
}

function safeEmit(logger, base, event, fields = {}) {
  if (typeof logger !== 'function') return
  try {
    logger(Object.freeze({
      event,
      apiHost: base.apiHost,
      runIdSummary: base.runId.slice(0, 8),
      fixtureNamespace: base.fixtureNamespace,
      ...fields,
    }))
  } catch {
    // A logger cannot influence the acceptance or cleanup result.
  }
}

function inspectBody(config, submissionRequestId) {
  return { action: 'inspect', submissionRequestId, listingSlug: config.listingSlug }
}

function cleanupBody(config, submissionRequestId, leadId) {
  return { action: 'cleanup', submissionRequestId, listingSlug: config.listingSlug, leadId }
}

function inquiryBody(config, submissionRequestId) {
  return {
    submissionRequestId,
    listingSlug: config.listingSlug,
    buildingSlug: null,
    moveInTime: null,
    phone: config.phone,
    consent: { accepted: true, policyVersion: config.policyVersion },
    priceSnapshot: null,
  }
}

export async function runStagingAcceptance({
  environment = process.env,
  fetchImpl = globalThis.fetch,
  capsuleStore,
  randomUUID = nodeRandomUUID,
  registerSignal,
  logger,
  requestTimeoutMs,
  maxResponseBytes,
} = {}) {
  const config = parseRunnerEnvironment(environment)
  if (
    typeof fetchImpl !== 'function' || typeof randomUUID !== 'function' ||
    !isRecord(capsuleStore) || typeof capsuleStore.acquire !== 'function' ||
    (registerSignal !== undefined && typeof registerSignal !== 'function')
  ) fail('runner_config_invalid')
  const timeoutMs = parsePositiveInteger(requestTimeoutMs, DEFAULT_TIMEOUT_MS, 60_000)
  const responseLimit = parsePositiveInteger(maxResponseBytes, DEFAULT_RESPONSE_LIMIT, 1024 * 1024)

  const manifest = {
    runId: config.runId,
    objectType: 'leads',
    fixtureNamespace: config.fixtureNamespace,
    locatorHash: null,
    cleanStartProven: false,
    ownedLeadId: null,
    cleanupAttempted: false,
    clean: false,
    writeOutcomeUnknown: false,
  }
  let lease = null
  let submissionRequestId = null
  let writerPermit = null
  let durablePhase = null
  let durableLeadId = null
  let finalizePromise = null
  let activeWritePromise = null
  let interrupted = false
  const unregister = []

  const json = (path, method, authHeaders, body) => requestJson({
    fetchImpl,
    origin: config.origin,
    path,
    method,
    headers: {
      ...authHeaders,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body,
    timeoutMs,
    responseLimit,
  })

  const permitIdentity = () => ({
    runId: config.runId,
    submissionRequestId,
    listingSlug: config.listingSlug,
    fixtureNamespace: config.fixtureNamespace,
    expectedGitCommitSha: config.expectedGitCommitSha,
    expectedDeploymentRevision: config.expectedDeploymentRevision,
    expectedDbFingerprint: config.expectedDbFingerprint,
  })

  const issuePermit = async (mode) => parsePermit(await json(
    PATHS.permit,
    'POST',
    { 'x-sbh-acceptance-bootstrap': config.operatorBootstrapSecret },
    { mode, ...permitIdentity() },
  ), mode)

  const inspect = async (permit) => parseFixtureInspect(await json(
    PATHS.fixture,
    'POST',
    { 'x-sbh-acceptance-permit': permit },
    inspectBody(config, submissionRequestId),
  ))

  const freshInspect = async () => {
    const inspectCapability = await issuePermit('inspect')
    return inspect(inspectCapability.permit)
  }

  const submitInquiry = (acceptedExisting) => {
    const operation = (async () => {
      try {
        const value = await json(
          PATHS.inquiry,
          'POST',
          { 'x-sbh-acceptance-permit': writerPermit },
          inquiryBody(config, submissionRequestId),
        )
        return parseInquiry(value, config, acceptedExisting)
      } catch (error) {
        if (isWriteOutcomeUnknown(error)) manifest.writeOutcomeUnknown = true
        throw error
      }
    })()
    const tracked = operation.finally(() => {
      if (activeWritePromise === tracked) activeWritePromise = null
    })
    activeWritePromise = tracked
    return tracked
  }

  const transition = async (nextPhase, patch = {}) => {
    try {
      await lease.transition(nextPhase, patch)
      durablePhase = nextPhase
    } catch {
      fail('scenario_failed')
    }
  }

  const ensureZeroRelations = (result) => {
    if (result.followUpCount !== 0 || result.ownershipHistoryCount !== 0) {
      freeze('fixture_relations_present')
    }
  }

  const exactObservedLead = (result, expectedLeadId = null) => {
    ensureZeroRelations(result)
    if (result.leadCount !== 1 || !canonicalLeadId(result.leadId)) freeze('fixture_owner_missing')
    if (expectedLeadId !== null && expectedLeadId !== result.leadId) {
      freeze('fixture_owner_changed')
    }
    return result.leadId
  }

  const performFinalize = async () => {
    if (durablePhase !== 'idempotency_verified') return false
    await transition('cleanup_dispatched')
    manifest.cleanupAttempted = true
    safeEmit(logger, config, 'cleanup_started', { cleanupAttempted: true })
    try {
      const cleaned = parseFixtureCleanup(await json(
        PATHS.fixture,
        'POST',
        { 'x-sbh-acceptance-permit': writerPermit },
        cleanupBody(config, submissionRequestId, durableLeadId),
      ))
      if (
        cleaned.cleaned !== true || cleaned.leadCount !== 0 ||
        cleaned.followUpCount !== 0 || cleaned.ownershipHistoryCount !== 0
      ) freeze('cleanup_not_confirmed')
      const finalState = await freshInspect()
      if (
        finalState.leadCount !== 0 || finalState.followUpCount !== 0 ||
        finalState.ownershipHistoryCount !== 0
      ) freeze('cleanup_residual')
    } catch (error) {
      if (error instanceof SafeRunnerError && error.code === 'scenario_failed') throw error
      manifest.clean = false
      safeEmit(logger, config, 'acceptance_frozen', { clean: false })
      freeze('cleanup_failed')
    }
    await transition('cleanup_confirmed')
    try {
      await lease.removeConfirmed()
    } catch {
      fail('scenario_failed')
    }
    manifest.clean = true
    safeEmit(logger, config, 'cleanup_complete', {
      clean: true,
      leadCount: 0,
      followUpCount: 0,
      ownershipHistoryCount: 0,
    })
    return true
  }

  const finalizeOnce = () => {
    if (!finalizePromise) finalizePromise = performFinalize()
    return finalizePromise
  }
  const signalHandler = async () => {
    interrupted = true
    const currentWrite = activeWritePromise
    if (currentWrite) {
      try {
        await currentWrite
      } catch {
        // The main scenario classifies the write outcome and preserves its durable phase.
      }
    }
    await finalizeOnce()
  }
  const ensureActive = () => {
    if (interrupted) freeze('interrupted')
  }

  let primaryError = null
  try {
    try {
      lease = await capsuleStore.acquire('normal')
    } catch {
      fail('scenario_failed')
    }
    if (
      !isRecord(lease) || typeof lease.createPrepared !== 'function' ||
      typeof lease.transition !== 'function' || typeof lease.removeConfirmed !== 'function' ||
      typeof lease.release !== 'function'
    ) fail('scenario_failed')

    try {
      submissionRequestId = randomUUID()
    } catch {
      fail('scenario_failed')
    }
    if (!UUID_V4_PATTERN.test(submissionRequestId)) fail('submission_id_invalid')

    try {
      await lease.createPrepared({
        runId: config.runId,
        submissionRequestId,
        listingSlug: config.listingSlug,
        fixtureNamespace: config.fixtureNamespace,
        origin: config.origin,
        expectedGitCommitSha: config.expectedGitCommitSha,
        expectedDeploymentRevision: config.expectedDeploymentRevision,
        expectedDbFingerprint: config.expectedDbFingerprint,
      })
      durablePhase = 'prepared'
    } catch {
      fail('scenario_failed')
    }

    if (registerSignal !== undefined) {
      try {
        for (const signal of ['SIGINT', 'SIGTERM']) {
          const remove = registerSignal(signal, signalHandler)
          if (typeof remove === 'function') unregister.push(remove)
        }
      } catch {
        fail('scenario_failed')
      }
    }

    const attestation = parseAttestation(await json(
      PATHS.attestation,
      'GET',
      { 'x-sbh-acceptance-bootstrap': config.operatorBootstrapSecret },
    ), config)
    ensureActive()
    safeEmit(logger, config, 'attestation_verified', { attestationVerified: true })

    const issuedWriter = await issuePermit('write')
    writerPermit = issuedWriter.permit
    ensureActive()
    safeEmit(logger, config, 'permit_issued', { permitIssued: true })

    const cleanStart = await inspect(writerPermit)
    ensureZeroRelations(cleanStart)
    if (cleanStart.leadCount !== 0 || cleanStart.leadId !== null) freeze('clean_start_not_empty')
    await transition('clean_start_proven', { recoveryReceipt: issuedWriter.recoveryReceipt })
    manifest.cleanStartProven = true
    safeEmit(logger, config, 'clean_start_proven', {
      cleanStartProven: true,
      leadCount: 0,
      followUpCount: 0,
      ownershipHistoryCount: 0,
    })
    ensureActive()

    await transition('first_write_dispatched')
    ensureActive()
    let firstReceipt = null
    let firstResponseError = null
    try {
      firstReceipt = await submitInquiry(false)
    } catch (error) {
      if (manifest.writeOutcomeUnknown) throw error
      firstResponseError = error
    }
    ensureActive()

    const afterCreate = await freshInspect()
    ensureZeroRelations(afterCreate)
    if (afterCreate.leadCount === 1) {
      const observedLeadId = exactObservedLead(afterCreate)
      await transition('lead_observed', { leadId: observedLeadId })
      durableLeadId = observedLeadId
      manifest.ownedLeadId = observedLeadId
    } else if (firstResponseError === null) {
      freeze('fixture_owner_missing')
    }
    if (firstResponseError !== null) throw firstResponseError
    manifest.locatorHash = locatorSummary(firstReceipt.acceptance.leadLocator.idempotencyKey)
    safeEmit(logger, config, 'first_write_verified', {
      firstWriteVerified: true,
      locatorHash: manifest.locatorHash,
      leadCount: 1,
      followUpCount: 0,
      ownershipHistoryCount: 0,
    })
    ensureActive()

    await transition('retry_write_dispatched')
    ensureActive()
    let retryReceipt = null
    let retryResponseError = null
    try {
      retryReceipt = await submitInquiry(true)
      if (locatorSummary(retryReceipt.acceptance.leadLocator.idempotencyKey) !== manifest.locatorHash) {
        retryResponseError = new FrozenRunnerError('fixture_locator_changed')
      }
    } catch (error) {
      if (manifest.writeOutcomeUnknown) throw error
      retryResponseError = error
    }
    ensureActive()

    const afterRetry = await freshInspect()
    exactObservedLead(afterRetry, durableLeadId)
    if (retryResponseError !== null) throw retryResponseError
    await transition('idempotency_verified')
    safeEmit(logger, config, 'idempotency_verified', {
      idempotencyVerified: true,
      locatorHash: manifest.locatorHash,
      leadCount: 1,
      followUpCount: 0,
      ownershipHistoryCount: 0,
    })
  } catch (error) {
    primaryError = error instanceof SafeRunnerError ? error : new SafeRunnerError('scenario_failed')
  } finally {
    try {
      await finalizeOnce()
    } catch (error) {
      if (primaryError === null) {
        primaryError = error instanceof SafeRunnerError ? error : new SafeRunnerError('scenario_failed')
      }
    }
    if (lease !== null) {
      try {
        await lease.release()
      } catch {
        if (primaryError === null) primaryError = new SafeRunnerError('scenario_failed')
      }
    }
    for (const remove of unregister) {
      try {
        remove()
      } catch {
        // Signal deregistration is best-effort and cannot affect cleanup evidence.
      }
    }
  }

  if (interrupted && primaryError === null) primaryError = new FrozenRunnerError('interrupted')
  if (primaryError) throw primaryError
  return { ok: true, manifest: Object.freeze({ ...manifest }) }
}

function consoleLogger(entry) {
  console.log(JSON.stringify(entry))
}

function registerProcessSignal(signal, handler) {
  const listener = () => {
    Promise.resolve(handler()).catch(() => {
      console.error('staging acceptance 本轮冻结')
    }).finally(() => {
      process.exitCode = 1
    })
  }
  process.once(signal, listener)
  return () => process.removeListener(signal, listener)
}

export async function main() {
  try {
    await runStagingAcceptance({
      environment: process.env,
      fetchImpl: globalThis.fetch,
      randomUUID: nodeRandomUUID,
      registerSignal: registerProcessSignal,
      logger: consoleLogger,
      capsuleStore: createCapsuleStore(),
    })
  } catch {
    console.error('staging acceptance 运行失败')
    process.exitCode = 1
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main()
}
