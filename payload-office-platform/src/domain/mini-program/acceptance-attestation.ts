import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { isIP } from 'node:net'

export type AcceptanceRuntimeConfig = Readonly<{
  deploymentGitCommitSha: string
  deploymentRevision: string
  attestationSecret: Uint8Array
  operatorBootstrapSecret: Uint8Array
  permitSigningSecret: Uint8Array
  dbFingerprintAllowlist: readonly string[]
}>

export type DatabaseIdentity = Readonly<{ databaseName: string; serverAddress: string; serverPort: number }>
export type DatabaseIdentityWithClock = Readonly<{
  identity: DatabaseIdentity
  nowMs: number
}>

const REVISION = /^[A-Za-z0-9._-]{1,128}$/
const FINGERPRINT = /^[0-9a-f]{64}$/
const B64URL = /^[A-Za-z0-9_-]+$/
const CLOCK_MILLISECONDS = /^(?:0|[1-9][0-9]*)$/

export function decodeAttestationSecret(value: string): Uint8Array | null {
  if (!B64URL.test(value)) return null
  const bytes = Buffer.from(value, 'base64url')
  return bytes.length >= 32 &&
    bytes.length <= 64 &&
    Buffer.from(bytes).toString('base64url') === value &&
    new Set(bytes).size >= 16
    ? Uint8Array.from(bytes)
    : null
}

export function constantTimeSecretMatches(provided: string, expected: Uint8Array): boolean {
  // 超界输入先拒绝，避免对攻击者可控的大字符串做解码；128 字符以内才进入固定长度摘要比较。
  if (provided.length > 128) return false
  const providedBytes = decodeAttestationSecret(provided)
  const candidate = providedBytes ?? new Uint8Array(0)
  const providedDigest = createHash('sha256').update(Buffer.from(candidate)).digest()
  const expectedDigest = createHash('sha256').update(Buffer.from(expected)).digest()
  return providedBytes !== null && timingSafeEqual(providedDigest, expectedDigest)
}

export function databaseFingerprint(identity: DatabaseIdentity, secret: Uint8Array): string {
  const canonical = JSON.stringify({
    databaseName: identity.databaseName,
    serverAddress: identity.serverAddress,
    serverPort: identity.serverPort,
  })
  return createHmac('sha256', secret).update(canonical).digest('hex')
}

export function isAllowedDatabaseFingerprint(fingerprint: string, allowlist: readonly string[]): boolean {
  return FINGERPRINT.test(fingerprint) && allowlist.includes(fingerprint)
}

export function validateDatabaseIdentity(value: unknown): DatabaseIdentity | null {
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as Partial<DatabaseIdentity>
  if (
    typeof candidate.databaseName !== 'string' ||
    candidate.databaseName.trim().length === 0 ||
    candidate.databaseName.length > 128 ||
    /[\u0000-\u001f\u007f]/.test(candidate.databaseName)
  )
    return null
  if (
    typeof candidate.serverAddress !== 'string' ||
    candidate.serverAddress.length === 0 ||
    candidate.serverAddress.length > 256 ||
    isIP(candidate.serverAddress) === 0
  )
    return null
  if (
    typeof candidate.serverPort !== 'number' ||
    !Number.isInteger(candidate.serverPort) ||
    candidate.serverPort < 1 ||
    candidate.serverPort > 65535
  )
    return null
  return {
    databaseName: candidate.databaseName,
    serverAddress: candidate.serverAddress,
    serverPort: candidate.serverPort,
  }
}

export function validateDatabaseIdentityWithClock(value: unknown): DatabaseIdentityWithClock | null {
  const identity = validateDatabaseIdentity(value)
  if (!identity || typeof value !== 'object' || value === null) return null
  const rawNowMs = (value as { nowMs?: unknown }).nowMs
  if (typeof rawNowMs !== 'string' || !CLOCK_MILLISECONDS.test(rawNowMs)) return null
  const nowMs = Number(rawNowMs)
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 || String(nowMs) !== rawNowMs) return null
  return { identity, nowMs }
}
