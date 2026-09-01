import { getPayload } from 'payload'
import { randomBytes } from 'node:crypto'
import { NextResponse } from 'next/server'
import config from '@/payload.config'
import { constantTimeSecretMatches } from '@/domain/mini-program/acceptance-attestation'
import {
  issueAcceptanceInspectPermit,
  issueAcceptancePermit,
  issueAcceptanceRecoveryPermit,
  parseAcceptancePermitRequest,
  verifyAcceptanceRecoveryReceipt,
  type AcceptancePermitContext,
  type AcceptancePermitRequest,
} from '@/domain/mini-program/acceptance-permit'
import { readAcceptanceRuntimeConfig } from '@/lib/mini-program/acceptance-runtime-config'
import { probeAcceptanceDatabase } from '@/lib/mini-program/acceptance-db-probe'
import { miniRequestId } from '@/domain/mini-program/response'
import type { PoolLike } from '@/lib/rate-limit-pg'
import { readBoundedJsonBody } from '../../bounded-json-body'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const MAX_BODY_BYTES = 16 * 1024
export const ACCEPTANCE_POSTGRES_CLOCK_SQL =
  'SELECT floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text AS "nowMs"'
type RuntimeConfig = NonNullable<ReturnType<typeof readAcceptanceRuntimeConfig>>
type Deps = Readonly<{
  readConfig: () => RuntimeConfig | null
  getPayload: () => Promise<{ db: { pool?: PoolLike } }>
  probe: typeof probeAcceptanceDatabase
  issueWrite: typeof issueAcceptancePermit
  issueInspect: typeof issueAcceptanceInspectPermit
  issueRecovery: typeof issueAcceptanceRecoveryPermit
  random: Parameters<typeof issueAcceptancePermit>[3]
  requestId: () => string
}>
function jsonResponse(body: unknown, status: number, requestId: string): Response {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store', 'X-Request-Id': requestId },
  })
}

async function readPostgresClockMilliseconds(pool: PoolLike): Promise<number> {
  const result = await pool.query({ text: ACCEPTANCE_POSTGRES_CLOCK_SQL, values: [] })
  const value = result.rows.length === 1 ? result.rows[0]?.nowMs : null
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new Error('invalid PostgreSQL clock')
  }
  const now = Number(value)
  if (!Number.isSafeInteger(now) || now < 0 || String(now) !== value) {
    throw new Error('invalid PostgreSQL clock')
  }
  return now
}

function permitContext(request: AcceptancePermitRequest): AcceptancePermitContext {
  return {
    runId: request.runId,
    submissionRequestId: request.submissionRequestId,
    listingSlug: request.listingSlug,
    fixtureNamespace: request.fixtureNamespace,
    expectedGitCommitSha: request.expectedGitCommitSha,
    expectedDeploymentRevision: request.expectedDeploymentRevision,
    expectedDbFingerprint: request.expectedDbFingerprint,
  }
}

function permitResponse(
  issued: Readonly<{ token: string; payload: Readonly<{ iat: number; exp: number }> }>,
  requestId: string,
  recoveryReceipt?: string,
): Response {
  return jsonResponse({
    ok: true,
    permit: issued.token,
    ...(recoveryReceipt === undefined ? {} : { recoveryReceipt }),
    issuedAt: new Date(issued.payload.iat).toISOString(),
    expiresAt: new Date(issued.payload.exp).toISOString(),
    meta: { requestId },
  }, 200, requestId)
}

export function createAcceptancePermitPostHandler(deps: Deps) {
  return async function POST(request: Request): Promise<Response> {
    const requestId = deps.requestId()
    const header = request.headers.get('x-sbh-acceptance-bootstrap') ?? ''
    if (header.length > 128) return jsonResponse({ ok: false, meta: { requestId } }, 404, requestId)
    const runtimeConfig = deps.readConfig()
    if (!runtimeConfig || !constantTimeSecretMatches(header, runtimeConfig.operatorBootstrapSecret))
      return jsonResponse({ ok: false, meta: { requestId } }, 404, requestId)
    try {
      const mediaType = request.headers.get('content-type')?.toLowerCase().split(';', 1)[0].trim()
      if (mediaType !== 'application/json') return jsonResponse({ ok: false, meta: { requestId } }, 415, requestId)
      const parsed = await readBoundedJsonBody(request, MAX_BODY_BYTES)
      if (!parsed.ok)
        return jsonResponse(
          { ok: false, meta: { requestId } },
          parsed.error === 'body_too_large' ? 413 : 400,
          requestId,
        )
      const permitRequest = parseAcceptancePermitRequest(parsed.value)
      if (!permitRequest) return jsonResponse({ ok: false, meta: { requestId } }, 400, requestId)
      const context = permitContext(permitRequest)
      const payload = await deps.getPayload()
      if (!payload.db.pool) throw new Error('pool unavailable')
      const actual = await deps.probe(
        payload.db.pool,
        runtimeConfig.attestationSecret,
        runtimeConfig.dbFingerprintAllowlist,
      )
      if (
        context.expectedGitCommitSha !== runtimeConfig.deploymentGitCommitSha ||
        context.expectedDeploymentRevision !== runtimeConfig.deploymentRevision ||
        context.expectedDbFingerprint !== actual.fingerprint
      )
        return jsonResponse({ ok: false, meta: { requestId } }, 409, requestId)
      const databaseNow = await readPostgresClockMilliseconds(payload.db.pool)
      if (permitRequest.mode === 'write') {
        const issued = deps.issueWrite(
          context,
          runtimeConfig.permitSigningSecret,
          databaseNow,
          deps.random,
        )
        return permitResponse(issued, requestId, issued.recoveryReceipt)
      }
      if (permitRequest.mode === 'inspect') {
        const issued = deps.issueInspect(
          context,
          runtimeConfig.permitSigningSecret,
          databaseNow,
          deps.random,
        )
        return permitResponse(issued, requestId)
      }
      const receipt = verifyAcceptanceRecoveryReceipt(
        permitRequest.recoveryReceipt,
        context,
        runtimeConfig.permitSigningSecret,
      )
      if (!receipt || databaseNow < receipt.writerExp) {
        return jsonResponse({ ok: false, meta: { requestId } }, 409, requestId)
      }
      const issued = deps.issueRecovery(
        context,
        permitRequest.recoveryReceipt,
        {
          recoveryMode: permitRequest.recoveryMode,
          expectedLeadId: permitRequest.expectedLeadId,
        },
        runtimeConfig.permitSigningSecret,
        databaseNow,
        deps.random,
      )
      return permitResponse(issued, requestId)
    } catch {
      return jsonResponse({ ok: false, meta: { requestId } }, 503, requestId)
    }
  }
}

export const POST = createAcceptancePermitPostHandler({
  readConfig: () => readAcceptanceRuntimeConfig(),
  getPayload: () => getPayload({ config }) as Promise<{ db: { pool?: PoolLike } }>,
  probe: probeAcceptanceDatabase,
  issueWrite: issueAcceptancePermit,
  issueInspect: issueAcceptanceInspectPermit,
  issueRecovery: issueAcceptanceRecoveryPermit,
  random: randomBytes,
  requestId: miniRequestId,
})
