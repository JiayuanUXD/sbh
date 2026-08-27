import { getPayload } from 'payload'
import { randomBytes } from 'node:crypto'
import { NextResponse } from 'next/server'
import config from '@/payload.config'
import { constantTimeSecretMatches } from '@/domain/mini-program/acceptance-attestation'
import { issueAcceptancePermit, parseAcceptancePermitContext } from '@/domain/mini-program/acceptance-permit'
import { readAcceptanceRuntimeConfig } from '@/lib/mini-program/acceptance-runtime-config'
import { probeAcceptanceDatabase } from '@/lib/mini-program/acceptance-db-probe'
import { miniRequestId } from '@/domain/mini-program/response'
import type { PoolLike } from '@/lib/rate-limit-pg'
import { readBoundedJsonBody } from '../../bounded-json-body'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const MAX_BODY_BYTES = 16 * 1024
type RuntimeConfig = NonNullable<ReturnType<typeof readAcceptanceRuntimeConfig>>
type Deps = Readonly<{
  readConfig: () => RuntimeConfig | null
  getPayload: () => Promise<{ db: { pool?: PoolLike } }>
  probe: typeof probeAcceptanceDatabase
  issue: typeof issueAcceptancePermit
  now: () => number
  random: Parameters<typeof issueAcceptancePermit>[3]
  requestId: () => string
}>
function jsonResponse(body: unknown, status: number, requestId: string): Response {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store', 'X-Request-Id': requestId },
  })
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
      const context = parseAcceptancePermitContext(parsed.value)
      if (!context) return jsonResponse({ ok: false, meta: { requestId } }, 400, requestId)
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
      const issued = deps.issue(context, runtimeConfig.permitSigningSecret, deps.now(), deps.random)
      return jsonResponse(
        { ok: true, permit: issued.token, expiresAt: new Date(issued.payload.exp).toISOString(), meta: { requestId } },
        200,
        requestId,
      )
    } catch {
      return jsonResponse({ ok: false, meta: { requestId } }, 503, requestId)
    }
  }
}

export const POST = createAcceptancePermitPostHandler({
  readConfig: () => readAcceptanceRuntimeConfig(),
  getPayload: () => getPayload({ config }) as Promise<{ db: { pool?: PoolLike } }>,
  probe: probeAcceptanceDatabase,
  issue: issueAcceptancePermit,
  now: () => Date.now(),
  random: randomBytes,
  requestId: miniRequestId,
})
