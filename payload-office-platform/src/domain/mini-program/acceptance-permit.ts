import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export type AcceptancePermitContext = Readonly<{
  runId: string
  fixtureNamespace: string
  expectedGitCommitSha: string
  expectedDeploymentRevision: string
  expectedDbFingerprint: string
}>

export type AcceptancePermitPayload = Readonly<{
  version: 1
  purpose: 'acceptance-write'
  runId: string
  fixtureNamespace: string
  gitSHA: string
  revision: string
  dbFingerprint: string
  iat: number
  exp: number
  jti: string
}>

const CONTEXT_KEYS = [
  'runId',
  'fixtureNamespace',
  'expectedGitCommitSha',
  'expectedDeploymentRevision',
  'expectedDbFingerprint',
] as const
const PAYLOAD_KEYS = [
  'version',
  'purpose',
  'runId',
  'fixtureNamespace',
  'gitSHA',
  'revision',
  'dbFingerprint',
  'iat',
  'exp',
  'jti',
] as const
const PERMIT_TTL_MS = 10 * 60_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA = /^[0-9a-f]{40}$/
const REVISION = /^[A-Za-z0-9._-]{1,128}$/
const FINGERPRINT = /^[0-9a-f]{64}$/

const encode = (value: Uint8Array) => Buffer.from(value).toString('base64url')

function decodeCanonical(value: string): Buffer | null {
  try {
    const decoded = Buffer.from(value, 'base64url')
    return decoded.toString('base64url') === value ? decoded : null
  } catch {
    return null
  }
}

function sign(body: string, secret: Uint8Array): string {
  return createHmac('sha256', secret).update(body).digest('base64url')
}

/** 仅供合同测试构造已签名恶意 payload；不绕过 verify。 */
export function signAcceptancePermitPayloadForTests(payload: unknown, secret: Uint8Array): string {
  const body = encode(Buffer.from(JSON.stringify(payload)))
  return `${body}.${sign(body, secret)}`
}

function namespace(runId: string): string {
  return `mp-e2e-${createHash('sha256').update(runId).digest('hex').slice(0, 16)}`
}

function hasExactOwnKeys(value: unknown, expectedKeys: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return (
    Object.keys(record).length === expectedKeys.length &&
    expectedKeys.every((key) => Object.prototype.hasOwnProperty.call(record, key))
  )
}

function isValidContext(context: AcceptancePermitContext): boolean {
  return (
    UUID.test(context.runId) &&
    context.fixtureNamespace === namespace(context.runId) &&
    SHA.test(context.expectedGitCommitSha) &&
    REVISION.test(context.expectedDeploymentRevision) &&
    FINGERPRINT.test(context.expectedDbFingerprint)
  )
}

export function issueAcceptancePermit(
  context: AcceptancePermitContext,
  secret: Uint8Array,
  now = Date.now(),
  random = randomBytes,
): { token: string; payload: AcceptancePermitPayload } {
  const exp = now + PERMIT_TTL_MS
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(exp)) {
    throw new Error('invalid permit time')
  }
  if (!isValidContext(context)) throw new Error('invalid permit context')

  const nonce = random(16)
  if (nonce.length !== 16) throw new Error('invalid permit random')

  const payload: AcceptancePermitPayload = {
    version: 1,
    purpose: 'acceptance-write',
    runId: context.runId,
    fixtureNamespace: context.fixtureNamespace,
    gitSHA: context.expectedGitCommitSha,
    revision: context.expectedDeploymentRevision,
    dbFingerprint: context.expectedDbFingerprint,
    iat: now,
    exp,
    jti: encode(nonce),
  }
  const body = encode(Buffer.from(JSON.stringify(payload)))
  return { token: `${body}.${sign(body, secret)}`, payload }
}

export function verifyAcceptancePermitToken(
  token: string,
  secret: Uint8Array,
  now = Date.now(),
): AcceptancePermitPayload | null {
  if (!Number.isSafeInteger(now) || now < 0) return null
  if (token.length > 4096) return null

  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [body, signature] = parts
  if (!body || !signature) return null

  const decodedBody = decodeCanonical(body)
  if (!decodedBody) return null

  const expected = Buffer.from(sign(body, secret))
  const actual = Buffer.from(signature)
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(decodedBody.toString('utf8'))
  } catch {
    return null
  }
  if (!hasExactOwnKeys(parsed, PAYLOAD_KEYS)) return null

  const jti = typeof parsed.jti === 'string' ? decodeCanonical(parsed.jti) : null
  if (
    parsed.version !== 1 ||
    parsed.purpose !== 'acceptance-write' ||
    typeof parsed.runId !== 'string' ||
    typeof parsed.fixtureNamespace !== 'string' ||
    typeof parsed.gitSHA !== 'string' ||
    typeof parsed.revision !== 'string' ||
    typeof parsed.dbFingerprint !== 'string' ||
    !UUID.test(parsed.runId) ||
    parsed.fixtureNamespace !== namespace(parsed.runId) ||
    !SHA.test(parsed.gitSHA) ||
    !REVISION.test(parsed.revision) ||
    !FINGERPRINT.test(parsed.dbFingerprint) ||
    !Number.isSafeInteger(parsed.iat) ||
    !Number.isSafeInteger(parsed.exp) ||
    (parsed.exp as number) - (parsed.iat as number) !== PERMIT_TTL_MS ||
    (parsed.iat as number) > now ||
    (parsed.exp as number) <= now ||
    jti?.length !== 16
  ) {
    return null
  }

  return parsed as AcceptancePermitPayload
}

export function verifyAcceptancePermit(
  token: string,
  context: AcceptancePermitContext,
  secret: Uint8Array,
  now = Date.now(),
): AcceptancePermitPayload | null {
  if (!isValidContext(context)) return null
  const payload = verifyAcceptancePermitToken(token, secret, now)
  if (!payload) return null
  return payload.runId === context.runId &&
    payload.fixtureNamespace === context.fixtureNamespace &&
    payload.gitSHA === context.expectedGitCommitSha &&
    payload.revision === context.expectedDeploymentRevision &&
    payload.dbFingerprint === context.expectedDbFingerprint
    ? payload
    : null
}

export { namespace as acceptanceFixtureNamespace }

export function parseAcceptancePermitContext(value: unknown): AcceptancePermitContext | null {
  if (!hasExactOwnKeys(value, CONTEXT_KEYS)) return null
  if (CONTEXT_KEYS.some((key) => typeof value[key] !== 'string')) return null

  const context: AcceptancePermitContext = {
    runId: value.runId as string,
    fixtureNamespace: value.fixtureNamespace as string,
    expectedGitCommitSha: value.expectedGitCommitSha as string,
    expectedDeploymentRevision: value.expectedDeploymentRevision as string,
    expectedDbFingerprint: value.expectedDbFingerprint as string,
  }
  return isValidContext(context) ? context : null
}
