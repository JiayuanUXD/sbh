import { getPayload } from 'payload'
import { NextResponse } from 'next/server'
import config from '@/payload.config'
import { constantTimeSecretMatches } from '@/domain/mini-program/acceptance-attestation'
import { readAcceptanceRuntimeConfig } from '@/lib/mini-program/acceptance-runtime-config'
import { miniRequestId } from '@/domain/mini-program/response'
import type { PoolLike } from '@/lib/rate-limit-pg'
import { probeAcceptanceDatabase } from '@/lib/mini-program/acceptance-db-probe'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NOT_FOUND = 'Not Found'
function unavailable(requestId: string): Response {
  return new NextResponse(NOT_FOUND, {
    status: 404,
    headers: { 'Cache-Control': 'private, no-store', 'X-Request-Id': requestId },
  })
}

export async function GET(request: Request): Promise<Response> {
  const requestId = miniRequestId()
  const bootstrapHeader = request.headers.get('x-sbh-acceptance-bootstrap') ?? ''
  if (bootstrapHeader.length > 128) return unavailable(requestId)
  const runtimeConfig = readAcceptanceRuntimeConfig()
  if (!runtimeConfig || !constantTimeSecretMatches(bootstrapHeader, runtimeConfig.operatorBootstrapSecret))
    return unavailable(requestId)
  try {
    const payload = await getPayload({ config })
    const pool = (payload.db as unknown as { pool?: PoolLike }).pool
    if (!pool) throw new Error('pool unavailable')
    const { fingerprint } = await probeAcceptanceDatabase(
      pool,
      runtimeConfig.attestationSecret,
      runtimeConfig.dbFingerprintAllowlist,
    )
    return NextResponse.json(
      {
        ok: true,
        staging: true,
        deploymentGitCommitSha: runtimeConfig.deploymentGitCommitSha,
        deploymentRevision: runtimeConfig.deploymentRevision,
        fingerprint,
        acceptanceReady: true,
        meta: { requestId },
      },
      { headers: { 'Cache-Control': 'private, no-store', 'X-Request-Id': requestId } },
    )
  } catch {
    return new NextResponse('Service Unavailable', {
      status: 503,
      headers: { 'Cache-Control': 'private, no-store', 'X-Request-Id': requestId },
    })
  }
}
