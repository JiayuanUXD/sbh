import { normalizePhone, isValidCnMobile } from '@/domain/shared/phone'
import {
  CITY_PARTNER_IDENTITIES,
  CITY_PARTNER_RESOURCE_TYPES,
  type CityPartnerIdentity,
  type CityPartnerResourceType,
} from '@/domain/city-partner-application/schema'
import { normalizeCitySlug } from '@/domain/city-site-profile/resolver'
import { siteConfig } from '@/lib/frontend/site-config'
import type { PoolLike } from '@/lib/rate-limit-pg'

const TOKEN = "[!#$%&'*+.^_`|~0-9A-Za-z-]+"
const QUOTED_STRING = '"(?:[^"\\\\\r\n]|\\\\[\t -~])*"'
const JSON_MEDIA_TYPE = new RegExp(
  `^\\s*application\\/json\\s*(?:;\\s*${TOKEN}\\s*=\\s*(?:${TOKEN}|${QUOTED_STRING})\\s*)*$`,
  'i',
)
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/

export type CityPartnerCreateBody = Readonly<{
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

export type CityPartnerDetailsBody = Readonly<{
  requestId: string
  contactPhone: string
  phoneNormalized: string
  organizationName?: string
  resourceTypes?: readonly CityPartnerResourceType[]
  otherResource?: string
  experienceSummary?: string
  cooperationPlan?: string
}>

export type ValidationResult<T> =
  | Readonly<{ ok: true; data: T }>
  | Readonly<{ ok: false; errors: readonly string[] }>

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function poolLike(value: unknown): value is PoolLike {
  const candidate = record(value)
  return candidate !== null && typeof candidate.query === 'function'
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allow = new Set(allowed)
  return Object.keys(value).every((key) => allow.has(key))
}

function normalizedText(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized.length > 0 && normalized.length <= maximum ? normalized : null
}

function optionalText(value: unknown, maximum: number): string | null | undefined {
  if (value === undefined) return undefined
  return normalizedText(value, maximum)
}

function failure(...errors: string[]): ValidationResult<never> {
  return { ok: false, errors }
}

export function isStrictJsonContentType(contentType: string | null): boolean {
  return contentType !== null && JSON_MEDIA_TYPE.test(contentType)
}

export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin')
  const host = req.headers.get('host')
  if (!origin || !host) return false
  try {
    const suppliedOrigin = new URL(origin)
    const requestUrl = new URL(req.url)
    return suppliedOrigin.origin === requestUrl.origin && host === requestUrl.host
  } catch {
    return false
  }
}

export function extractPgPool(database: unknown): PoolLike | null {
  const candidate = record(database)
  return poolLike(candidate?.pool) ? candidate.pool : null
}

export function validateCityPartnerCreateBody(value: unknown): ValidationResult<CityPartnerCreateBody> {
  const input = record(value)
  if (!input || !hasOnlyKeys(input, [
    'requestId', 'city', 'applicantName', 'contactPhone', 'applicantIdentity',
    'otherIdentity', 'consent', 'source',
  ])) return failure('invalid_body')

  const requestId = normalizedText(input.requestId, 100)
  const city = normalizeCitySlug(input.city)
  const applicantName = normalizedText(input.applicantName, 50)
  const phoneNormalized = normalizePhone(
    typeof input.contactPhone === 'string' ? input.contactPhone : '',
  )
  const contactPhone = phoneNormalized
  const applicantIdentity = input.applicantIdentity
  const otherIdentity = optionalText(input.otherIdentity, 100)
  const consent = record(input.consent)
  const source = record(input.source)
  if (
    !requestId || !REQUEST_ID.test(requestId) || !city || input.city !== city || !applicantName ||
    !isValidCnMobile(phoneNormalized) ||
    !(CITY_PARTNER_IDENTITIES as readonly unknown[]).includes(applicantIdentity) ||
    otherIdentity === null || !consent || !hasOnlyKeys(consent, ['accepted', 'policyVersion']) ||
    consent.accepted !== true || consent.policyVersion !== siteConfig.privacyPolicyVersion ||
    !source || !hasOnlyKeys(source, ['path']) || source.path !== '/city-partner'
  ) return failure('invalid_body')

  if ((applicantIdentity === 'other') !== (typeof otherIdentity === 'string')) {
    return failure('invalid_other_identity')
  }

  return {
    ok: true,
    data: {
      requestId,
      city,
      applicantName,
      contactPhone,
      phoneNormalized,
      applicantIdentity: applicantIdentity as CityPartnerIdentity,
      ...(otherIdentity ? { otherIdentity } : {}),
      consent: { accepted: true, policyVersion: siteConfig.privacyPolicyVersion },
      source: { path: '/city-partner' },
    },
  }
}

export function validateCityPartnerDetailsBody(value: unknown): ValidationResult<CityPartnerDetailsBody> {
  const input = record(value)
  if (!input || !hasOnlyKeys(input, [
    'requestId', 'contactPhone', 'organizationName', 'resourceTypes', 'otherResource',
    'experienceSummary', 'cooperationPlan',
  ])) return failure('invalid_body')

  const requestId = normalizedText(input.requestId, 100)
  const phoneNormalized = normalizePhone(
    typeof input.contactPhone === 'string' ? input.contactPhone : '',
  )
  const organizationName = optionalText(input.organizationName, 100)
  const otherResource = optionalText(input.otherResource, 200)
  const experienceSummary = optionalText(input.experienceSummary, 2000)
  const cooperationPlan = optionalText(input.cooperationPlan, 2000)
  const rawResources = input.resourceTypes
  if (
    !requestId || !REQUEST_ID.test(requestId) || !isValidCnMobile(phoneNormalized) ||
    organizationName === null || otherResource === null || experienceSummary === null ||
    cooperationPlan === null ||
    (rawResources !== undefined && !Array.isArray(rawResources))
  ) return failure('invalid_body')

  let resourceTypes: CityPartnerResourceType[] | undefined
  if (Array.isArray(rawResources)) {
    if (
      rawResources.some((resource) => !(CITY_PARTNER_RESOURCE_TYPES as readonly unknown[]).includes(resource)) ||
      new Set(rawResources).size !== rawResources.length
    ) return failure('invalid_resource_types')
    resourceTypes = (rawResources as CityPartnerResourceType[]).slice().sort()
    if (resourceTypes.length === 0) resourceTypes = undefined
  }
  if ((resourceTypes?.includes('other') ?? false) !== (typeof otherResource === 'string')) {
    return failure('invalid_other_resource')
  }

  return {
    ok: true,
    data: {
      requestId,
      contactPhone: phoneNormalized,
      phoneNormalized,
      ...(organizationName ? { organizationName } : {}),
      ...(resourceTypes ? { resourceTypes } : {}),
      ...(otherResource ? { otherResource } : {}),
      ...(experienceSummary ? { experienceSummary } : {}),
      ...(cooperationPlan ? { cooperationPlan } : {}),
    },
  }
}
