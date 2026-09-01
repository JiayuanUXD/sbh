import { computeMiniAcceptanceListingInquiryIdempotencyKey } from './inquiry-idempotency'
import { isCanonicalMiniSlug, isCanonicalMiniUuidV4 } from './inquiry-schema'

declare const acceptanceFixtureLeadIdBrand: unique symbol
export type AcceptanceFixtureLeadId = string & Readonly<{
  [acceptanceFixtureLeadIdBrand]: true
}>

type AcceptanceFixtureRequestIdentity = Readonly<{
  submissionRequestId: string
  listingSlug: string
}>

export type AcceptanceFixtureRequest =
  | (AcceptanceFixtureRequestIdentity & Readonly<{ action: 'inspect' }>)
  | (AcceptanceFixtureRequestIdentity & Readonly<{
    action: 'cleanup'
    leadId: AcceptanceFixtureLeadId
  }>)
  | (AcceptanceFixtureRequestIdentity & Readonly<{
    action: 'recover'
    recoveryReceipt: string
  }>)

export type AcceptanceFixtureParseResult =
  | Readonly<{ ok: true; data: AcceptanceFixtureRequest }>
  | Readonly<{ ok: false; error: 'invalid_request' }>

const MAX_STRING_LEAD_ID_UTF8_BYTES = 128
const MAX_RECOVERY_RECEIPT_BYTES = 4096
const NUMBER_TOKEN = /^n:[1-9][0-9]*$/
const STRING_TOKEN = /^s:([A-Za-z0-9_-]+)$/
const CONTROL = /\p{Cc}/u
const WHITESPACE = /\p{White_Space}/u

function own(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function record(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  )
}

function hasExactOwnKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value)
  return keys.length === expected.length && keys.every((key) => (
    typeof key === 'string' && expected.includes(key) && own(value, key)
  ))
}

function validStringLeadId(value: string): boolean {
  const encoded = Buffer.from(value, 'utf8')
  return (
    encoded.length >= 1 &&
    encoded.length <= MAX_STRING_LEAD_ID_UTF8_BYTES &&
    encoded.toString('utf8') === value &&
    !CONTROL.test(value) &&
    !WHITESPACE.test(value)
  )
}

function canonicalBase64url(value: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null
  const decoded = Buffer.from(value, 'base64url')
  return decoded.toString('base64url') === value ? decoded : null
}

function validRecoveryReceipt(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > MAX_RECOVERY_RECEIPT_BYTES) return false
  const parts = value.split('.')
  if (parts.length !== 2) return false
  const body = canonicalBase64url(parts[0] ?? '')
  const signature = canonicalBase64url(parts[1] ?? '')
  return body !== null && body.length > 0 && signature?.length === 32
}

export function encodeAcceptanceFixtureLeadId(value: number | string): AcceptanceFixtureLeadId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error('invalid acceptance fixture lead id')
    return `n:${value}` as AcceptanceFixtureLeadId
  }
  if (!validStringLeadId(value)) throw new Error('invalid acceptance fixture lead id')
  return `s:${Buffer.from(value, 'utf8').toString('base64url')}` as AcceptanceFixtureLeadId
}

function parseCanonicalLeadIdToken(value: unknown): AcceptanceFixtureLeadId | null {
  if (typeof value !== 'string') return null
  if (NUMBER_TOKEN.test(value)) {
    const id = Number(value.slice(2))
    if (!Number.isSafeInteger(id) || id <= 0) return null
    return encodeAcceptanceFixtureLeadId(id) === value ? value as AcceptanceFixtureLeadId : null
  }
  const match = STRING_TOKEN.exec(value)
  if (!match) return null
  const encoded = match[1]
  const decoded = Buffer.from(encoded, 'base64url')
  if (decoded.toString('base64url') !== encoded) return null
  const id = decoded.toString('utf8')
  if (!validStringLeadId(id)) return null
  return encodeAcceptanceFixtureLeadId(id) === value ? value as AcceptanceFixtureLeadId : null
}

export function decodeAcceptanceFixtureLeadId(value: unknown): number | string | null {
  const token = parseCanonicalLeadIdToken(value)
  if (!token) return null
  if (token.startsWith('n:')) return Number(token.slice(2))
  const encoded = token.slice(2)
  return Buffer.from(encoded, 'base64url').toString('utf8')
}

export function parseAcceptanceFixtureRequest(value: unknown): AcceptanceFixtureParseResult {
  if (!record(value) || !own(value, 'action') || !own(value, 'submissionRequestId') || !own(value, 'listingSlug')) return { ok: false, error: 'invalid_request' }
  if (value.action !== 'inspect' && value.action !== 'cleanup' && value.action !== 'recover') return { ok: false, error: 'invalid_request' }
  if (!isCanonicalMiniUuidV4(value.submissionRequestId)) return { ok: false, error: 'invalid_request' }
  if (!isCanonicalMiniSlug(value.listingSlug)) return { ok: false, error: 'invalid_request' }
  const expectedKeys = value.action === 'cleanup'
    ? ['action', 'submissionRequestId', 'listingSlug', 'leadId']
    : value.action === 'recover'
      ? ['action', 'submissionRequestId', 'listingSlug', 'recoveryReceipt']
      : ['action', 'submissionRequestId', 'listingSlug']
  if (!hasExactOwnKeys(value, expectedKeys)) return { ok: false, error: 'invalid_request' }
  if (value.action === 'cleanup') {
    const leadId = parseCanonicalLeadIdToken(value.leadId)
    if (!leadId) return { ok: false, error: 'invalid_request' }
    return {
      ok: true,
      data: {
        action: 'cleanup',
        submissionRequestId: value.submissionRequestId,
        listingSlug: value.listingSlug,
        leadId,
      },
    }
  }
  if (value.action === 'recover') {
    if (!validRecoveryReceipt(value.recoveryReceipt)) return { ok: false, error: 'invalid_request' }
    return {
      ok: true,
      data: {
        action: 'recover',
        submissionRequestId: value.submissionRequestId,
        listingSlug: value.listingSlug,
        recoveryReceipt: value.recoveryReceipt,
      },
    }
  }
  return {
    ok: true,
    data: {
      action: 'inspect',
      submissionRequestId: value.submissionRequestId,
      listingSlug: value.listingSlug,
    },
  }
}

export function computeAcceptanceFixtureLocator(runId: string, value: AcceptanceFixtureRequest) {
  if (!isCanonicalMiniUuidV4(runId)) throw new Error('invalid acceptance fixture locator')
  const parsed = parseAcceptanceFixtureRequest(value)
  if (!parsed.ok) throw new Error('invalid acceptance fixture locator')
  return computeMiniAcceptanceListingInquiryIdempotencyKey(
    runId,
    parsed.data.submissionRequestId,
    parsed.data.listingSlug,
  )
}
