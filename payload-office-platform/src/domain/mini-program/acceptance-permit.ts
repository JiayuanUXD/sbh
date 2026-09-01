import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

import { isCanonicalMiniSlug, isCanonicalMiniUuidV4 } from './inquiry-schema'

export type AcceptanceIdentity = Readonly<{
  runId: string
  submissionRequestId: string
  listingSlug: string
  fixtureNamespace: string
  expectedGitCommitSha: string
  expectedDeploymentRevision: string
  expectedDbFingerprint: string
}>

export type AcceptancePermitContext = AcceptanceIdentity
export type AcceptancePermitMode = 'write' | 'inspect' | 'recovery'
export type AcceptanceRecoveryMode = 'unknown-first-write' | 'known-lead'

type AcceptancePermitBase = Readonly<{
  version: 1
  runId: string
  submissionRequestId: string
  listingSlug: string
  fixtureNamespace: string
  gitSHA: string
  revision: string
  dbFingerprint: string
  iat: number
  exp: number
  jti: string
}>

export type AcceptanceWritePermitPayload = AcceptancePermitBase & Readonly<{
  purpose: 'acceptance-write'
}>

export type AcceptanceInspectPermitPayload = AcceptancePermitBase & Readonly<{
  purpose: 'acceptance-inspect'
}>

export type AcceptanceRecoveryPermitPayload = AcceptancePermitBase & Readonly<{
  purpose: 'acceptance-recovery'
  recoveryReceiptDigest: string
  recoveryMode: AcceptanceRecoveryMode
  expectedLeadId: string | null
}>

/** 兼容既有 write-only 调用方；inspect/recovery 必须使用各自 verifier。 */
export type AcceptancePermitPayload = AcceptanceWritePermitPayload

export type AcceptanceRecoveryReceiptPayload = Readonly<{
  version: 1
  purpose: 'acceptance-recovery-fence'
  writerJti: string
  writerIat: number
  writerExp: number
  runId: string
  submissionRequestId: string
  listingSlug: string
  fixtureNamespace: string
  gitSHA: string
  revision: string
  dbFingerprint: string
}>

export type AcceptanceRecoverySpec = Readonly<{
  recoveryMode: AcceptanceRecoveryMode
  expectedLeadId: string | null
}>

export type AcceptancePermitRequest =
  | (AcceptanceIdentity & Readonly<{ mode: 'write' }>)
  | (AcceptanceIdentity & Readonly<{ mode: 'inspect' }>)
  | (AcceptanceIdentity & AcceptanceRecoverySpec & Readonly<{
    mode: 'recovery'
    recoveryReceipt: string
  }>)

const CONTEXT_KEYS = [
  'runId',
  'submissionRequestId',
  'listingSlug',
  'fixtureNamespace',
  'expectedGitCommitSha',
  'expectedDeploymentRevision',
  'expectedDbFingerprint',
] as const
const BASE_PAYLOAD_KEYS = [
  'version',
  'purpose',
  'runId',
  'submissionRequestId',
  'listingSlug',
  'fixtureNamespace',
  'gitSHA',
  'revision',
  'dbFingerprint',
  'iat',
  'exp',
  'jti',
] as const
const RECOVERY_PAYLOAD_KEYS = [
  ...BASE_PAYLOAD_KEYS,
  'recoveryReceiptDigest',
  'recoveryMode',
  'expectedLeadId',
] as const
const RECOVERY_RECEIPT_KEYS = [
  'version',
  'purpose',
  'writerJti',
  'writerIat',
  'writerExp',
  'runId',
  'submissionRequestId',
  'listingSlug',
  'fixtureNamespace',
  'gitSHA',
  'revision',
  'dbFingerprint',
] as const
const WRITE_REQUEST_KEYS = ['mode', ...CONTEXT_KEYS] as const
const RECOVERY_REQUEST_KEYS = [
  'mode',
  ...CONTEXT_KEYS,
  'recoveryReceipt',
  'recoveryMode',
  'expectedLeadId',
] as const
const PERMIT_TTL_MS = 10 * 60_000
const TOKEN_MAX_BYTES = 4096
const RECEIPT_KEY_DOMAIN = 'sbh:mini-program:acceptance-recovery-receipt:v1'
const SHA = /^[0-9a-f]{40}$/
const REVISION = /^[A-Za-z0-9._-]{1,128}$/
const FINGERPRINT = /^[0-9a-f]{64}$/
const DIGEST = /^[0-9a-f]{64}$/
const NUMBER_LEAD_ID = /^n:[1-9][0-9]*$/
const STRING_LEAD_ID = /^s:([A-Za-z0-9_-]+)$/
const CONTROL = /\p{Cc}/u
const WHITESPACE = /\p{White_Space}/u
const MAX_STRING_LEAD_ID_UTF8_BYTES = 128

const encode = (value: Uint8Array) => Buffer.from(value).toString('base64url')

function decodeCanonical(value: string): Buffer | null {
  try {
    const decoded = Buffer.from(value, 'base64url')
    return decoded.toString('base64url') === value ? decoded : null
  } catch {
    return null
  }
}

function hmac(body: string, secret: Uint8Array): Buffer {
  return createHmac('sha256', secret).update(body).digest()
}

function signToken(payload: unknown, secret: Uint8Array): string {
  const body = encode(Buffer.from(JSON.stringify(payload)))
  return `${body}.${encode(hmac(body, secret))}`
}

function deriveRecoveryReceiptKey(secret: Uint8Array): Uint8Array {
  return createHmac('sha256', secret).update(RECEIPT_KEY_DOMAIN).digest()
}

/** 仅供合同测试构造已签名恶意 permit payload；不绕过 verify。 */
export function signAcceptancePermitPayloadForTests(payload: unknown, secret: Uint8Array): string {
  return signToken(payload, secret)
}

/** 仅供合同测试构造已签名恶意 receipt payload；使用真实领域派生 key。 */
export function signAcceptanceRecoveryReceiptPayloadForTests(
  payload: unknown,
  secret: Uint8Array,
): string {
  return signToken(payload, deriveRecoveryReceiptKey(secret))
}

function namespace(runId: string): string {
  return `mp-e2e-${createHash('sha256').update(runId).digest('hex').slice(0, 16)}`
}

function hasExactOwnKeys(value: unknown, expectedKeys: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  const keys = Reflect.ownKeys(record)
  return (
    keys.length === expectedKeys.length &&
    keys.every((key) => typeof key === 'string' && expectedKeys.includes(key)) &&
    expectedKeys.every((key) => Object.prototype.hasOwnProperty.call(record, key))
  )
}

function isValidContext(context: AcceptancePermitContext): boolean {
  return (
    isCanonicalMiniUuidV4(context.runId) &&
    isCanonicalMiniUuidV4(context.submissionRequestId) &&
    isCanonicalMiniSlug(context.listingSlug) &&
    context.fixtureNamespace === namespace(context.runId) &&
    SHA.test(context.expectedGitCommitSha) &&
    REVISION.test(context.expectedDeploymentRevision) &&
    FINGERPRINT.test(context.expectedDbFingerprint)
  )
}

function validTime(now: number): boolean {
  return Number.isSafeInteger(now) && now >= 0
}

function makeBasePayload<
  Purpose extends AcceptanceWritePermitPayload['purpose'] |
    AcceptanceInspectPermitPayload['purpose'] |
    AcceptanceRecoveryPermitPayload['purpose'],
>(
  context: AcceptancePermitContext,
  purpose: Purpose,
  now: number,
  random: typeof randomBytes,
): AcceptancePermitBase & Readonly<{ purpose: Purpose }> {
  const exp = now + PERMIT_TTL_MS
  if (!validTime(now) || !Number.isSafeInteger(exp)) throw new Error('invalid permit time')
  if (!isValidContext(context)) throw new Error('invalid permit context')
  const nonce = random(16)
  if (nonce.length !== 16) throw new Error('invalid permit random')
  return {
    version: 1,
    purpose,
    runId: context.runId,
    submissionRequestId: context.submissionRequestId,
    listingSlug: context.listingSlug,
    fixtureNamespace: context.fixtureNamespace,
    gitSHA: context.expectedGitCommitSha,
    revision: context.expectedDeploymentRevision,
    dbFingerprint: context.expectedDbFingerprint,
    iat: now,
    exp,
    jti: encode(nonce),
  }
}

function readSignedPayload(token: string, secret: Uint8Array): unknown | null {
  if (token.length > TOKEN_MAX_BYTES) return null
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [body, signature] = parts
  if (!body || !signature) return null
  const decodedBody = decodeCanonical(body)
  const decodedSignature = decodeCanonical(signature)
  if (!decodedBody || decodedSignature?.length !== 32) return null
  const expected = hmac(body, secret)
  if (!timingSafeEqual(decodedSignature, expected)) return null
  try {
    return JSON.parse(decodedBody.toString('utf8')) as unknown
  } catch {
    return null
  }
}

function hasValidIntrinsicIdentity(value: Record<string, unknown>): boolean {
  return (
    typeof value.runId === 'string' &&
    typeof value.submissionRequestId === 'string' &&
    typeof value.listingSlug === 'string' &&
    typeof value.fixtureNamespace === 'string' &&
    typeof value.gitSHA === 'string' &&
    typeof value.revision === 'string' &&
    typeof value.dbFingerprint === 'string' &&
    isCanonicalMiniUuidV4(value.runId) &&
    isCanonicalMiniUuidV4(value.submissionRequestId) &&
    isCanonicalMiniSlug(value.listingSlug) &&
    value.fixtureNamespace === namespace(value.runId) &&
    SHA.test(value.gitSHA) &&
    REVISION.test(value.revision) &&
    FINGERPRINT.test(value.dbFingerprint)
  )
}

function hasValidPermitTime(value: Record<string, unknown>, now: number): boolean {
  const jti = typeof value.jti === 'string' ? decodeCanonical(value.jti) : null
  return (
    validTime(now) &&
    Number.isSafeInteger(value.iat) &&
    Number.isSafeInteger(value.exp) &&
    (value.exp as number) - (value.iat as number) === PERMIT_TTL_MS &&
    (value.iat as number) <= now &&
    (value.exp as number) > now &&
    jti?.length === 16
  )
}

function matchesContext(value: Record<string, unknown>, context: AcceptancePermitContext): boolean {
  return (
    value.runId === context.runId &&
    value.submissionRequestId === context.submissionRequestId &&
    value.listingSlug === context.listingSlug &&
    value.fixtureNamespace === context.fixtureNamespace &&
    value.gitSHA === context.expectedGitCommitSha &&
    value.revision === context.expectedDeploymentRevision &&
    value.dbFingerprint === context.expectedDbFingerprint
  )
}

function isCanonicalLeadId(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (NUMBER_LEAD_ID.test(value)) {
    const numeric = Number(value.slice(2))
    return Number.isSafeInteger(numeric) && numeric > 0 && `n:${numeric}` === value
  }
  const match = STRING_LEAD_ID.exec(value)
  if (!match) return false
  const decoded = decodeCanonical(match[1])
  if (!decoded) return false
  const id = decoded.toString('utf8')
  const bytes = Buffer.from(id, 'utf8')
  return (
    bytes.length >= 1 &&
    bytes.length <= MAX_STRING_LEAD_ID_UTF8_BYTES &&
    decoded.equals(bytes) &&
    !CONTROL.test(id) &&
    !WHITESPACE.test(id)
  )
}

function isValidRecoverySpec(value: AcceptanceRecoverySpec): boolean {
  return (
    (value.recoveryMode === 'unknown-first-write' && value.expectedLeadId === null) ||
    (value.recoveryMode === 'known-lead' && isCanonicalLeadId(value.expectedLeadId))
  )
}

export function issueAcceptancePermit(
  context: AcceptancePermitContext,
  secret: Uint8Array,
  now = Date.now(),
  random = randomBytes,
): Readonly<{
  token: string
  payload: AcceptanceWritePermitPayload
  recoveryReceipt: string
  recoveryReceiptPayload: AcceptanceRecoveryReceiptPayload
}> {
  const payload: AcceptanceWritePermitPayload = makeBasePayload(context, 'acceptance-write', now, random)
  const recoveryReceiptPayload: AcceptanceRecoveryReceiptPayload = {
    version: 1,
    purpose: 'acceptance-recovery-fence',
    writerJti: payload.jti,
    writerIat: payload.iat,
    writerExp: payload.exp,
    runId: payload.runId,
    submissionRequestId: payload.submissionRequestId,
    listingSlug: payload.listingSlug,
    fixtureNamespace: payload.fixtureNamespace,
    gitSHA: payload.gitSHA,
    revision: payload.revision,
    dbFingerprint: payload.dbFingerprint,
  }
  return {
    token: signToken(payload, secret),
    payload,
    recoveryReceipt: signToken(recoveryReceiptPayload, deriveRecoveryReceiptKey(secret)),
    recoveryReceiptPayload,
  }
}

export function issueAcceptanceInspectPermit(
  context: AcceptancePermitContext,
  secret: Uint8Array,
  now = Date.now(),
  random = randomBytes,
): Readonly<{ token: string; payload: AcceptanceInspectPermitPayload }> {
  const payload: AcceptanceInspectPermitPayload = makeBasePayload(context, 'acceptance-inspect', now, random)
  return { token: signToken(payload, secret), payload }
}

export function acceptanceRecoveryReceiptDigest(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function issueAcceptanceRecoveryPermit(
  context: AcceptancePermitContext,
  recoveryReceipt: string,
  recovery: AcceptanceRecoverySpec,
  secret: Uint8Array,
  now = Date.now(),
  random = randomBytes,
): Readonly<{ token: string; payload: AcceptanceRecoveryPermitPayload }> {
  if (!validTime(now)) throw new Error('invalid permit time')
  if (!isValidContext(context)) throw new Error('invalid permit context')
  if (!isValidRecoverySpec(recovery)) throw new Error('invalid recovery context')
  const receipt = verifyAcceptanceRecoveryReceipt(recoveryReceipt, context, secret)
  if (!receipt) throw new Error('invalid recovery receipt')
  if (now < receipt.writerExp) throw new Error('recovery receipt not expired')
  const payload: AcceptanceRecoveryPermitPayload = {
    ...makeBasePayload(context, 'acceptance-recovery', now, random),
    recoveryReceiptDigest: acceptanceRecoveryReceiptDigest(recoveryReceipt),
    recoveryMode: recovery.recoveryMode,
    expectedLeadId: recovery.expectedLeadId,
  }
  return { token: signToken(payload, secret), payload }
}

function verifyBasePermitToken(
  token: string,
  secret: Uint8Array,
  now: number,
  purpose: AcceptanceWritePermitPayload['purpose'] | AcceptanceInspectPermitPayload['purpose'],
): Record<string, unknown> | null {
  const parsed = readSignedPayload(token, secret)
  if (!hasExactOwnKeys(parsed, BASE_PAYLOAD_KEYS)) return null
  if (
    parsed.version !== 1 ||
    parsed.purpose !== purpose ||
    !hasValidIntrinsicIdentity(parsed) ||
    !hasValidPermitTime(parsed, now)
  ) return null
  return parsed
}

export function verifyAcceptancePermitToken(
  token: string,
  secret: Uint8Array,
  now = Date.now(),
): AcceptanceWritePermitPayload | null {
  return verifyBasePermitToken(token, secret, now, 'acceptance-write') as AcceptanceWritePermitPayload | null
}

export function verifyAcceptanceInspectPermitToken(
  token: string,
  secret: Uint8Array,
  now = Date.now(),
): AcceptanceInspectPermitPayload | null {
  return verifyBasePermitToken(token, secret, now, 'acceptance-inspect') as AcceptanceInspectPermitPayload | null
}

export function verifyAcceptanceRecoveryPermitToken(
  token: string,
  secret: Uint8Array,
  now = Date.now(),
): AcceptanceRecoveryPermitPayload | null {
  const parsed = readSignedPayload(token, secret)
  if (!hasExactOwnKeys(parsed, RECOVERY_PAYLOAD_KEYS)) return null
  if (
    parsed.version !== 1 ||
    parsed.purpose !== 'acceptance-recovery' ||
    !hasValidIntrinsicIdentity(parsed) ||
    !hasValidPermitTime(parsed, now) ||
    typeof parsed.recoveryReceiptDigest !== 'string' ||
    !DIGEST.test(parsed.recoveryReceiptDigest) ||
    (parsed.recoveryMode !== 'unknown-first-write' && parsed.recoveryMode !== 'known-lead') ||
    !isValidRecoverySpec({
      recoveryMode: parsed.recoveryMode,
      expectedLeadId: typeof parsed.expectedLeadId === 'string' ? parsed.expectedLeadId : null,
    }) ||
    (parsed.expectedLeadId !== null && typeof parsed.expectedLeadId !== 'string')
  ) return null
  return parsed as AcceptanceRecoveryPermitPayload
}

export function verifyAcceptanceRecoveryReceipt(
  token: string,
  context: AcceptancePermitContext,
  secret: Uint8Array,
): AcceptanceRecoveryReceiptPayload | null {
  if (!isValidContext(context)) return null
  const parsed = readSignedPayload(token, deriveRecoveryReceiptKey(secret))
  if (!hasExactOwnKeys(parsed, RECOVERY_RECEIPT_KEYS)) return null
  const writerJti = typeof parsed.writerJti === 'string' ? decodeCanonical(parsed.writerJti) : null
  if (
    parsed.version !== 1 ||
    parsed.purpose !== 'acceptance-recovery-fence' ||
    !hasValidIntrinsicIdentity(parsed) ||
    !Number.isSafeInteger(parsed.writerIat) ||
    !Number.isSafeInteger(parsed.writerExp) ||
    (parsed.writerIat as number) < 0 ||
    (parsed.writerExp as number) - (parsed.writerIat as number) !== PERMIT_TTL_MS ||
    writerJti?.length !== 16 ||
    !matchesContext(parsed, context)
  ) return null
  return parsed as AcceptanceRecoveryReceiptPayload
}

export function verifyAcceptancePermit(
  token: string,
  context: AcceptancePermitContext,
  secret: Uint8Array,
  now = Date.now(),
): AcceptanceWritePermitPayload | null {
  if (!isValidContext(context)) return null
  const payload = verifyAcceptancePermitToken(token, secret, now)
  return payload && matchesContext(payload as unknown as Record<string, unknown>, context) ? payload : null
}

export { namespace as acceptanceFixtureNamespace }

export function parseAcceptancePermitContext(value: unknown): AcceptancePermitContext | null {
  if (!hasExactOwnKeys(value, CONTEXT_KEYS)) return null
  if (CONTEXT_KEYS.some((key) => typeof value[key] !== 'string')) return null
  const context: AcceptancePermitContext = {
    runId: value.runId as string,
    submissionRequestId: value.submissionRequestId as string,
    listingSlug: value.listingSlug as string,
    fixtureNamespace: value.fixtureNamespace as string,
    expectedGitCommitSha: value.expectedGitCommitSha as string,
    expectedDeploymentRevision: value.expectedDeploymentRevision as string,
    expectedDbFingerprint: value.expectedDbFingerprint as string,
  }
  return isValidContext(context) ? context : null
}

function pickContext(value: Record<string, unknown>): unknown {
  return Object.fromEntries(CONTEXT_KEYS.map((key) => [key, value[key]]))
}

export function parseAcceptancePermitRequest(value: unknown): AcceptancePermitRequest | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (record.mode !== 'write' && record.mode !== 'inspect' && record.mode !== 'recovery') return null
  const expectedKeys = record.mode === 'recovery' ? RECOVERY_REQUEST_KEYS : WRITE_REQUEST_KEYS
  if (!hasExactOwnKeys(record, expectedKeys)) return null
  const context = parseAcceptancePermitContext(pickContext(record))
  if (!context) return null
  if (record.mode === 'write' || record.mode === 'inspect') return { mode: record.mode, ...context }
  if (
    typeof record.recoveryReceipt !== 'string' ||
    record.recoveryReceipt.length > TOKEN_MAX_BYTES ||
    (record.recoveryMode !== 'unknown-first-write' && record.recoveryMode !== 'known-lead')
  ) return null
  const recovery: AcceptanceRecoverySpec = {
    recoveryMode: record.recoveryMode,
    expectedLeadId: typeof record.expectedLeadId === 'string' ? record.expectedLeadId : null,
  }
  if (
    !isValidRecoverySpec(recovery) ||
    (record.expectedLeadId !== null && typeof record.expectedLeadId !== 'string')
  ) return null
  return {
    mode: 'recovery',
    ...context,
    recoveryReceipt: record.recoveryReceipt,
    ...recovery,
  }
}
