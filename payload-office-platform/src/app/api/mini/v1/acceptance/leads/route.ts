import { getPayload, type Payload, type PayloadRequest } from 'payload'
import { NextResponse } from 'next/server'

import config from '@/payload.config'
import {
  databaseFingerprint,
  isAllowedDatabaseFingerprint,
  type AcceptanceRuntimeConfig,
} from '@/domain/mini-program/acceptance-attestation'
import {
  computeAcceptanceFixtureLocator,
  decodeAcceptanceFixtureLeadId,
  encodeAcceptanceFixtureLeadId,
  parseAcceptanceFixtureRequest,
  type AcceptanceFixtureRequest,
} from '@/domain/mini-program/acceptance-fixture'
import {
  acceptanceRecoveryReceiptDigest,
  verifyAcceptanceInspectPermitToken,
  verifyAcceptancePermitToken,
  verifyAcceptanceRecoveryPermitToken,
  verifyAcceptanceRecoveryReceipt,
  type AcceptanceInspectPermitPayload,
  type AcceptancePermitContext,
  type AcceptanceRecoveryPermitPayload,
  type AcceptanceWritePermitPayload,
} from '@/domain/mini-program/acceptance-permit'
import { runAcceptanceFencedTransaction } from '@/domain/mini-program/acceptance-transaction-fence'
import { miniRequestId } from '@/domain/mini-program/response'
import { readAcceptanceRuntimeConfig } from '@/lib/mini-program/acceptance-runtime-config'

import { readBoundedJsonBody } from '../../bounded-json-body'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ACCEPTANCE_PERMIT_HEADER = 'x-sbh-acceptance-permit'
const MAX_HEADER_BYTES = 4096
const MAX_BODY_BYTES = 16 * 1024
const RESPONSE_HEADERS = { 'Cache-Control': 'private, no-store' } as const

type LeadId = number | string
type LeadDocument = Readonly<{ id: LeadId; [key: string]: unknown }>
type FixturePermit =
  | AcceptanceWritePermitPayload
  | AcceptanceInspectPermitPayload
  | AcceptanceRecoveryPermitPayload
type AuthorizedPermit = Readonly<{
  rawToken: string
  permit: FixturePermit
}>
type FixturePayload = Readonly<{
  db: Payload['db']
  find: (args: unknown) => Promise<Readonly<{ docs: readonly LeadDocument[] }>>
  count: (args: unknown) => Promise<Readonly<{ totalDocs: number }>>
  delete: (args: unknown) => Promise<unknown>
}>
type FixtureActionResult = Readonly<{
  cleaned?: boolean
  leadCount: 0 | 1
  leadId?: ReturnType<typeof encodeAcceptanceFixtureLeadId> | null
  followUpCount: number
  ownershipHistoryCount: number
}>
type Deps = Readonly<{
  readConfig: () => AcceptanceRuntimeConfig | null
  getPayload: () => Promise<FixturePayload>
  requestId: () => string
}>

class FixtureConflictError extends Error {
  constructor() {
    super('acceptance fixture conflict')
    this.name = 'FixtureConflictError'
  }
}

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

function success(requestId: string, result: FixtureActionResult): Response {
  return jsonResponse({ ok: true, result, meta: { requestId } }, 200, requestId)
}

function verifyTokenForPurpose(
  rawToken: string,
  purpose: FixturePermit['purpose'],
  runtimeConfig: AcceptanceRuntimeConfig,
  nowMs: number,
): FixturePermit | null {
  if (purpose === 'acceptance-write') {
    return verifyAcceptancePermitToken(rawToken, runtimeConfig.permitSigningSecret, nowMs)
  }
  if (purpose === 'acceptance-inspect') {
    return verifyAcceptanceInspectPermitToken(rawToken, runtimeConfig.permitSigningSecret, nowMs)
  }
  return verifyAcceptanceRecoveryPermitToken(rawToken, runtimeConfig.permitSigningSecret, nowMs)
}

function matchesRuntime(permit: FixturePermit, runtimeConfig: AcceptanceRuntimeConfig): boolean {
  return (
    permit.gitSHA === runtimeConfig.deploymentGitCommitSha &&
    permit.revision === runtimeConfig.deploymentRevision &&
    isAllowedDatabaseFingerprint(permit.dbFingerprint, runtimeConfig.dbFingerprintAllowlist)
  )
}

function samePermit(left: FixturePermit, right: FixturePermit): boolean {
  if (
    left.purpose !== right.purpose ||
    left.runId !== right.runId ||
    left.submissionRequestId !== right.submissionRequestId ||
    left.listingSlug !== right.listingSlug ||
    left.fixtureNamespace !== right.fixtureNamespace ||
    left.gitSHA !== right.gitSHA ||
    left.revision !== right.revision ||
    left.dbFingerprint !== right.dbFingerprint ||
    left.iat !== right.iat ||
    left.exp !== right.exp ||
    left.jti !== right.jti
  ) {
    return false
  }
  if (left.purpose !== 'acceptance-recovery' || right.purpose !== 'acceptance-recovery') {
    return true
  }
  return (
    left.recoveryReceiptDigest === right.recoveryReceiptDigest &&
    left.recoveryMode === right.recoveryMode &&
    left.expectedLeadId === right.expectedLeadId
  )
}

function readPermit(
  request: Request,
  runtimeConfig: AcceptanceRuntimeConfig,
): AuthorizedPermit | null {
  const rawToken = request.headers.get(ACCEPTANCE_PERMIT_HEADER) ?? ''
  if (!rawToken || rawToken.length > MAX_HEADER_BYTES) return null
  const nowMs = Date.now()
  const permit =
    verifyAcceptancePermitToken(rawToken, runtimeConfig.permitSigningSecret, nowMs) ??
    verifyAcceptanceInspectPermitToken(rawToken, runtimeConfig.permitSigningSecret, nowMs) ??
    verifyAcceptanceRecoveryPermitToken(rawToken, runtimeConfig.permitSigningSecret, nowMs)
  return permit && matchesRuntime(permit, runtimeConfig) ? { rawToken, permit } : null
}

function authorizes(permit: FixturePermit, request: AcceptanceFixtureRequest): boolean {
  if (
    permit.submissionRequestId !== request.submissionRequestId ||
    permit.listingSlug !== request.listingSlug
  ) {
    return false
  }
  if (permit.purpose === 'acceptance-write') {
    return request.action === 'inspect' || request.action === 'cleanup'
  }
  if (permit.purpose === 'acceptance-inspect') return request.action === 'inspect'
  return request.action === 'recover'
}

function receiptContext(permit: AcceptanceRecoveryPermitPayload): AcceptancePermitContext {
  return {
    runId: permit.runId,
    submissionRequestId: permit.submissionRequestId,
    listingSlug: permit.listingSlug,
    fixtureNamespace: permit.fixtureNamespace,
    expectedGitCommitSha: permit.gitSHA,
    expectedDeploymentRevision: permit.revision,
    expectedDbFingerprint: permit.dbFingerprint,
  }
}

function leadQuery(locator: string, req: PayloadRequest) {
  return {
    collection: 'leads',
    where: { idempotencyKey: { equals: locator } },
    limit: 2,
    depth: 0,
    overrideAccess: true,
    trash: true,
    req,
  }
}

async function findLeads(
  payload: FixturePayload,
  locator: string,
  req: PayloadRequest,
): Promise<readonly LeadDocument[]> {
  const result = await payload.find(leadQuery(locator, req))
  if (!Array.isArray(result.docs)) throw new Error('invalid lead query')
  return result.docs
}

async function relationCounts(
  payload: FixturePayload,
  leadId: LeadId,
  req: PayloadRequest,
): Promise<Readonly<{
  followUpCount: number
  ownershipHistoryCount: number
}>> {
  const followUps = await payload.count({
    collection: 'follow-ups',
    where: { lead: { equals: leadId } },
    overrideAccess: true,
    req,
  })
  const ownershipHistory = await payload.count({
    collection: 'lead-ownership-history',
    where: { lead: { equals: leadId } },
    overrideAccess: true,
    req,
  })
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

function zeroResult(cleaned?: boolean): FixtureActionResult {
  return {
    ...(cleaned === undefined ? { leadId: null } : { cleaned }),
    leadCount: 0,
    followUpCount: 0,
    ownershipHistoryCount: 0,
  }
}

async function assertFinalZero(
  payload: FixturePayload,
  locator: string,
  req: PayloadRequest,
  deletedLeadId?: LeadId,
): Promise<void> {
  const remaining = await findLeads(payload, locator, req)
  if (remaining.length !== 0) throw new Error('fixture cleanup recheck failed')
  if (deletedLeadId === undefined) return
  const postDeleteCounts = await relationCounts(payload, deletedLeadId, req)
  if (postDeleteCounts.followUpCount !== 0 || postDeleteCounts.ownershipHistoryCount !== 0) {
    throw new Error('fixture cleanup recheck failed')
  }
}

function expectedLeadId(
  request: AcceptanceFixtureRequest,
  permit: FixturePermit,
): string | null {
  if (request.action === 'cleanup') return request.leadId
  if (request.action === 'recover' && permit.purpose === 'acceptance-recovery') {
    return permit.expectedLeadId
  }
  return null
}

async function runFixtureAction(
  payload: FixturePayload,
  permit: FixturePermit,
  request: AcceptanceFixtureRequest,
  locator: string,
  req: PayloadRequest,
): Promise<FixtureActionResult> {
  const initial = await findLeads(payload, locator, req)
  if (initial.length > 1) throw new FixtureConflictError()
  if (initial.length === 0) {
    if (request.action === 'inspect') return zeroResult()
    const expected = expectedLeadId(request, permit)
    if (expected === null) {
      await assertFinalZero(payload, locator, req)
    } else {
      const rawExpectedLeadId = decodeAcceptanceFixtureLeadId(expected)
      if (rawExpectedLeadId === null) throw new Error('invalid expected lead id')
      const initialCounts = await relationCounts(payload, rawExpectedLeadId, req)
      if (initialCounts.followUpCount !== 0 || initialCounts.ownershipHistoryCount !== 0) {
        throw new FixtureConflictError()
      }
      await assertFinalZero(payload, locator, req, rawExpectedLeadId)
    }
    return zeroResult(false)
  }

  const lead = initial[0]
  if (!lead || (typeof lead.id !== 'number' && typeof lead.id !== 'string')) {
    throw new Error('invalid lead id')
  }
  const encodedLeadId = encodeAcceptanceFixtureLeadId(lead.id)
  const exactLeadId = expectedLeadId(request, permit)
  if (exactLeadId !== null && encodedLeadId !== exactLeadId) {
    throw new FixtureConflictError()
  }

  const counts = await relationCounts(payload, lead.id, req)
  if (request.action === 'inspect') {
    return {
      leadCount: 1,
      leadId: encodedLeadId,
      ...counts,
    }
  }
  if (counts.followUpCount !== 0 || counts.ownershipHistoryCount !== 0) {
    throw new FixtureConflictError()
  }

  await payload.delete({
    collection: 'leads',
    id: lead.id,
    overrideAccess: true,
    trash: true,
    req,
  })
  await assertFinalZero(payload, locator, req, lead.id)
  return zeroResult(true)
}

function verifyRecoveryReceiptAtDatabaseTime(
  request: AcceptanceFixtureRequest,
  permit: FixturePermit,
  runtimeConfig: AcceptanceRuntimeConfig,
  dbNowMs: number,
): void {
  if (request.action !== 'recover' || permit.purpose !== 'acceptance-recovery') return
  const receipt = verifyAcceptanceRecoveryReceipt(
    request.recoveryReceipt,
    receiptContext(permit),
    runtimeConfig.permitSigningSecret,
  )
  if (
    !receipt ||
    acceptanceRecoveryReceiptDigest(request.recoveryReceipt) !== permit.recoveryReceiptDigest ||
    dbNowMs < receipt.writerExp
  ) {
    throw new FixtureConflictError()
  }
}

export function createAcceptanceFixturePostHandler(deps: Deps) {
  return async function POST(request: Request): Promise<Response> {
    const requestId = deps.requestId()
    let runtimeConfig: AcceptanceRuntimeConfig | null
    let authorization: AuthorizedPermit | null
    try {
      runtimeConfig = deps.readConfig()
      authorization = runtimeConfig ? readPermit(request, runtimeConfig) : null
    } catch {
      return unavailable(requestId)
    }
    if (!runtimeConfig || !authorization) return unavailable(requestId)

    const mediaType = request.headers.get('content-type')?.toLowerCase().split(';', 1)[0].trim()
    if (mediaType !== 'application/json') return failure(requestId, 415)
    const body = await readBoundedJsonBody(request, MAX_BODY_BYTES)
    if (!body.ok) return failure(requestId, body.error === 'body_too_large' ? 413 : 400)
    const parsed = parseAcceptanceFixtureRequest(body.value)
    if (!parsed.ok) return failure(requestId, 400)
    if (!authorizes(authorization.permit, parsed.data)) return unavailable(requestId)

    try {
      const payload = await deps.getPayload()
      const locator = await computeAcceptanceFixtureLocator(
        authorization.permit.runId,
        parsed.data,
      )
      const fenced = await runAcceptanceFencedTransaction({
        payload: payload as unknown as Payload,
        locator,
        verifyLeaseAtDatabaseTime: (dbNowMs, databaseIdentity) => {
          const actualFingerprint = databaseFingerprint(
            databaseIdentity,
            runtimeConfig.attestationSecret,
          )
          if (
            actualFingerprint !== authorization.permit.dbFingerprint ||
            !isAllowedDatabaseFingerprint(
              actualFingerprint,
              runtimeConfig.dbFingerprintAllowlist,
            )
          ) {
            return null
          }
          const permit = verifyTokenForPurpose(
            authorization.rawToken,
            authorization.permit.purpose,
            runtimeConfig,
            dbNowMs,
          )
          return permit &&
            matchesRuntime(permit, runtimeConfig) &&
            samePermit(permit, authorization.permit) &&
            authorizes(permit, parsed.data)
            ? permit
            : null
        },
        action: async ({ req, lease, dbNowMs }) => {
          verifyRecoveryReceiptAtDatabaseTime(parsed.data, lease, runtimeConfig, dbNowMs)
          return runFixtureAction(payload, lease, parsed.data, locator, req)
        },
      })
      if (fenced.kind !== 'committed') return failure(requestId, 503)
      return success(requestId, fenced.value)
    } catch (error) {
      return failure(requestId, error instanceof FixtureConflictError ? 409 : 503)
    }
  }
}

export const POST = createAcceptanceFixturePostHandler({
  readConfig: () => readAcceptanceRuntimeConfig(),
  getPayload: () => getPayload({ config }) as unknown as Promise<FixturePayload>,
  requestId: miniRequestId,
})
