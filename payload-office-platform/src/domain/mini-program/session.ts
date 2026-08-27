import { createHmac, timingSafeEqual } from 'node:crypto'

const SESSION_ISSUER = 'sbh-platform'
const SESSION_AUDIENCE = 'sbh-wechat-mini-program'
const SESSION_PURPOSE = 'anonymous-context'
const SESSION_VERSION = 1
const SESSION_MAX_AGE_SECONDS = 15 * 60
const TOKEN_MAX_LENGTH = 4096
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/
const MAX_CLOCK_MS = 8_640_000_000_000_000 - SESSION_MAX_AGE_SECONDS * 1000
const HEADER_KEYS = ['alg', 'typ'] as const
const PAYLOAD_KEYS = ['iss', 'aud', 'purpose', 'version', 'sub', 'jti', 'iat', 'exp'] as const

export type MiniSessionCryptoDeps = Readonly<{
  signingSecret: Uint8Array
  now(): number
  randomBytes(size: number): Uint8Array
}>

export type AnonymousContext = Readonly<{
  subject: string
  jti: string
  purpose: 'anonymous-context'
  issuedAt: string
  expiresAt: string
}>

export type AnonymousContextVerification =
  | Readonly<{ ok: true; context: AnonymousContext }>
  | Readonly<{ ok: false; errorCode: 'session_invalid' | 'session_expired' }>

type TokenPayload = Readonly<{
  iss: typeof SESSION_ISSUER
  aud: typeof SESSION_AUDIENCE
  purpose: typeof SESSION_PURPOSE
  version: typeof SESSION_VERSION
  sub: string
  jti: string
  iat: number
  exp: number
}>

function base64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function hmac(input: string, secret: Uint8Array): Buffer {
  return createHmac('sha256', Buffer.from(secret)).update(input, 'utf8').digest()
}

function validSecret(secret: Uint8Array): boolean {
  return secret instanceof Uint8Array && secret.byteLength >= 32
}

function decodeBase64url(value: string): Buffer | null {
  if (!value || !BASE64URL_PATTERN.test(value)) return null
  const decoded = Buffer.from(value, 'base64url')
  return decoded.toString('base64url') === value ? decoded : null
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function integer(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

function hasExactOwnKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const actualKeys = Object.keys(value)
  return actualKeys.length === expectedKeys.length
    && expectedKeys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
}

function readClock(now: () => number): number | null {
  let value: number
  try {
    value = now()
  } catch {
    return null
  }
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_CLOCK_MS
    ? value
    : null
}

function parsePayload(value: unknown): TokenPayload | null {
  const payload = record(value)
  if (
    !payload
    || !hasExactOwnKeys(payload, PAYLOAD_KEYS)
    || payload.iss !== SESSION_ISSUER
    || payload.aud !== SESSION_AUDIENCE
    || payload.purpose !== SESSION_PURPOSE
    || payload.version !== SESSION_VERSION
    || typeof payload.sub !== 'string'
    || !BASE64URL_PATTERN.test(payload.sub)
    || typeof payload.jti !== 'string'
    || !BASE64URL_PATTERN.test(payload.jti)
    || !integer(payload.iat)
    || !integer(payload.exp)
  ) {
    return null
  }
  return payload as TokenPayload
}

function invalid(): AnonymousContextVerification {
  return { ok: false, errorCode: 'session_invalid' }
}

export function issueAnonymousContextToken(
  openId: string,
  deps: MiniSessionCryptoDeps,
): Readonly<{ token: string; expiresAt: string }> {
  if (!validSecret(deps.signingSecret)) throw new Error('mini_session_config_invalid')
  if (typeof openId !== 'string' || openId.length < 1 || openId.length > 256) {
    throw new Error('mini_session_identity_invalid')
  }
  const nowMs = readClock(deps.now)
  if (nowMs === null) throw new Error('mini_session_clock_invalid')
  const random = deps.randomBytes(16)
  if (!(random instanceof Uint8Array) || random.byteLength !== 16) {
    throw new Error('mini_session_random_invalid')
  }
  const iat = Math.floor(nowMs / 1000)
  const exp = iat + SESSION_MAX_AGE_SECONDS
  const subject = hmac(`mini-anonymous-sub-v1|${openId}`, deps.signingSecret).toString('base64url')
  const payload: TokenPayload = {
    iss: SESSION_ISSUER,
    aud: SESSION_AUDIENCE,
    purpose: SESSION_PURPOSE,
    version: SESSION_VERSION,
    sub: subject,
    jti: Buffer.from(random).toString('base64url'),
    iat,
    exp,
  }
  const signingInput = `${base64urlJson({ alg: 'HS256', typ: 'JWT' })}.${base64urlJson(payload)}`
  const signature = hmac(signingInput, deps.signingSecret).toString('base64url')
  return {
    token: `${signingInput}.${signature}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  }
}

export function verifyAnonymousContextToken(
  token: string,
  deps: Pick<MiniSessionCryptoDeps, 'signingSecret' | 'now'>,
): AnonymousContextVerification {
  if (!validSecret(deps.signingSecret) || typeof token !== 'string' || token.length > TOKEN_MAX_LENGTH) {
    return invalid()
  }
  const parts = token.split('.')
  if (parts.length !== 3) return invalid()
  const [headerPart, payloadPart, signaturePart] = parts
  const headerBytes = decodeBase64url(headerPart)
  const payloadBytes = decodeBase64url(payloadPart)
  const signatureBytes = decodeBase64url(signaturePart)
  if (!headerBytes || !payloadBytes || !signatureBytes) return invalid()

  const expectedSignature = hmac(`${headerPart}.${payloadPart}`, deps.signingSecret)
  const comparableSignature = signatureBytes.byteLength === expectedSignature.byteLength
    ? signatureBytes
    : Buffer.alloc(expectedSignature.byteLength)
  const signatureValid = timingSafeEqual(expectedSignature, comparableSignature)
    && signatureBytes.byteLength === expectedSignature.byteLength
  if (!signatureValid) return invalid()

  let headerValue: unknown
  let payloadValue: unknown
  try {
    headerValue = JSON.parse(headerBytes.toString('utf8'))
    payloadValue = JSON.parse(payloadBytes.toString('utf8'))
  } catch {
    return invalid()
  }
  const header = record(headerValue)
  if (
    !header
    || !hasExactOwnKeys(header, HEADER_KEYS)
    || header.alg !== 'HS256'
    || header.typ !== 'JWT'
  ) {
    return invalid()
  }
  const payload = parsePayload(payloadValue)
  if (!payload) return invalid()

  const nowMs = readClock(deps.now)
  if (nowMs === null) return invalid()
  const now = Math.floor(nowMs / 1000)
  if (payload.exp <= now) return { ok: false, errorCode: 'session_expired' }
  if (
    payload.iat > now
    || payload.exp <= payload.iat
    || payload.exp - payload.iat > SESSION_MAX_AGE_SECONDS
  ) {
    return invalid()
  }
  return {
    ok: true,
    context: {
      subject: payload.sub,
      jti: payload.jti,
      purpose: SESSION_PURPOSE,
      issuedAt: new Date(payload.iat * 1000).toISOString(),
      expiresAt: new Date(payload.exp * 1000).toISOString(),
    },
  }
}
