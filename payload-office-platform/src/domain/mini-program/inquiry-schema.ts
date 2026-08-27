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

export type MiniInquiryInput = Readonly<{
  submissionRequestId: string
  listingSlug: string
  buildingSlug: string | null
  moveInTime: string | null
  phoneCode: string | null
  phone: string | null
  consent: Readonly<{ accepted: true; policyVersion: string }>
  priceSnapshot: InquiryPriceSnapshot | null
}>

export type MiniInquiryValidationResult =
  | Readonly<{ ok: true; data: MiniInquiryInput }>
  | Readonly<{ ok: false; errors: readonly string[] }>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function own(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

export function validateMiniInquiryInput(
  value: unknown,
  expectedPolicyVersion: string,
): MiniInquiryValidationResult {
  if (!isRecord(value)) return { ok: false, errors: ['invalid_body'] }
  if (Object.keys(value).some((key) => !TOP_LEVEL_KEYS.has(key))) {
    return { ok: false, errors: ['invalid_body_fields'] }
  }

  const errors: string[] = []
  const submissionRequestId = typeof value.submissionRequestId === 'string'
    ? value.submissionRequestId
    : ''
  if (!own(value, 'submissionRequestId') || !SUBMISSION_ID_PATTERN.test(submissionRequestId)) {
    errors.push('submission_request_id_invalid')
  }

  const listingSlug = typeof value.listingSlug === 'string' ? value.listingSlug : ''
  if (!own(value, 'listingSlug') || !SAFE_SLUG_PATTERN.test(listingSlug)) {
    errors.push('listing_slug_invalid')
  }

  let buildingSlug: string | null = null
  if (own(value, 'buildingSlug') && value.buildingSlug != null) {
    if (typeof value.buildingSlug !== 'string' || !SAFE_SLUG_PATTERN.test(value.buildingSlug)) {
      errors.push('building_slug_invalid')
    } else {
      buildingSlug = value.buildingSlug
    }
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

  if (errors.length > 0 || !consent || !priceSnapshot.ok) {
    return { ok: false, errors }
  }
  return {
    ok: true,
    data: {
      submissionRequestId,
      listingSlug,
      buildingSlug,
      moveInTime,
      phoneCode,
      phone,
      consent,
      priceSnapshot: priceSnapshot.data,
    },
  }
}
