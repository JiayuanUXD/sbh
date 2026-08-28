import { createHash, randomUUID as nodeRandomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { parsePreflightEnvironment } from './staging-acceptance-preflight.mjs'

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

function parsePermit(value) {
  const now = Date.now()
  const expiresAt = typeof value?.expiresAt === 'string' ? Date.parse(value.expiresAt) : Number.NaN
  const parts = typeof value?.permit === 'string' ? value.permit.split('.') : []
  const [body, signature] = parts
  if (
    !hasExactKeys(value, ['ok', 'permit', 'expiresAt', 'meta']) ||
    value.ok !== true || typeof value.permit !== 'string' ||
    value.permit.length > 4096 || parts.length !== 2 ||
    !canonicalBase64Url(body, 64, 4000) || !canonicalBase64Url(signature, 43, 43) ||
    !Number.isFinite(expiresAt) || expiresAt <= now || expiresAt > now + 10 * 60_000 + 30_000 ||
    !hasRequestMeta(value.meta)
  ) fail('permit_invalid')
  return value.permit
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

function parseReconciliationInquiry(value, expected) {
  if (!isRecord(value) || !isRecord(value.data) || typeof value.data.acceptedExisting !== 'boolean') {
    fail('inquiry_response_invalid')
  }
  return parseInquiry(value, expected, value.data.acceptedExisting)
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
  randomUUID = nodeRandomUUID,
  registerSignal,
  logger,
  requestTimeoutMs,
  maxResponseBytes,
} = {}) {
  const config = parseRunnerEnvironment(environment)
  if (typeof fetchImpl !== 'function' || typeof randomUUID !== 'function') fail('runner_config_invalid')
  const timeoutMs = parsePositiveInteger(requestTimeoutMs, DEFAULT_TIMEOUT_MS, 60_000)
  const responseLimit = parsePositiveInteger(maxResponseBytes, DEFAULT_RESPONSE_LIMIT, 1024 * 1024)
  const submissionRequestId = randomUUID()
  if (!UUID_V4_PATTERN.test(submissionRequestId)) fail('submission_id_invalid')

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
  let permit = null
  let cleanupPromise = null
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

  const inspect = async () => parseFixtureInspect(await json(
    PATHS.fixture,
    'POST',
    { 'x-sbh-acceptance-permit': permit },
    inspectBody(config, submissionRequestId),
  ))

  const submitInquiry = (acceptedExisting) => {
    const operation = (async () => {
      try {
        const value = await json(
          PATHS.inquiry,
          'POST',
          { 'x-sbh-acceptance-permit': permit },
          inquiryBody(config, submissionRequestId),
        )
        const receipt = acceptedExisting === null
          ? parseReconciliationInquiry(value, config)
          : parseInquiry(value, config, acceptedExisting)
        manifest.writeOutcomeUnknown = false
        return receipt
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

  const ensureZeroRelations = (result) => {
    if (result.followUpCount !== 0 || result.ownershipHistoryCount !== 0) {
      freeze('fixture_relations_present')
    }
  }

  const adopt = (result) => {
    ensureZeroRelations(result)
    if (result.leadCount !== 1 || !canonicalLeadId(result.leadId)) freeze('fixture_owner_missing')
    if (manifest.ownedLeadId !== null && manifest.ownedLeadId !== result.leadId) {
      freeze('fixture_owner_changed')
    }
    manifest.ownedLeadId = result.leadId
  }

  const performCleanup = async () => {
    if (!manifest.cleanStartProven) return
    manifest.cleanupAttempted = true
    safeEmit(logger, config, 'cleanup_started', { cleanupAttempted: true })
    try {
      let reconciledUnknownWrite = false
      if (manifest.writeOutcomeUnknown) {
        let receipt
        try {
          receipt = await submitInquiry(null)
        } catch {
          freeze('write_outcome_unknown')
        }
        const reconciledLocatorHash = locatorSummary(receipt.acceptance.leadLocator.idempotencyKey)
        if (manifest.locatorHash !== null && manifest.locatorHash !== reconciledLocatorHash) {
          freeze('fixture_locator_changed')
        }
        manifest.locatorHash = reconciledLocatorHash
        reconciledUnknownWrite = true
      }
      const current = await inspect()
      ensureZeroRelations(current)
      if (current.leadCount === 0) {
        if (reconciledUnknownWrite) freeze('fixture_owner_missing')
        manifest.clean = true
        safeEmit(logger, config, 'cleanup_complete', {
          clean: true,
          leadCount: 0,
          followUpCount: 0,
          ownershipHistoryCount: 0,
        })
        return
      }
      adopt(current)
      const cleaned = parseFixtureCleanup(await json(
        PATHS.fixture,
        'POST',
        { 'x-sbh-acceptance-permit': permit },
        cleanupBody(config, submissionRequestId, manifest.ownedLeadId),
      ))
      if (
        cleaned.cleaned !== true || cleaned.leadCount !== 0 ||
        cleaned.followUpCount !== 0 || cleaned.ownershipHistoryCount !== 0
      ) freeze('cleanup_not_confirmed')
      const finalState = await inspect()
      if (
        finalState.leadCount !== 0 || finalState.followUpCount !== 0 ||
        finalState.ownershipHistoryCount !== 0
      ) freeze('cleanup_residual')
      manifest.clean = true
      safeEmit(logger, config, 'cleanup_complete', {
        clean: true,
        leadCount: 0,
        followUpCount: 0,
        ownershipHistoryCount: 0,
      })
    } catch {
      manifest.clean = false
      safeEmit(logger, config, 'acceptance_frozen', { clean: false })
      freeze('cleanup_failed')
    }
  }

  const cleanupOnce = () => {
    if (!cleanupPromise) cleanupPromise = performCleanup()
    return cleanupPromise
  }
  const signalHandler = async () => {
    interrupted = true
    const currentWrite = activeWritePromise
    if (currentWrite) {
      try {
        await currentWrite
      } catch {
        // The write result is handled by the main scenario; cleanup still must inspect afterward.
      }
    }
    if (manifest.cleanStartProven) await cleanupOnce()
  }
  const ensureActive = () => {
    if (interrupted) freeze('interrupted')
  }

  if (registerSignal !== undefined) {
    if (typeof registerSignal !== 'function') fail('runner_config_invalid')
    for (const signal of ['SIGINT', 'SIGTERM']) {
      const remove = registerSignal(signal, signalHandler)
      if (typeof remove === 'function') unregister.push(remove)
    }
  }

  let primaryError = null
  try {
    const attestation = parseAttestation(await json(
      PATHS.attestation,
      'GET',
      { 'x-sbh-acceptance-bootstrap': config.operatorBootstrapSecret },
    ), config)
    ensureActive()
    safeEmit(logger, config, 'attestation_verified', { attestationVerified: true })

    permit = parsePermit(await json(
      PATHS.permit,
      'POST',
      { 'x-sbh-acceptance-bootstrap': config.operatorBootstrapSecret },
      {
        runId: config.runId,
        fixtureNamespace: config.fixtureNamespace,
        expectedGitCommitSha: attestation.deploymentGitCommitSha,
        expectedDeploymentRevision: attestation.deploymentRevision,
        expectedDbFingerprint: attestation.fingerprint,
      },
    ))
    ensureActive()
    safeEmit(logger, config, 'permit_issued', { permitIssued: true })

    const cleanStart = await inspect()
    ensureZeroRelations(cleanStart)
    if (cleanStart.leadCount !== 0 || cleanStart.leadId !== null) freeze('clean_start_not_empty')
    manifest.cleanStartProven = true
    safeEmit(logger, config, 'clean_start_proven', {
      cleanStartProven: true,
      leadCount: 0,
      followUpCount: 0,
      ownershipHistoryCount: 0,
    })
    ensureActive()

    const firstReceipt = await submitInquiry(false)
    manifest.locatorHash = locatorSummary(firstReceipt.acceptance.leadLocator.idempotencyKey)
    ensureActive()

    const afterCreate = await inspect()
    adopt(afterCreate)
    safeEmit(logger, config, 'first_write_verified', {
      firstWriteVerified: true,
      locatorHash: manifest.locatorHash,
      leadCount: 1,
      followUpCount: 0,
      ownershipHistoryCount: 0,
    })
    ensureActive()

    const retryReceipt = await submitInquiry(true)
    if (locatorSummary(retryReceipt.acceptance.leadLocator.idempotencyKey) !== manifest.locatorHash) {
      freeze('fixture_locator_changed')
    }
    ensureActive()

    const afterRetry = await inspect()
    adopt(afterRetry)
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
    if (manifest.cleanStartProven) {
      try {
        await cleanupOnce()
      } catch (error) {
        primaryError = error instanceof FrozenRunnerError ? error : new FrozenRunnerError('cleanup_failed')
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
    })
  } catch {
    console.error('staging acceptance 运行失败')
    process.exitCode = 1
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main()
}
