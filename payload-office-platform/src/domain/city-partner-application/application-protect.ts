import type { CollectionBeforeChangeHook } from 'payload'

import { derivePermissionContextFromRequest, type RequestContext } from '@/domain/auth/access'
import { hasOperationPermission } from '@/domain/auth/permission-context'
import { isCityPartnerCityInScope } from './access'
import { canTransitionCityPartner, isCityPartnerStatus } from './schema'

export const CITY_PARTNER_WRITE_STAGE_CONTEXT_KEY = 'cityPartnerApplicationWriteStage'
export type CityPartnerWriteStage = 'stage-one' | 'stage-two'

const STAGE_ONE_FIELDS = [
  'city', 'applicantName', 'contactPhone', 'applicantIdentity', 'otherIdentity',
  'requestId', 'idempotencyKey', 'sourcePath', 'sourceUrl', 'consentAccepted',
  'consentPolicyVersion', 'submitterIpHash',
] as const

const STAGE_TWO_FIELDS = [
  'organizationName', 'resourceTypes', 'otherResource', 'experienceSummary',
  'cooperationPlan', 'detailsCompletedAt', 'detailsFingerprint',
] as const

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function relationId(value: unknown): unknown {
  if (value && typeof value === 'object' && 'id' in value) return (value as { id?: unknown }).id
  return value
}

function scopedCityId(value: unknown): number | string | null {
  const id = relationId(value)
  return typeof id === 'number' || typeof id === 'string' ? id : null
}

function changed(next: unknown, previous: unknown): boolean {
  return JSON.stringify(relationId(next)) !== JSON.stringify(relationId(previous))
}

function assertFieldsUnchanged(
  next: Record<string, unknown>,
  previous: Record<string, unknown>,
  fields: readonly string[],
  code: string,
): void {
  for (const field of fields) {
    if (field in next && changed(next[field], previous[field])) throw new Error(code)
  }
}

function hasFact(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  return value !== null && value !== undefined
}

function hasUnsealedStageTwoFacts(previous: Record<string, unknown>): boolean {
  return STAGE_TWO_FIELDS
    .filter((field) => field !== 'detailsCompletedAt' && field !== 'detailsFingerprint')
    .some((field) => hasFact(previous[field]))
}

function writeStage(req: { context?: unknown }): CityPartnerWriteStage | null {
  const context = record(req.context)
  const value = context[CITY_PARTNER_WRITE_STAGE_CONTEXT_KEY]
  return value === 'stage-one' || value === 'stage-two' ? value : null
}

export const protectCityPartnerApplication: CollectionBeforeChangeHook = async ({
  data,
  operation,
  originalDoc,
  req,
}) => {
  const next = record(data)
  const previous = record(originalDoc)
  const stage = writeStage(req)

  if (operation === 'create') {
    if (stage !== 'stage-one') throw new Error('city_partner_stage_one_context_required')
    const accepted: Record<string, unknown> = {}
    for (const field of STAGE_ONE_FIELDS) if (field in next) accepted[field] = next[field]
    return { ...accepted, status: 'pending', assignee: null, internalNote: null, handledAt: null }
  }

  assertFieldsUnchanged(next, previous, STAGE_ONE_FIELDS, 'city_partner_applicant_facts_immutable')

  if (stage === 'stage-two') {
    if (previous.detailsCompletedAt) throw new Error('city_partner_details_already_completed')
    if (hasUnsealedStageTwoFacts(previous)) {
      throw new Error('city_partner_unsealed_details_require_manual_repair')
    }
    if (
      !next.detailsCompletedAt ||
      typeof next.detailsFingerprint !== 'string' ||
      next.detailsFingerprint.trim().length === 0
    ) throw new Error('city_partner_details_completion_markers_required')
    const accepted: Record<string, unknown> = {}
    for (const field of STAGE_TWO_FIELDS) if (field in next) accepted[field] = next[field]
    return { ...previous, ...accepted }
  }

  assertFieldsUnchanged(next, previous, STAGE_TWO_FIELDS, 'city_partner_details_immutable')

  const from = previous.status
  const to = next.status
  if (to !== undefined && to !== from) {
    if (!isCityPartnerStatus(from) || !isCityPartnerStatus(to) || !canTransitionCityPartner(from, to)) {
      throw new Error('city_partner_status_transition_invalid')
    }
  }

  const permission = await derivePermissionContextFromRequest(req as RequestContext)
  if (!permission || !hasOperationPermission(permission, 'city_partner_application:manage')) {
    throw new Error('city_partner_manage_permission_required')
  }
  if (!isCityPartnerCityInScope(permission, scopedCityId(previous.city))) {
    throw new Error('city_partner_city_scope_required')
  }

  const workflow: Record<string, unknown> = {}
  for (const field of ['status', 'assignee', 'internalNote'] as const) {
    if (field in next) workflow[field] = next[field]
  }
  if (to !== from && (to === 'qualified' || to === 'not-fit' || to === 'withdrawn')) {
    workflow.handledAt = new Date().toISOString()
  }
  return { ...previous, ...workflow }
}
