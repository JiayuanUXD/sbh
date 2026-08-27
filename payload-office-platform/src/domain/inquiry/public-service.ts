import { isPublicCitySlug } from '@/lib/frontend/city-routes'

import type { InquiryIdempotencyKey } from './idempotency'
import type { InquiryRequest } from './schema'

export type PublicInquiryTargetResolution = 'listing' | 'building' | 'general'

export type ExistingInquiryResult = Readonly<{
  targetResolution: PublicInquiryTargetResolution
}>

const TRUSTED_CITY_CAPABILITY = Symbol('trusted-public-inquiry-city')

type ResolvedInquiryCity = Readonly<{
  id: number | string
  slug: string
}>

export type TrustedInquiryCity = ResolvedInquiryCity & Readonly<{
  [TRUSTED_CITY_CAPABILITY]: true
}>

export type VerifiedViewingPreference = Readonly<{
  startsAt: string
  endsAt: string
  timezone: string
  status: 'pending-confirmation'
}>

export type PublicInquiryCommand = Readonly<{
  inquiry: InquiryRequest
  /** 只允许 adapter 使用服务端算法生成；不得直接取客户端 body。 */
  trustedIdempotencyKey: InquiryIdempotencyKey
  defaultCity: string
  siteOrigin: string
  /** adapter 可复用本 service 前置解析出的城市，避免重复读取；不得来自客户端。 */
  trustedCity?: TrustedInquiryCity
  /** Web adapter 已按服务时间复核；Mini adapter 缺省传 null。 */
  viewingPreference: VerifiedViewingPreference | null
}>

type ExistingLead = Readonly<{ targetType?: unknown }>
type EffectiveListing = Readonly<{ id: number }>
type EffectiveBuilding = Readonly<{ id: number; slug: string }>

export type PublicInquiryLeadData = Readonly<{
  name: string | undefined
  phone: string
  company: string | undefined
  status: 'new'
  source: 'frontend-form'
  city: number | string
  budget: string | undefined
  area: string | undefined
  moveInTime: string | undefined
  interestedListing: number | undefined
  notes: string | undefined
  idempotencyKey: string
  sourcePageType: InquiryRequest['source']['pageType']
  sourcePath: string
  sourceUrl: string
  targetType: 'listing' | 'building' | 'none'
  targetListingSlug: string | null
  targetBuildingSlug: string | null
  sourceSection: InquiryRequest['source']['section']
  activeSupplyGroup: InquiryRequest['activeSupplyGroup']
  currentFilters: InquiryRequest['source']['currentFilters']
  priceSnapshot: InquiryRequest['priceSnapshot']
  priceSnapshotSubmittedAt: string | null
  consentAccepted: true
  consentPolicyVersion: string
  campaign: InquiryRequest['source']['campaign']
  requestId: string
  viewingPreference: VerifiedViewingPreference | undefined
}>

export type PublicInquiryDeps = Readonly<{
  findExistingLead(trustedIdempotencyKey: InquiryIdempotencyKey): Promise<ExistingLead | null>
  resolveCity(slug: string): Promise<ResolvedInquiryCity | null>
  assertEffectiveListing(slug: string, citySlug: string): Promise<EffectiveListing | null>
  assertEffectiveBuilding(slug: string, citySlug: string): Promise<EffectiveBuilding | null>
  findOwningBuildingSlug(listingSlug: string): Promise<string | null>
  createLead(data: PublicInquiryLeadData): Promise<void>
  isIdempotencyUniqueViolation(error: unknown): boolean
  nowIso(): string
  onIdempotencyCheckError?(error: unknown): void
  onListingBuildingResolutionError?(error: unknown): void
  onIdempotencyRaceReadError?(error: unknown): void
}>

export class PublicInquirySubmissionError extends Error {
  readonly code: 'city_invalid' | 'idempotency_key_invalid' | 'create_failed'
  override readonly cause: unknown
  readonly targetResolution: PublicInquiryTargetResolution

  constructor(
    code: 'city_invalid' | 'idempotency_key_invalid' | 'create_failed',
    cause?: unknown,
    targetResolution: PublicInquiryTargetResolution = 'general',
  ) {
    super(code)
    this.name = 'PublicInquirySubmissionError'
    this.code = code
    this.cause = cause
    this.targetResolution = targetResolution
  }
}

const IDEMPOTENCY_KEY_PATTERN = /^[a-f0-9]{64}$/

function assertValidIdempotencyKey(key: InquiryIdempotencyKey): void {
  if (typeof key !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new PublicInquirySubmissionError('idempotency_key_invalid')
  }
}

function grantTrustedCityCapability(city: ResolvedInquiryCity): TrustedInquiryCity {
  const trusted = { id: city.id, slug: city.slug } as TrustedInquiryCity
  Object.defineProperty(trusted, TRUSTED_CITY_CAPABILITY, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  })
  return Object.freeze(trusted)
}

function hasTrustedCityCapability(value: unknown): value is TrustedInquiryCity {
  return (
    typeof value === 'object'
    && value !== null
    && (value as { [TRUSTED_CITY_CAPABILITY]?: unknown })[TRUSTED_CITY_CAPABILITY] === true
  )
}

function targetResolution(targetType: unknown): PublicInquiryTargetResolution {
  if (targetType === 'listing') return 'listing'
  if (targetType === 'building') return 'building'
  return 'general'
}

/** 只按 adapter 已生成的可信 key 读取，不接受请求体或最终 Lead 字段。 */
export async function findExistingInquiryResult(
  trustedIdempotencyKey: InquiryIdempotencyKey,
  deps: Pick<PublicInquiryDeps, 'findExistingLead'>,
): Promise<ExistingInquiryResult | null> {
  assertValidIdempotencyKey(trustedIdempotencyKey)
  const existing = await deps.findExistingLead(trustedIdempotencyKey)
  return existing ? { targetResolution: targetResolution(existing.targetType) } : null
}

function approvedLegacyInquiryCity(
  source: InquiryRequest['source'],
  defaultCity: string,
): string | null {
  const segments = source.path.split('/').filter(Boolean)
  const prefixedCity = isPublicCitySlug(segments[0]) ? segments[0] : null
  if (source.pageType === 'entrust') {
    return source.path === '/entrust' ? defaultCity : null
  }
  if (source.pageType === 'home') {
    if (source.path === '/') return defaultCity
    return segments.length === 1 ? prefixedCity : null
  }
  if (source.pageType === 'search') {
    if (segments.length === 1 && (segments[0] === 'listings' || segments[0] === 'buildings')) {
      return defaultCity
    }
    return segments.length === 2 && (segments[1] === 'listings' || segments[1] === 'buildings')
      ? prefixedCity
      : null
  }
  if (source.pageType === 'listing' || source.pageType === 'building') {
    const resource = source.pageType === 'listing' ? 'listings' : 'buildings'
    if (segments.length === 2 && segments[0] === resource) return defaultCity
    return segments.length === 3 && segments[1] === resource ? prefixedCity : null
  }
  return source.pageType === 'content' && /^\/(?:news|pages)\/[^/]+$/.test(source.path)
    ? defaultCity
    : null
}

export async function resolveTrustedPublicInquiryCity(
  inquiry: InquiryRequest,
  defaultCity: string,
  deps: Pick<PublicInquiryDeps, 'resolveCity'>,
): Promise<TrustedInquiryCity> {
  const submittedCity = inquiry.city
    ?? approvedLegacyInquiryCity(inquiry.source, defaultCity)
  const trustedCity = submittedCity ? await deps.resolveCity(submittedCity) : null
  if (!trustedCity || trustedCity.slug !== submittedCity) {
    throw new PublicInquirySubmissionError('city_invalid')
  }
  return grantTrustedCityCapability(trustedCity)
}

function submittedCityFor(command: PublicInquiryCommand): string | null {
  return command.inquiry.city
    ?? approvedLegacyInquiryCity(command.inquiry.source, command.defaultCity)
}

async function precheckWithoutBlocking(
  trustedIdempotencyKey: InquiryIdempotencyKey,
  deps: PublicInquiryDeps,
): Promise<ExistingInquiryResult | null> {
  try {
    return await findExistingInquiryResult(trustedIdempotencyKey, deps)
  } catch (error) {
    deps.onIdempotencyCheckError?.(error)
    return null
  }
}

/**
 * 共享的公开询盘落库事务边界。
 *
 * 每次提交都会在写入前重新预查；即使 adapter 已做过一次预查，这里也不会信任其
 * 结果。有效供给、归属和 Lead 字段均在服务端依赖上完成，客户端无法指定最终关系。
 */
export async function submitPublicInquiry(
  command: PublicInquiryCommand,
  deps: PublicInquiryDeps,
): Promise<Readonly<{ idempotent: boolean; targetResolution: PublicInquiryTargetResolution }>> {
  assertValidIdempotencyKey(command.trustedIdempotencyKey)
  const submittedCity = submittedCityFor(command)
  const trustedCity = command.trustedCity
    ?? await resolveTrustedPublicInquiryCity(command.inquiry, command.defaultCity, deps)
  if (
    !submittedCity
    || !hasTrustedCityCapability(trustedCity)
    || trustedCity.slug !== submittedCity
  ) {
    throw new PublicInquirySubmissionError('city_invalid')
  }
  const existing = await precheckWithoutBlocking(command.trustedIdempotencyKey, deps)
  if (existing) return { idempotent: true, targetResolution: existing.targetResolution }

  const { inquiry } = command
  const listing = inquiry.listingSlug
    ? await deps.assertEffectiveListing(inquiry.listingSlug, trustedCity.slug)
    : null
  let building: EffectiveBuilding | null = null
  if (!listing && inquiry.buildingSlug) {
    if (inquiry.listingSlug) {
      let owningBuildingSlug: string | null = null
      try {
        owningBuildingSlug = await deps.findOwningBuildingSlug(inquiry.listingSlug)
      } catch (error) {
        deps.onListingBuildingResolutionError?.(error)
      }
      if (owningBuildingSlug === inquiry.buildingSlug) {
        building = await deps.assertEffectiveBuilding(owningBuildingSlug, trustedCity.slug)
      }
    } else {
      building = await deps.assertEffectiveBuilding(inquiry.buildingSlug, trustedCity.slug)
    }
  }
  const resolution: PublicInquiryTargetResolution = listing
    ? 'listing'
    : building
      ? 'building'
      : 'general'

  try {
    await deps.createLead({
      name: inquiry.name || undefined,
      phone: inquiry.phone,
      company: inquiry.company ?? undefined,
      status: 'new',
      source: 'frontend-form',
      city: trustedCity.id,
      budget: inquiry.demand.budget ?? undefined,
      area: inquiry.demand.area ?? undefined,
      moveInTime: inquiry.demand.moveInTime ?? undefined,
      interestedListing: listing?.id,
      notes: inquiry.message ?? undefined,
      idempotencyKey: command.trustedIdempotencyKey,
      sourcePageType: inquiry.source.pageType,
      sourcePath: inquiry.source.path,
      sourceUrl: `${command.siteOrigin}${inquiry.source.path}`,
      targetType: resolution === 'general' ? 'none' : resolution,
      targetListingSlug: resolution === 'listing' ? inquiry.listingSlug : null,
      targetBuildingSlug: resolution === 'building' ? building?.slug ?? null : null,
      sourceSection: inquiry.source.section,
      activeSupplyGroup: inquiry.activeSupplyGroup,
      currentFilters: inquiry.source.currentFilters,
      priceSnapshot: inquiry.priceSnapshot,
      priceSnapshotSubmittedAt: inquiry.priceSnapshot ? deps.nowIso() : null,
      consentAccepted: inquiry.consent.accepted,
      consentPolicyVersion: inquiry.consent.policyVersion,
      campaign: inquiry.source.campaign,
      requestId: inquiry.requestId,
      viewingPreference: command.viewingPreference ?? undefined,
    })
    return { idempotent: false, targetResolution: resolution }
  } catch (error) {
    if (deps.isIdempotencyUniqueViolation(error)) {
      try {
        const raced = await findExistingInquiryResult(command.trustedIdempotencyKey, deps)
        if (raced) return { idempotent: true, targetResolution: raced.targetResolution }
      } catch (readError) {
        deps.onIdempotencyRaceReadError?.(readError)
      }
    }
    throw new PublicInquirySubmissionError('create_failed', error, resolution)
  }
}
