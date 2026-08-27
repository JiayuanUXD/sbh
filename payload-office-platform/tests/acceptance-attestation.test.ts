import { describe, expect, it } from 'vitest'
import { databaseFingerprint, isAllowedDatabaseFingerprint, constantTimeSecretMatches, validateDatabaseIdentity, decodeAttestationSecret } from '@/domain/mini-program/acceptance-attestation'
import { readAcceptanceRuntimeConfig } from '@/lib/mini-program/acceptance-runtime-config'

const secret = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1)).toString('base64url')
const identity = { databaseName: 'sbh', serverAddress: '10.0.0.4', serverPort: 5432 }
const commit = 'a'.repeat(40)
const operatorSecret = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 33)).toString('base64url')
const fingerprint = databaseFingerprint(identity, Uint8Array.from({ length: 32 }, (_, i) => i + 1))
const validEnv = {
  MP_ACCEPTANCE_ENABLED: '1',
  MP_ACCEPTANCE_DEPLOYMENT_ENVIRONMENT: 'staging',
  MP_ACCEPTANCE_DEPLOYMENT_GIT_COMMIT_SHA: commit,
  MP_ACCEPTANCE_DEPLOYMENT_REVISION: 'rev-1',
  MP_ACCEPTANCE_ATTESTATION_SECRET: secret,
  MP_ACCEPTANCE_OPERATOR_BOOTSTRAP_SECRET: operatorSecret,
  MP_ACCEPTANCE_DB_FINGERPRINT_ALLOWLIST: fingerprint,
}

describe('acceptance attestation', () => {
  it('只接受 staging 的完整安全配置', () => {
    expect(readAcceptanceRuntimeConfig(validEnv)).toBeTruthy()
    expect(readAcceptanceRuntimeConfig({ ...validEnv, MP_ACCEPTANCE_ENABLED: '0' })).toBeNull()
    expect(readAcceptanceRuntimeConfig({ ...validEnv, MP_ACCEPTANCE_DEPLOYMENT_ENVIRONMENT: 'production' })).toBeNull()
    expect(readAcceptanceRuntimeConfig({ ...validEnv, MP_ACCEPTANCE_DEPLOYMENT_GIT_COMMIT_SHA: 'bad' })).toBeNull()
    expect(readAcceptanceRuntimeConfig({ ...validEnv, MP_ACCEPTANCE_ATTESTATION_SECRET: 'weak' })).toBeNull()
    expect(readAcceptanceRuntimeConfig({ ...validEnv, MP_ACCEPTANCE_OPERATOR_BOOTSTRAP_SECRET: secret })).toBeNull()
    expect(readAcceptanceRuntimeConfig({
      ...validEnv,
      MP_ACCEPTANCE_OPERATOR_BOOTSTRAP_SECRET: Buffer.from(new Uint8Array(32).fill(7)).toString('base64url'),
    })).toBeNull()
    expect(readAcceptanceRuntimeConfig({ ...validEnv, MP_ACCEPTANCE_ATTESTATION_SECRET: `${secret}=` })).toBeNull()
    expect(readAcceptanceRuntimeConfig({ ...validEnv, MP_ACCEPTANCE_DB_FINGERPRINT_ALLOWLIST: 'bad' })).toBeNull()
  })

  it('fingerprint 随 database identity 改变且只命中 allowlist', () => {
    const key = Uint8Array.from({ length: 32 }, (_, i) => i + 1)
    const fingerprint = databaseFingerprint(identity, key)
    expect(databaseFingerprint({ ...identity, databaseName: 'other' }, key)).not.toBe(fingerprint)
    expect(databaseFingerprint({ ...identity, serverAddress: '10.0.0.5' }, key)).not.toBe(fingerprint)
    expect(databaseFingerprint({ ...identity, serverPort: 5433 }, key)).not.toBe(fingerprint)
    expect(isAllowedDatabaseFingerprint(fingerprint, [fingerprint])).toBe(true)
    expect(isAllowedDatabaseFingerprint(fingerprint, ['0'.repeat(64)])).toBe(false)
  })

  it('严格拒绝空/超长 identity 与端口边界', () => {
    expect(validateDatabaseIdentity({ ...identity, databaseName: '' })).toBeNull()
    expect(validateDatabaseIdentity({ ...identity, databaseName: '  ' })).toBeNull()
    expect(validateDatabaseIdentity({ ...identity, databaseName: 'sbh\u0000db' })).toBeNull()
    expect(validateDatabaseIdentity({ ...identity, serverAddress: 'x'.repeat(257) })).toBeNull()
    expect(validateDatabaseIdentity({ ...identity, serverAddress: 'not-an-ip' })).toBeNull()
    expect(validateDatabaseIdentity({ ...identity, serverPort: 0 })).toBeNull()
    expect(validateDatabaseIdentity({ ...identity, serverPort: 65536 })).toBeNull()
    expect(validateDatabaseIdentity({ ...identity, serverPort: 5432.5 })).toBeNull()
  })

  it('secret 比较为 constant-time 语义且不接受不同长度', () => {
    const expected = Uint8Array.from({ length: 32 }, (_, i) => i + 1)
    const encoded = Buffer.from(expected).toString('base64url')
    expect(constantTimeSecretMatches(encoded, expected)).toBe(true)
    expect(constantTimeSecretMatches(Buffer.from(Uint8Array.from({ length: 32 }, (_, i) => i + 2)).toString('base64url'), expected)).toBe(false)
    expect(constantTimeSecretMatches(`${encoded}x`, expected)).toBe(false)
  })

  it('secret 解码边界为 32 到 64 bytes', () => {
    for (const length of [31, 32, 64, 65]) {
      const decoded = Uint8Array.from({ length }, (_, i) => (i % 251) + 1)
      expect(Boolean(decodeAttestationSecret(Buffer.from(decoded).toString('base64url')))).toBe(length >= 32 && length <= 64)
    }
  })
})
