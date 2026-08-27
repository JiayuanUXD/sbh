import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { normalizeTrialOrigin } from './trial-origin.mjs'
import { pathToFileURL } from 'node:url'
const shaPattern = /^[0-9a-f]{40}$/
const revisionPattern = /^[A-Za-z0-9._-]{1,128}$/
const fingerprintPattern = /^[0-9a-f]{64}$/
const runIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const base64urlPattern = /^[A-Za-z0-9_-]+$/

function decodeSecret(value) {
  if (!base64urlPattern.test(value)) return null
  const bytes = Buffer.from(value, 'base64url')
  return bytes.length >= 32 && bytes.length <= 64 && Buffer.from(bytes).toString('base64url') === value && new Set(bytes).size >= 16 ? bytes : null
}

export function parsePreflightEnvironment(environment) {
  const env = environment ?? process.env
  if (env.MP_E2E_ALLOW_STAGING_WRITE !== '1') throw new Error('必须显式设置 MP_E2E_ALLOW_STAGING_WRITE=1')
  const { origin, host } = normalizeTrialOrigin(env.MP_E2E_API_ORIGIN ?? '')
  const expectedGitCommitSha = env.MP_E2E_EXPECTED_GIT_COMMIT_SHA ?? ''
  const expectedDeploymentRevision = env.MP_E2E_EXPECTED_DEPLOYMENT_REVISION ?? ''
  const expectedDbFingerprint = env.MP_E2E_EXPECTED_DB_FINGERPRINT ?? ''
  const runId = env.MP_E2E_RUN_ID ?? ''
  const operatorBootstrapSecret = env.MP_E2E_OPERATOR_BOOTSTRAP_SECRET ?? ''
  if (!shaPattern.test(expectedGitCommitSha)) throw new Error('expected Git commit SHA 非法')
  if (!revisionPattern.test(expectedDeploymentRevision)) throw new Error('deployment revision 非法')
  if (!fingerprintPattern.test(expectedDbFingerprint)) throw new Error('DB fingerprint 非法')
  if (!runIdPattern.test(runId)) throw new Error('run ID 必须是 UUIDv4')
  if (!decodeSecret(operatorBootstrapSecret)) throw new Error('operator bootstrap credential 非法')
  const fixtureNamespace = `mp-e2e-${createHash('sha256').update(runId).digest('hex').slice(0, 16)}`
  return { expectedGitCommitSha, expectedDeploymentRevision, expectedDbFingerprint, operatorBootstrapSecret, runId, origin, apiHost: host, fixtureNamespace }
}

export function formatPreflightOutput(result) {
  return JSON.stringify({
    apiHost: result.apiHost,
    localStructureValid: true,
    eligibleForAttestation: true,
    writeAuthorized: false,
    fixtureNamespace: result.fixtureNamespace,
    runIdSummary: result.runId.slice(0, 8),
    note: '仅本地结构预检，不证明服务端部署或数据库隔离',
  }, null, 2)
}

export function main() {
  try {
    console.log(formatPreflightOutput(parsePreflightEnvironment(process.env)))
  } catch (error) {
    console.error(`staging acceptance 预检失败：${error instanceof Error ? error.message : '未知错误'}`)
    process.exitCode = 1
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main()
