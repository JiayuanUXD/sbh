import { getPayload } from 'payload'
import { NextResponse } from 'next/server'

import config from '@/payload.config'
import {
  isAllowedDatabaseFingerprint,
  type AcceptanceRuntimeConfig,
} from '@/domain/mini-program/acceptance-attestation'
import {
  computeAcceptanceFixtureLocator,
  encodeAcceptanceFixtureLeadId,
  parseAcceptanceFixtureRequest,
  type AcceptanceFixtureRequest,
} from '@/domain/mini-program/acceptance-fixture'
import {
  verifyAcceptancePermitToken,
  type AcceptancePermitPayload,
} from '@/domain/mini-program/acceptance-permit'
import { miniRequestId } from '@/domain/mini-program/response'
import { probeAcceptanceDatabase } from '@/lib/mini-program/acceptance-db-probe'
import { readAcceptanceRuntimeConfig } from '@/lib/mini-program/acceptance-runtime-config'
import type { PoolLike } from '@/lib/rate-limit-pg'

import { readBoundedJsonBody } from '../../bounded-json-body'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ACCEPTANCE_PERMIT_HEADER = 'x-sbh-acceptance-permit'
const MAX_HEADER_BYTES = 4096
const MAX_BODY_BYTES = 16 * 1024
const RESPONSE_HEADERS = { 'Cache-Control': 'private, no-store' } as const

type LeadId = number | string
type LeadDocument = Readonly<{ id: LeadId; [key: string]: unknown }>
type FixturePayload = Readonly<{
  db: Readonly<{ pool?: PoolLike }>
  find: (args: unknown) => Promise<Readonly<{ docs: readonly LeadDocument[] }>>
  count: (args: unknown) => Promise<Readonly<{ totalDocs: number }>>
  delete: (args: unknown) => Promise<unknown>
}>
type Deps = Readonly<{
  readConfig: () => AcceptanceRuntimeConfig | null
  getPayload: () => Promise<FixturePayload>
  probe: typeof probeAcceptanceDatabase
  requestId: () => string
}>

function jsonResponse(body: unknown, status: number, requestId: string): Response {
  return NextResponse.json(body, {
    status,
    headers: { ...RESPONSE_HEADERS, 'X-Request-Id': requestId },
  })
}

function unavailable(requestId: string): Response {
  return new NextResponse('Not Found', {
    status: 404,
    headers: { ...RESPONSE_HEADERS, 'X-Request-Id': requestId },
  })
}

function failure(requestId: string, status: number): Response {
  return jsonResponse({ ok: false, meta: { requestId } }, status, requestId)
}

function readPermit(
  request: Request,
  runtimeConfig: AcceptanceRuntimeConfig,
): AcceptancePermitPayload | null {
  const token = request.headers.get(ACCEPTANCE_PERMIT_HEADER) ?? ''
  if (!token || token.length > MAX_HEADER_BYTES) return null
  const permit = verifyAcceptancePermitToken(token, runtimeConfig.permitSigningSecret)
  if (
    !permit ||
    permit.gitSHA !== runtimeConfig.deploymentGitCommitSha ||
    permit.revision !== runtimeConfig.deploymentRevision ||
    !isAllowedDatabaseFingerprint(permit.dbFingerprint, runtimeConfig.dbFingerprintAllowlist)
  ) {
    return null
  }
  return permit
}

function leadQuery(locator: string) {
  return {
    collection: 'leads',
    where: { idempotencyKey: { equals: locator } },
    limit: 2,
    depth: 0,
    overrideAccess: true,
  }
}

async function relationCounts(payload: FixturePayload, leadId: LeadId): Promise<Readonly<{
  followUpCount: number
  ownershipHistoryCount: number
}>> {
  const [followUps, ownershipHistory] = await Promise.all([
    payload.count({
      collection: 'follow-ups',
      where: { lead: { equals: leadId } },
      overrideAccess: true,
    }),
    payload.count({
      collection: 'lead-ownership-history',
      where: { lead: { equals: leadId } },
      overrideAccess: true,
    }),
  ])
  if (
    !Number.isSafeInteger(followUps.totalDocs) || followUps.totalDocs < 0 ||
    !Number.isSafeInteger(ownershipHistory.totalDocs) || ownershipHistory.totalDocs < 0
  ) {
    throw new Error('invalid relation count')
  }
  return {
    followUpCount: followUps.totalDocs,
    ownershipHistoryCount: ownershipHistory.totalDocs,
  }
}

function zeroInspect(requestId: string): Response {
  return jsonResponse({
    ok: true,
    result: {
      leadCount: 0,
      leadId: null,
      followUpCount: 0,
      ownershipHistoryCount: 0,
    },
    meta: { requestId },
  }, 200, requestId)
}

function zeroCleanup(requestId: string, cleaned: boolean): Response {
  return jsonResponse({
    ok: true,
    result: {
      cleaned,
      leadCount: 0,
      followUpCount: 0,
      ownershipHistoryCount: 0,
    },
    meta: { requestId },
  }, 200, requestId)
}

async function runFixtureAction(
  payload: FixturePayload,
  permit: AcceptancePermitPayload,
  request: AcceptanceFixtureRequest,
  requestId: string,
): Promise<Response> {
  const locator = await computeAcceptanceFixtureLocator(permit.runId, request)
  const initial = await payload.find(leadQuery(locator))
  if (!Array.isArray(initial.docs)) throw new Error('invalid lead query')
  if (initial.docs.length > 1) return failure(requestId, 409)
  if (initial.docs.length === 0) {
    return request.action === 'inspect' ? zeroInspect(requestId) : zeroCleanup(requestId, false)
  }

  const lead = initial.docs[0]
  if (!lead || (typeof lead.id !== 'number' && typeof lead.id !== 'string')) {
    throw new Error('invalid lead id')
  }
  const encodedLeadId = encodeAcceptanceFixtureLeadId(lead.id)
  if (request.action === 'cleanup' && encodedLeadId !== request.leadId) {
    return failure(requestId, 409)
  }

  const counts = await relationCounts(payload, lead.id)
  if (request.action === 'inspect') {
    return jsonResponse({
      ok: true,
      result: {
        leadCount: 1,
        leadId: encodedLeadId,
        ...counts,
      },
      meta: { requestId },
    }, 200, requestId)
  }
  if (counts.followUpCount !== 0 || counts.ownershipHistoryCount !== 0) {
    return failure(requestId, 409)
  }

  await payload.delete({ collection: 'leads', id: lead.id, overrideAccess: true })
  const remaining = await payload.find(leadQuery(locator))
  const postDeleteCounts = await relationCounts(payload, lead.id)
  if (
    !Array.isArray(remaining.docs) ||
    remaining.docs.length !== 0 ||
    postDeleteCounts.followUpCount !== 0 ||
    postDeleteCounts.ownershipHistoryCount !== 0
  ) {
    throw new Error('fixture cleanup recheck failed')
  }
  return zeroCleanup(requestId, true)
}

export function createAcceptanceFixturePostHandler(deps: Deps) {
  return async function POST(request: Request): Promise<Response> {
    const requestId = deps.requestId()
    let runtimeConfig: AcceptanceRuntimeConfig | null
    let permit: AcceptancePermitPayload | null
    try {
      runtimeConfig = deps.readConfig()
      permit = runtimeConfig ? readPermit(request, runtimeConfig) : null
    } catch {
      return unavailable(requestId)
    }
    if (!runtimeConfig || !permit) return unavailable(requestId)

    const mediaType = request.headers.get('content-type')?.toLowerCase().split(';', 1)[0].trim()
    if (mediaType !== 'application/json') return failure(requestId, 415)
    const body = await readBoundedJsonBody(request, MAX_BODY_BYTES)
    if (!body.ok) return failure(requestId, body.error === 'body_too_large' ? 413 : 400)
    const parsed = parseAcceptanceFixtureRequest(body.value)
    if (!parsed.ok) return failure(requestId, 400)

    try {
      const payload = await deps.getPayload()
      const pool = payload.db.pool
      if (!pool) throw new Error('pool unavailable')
      const actual = await deps.probe(
        pool,
        runtimeConfig.attestationSecret,
        runtimeConfig.dbFingerprintAllowlist,
      )
      if (actual.fingerprint !== permit.dbFingerprint) return failure(requestId, 409)
      return await runFixtureAction(payload, permit, parsed.data, requestId)
    } catch {
      return failure(requestId, 503)
    }
  }
}

export const POST = createAcceptanceFixturePostHandler({
  readConfig: () => readAcceptanceRuntimeConfig(),
  getPayload: () => getPayload({ config }) as unknown as Promise<FixturePayload>,
  probe: probeAcceptanceDatabase,
  requestId: miniRequestId,
})
