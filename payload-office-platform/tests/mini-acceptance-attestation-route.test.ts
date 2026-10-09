import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ getPayload: vi.fn(), readConfig: vi.fn() }))
vi.mock('payload', async (importOriginal) => ({
  ...(await importOriginal<typeof import('payload')>()),
  getPayload: io.getPayload,
}))
vi.mock('@/lib/mini-program/acceptance-runtime-config', () => ({ readAcceptanceRuntimeConfig: io.readConfig }))

import { GET } from '@/app/api/mini/v1/acceptance/attestation/route'
import { databaseFingerprint } from '@/domain/mini-program/acceptance-attestation'

const key = Uint8Array.from({ length: 32 }, (_, i) => i + 1)
const identity = { databaseName: 'sbh', serverAddress: '10.0.0.4', serverPort: 5432 }
const operatorSecret = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 33)).toString('base64url')
const attestationSecret = Buffer.from(key).toString('base64url')
const runtimeConfig = {
  deploymentGitCommitSha: 'a'.repeat(40),
  deploymentRevision: 'rev-1',
  attestationSecret: key,
  operatorBootstrapSecret: Uint8Array.from(Array.from({ length: 32 }, (_, i) => i + 33)),
  permitSigningSecret: Uint8Array.from(Array.from({ length: 32 }, (_, i) => i + 65)),
  dbFingerprintAllowlist: [databaseFingerprint(identity, key)],
}

beforeEach(() => {
  io.getPayload.mockReset()
  io.readConfig.mockReset().mockReturnValue(runtimeConfig)
})

describe('GET acceptance attestation', () => {
  it('认证失败时同形 404 且不初始化 Payload', async () => {
    const response = await GET(
      new Request('https://example.test/api/mini/v1/acceptance/attestation', {
        headers: {
          'x-sbh-acceptance-bootstrap': Buffer.from(Array.from({ length: 32 }, (_, i) => i + 34)).toString('base64url'),
        },
      }),
    )
    expect(response.status).toBe(404)
    expect(io.getPayload).not.toHaveBeenCalled()
  })

  it('超长 bootstrap header 在认证前拒绝且不初始化 Payload', async () => {
    const response = await GET(
      new Request('https://example.test/api/mini/v1/acceptance/attestation', {
        headers: { 'x-sbh-acceptance-bootstrap': 'x'.repeat(129) },
      }),
    )
    expect(response.status).toBe(404)
    expect(io.getPayload).not.toHaveBeenCalled()
  })

  it('disabled 时仍在认证前拒绝且不初始化 Payload', async () => {
    io.readConfig.mockReturnValue(null)
    const response = await GET(
      new Request('https://example.test/api/mini/v1/acceptance/attestation', {
        headers: { 'x-sbh-acceptance-bootstrap': operatorSecret },
      }),
    )
    expect(response.status).toBe(404)
    expect(io.getPayload).not.toHaveBeenCalled()
  })

  it('认证通过后才执行只读 probe 并返回 opaque fingerprint', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [identity], rowCount: 1 })
    io.getPayload.mockResolvedValue({ db: { pool: { query } } })
    const response = await GET(
      new Request('https://example.test/api/mini/v1/acceptance/attestation', {
        headers: { 'x-sbh-acceptance-bootstrap': operatorSecret },
      }),
    )
    expect(response.status).toBe(200)
    expect(query).toHaveBeenCalledWith({
      text: 'SELECT current_database() AS "databaseName", host(inet_server_addr()) AS "serverAddress", inet_server_port() AS "serverPort"',
      values: [],
    })
    const body = await response.json()
    expect(body).toMatchObject({
      ok: true,
      staging: true,
      deploymentGitCommitSha: 'a'.repeat(40),
      deploymentRevision: 'rev-1',
      fingerprint: databaseFingerprint(identity, key),
      acceptanceReady: true,
    })
    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain(operatorSecret)
    expect(serialized).not.toContain(attestationSecret)
    expect(serialized).not.toContain('10.0.0.4')
    expect(serialized).not.toContain('sbh')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it.each([
    ['allowlist miss', { rows: [identity] }, []],
    ['zero rows', { rows: [] }, runtimeConfig.dbFingerprintAllowlist],
    ['two rows', { rows: [identity, identity] }, runtimeConfig.dbFingerprintAllowlist],
    ['invalid name', { rows: [{ ...identity, databaseName: '' }] }, runtimeConfig.dbFingerprintAllowlist],
    ['invalid address', { rows: [{ ...identity, serverAddress: '' }] }, runtimeConfig.dbFingerprintAllowlist],
    ['invalid port', { rows: [{ ...identity, serverPort: 0 }] }, runtimeConfig.dbFingerprintAllowlist],
  ])('%s 返回 503 且不泄漏敏感值', async (_label, result, allowlist) => {
    io.readConfig.mockReturnValue({ ...runtimeConfig, dbFingerprintAllowlist: allowlist })
    io.getPayload.mockResolvedValue({ db: { pool: { query: vi.fn().mockResolvedValue(result) } } })
    const response = await GET(
      new Request('https://example.test/api/mini/v1/acceptance/attestation', {
        headers: { 'x-sbh-acceptance-bootstrap': operatorSecret },
      }),
    )
    const body = await response.text()
    expect(response.status).toBe(503)
    expect(body).not.toContain(operatorSecret)
    expect(body).not.toContain(attestationSecret)
    expect(body).not.toContain('10.0.0.4')
    expect(body).not.toContain('sbh')
  })
})
