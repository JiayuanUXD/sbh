import {
  LIMITS,
  parseInquiryPriceSnapshot,
  type InquiryPriceSnapshot,
} from '@/domain/inquiry/schema'
import { isValidCnMobile, normalizePhone } from '@/domain/shared/phone'

const SAFE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SUBMISSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const TOP_LEVEL_KEYS = new Set([
  'submissionRequestId',
  'targetType',
  'listingSlug',
  'buildingSlug',
  'moveInTime',
  'phoneCode',
  'phone',
  'consent',
  'priceSnapshot',
])
const ACCEPTANCE_TOP_LEVEL_KEYS = new Set([
  'submissionRequestId',
  'listingSlug',
  'buildingSlug',
  'moveInTime',
  'phoneCode',
  'phone',
  'consent',
  'priceSnapshot',
])
const CONSENT_KEYS = new Set(['accepted', 'policyVersion'])
const PRICE_SNAPSHOT_KEYS = new Set(['amount', 'currency', 'period', 'unit'])

export type MiniInquiryTarget =
  | Readonly<{
      targetType: 'listing'
      listingSlug: string
      buildingSlug?: string
    }>
  | Readonly<{
      targetType: 'building'
      buildingSlug: string
    }>
  | Readonly<{
      targetType: 'general'
    }>

type MiniInquiryFields = Readonly<{
  submissionRequestId: string
  moveInTime: string | null
  phoneCode: string | null
  phone: string | null
  consent: Readonly<{ accepted: true; policyVersion: string }>
  priceSnapshot: InquiryPriceSnapshot | null
}>

export type MiniInquiryInput = MiniInquiryFields & MiniInquiryTarget

export type MiniInquiryValidationResult =
  | Readonly<{ ok: true; data: MiniInquiryInput }>
  | Readonly<{ ok: false; errors: readonly string[] }>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function own(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

export function isCanonicalMiniUuidV4(value: unknown): value is string {
  return typeof value === 'string' && SUBMISSION_ID_PATTERN.test(value)
}

export function isCanonicalMiniSlug(value: unknown): value is string {
  return typeof value === 'string' && SAFE_SLUG_PATTERN.test(value)
}

export function validateMiniInquiryInput(
  value: unknown,
  expectedPolicyVersion: string,
  mode: 'regular' | 'acceptance' = 'regular',
): MiniInquiryValidationResult {
  if (!isRecord(value)) return { ok: false, errors: ['invalid_body'] }
  const allowedKeys = mode === 'acceptance' ? ACCEPTANCE_TOP_LEVEL_KEYS : TOP_LEVEL_KEYS
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    return { ok: false, errors: ['invalid_body_fields'] }
  }

  const errors: string[] = []
  const submissionRequestId = isCanonicalMiniUuidV4(value.submissionRequestId)
    ? value.submissionRequestId
    : ''
  if (!own(value, 'submissionRequestId') || !isCanonicalMiniUuidV4(submissionRequestId)) {
    errors.push('submission_request_id_invalid')
  }

  let target: MiniInquiryTarget | null = null
  if (mode === 'acceptance') {
    if (!own(value, 'listingSlug') || !isCanonicalMiniSlug(value.listingSlug)) {
      errors.push('listing_slug_invalid')
    } else if (own(value, 'buildingSlug') && value.buildingSlug != null) {
      if (!isCanonicalMiniSlug(value.buildingSlug)) errors.push('building_slug_invalid')
      else target = {
        targetType: 'listing',
        listingSlug: value.listingSlug,
        buildingSlug: value.buildingSlug,
      }
    } else {
      target = { targetType: 'listing', listingSlug: value.listingSlug }
    }
  } else if (value.targetType === 'listing') {
    if (!own(value, 'listingSlug') || !isCanonicalMiniSlug(value.listingSlug)) {
      errors.push('listing_slug_invalid')
    } else if (own(value, 'buildingSlug') && value.buildingSlug !== undefined) {
      if (!isCanonicalMiniSlug(value.buildingSlug)) errors.push('building_slug_invalid')
      else target = {
        targetType: 'listing',
        listingSlug: value.listingSlug,
        buildingSlug: value.buildingSlug,
      }
    } else {
      target = { targetType: 'listing', listingSlug: value.listingSlug }
    }
  } else if (value.targetType === 'building') {
    if (own(value, 'listingSlug')) {
      errors.push('target_fields_invalid')
    }
    if (!own(value, 'buildingSlug') || !isCanonicalMiniSlug(value.buildingSlug)) {
      errors.push('building_slug_invalid')
    } else if (errors.length === 0) {
      target = { targetType: 'building', buildingSlug: value.buildingSlug }
    }
  } else if (value.targetType === 'general') {
    if (
      own(value, 'listingSlug')
      || own(value, 'buildingSlug')
    ) {
      errors.push('target_fields_invalid')
    } else {
      target = { targetType: 'general' }
    }
  } else {
    errors.push('target_type_invalid')
  }

  let moveInTime: string | null = null
  if (own(value, 'moveInTime') && value.moveInTime != null) {
    if (typeof value.moveInTime !== 'string') {
      errors.push('move_in_time_invalid')
    } else {
      const normalized = value.moveInTime.trim()
      if (normalized.length > LIMITS.DEMAND_FIELD_MAX) errors.push('move_in_time_invalid')
      else moveInTime = normalized || null
    }
  }

  const hasPhoneCode = own(value, 'phoneCode') && value.phoneCode !== undefined
  const hasPhone = own(value, 'phone') && value.phone !== undefined
  let phoneCode: string | null = null
  let phone: string | null = null
  if (hasPhoneCode === hasPhone) {
    errors.push('phone_choice_invalid')
  } else if (hasPhoneCode) {
    if (
      typeof value.phoneCode !== 'string'
      || value.phoneCode.length < 1
      || value.phoneCode.length > 128
    ) {
      errors.push('phone_code_invalid')
    } else {
      phoneCode = value.phoneCode
    }
  } else {
    const normalized = typeof value.phone === 'string' ? normalizePhone(value.phone) : ''
    if (!normalized || !isValidCnMobile(normalized)) errors.push('phone_invalid')
    else phone = normalized
  }

  let consent: MiniInquiryInput['consent'] | null = null
  if (
    !own(value, 'consent')
    || !isRecord(value.consent)
    || Object.keys(value.consent).length !== CONSENT_KEYS.size
    || Object.keys(value.consent).some((key) => !CONSENT_KEYS.has(key))
    || !own(value.consent, 'accepted')
    || !own(value.consent, 'policyVersion')
  ) {
    errors.push('consent_invalid')
  } else if (value.consent.accepted !== true) {
    errors.push('consent_required')
  } else if (
    typeof value.consent.policyVersion !== 'string'
    || value.consent.policyVersion !== expectedPolicyVersion
  ) {
    errors.push('consent_version_invalid')
  } else {
    consent = { accepted: true, policyVersion: value.consent.policyVersion }
  }

  const rawPriceSnapshot = value.priceSnapshot
  const exactPriceSnapshot = rawPriceSnapshot == null || (
    own(value, 'priceSnapshot')
    && isRecord(rawPriceSnapshot)
    && Object.keys(rawPriceSnapshot).length === PRICE_SNAPSHOT_KEYS.size
    && Object.keys(rawPriceSnapshot).every((key) => PRICE_SNAPSHOT_KEYS.has(key))
    && [...PRICE_SNAPSHOT_KEYS].every((key) => own(rawPriceSnapshot, key))
  )
  const priceSnapshot = exactPriceSnapshot
    ? parseInquiryPriceSnapshot(rawPriceSnapshot)
    : { ok: false as const }
  if (!priceSnapshot.ok) errors.push('price_snapshot_invalid')

  if (errors.length > 0 || !target || !consent || !priceSnapshot.ok) {
    return { ok: false, errors }
  }
  return {
    ok: true,
    data: {
      submissionRequestId,
      ...target,
      moveInTime,
      phoneCode,
      phone,
      consent,
      priceSnapshot: priceSnapshot.data,
    },
  }
}
