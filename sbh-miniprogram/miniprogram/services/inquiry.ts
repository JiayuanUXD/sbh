import type { RequestOptions } from './mini-api-contracts.js'

export type InquiryTargetResolution = 'listing' | 'building' | 'general'
export type InquiryErrorCode =
  | 'phone_code_consumed'
  | 'inquiry_submit_failed'
  | 'session_invalid'
  | 'invalid_request'
  | 'rate_limited'
  | 'service_unavailable'
  | 'network_error'
  | 'request_timeout'

export interface PhoneCodeAttempt {
  consume(): string | null
}

export type RandomValueSource = (
  input: Readonly<{ length: 16 }>,
) => Promise<ArrayBuffer | Uint8Array>

export type InquiryPriceUnit =
  | 'rmb-sqm-day'
  | 'rmb-sqm-month'
  | 'rmb-sqm-year'
  | 'rmb-sqm-total'
  | 'rmb-seat-day'
  | 'rmb-seat-month'
  | 'rmb-seat-year'
  | 'rmb-seat-total'
  | 'rmb-day'
  | 'rmb-month'
  | 'rmb-year'
  | 'rmb-total'

export type InquiryPriceSnapshot = Readonly<{
  amount: number
  currency: 'CNY'
  period: 'day' | 'month' | 'year' | 'one-time'
  unit: InquiryPriceUnit
}>

export type InquiryTarget =
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

export type InquiryInput = Readonly<{
  submissionRequestId: string
  target: InquiryTarget
  moveInTime?: string
  phoneCode?: PhoneCodeAttempt
  phone?: string
  consent: Readonly<{ accepted: true; policyVersion: string }>
  priceSnapshot?: InquiryPriceSnapshot
}>

export type InquirySuccess = Readonly<{
  ok: true
  accepted: true
  acceptedExisting: boolean
  targetResolution: InquiryTargetResolution
}>

export type InquiryFailure = Readonly<{
  ok: false
  code: InquiryErrorCode
  requiresNewPhoneAuthorization?: true
}>

export type InquiryResult = InquirySuccess | InquiryFailure

export type SubmissionIntent = Readonly<{
  target: string
  submissionRequestId: string
}>

type RequestClient = (options: RequestOptions<unknown>) => Promise<unknown>
type PlainRecord = Record<string, unknown>

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const SAFE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const INTENT_TARGET = /^[a-z0-9][a-z0-9:-]{0,299}$/
const POLICY_VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/
const PHONE = /^1[3-9]\d{9}$/
const MAX_MOVE_IN_TIME_LENGTH = 100
const MAX_PRICE_AMOUNT = 1_000_000_000_000
const MAX_PHONE_CODE_LENGTH = 128
const INPUT_KEYS = new Set([
  'submissionRequestId',
  'target',
  'moveInTime',
  'phoneCode',
  'phone',
  'consent',
  'priceSnapshot',
])
const CONSENT_KEYS = new Set(['accepted', 'policyVersion'])
const PRICE_KEYS = new Set(['amount', 'currency', 'period', 'unit'])
const LISTING_TARGET_KEYS = new Set(['targetType', 'listingSlug', 'buildingSlug'])
const BUILDING_TARGET_KEYS = new Set(['targetType', 'buildingSlug'])
const GENERAL_TARGET_KEYS = new Set(['targetType'])
const PRICE_PERIODS = new Set(['day', 'month', 'year', 'one-time'])
const PRICE_UNITS = new Set<InquiryPriceUnit>([
  'rmb-sqm-day',
  'rmb-sqm-month',
  'rmb-sqm-year',
  'rmb-sqm-total',
  'rmb-seat-day',
  'rmb-seat-month',
  'rmb-seat-year',
  'rmb-seat-total',
  'rmb-day',
  'rmb-month',
  'rmb-year',
  'rmb-total',
])
const STABLE_ERROR_CODES = new Set<InquiryErrorCode>([
  'phone_code_consumed',
  'inquiry_submit_failed',
  'session_invalid',
  'invalid_request',
  'rate_limited',
  'service_unavailable',
  'network_error',
  'request_timeout',
])
const phoneCodeAttempts = new WeakMap<PhoneCodeAttempt, boolean>()

function isPlainDataRecord(value: unknown): value is PlainRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  if (Object.getOwnPropertySymbols(value).length > 0) return false
  return Object.getOwnPropertyNames(value).every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return Boolean(descriptor?.enumerable && Object.hasOwn(descriptor, 'value'))
  })
}

function hasOnlyKeys(record: PlainRecord, allowed: ReadonlySet<string>): boolean {
  return Object.keys(record).every((key) => allowed.has(key))
}

function hasExactKeys(record: PlainRecord, expected: ReadonlySet<string>): boolean {
  const keys = Object.keys(record)
  return keys.length === expected.size
    && keys.every((key) => expected.has(key))
    && [...expected].every((key) => Object.hasOwn(record, key))
}

function normalizePhone(value: string): string {
  return value.replace(/[\s\-().]+/g, '').replace(/^(?:\+?86)+/, '')
}

function validPhoneCodeAttempt(value: unknown): value is PhoneCodeAttempt {
  return isPlainDataRecord(value)
    && hasExactKeys(value, new Set(['consume']))
    && typeof value.consume === 'function'
    && phoneCodeAttempts.get(value as unknown as PhoneCodeAttempt) === true
}

function parseConsent(value: unknown): InquiryInput['consent'] | null {
  if (!isPlainDataRecord(value) || !hasExactKeys(value, CONSENT_KEYS)) return null
  if (
    value.accepted !== true
    || typeof value.policyVersion !== 'string'
    || !POLICY_VERSION.test(value.policyVersion)
  ) {
    return null
  }
  return { accepted: true, policyVersion: value.policyVersion }
}

function parsePriceSnapshot(value: unknown): InquiryPriceSnapshot | null {
  if (!isPlainDataRecord(value) || !hasExactKeys(value, PRICE_KEYS)) return null
  if (
    typeof value.amount !== 'number'
    || !Number.isFinite(value.amount)
    || value.amount <= 0
    || value.amount > MAX_PRICE_AMOUNT
    || value.currency !== 'CNY'
    || typeof value.period !== 'string'
    || !PRICE_PERIODS.has(value.period)
    || typeof value.unit !== 'string'
    || !PRICE_UNITS.has(value.unit as InquiryPriceUnit)
  ) {
    return null
  }
  return {
    amount: value.amount,
    currency: 'CNY',
    period: value.period as InquiryPriceSnapshot['period'],
    unit: value.unit as InquiryPriceUnit,
  }
}

type NormalizedInquiryInput = Readonly<{
  submissionRequestId: string
  target: InquiryTarget
  moveInTime: string | null
  phoneCode: PhoneCodeAttempt | null
  phone: string | null
  consent: InquiryInput['consent']
  priceSnapshot: InquiryPriceSnapshot | null
}>

function parseTarget(value: unknown): InquiryTarget | null {
  if (!isPlainDataRecord(value)) return null
  if (value.targetType === 'listing') {
    if (
      !hasOnlyKeys(value, LISTING_TARGET_KEYS)
      || typeof value.listingSlug !== 'string'
      || !SAFE_SLUG.test(value.listingSlug)
    ) return null
    if (Object.hasOwn(value, 'buildingSlug')) {
      if (typeof value.buildingSlug !== 'string' || !SAFE_SLUG.test(value.buildingSlug)) return null
      return {
        targetType: 'listing',
        listingSlug: value.listingSlug,
        buildingSlug: value.buildingSlug,
      }
    }
    return { targetType: 'listing', listingSlug: value.listingSlug }
  }
  if (value.targetType === 'building') {
    return hasExactKeys(value, BUILDING_TARGET_KEYS)
      && typeof value.buildingSlug === 'string'
      && SAFE_SLUG.test(value.buildingSlug)
      ? { targetType: 'building', buildingSlug: value.buildingSlug }
      : null
  }
  return value.targetType === 'general' && hasExactKeys(value, GENERAL_TARGET_KEYS)
    ? { targetType: 'general' }
    : null
}

export function inquiryTargetDescriptor(target: InquiryTarget): string {
  if (target.targetType === 'listing') {
    const building = target.buildingSlug ?? ''
    return `listing:${target.listingSlug.length}:${target.listingSlug}:${building.length}:${building}`
  }
  if (target.targetType === 'building') {
    return `building:${target.buildingSlug.length}:${target.buildingSlug}`
  }
  return 'general'
}

function parseInput(value: unknown): NormalizedInquiryInput | null {
  if (!isPlainDataRecord(value) || !hasOnlyKeys(value, INPUT_KEYS)) return null
  if (
    !Object.hasOwn(value, 'submissionRequestId')
    || typeof value.submissionRequestId !== 'string'
    || !UUID_V4.test(value.submissionRequestId)
  ) {
    return null
  }
  const target = parseTarget(value.target)
  if (!Object.hasOwn(value, 'target') || !target) return null

  let moveInTime: string | null = null
  if (Object.hasOwn(value, 'moveInTime') && value.moveInTime !== undefined) {
    if (typeof value.moveInTime !== 'string') return null
    const normalized = value.moveInTime.trim()
    if (normalized.length > MAX_MOVE_IN_TIME_LENGTH) return null
    moveInTime = normalized || null
  }

  const consent = parseConsent(value.consent)
  if (!Object.hasOwn(value, 'consent') || !consent) return null

  let priceSnapshot: InquiryPriceSnapshot | null = null
  if (Object.hasOwn(value, 'priceSnapshot') && value.priceSnapshot !== undefined) {
    priceSnapshot = parsePriceSnapshot(value.priceSnapshot)
    if (!priceSnapshot) return null
  }

  const hasPhoneCode = Object.hasOwn(value, 'phoneCode') && value.phoneCode !== undefined
  const hasPhone = Object.hasOwn(value, 'phone') && value.phone !== undefined
  if (hasPhoneCode === hasPhone) return null

  let phoneCode: PhoneCodeAttempt | null = null
  let phone: string | null = null
  if (hasPhoneCode) {
    if (!validPhoneCodeAttempt(value.phoneCode)) return null
    phoneCode = value.phoneCode
  } else {
    if (typeof value.phone !== 'string') return null
    const normalized = normalizePhone(value.phone)
    if (!PHONE.test(normalized)) return null
    phone = normalized
  }

  return {
    submissionRequestId: value.submissionRequestId,
    target,
    moveInTime,
    phoneCode,
    phone,
    consent,
    priceSnapshot,
  }
}

function parseResponse(value: unknown): Omit<InquirySuccess, 'ok'> {
  if (!isPlainDataRecord(value)) throw new Error('invalid response')
  const keys = new Set(['accepted', 'acceptedExisting', 'targetResolution'])
  if (
    !hasExactKeys(value, keys)
    || value.accepted !== true
    || typeof value.acceptedExisting !== 'boolean'
    || (value.targetResolution !== 'listing'
      && value.targetResolution !== 'building'
      && value.targetResolution !== 'general')
  ) {
    throw new Error('invalid response')
  }
  return {
    accepted: true,
    acceptedExisting: value.acceptedExisting,
    targetResolution: value.targetResolution,
  }
}

function stableErrorCode(error: unknown): InquiryErrorCode {
  if (typeof error !== 'object' || error === null) return 'network_error'
  const descriptor = Object.getOwnPropertyDescriptor(error, 'code')
  const code = descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : null
  return typeof code === 'string' && STABLE_ERROR_CODES.has(code as InquiryErrorCode)
    ? code as InquiryErrorCode
    : 'network_error'
}

function defaultRandomValues(input: Readonly<{ length: 16 }>): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const api = (globalThis as unknown as {
      wx?: {
        getRandomValues?: (options: Readonly<{
          length: number
          success(result: Readonly<{ randomValues: ArrayBuffer }>): void
          fail(error: unknown): void
        }>) => unknown
      }
    }).wx
    if (!api?.getRandomValues) {
      reject(new Error('random values unavailable'))
      return
    }
    try {
      api.getRandomValues({
        length: input.length,
        success: (result) => resolve(result.randomValues),
        fail: () => reject(new Error('random values unavailable')),
      })
    } catch {
      reject(new Error('random values unavailable'))
    }
  })
}

export async function generateSubmissionRequestId(
  randomValues: RandomValueSource = defaultRandomValues,
): Promise<string> {
  let generated: ArrayBuffer | Uint8Array
  try {
    generated = await randomValues({ length: 16 })
  } catch {
    throw new Error('random values unavailable')
  }
  const bytes = generated instanceof ArrayBuffer
    ? new Uint8Array(generated.slice(0))
    : generated instanceof Uint8Array
      ? Uint8Array.from(generated)
      : new Uint8Array(0)
  if (bytes.byteLength !== 16) throw new Error('invalid random length')
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function createSubmissionIntentManager(randomValues?: RandomValueSource) {
  let currentIntent: SubmissionIntent | null = null
  let pending: Readonly<{
    target: string
    generation: number
    promise: Promise<string | null>
  }> | null = null
  let generation = 0

  const open = (target: string): Promise<string | null> => {
    if (!INTENT_TARGET.test(target)) return Promise.reject(new Error('invalid target'))
    if (currentIntent?.target === target) {
      return Promise.resolve(currentIntent.submissionRequestId)
    }
    if (pending?.target === target) return pending.promise

    generation += 1
    const startedGeneration = generation
    currentIntent = null
    const promise = (async (): Promise<string | null> => {
      try {
        const submissionRequestId = await generateSubmissionRequestId(randomValues)
        if (generation !== startedGeneration) return null
        currentIntent = Object.freeze({ target, submissionRequestId })
        return submissionRequestId
      } finally {
        if (pending?.generation === startedGeneration) pending = null
      }
    })()
    pending = { target, generation: startedGeneration, promise }
    return promise
  }

  const invalidate = (): void => {
    generation += 1
    currentIntent = null
    pending = null
  }

  return {
    open,
    invalidate,
    current: (): SubmissionIntent | null => currentIntent,
  }
}

export function createPhoneCodeAttempt(code: string, onConsumed?: () => void): PhoneCodeAttempt {
  let available = true
  const valid = typeof code === 'string'
    && code.length >= 1
    && code.length <= MAX_PHONE_CODE_LENGTH
  const attempt: PhoneCodeAttempt = {
    consume: () => {
      if (!available || !valid) return null
      available = false
      try {
        onConsumed?.()
      } catch {
        // cleanup failure must not make the consumed WeChat code reusable.
      }
      return code
    },
  }
  phoneCodeAttempts.set(attempt, valid)
  return attempt
}

export function createInquiryService(dependencies: Readonly<{
  request: RequestClient
  getAnonymousContextToken?: () => string | null
  clearAnonymousContext?: () => void
}>) {
  const submit = async (input: unknown): Promise<InquiryResult> => {
    const normalized = parseInput(input)
    if (!normalized) return { ok: false, code: 'invalid_request' }

    const anonymousContextToken = dependencies.getAnonymousContextToken?.() ?? null
    if (anonymousContextToken === null) {
      return { ok: false, code: 'session_invalid' }
    }

    const hasPhoneCode = normalized.phoneCode !== null
    const code = normalized.phoneCode?.consume() ?? null
    if (hasPhoneCode && code === null) {
      return {
        ok: false,
        code: 'phone_code_consumed',
        requiresNewPhoneAuthorization: true,
      }
    }

    try {
      const response = parseResponse(await dependencies.request({
        path: '/api/mini/v1/inquiries',
        method: 'POST',
        anonymousContextToken,
        data: {
          submissionRequestId: normalized.submissionRequestId,
          ...normalized.target,
          ...(normalized.moveInTime === null ? {} : { moveInTime: normalized.moveInTime }),
          ...(hasPhoneCode ? { phoneCode: code as string } : { phone: normalized.phone as string }),
          consent: normalized.consent,
          ...(normalized.priceSnapshot === null
            ? {}
            : { priceSnapshot: normalized.priceSnapshot }),
        },
        parse: parseResponse,
      }))
      return { ok: true, ...response }
    } catch (error) {
      const code = stableErrorCode(error)
      if (code === 'session_invalid') {
        try {
          dependencies.clearAnonymousContext?.()
        } catch {
          // clearing an optional cache must not mask the stable submission result.
        }
      }
      return {
        ok: false,
        code,
        ...(hasPhoneCode ? { requiresNewPhoneAuthorization: true as const } : {}),
      }
    }
  }

  return { submit }
}
