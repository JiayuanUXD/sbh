import { sql, type SQL } from 'drizzle-orm'
import { createLocalReq, type Payload, type PayloadRequest } from 'payload'

import { resolveCityContext } from '@/app/(frontend)/_lib/city-context'
import type { CityContext } from '@/domain/city-site-profile/resolver'
import type { CityPartnerIdentity, CityPartnerResourceType } from './schema'
import {
  CITY_PARTNER_WRITE_STAGE_CONTEXT_KEY,
} from './application-protect'
import {
  computeCityPartnerDetailsFingerprint,
  computeCityPartnerIdempotencyKey,
} from './idempotency'

export type CityPartnerCreateInput = Readonly<{
  requestId: string
  city: string
  applicantName: string
  contactPhone: string
  phoneNormalized: string
  applicantIdentity: CityPartnerIdentity
  otherIdentity?: string
  consent: Readonly<{ accepted: true; policyVersion: string }>
  source: Readonly<{ path: '/city-partner' }>
}>

export type CityPartnerDetailsInput = Readonly<{
  requestId: string
  contactPhone: string
  phoneNormalized: string
  organizationName?: string
  resourceTypes?: readonly CityPartnerResourceType[]
  otherResource?: string
  experienceSummary?: string
  cooperationPlan?: string
}>

export type CreateCityPartnerResult =
  | Readonly<{ kind: 'created' }>
  | Readonly<{ kind: 'idempotent' }>
  | Readonly<{ kind: 'invalid_city' }>

export type CompleteCityPartnerResult =
  | Readonly<{ kind: 'completed' }>
  | Readonly<{ kind: 'idempotent' }>
  | Readonly<{ kind: 'conflict' }>
  | Readonly<{ kind: 'identity_ambiguous' }>
  | Readonly<{ kind: 'not_found' }>

type StageOneArgs = Readonly<{
  payload: Payload
  input: CityPartnerCreateInput
  submitterIpHash: string
  sourceUrl: string
  resolveCity?: (slug: unknown) => Promise<CityContext | null>
}>

type StageTwoArgs = Readonly<{
  payload: Payload
  input: CityPartnerDetailsInput
  now?: () => Date
}>

type LockedDetailsRow = Readonly<{
  id: number | string
  detailsCompletedAt: string | Date | null
  detailsFingerprint: string | null
}>

type TransactionExecutor = Readonly<{
  execute: (statement: SQL) => Promise<unknown>
}>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTransactionExecutor(value: unknown): value is TransactionExecutor {
  return isRecord(value) && typeof value.execute === 'function'
}

function identifier(value: unknown): number | string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && value.trim().length > 0) return value
  return null
}

function rowsFromQuery(value: unknown): readonly unknown[] {
  if (isRecord(value) && Array.isArray(value.rows)) return value.rows
  return Array.isArray(value) ? value : []
}

function lockedRow(value: unknown): LockedDetailsRow | null {
  if (!isRecord(value)) return null
  const id = identifier(value.id)
  if (id === null) return null
  if (
    value.detailsCompletedAt !== null && value.detailsCompletedAt !== undefined &&
    typeof value.detailsCompletedAt !== 'string' && !(value.detailsCompletedAt instanceof Date)
  ) return null
  if (
    value.detailsFingerprint !== null && value.detailsFingerprint !== undefined &&
    typeof value.detailsFingerprint !== 'string'
  ) return null
  return {
    id,
    detailsCompletedAt: typeof value.detailsCompletedAt === 'string' || value.detailsCompletedAt instanceof Date
      ? value.detailsCompletedAt
      : null,
    detailsFingerprint: typeof value.detailsFingerprint === 'string'
      ? value.detailsFingerprint
      : null,
  }
}

function transactionExecutor(payload: Payload, transactionID: number | string): TransactionExecutor | null {
  const session = payload.db.sessions?.[String(transactionID)]
  return session && isTransactionExecutor(session.db) ? session.db : null
}

function isIdempotencyUniqueViolation(error: unknown): boolean {
  let candidate = error
  for (let depth = 0; depth < 5 && isRecord(candidate); depth += 1) {
    const marker = [candidate.constraint, candidate.detail, candidate.message]
      .filter((part): part is string => typeof part === 'string')
      .join(' ')
      .toLowerCase()
    if (
      candidate.code === '23505' &&
      (marker.includes('city_partner_applications') || marker.includes('idempotency_key'))
    ) return true
    candidate = candidate.cause
  }
  return false
}

async function findExisting(payload: Payload, idempotencyKey: string): Promise<boolean> {
  const result = await payload.find({
    collection: 'city-partner-applications',
    where: { idempotencyKey: { equals: idempotencyKey } },
    select: { idempotencyKey: true },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  return result.docs.length > 0
}

export async function createPublicCityPartnerApplication({
  payload,
  input,
  submitterIpHash,
  sourceUrl,
  resolveCity = resolveCityContext,
}: StageOneArgs): Promise<CreateCityPartnerResult> {
  const city = await resolveCity(input.city)
  if (!city || city.slug !== input.city || typeof city.id !== 'number') {
    return { kind: 'invalid_city' }
  }
  const idempotencyKey = computeCityPartnerIdempotencyKey(
    input.requestId,
    input.phoneNormalized,
    city.id,
  )
  if (await findExisting(payload, idempotencyKey)) return { kind: 'idempotent' }

  const req = await createLocalReq({
    context: { [CITY_PARTNER_WRITE_STAGE_CONTEXT_KEY]: 'stage-one' },
  }, payload)
  try {
    await payload.create({
      collection: 'city-partner-applications',
      data: {
        city: city.id,
        applicantName: input.applicantName,
        contactPhone: input.phoneNormalized,
        applicantIdentity: input.applicantIdentity,
        otherIdentity: input.otherIdentity,
        status: 'pending',
        requestId: input.requestId,
        idempotencyKey,
        sourcePath: input.source.path,
        sourceUrl,
        consentAccepted: input.consent.accepted,
        consentPolicyVersion: input.consent.policyVersion,
        submitterIpHash,
      },
      overrideAccess: true,
      req,
    })
    return { kind: 'created' }
  } catch (error) {
    if (isIdempotencyUniqueViolation(error) && await findExisting(payload, idempotencyKey)) {
      return { kind: 'idempotent' }
    }
    throw error
  }
}

async function localRequest(payload: Payload, transactionID: number | string): Promise<PayloadRequest> {
  const req = await createLocalReq({
    context: { [CITY_PARTNER_WRITE_STAGE_CONTEXT_KEY]: 'stage-two' },
  }, payload)
  req.transactionID = transactionID
  return req
}

export async function completePublicCityPartnerDetails({
  payload,
  input,
  now = () => new Date(),
}: StageTwoArgs): Promise<CompleteCityPartnerResult> {
  const fingerprint = computeCityPartnerDetailsFingerprint(input)
  const transactionID = await payload.db.beginTransaction()
  if (transactionID === null) throw new Error('city_partner_transaction_unavailable')
  let settled = false
  try {
    const executor = transactionExecutor(payload, transactionID)
    if (!executor) throw new Error('city_partner_transaction_session_unavailable')
    const result = await executor.execute(sql`
      SELECT id, details_completed_at AS "detailsCompletedAt",
             details_fingerprint AS "detailsFingerprint"
      FROM city_partner_applications
      WHERE request_id = ${input.requestId}
        AND contact_phone = ${input.phoneNormalized}
      ORDER BY id
      FOR UPDATE
    `)
    const matchedRows = rowsFromQuery(result)
    if (matchedRows.length === 0) {
      await payload.db.commitTransaction(transactionID)
      settled = true
      return { kind: 'not_found' }
    }
    if (matchedRows.length !== 1) {
      await payload.db.commitTransaction(transactionID)
      settled = true
      return { kind: 'identity_ambiguous' }
    }
    const row = lockedRow(matchedRows[0])
    if (!row) throw new Error('city_partner_locked_row_malformed')
    if (row.detailsCompletedAt) {
      await payload.db.commitTransaction(transactionID)
      settled = true
      return row.detailsFingerprint === fingerprint
        ? { kind: 'idempotent' }
        : { kind: 'conflict' }
    }

    const req = await localRequest(payload, transactionID)
    await payload.update({
      collection: 'city-partner-applications',
      id: row.id,
      data: {
        organizationName: input.organizationName ?? null,
        resourceTypes: input.resourceTypes ? [...input.resourceTypes] : [],
        otherResource: input.otherResource ?? null,
        experienceSummary: input.experienceSummary ?? null,
        cooperationPlan: input.cooperationPlan ?? null,
        detailsCompletedAt: now().toISOString(),
        detailsFingerprint: fingerprint,
      },
      overrideAccess: true,
      req,
    })
    await payload.db.commitTransaction(transactionID)
    settled = true
    return { kind: 'completed' }
  } catch (error) {
    if (!settled) await payload.db.rollbackTransaction(transactionID)
    throw error
  }
}
