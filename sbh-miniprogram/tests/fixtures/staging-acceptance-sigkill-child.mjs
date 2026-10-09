import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'

import { createCapsuleStore } from '../../scripts/staging-acceptance-capsule.mjs'
import { runStagingAcceptance } from '../../scripts/staging-acceptance-runner.mjs'

const rootDir = process.argv[2]
if (typeof rootDir !== 'string' || rootDir.length === 0) {
  throw new Error('sigkill fixture root missing')
}

const runId = '550e8400-e29b-41d4-a716-446655440000'
const submissionRequestId = '650e8400-e29b-41d4-a716-446655440000'
const expectedGitCommitSha = 'a'.repeat(40)
const expectedDbFingerprint = 'b'.repeat(64)
const expectedDeploymentRevision = 'deploy-2026-08-28'
const fixtureNamespace = `mp-e2e-${createHash('sha256').update(runId).digest('hex').slice(0, 16)}`
const origin = 'https://sbhmini-305971-11-1253925058.sh.run.tcloudbase.com'
const permit = `${Buffer.alloc(192, 7).toString('base64url')}.${Buffer.alloc(32, 11).toString('base64url')}`
const recoveryReceipt = `${Buffer.alloc(192, 13).toString('base64url')}.${Buffer.alloc(32, 17).toString('base64url')}`
const operatorBootstrapSecret = Buffer.from(
  Array.from({ length: 32 }, (_, index) => index + 33),
).toString('base64url')

const environment = {
  MP_E2E_ALLOW_STAGING_WRITE: '1',
  MP_E2E_API_ORIGIN: origin,
  MP_E2E_EXPECTED_GIT_COMMIT_SHA: expectedGitCommitSha,
  MP_E2E_EXPECTED_DEPLOYMENT_REVISION: expectedDeploymentRevision,
  MP_E2E_EXPECTED_DB_FINGERPRINT: expectedDbFingerprint,
  MP_E2E_RUN_ID: runId,
  MP_E2E_OPERATOR_BOOTSTRAP_SECRET: operatorBootstrapSecret,
  MP_E2E_LISTING_SLUG: 'jing-an-tower',
  MP_E2E_TEST_PHONE: '13800138000',
  MP_E2E_PRIVACY_POLICY_VERSION: '2026-08-28.v1',
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

async function fakeTransport(input, init = {}) {
  const path = new URL(String(input)).pathname
  if (path.endsWith('/attestation')) {
    return jsonResponse({
      ok: true,
      staging: true,
      deploymentGitCommitSha: expectedGitCommitSha,
      deploymentRevision: expectedDeploymentRevision,
      fingerprint: expectedDbFingerprint,
      acceptanceReady: true,
      meta: { requestId: 'sigkill-attestation' },
    })
  }
  if (path.endsWith('/permits')) {
    const body = JSON.parse(String(init.body))
    if (body.mode !== 'write') throw new Error('unexpected permit mode')
    return jsonResponse({
      ok: true,
      permit,
      recoveryReceipt,
      issuedAt: '2027-01-15T08:00:00.000Z',
      expiresAt: '2027-01-15T08:10:00.000Z',
      meta: { requestId: 'sigkill-permit' },
    })
  }
  if (path.endsWith('/acceptance/leads')) {
    return jsonResponse({
      ok: true,
      result: {
        leadCount: 0,
        leadId: null,
        followUpCount: 0,
        ownershipHistoryCount: 0,
      },
      meta: { requestId: 'sigkill-inspect' },
    })
  }
  if (path.endsWith('/inquiries')) {
    process.stdout.write('first-write-dispatch-durable\n')
    return new Promise(() => undefined)
  }
  throw new Error('unexpected fake transport path')
}

globalThis.fetch = () => { throw new Error('real network forbidden') }

await runStagingAcceptance({
  environment,
  fetchImpl: fakeTransport,
  randomUUID: () => submissionRequestId,
  capsuleStore: createCapsuleStore({ rootDir }),
  requestTimeoutMs: 60_000,
})
