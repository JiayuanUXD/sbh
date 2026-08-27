import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const { parsePreflightEnvironment, formatPreflightOutput } = await import('../scripts/staging-acceptance-preflight.mjs' as never) as {
  parsePreflightEnvironment: (environment: Record<string, string>) => unknown
  formatPreflightOutput: (result: { apiHost: string; fixtureNamespace: string; runId: string }) => string
}

const valid = {
  MP_E2E_ALLOW_STAGING_WRITE: '1',
  MP_E2E_API_ORIGIN: 'https://staging.example.com',
  MP_E2E_EXPECTED_GIT_COMMIT_SHA: 'a'.repeat(40),
  MP_E2E_EXPECTED_DEPLOYMENT_REVISION: 'deploy-2026-08-27',
  MP_E2E_EXPECTED_DB_FINGERPRINT: 'b'.repeat(64),
  MP_E2E_RUN_ID: '550e8400-e29b-41d4-a716-446655440000',
  MP_E2E_OPERATOR_BOOTSTRAP_SECRET: Buffer.from(Array.from({ length: 32 }, (_, index) => index + 33)).toString('base64url'),
}
const scriptPath = fileURLToPath(new URL('../scripts/staging-acceptance-preflight.mjs', import.meta.url))

describe('staging acceptance preflight', () => {
  it('解析完整配置并由 run ID 派生 fixture namespace', () => {
    const result = parsePreflightEnvironment(valid) as { apiHost: string; fixtureNamespace: string; runId: string }
    expect(result).toMatchObject({ apiHost: 'staging.example.com', runId: valid.MP_E2E_RUN_ID })
    expect(result.fixtureNamespace).toMatch(/^mp-e2e-[0-9a-f]{16}$/)
  })

  it.each([
    ['production', 'https://sbh-286300-10-1253925058.sh.run.tcloudbase.com'],
    ['production default-port variant', 'HTTPS://SBH-286300-10-1253925058.SH.RUN.TCLOUDBASE.COM:0443/'],
    ['localhost', 'https://localhost'],
    ['localhost trailing dot', 'https://localhost.'],
    ['localhost subdomain', 'https://fixture.localhost'],
    ['DNS absolute-name trailing dot', 'https://staging.example.com.'],
    ['percent-encoded dot', 'https://staging%2eexample.com'],
    ['numeric localhost', 'https://2130706433'],
    ['path', 'https://staging.example.com/api'],
    ['query', 'https://staging.example.com?x=1'],
    ['hash', 'https://staging.example.com#x'],
    ['credentials', 'https://user:pass@staging.example.com'],
  ])('拒绝非法 origin：%s', (_label, origin) => {
    expect(() => parsePreflightEnvironment({ ...valid, MP_E2E_API_ORIGIN: origin })).toThrow()
  })

  it.each([
    ['allow flag', 'MP_E2E_ALLOW_STAGING_WRITE', '0'],
    ['sha', 'MP_E2E_EXPECTED_GIT_COMMIT_SHA', 'bad'],
    ['revision', 'MP_E2E_EXPECTED_DEPLOYMENT_REVISION', 'bad revision'],
    ['fingerprint', 'MP_E2E_EXPECTED_DB_FINGERPRINT', 'A'.repeat(64)],
    ['run id', 'MP_E2E_RUN_ID', 'not-a-uuid'],
    ['secret', 'MP_E2E_OPERATOR_BOOTSTRAP_SECRET', 'weak'],
  ])('拒绝非法字段：%s', (_label, key, value) => {
    expect(() => parsePreflightEnvironment({ ...valid, [key]: value })).toThrow()
  })

  it.each([31, 65])('拒绝 %s bytes 的 operator secret', (length) => {
    const bytes = Buffer.from(Array.from({ length }, (_, index) => (index % 251) + 1))
    expect(() => parsePreflightEnvironment({ ...valid, MP_E2E_OPERATOR_BOOTSTRAP_SECRET: bytes.toString('base64url') })).toThrow()
  })

  it('输出只包含安全摘要，不泄漏 secret、完整 run ID、commit 或 fingerprint', () => {
    const result = parsePreflightEnvironment(valid) as { apiHost: string; fixtureNamespace: string; runId: string }
    const output = formatPreflightOutput(result)
    expect(output).toContain('staging.example.com')
    expect(output).toContain('localStructureValid')
    expect(output).toContain('writeAuthorized')
    expect(output).not.toContain('stagingWriteAllowed')
    expect(output).toContain('仅本地结构预检，不证明服务端部署或数据库隔离')
    expect(output).not.toContain(valid.MP_E2E_OPERATOR_BOOTSTRAP_SECRET)
    expect(output).not.toContain(valid.MP_E2E_RUN_ID)
    expect(output).not.toContain(valid.MP_E2E_EXPECTED_GIT_COMMIT_SHA)
    expect(output).not.toContain(valid.MP_E2E_EXPECTED_DB_FINGERPRINT)
  })

  it('纯 parser 不调用网络或写入注入', () => {
    const source = readFileSync(scriptPath, 'utf8')
    expect(source).not.toMatch(/fetch|writeFileSync/)
    expect(parsePreflightEnvironment(valid)).toBeTruthy()
  })

  it('真实 CLI 失败返回非零且不泄漏敏感值', () => {
    const result = spawnSync(process.execPath, [scriptPath], { env: { ...process.env, ...valid, MP_E2E_API_ORIGIN: 'https://localhost', MP_E2E_OPERATOR_BOOTSTRAP_SECRET: valid.MP_E2E_OPERATOR_BOOTSTRAP_SECRET }, encoding: 'utf8' })
    const output = `${result.stdout}${result.stderr}`
    expect(result.status).not.toBe(0)
    expect(output).not.toContain(valid.MP_E2E_OPERATOR_BOOTSTRAP_SECRET)
    expect(output).not.toContain(valid.MP_E2E_RUN_ID)
    expect(output).not.toContain(valid.MP_E2E_EXPECTED_GIT_COMMIT_SHA)
    expect(output).not.toContain(valid.MP_E2E_EXPECTED_DB_FINGERPRINT)
  })

  it('真实 CLI 成功输出脱敏摘要', () => {
    const output = execFileSync(process.execPath, [scriptPath], { env: { ...process.env, ...valid }, encoding: 'utf8' })
    expect(output).toContain('staging.example.com')
    expect(output).toContain('localStructureValid')
    expect(output).not.toContain('stagingWriteAllowed')
    expect(output).not.toContain(valid.MP_E2E_OPERATOR_BOOTSTRAP_SECRET)
    expect(output).not.toContain(valid.MP_E2E_RUN_ID)
    expect(output).not.toContain(valid.MP_E2E_EXPECTED_GIT_COMMIT_SHA)
    expect(output).not.toContain(valid.MP_E2E_EXPECTED_DB_FINGERPRINT)
  })
})
