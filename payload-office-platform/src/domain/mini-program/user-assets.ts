import { createHash } from 'node:crypto'

import { NextResponse } from 'next/server'
import type { Payload } from 'payload'

import { LEAD_STAGE_LABELS, isLeadStage, mapLegacyStatusToStage } from '@/domain/crm/lead-stage'
import type {
  MiniBuildingCard,
  MiniListingCard,
} from '@/domain/mini-program/contracts'
import type { MiniInquiryTarget } from '@/domain/mini-program/inquiry-schema'
import { mapMiniBuildingCard, mapMiniListingCard } from '@/domain/mini-program/mappers'
import {
  MINI_CACHE_CONTROL,
  miniError,
  miniRequestId,
} from '@/domain/mini-program/response'
import { verifyAnonymousContextToken } from '@/domain/mini-program/session'
import type {
  BuildingDetailViewModel,
  ListingCardViewModel,
} from '@/domain/public-catalog'
import { readMiniSessionSigningRuntimeConfig } from '@/lib/mini-program/runtime-config'

const MAX_BEARER_LENGTH = 4096

export type MiniUserAssetKind = 'favorite-listing' | 'favorite-building' | 'inquiry'
export type MiniUserAssetTargetType = 'listing' | 'building' | 'general'

export type MiniFavoriteTarget = Readonly<{
  targetType: 'listing' | 'building'
  targetSlug: string
}>

export type MiniUserAssetCreate = Readonly<{
  assetKey: string
  subject: string
  kind: MiniUserAssetKind
  targetType: MiniUserAssetTargetType
  targetSlug: string | null
  lead?: number | null
}>


export type MiniUserAssetRecord = Readonly<{
  databaseId: number | string
  assetKey: string
  subject: string
  kind: MiniUserAssetKind
  targetType: MiniUserAssetTargetType
  targetSlug: string | null
  lead: unknown
  createdAt: string
}>

export type MiniInquiryLinkTarget = MiniInquiryTarget

export interface MiniUserAssetStore {
  findByAssetKey(assetKey: string): Promise<MiniUserAssetRecord | null>
  create(data: MiniUserAssetCreate): Promise<MiniUserAssetRecord>
  deleteExact(
    assetKey: string,
    subject: string,
    kind: MiniUserAssetKind,
    target: MiniFavoriteTarget,
  ): Promise<number>
  findBySubject(subject: string): Promise<readonly MiniUserAssetRecord[]>
}

export type MiniBearerVerification =
  | Readonly<{ ok: true; subject: string }>
  | Readonly<{ ok: false; response: Response }>

type SafeListingFavorite = Omit<MiniListingCard, 'id'>
type SafeBuildingFavorite = Omit<MiniBuildingCard, 'id'>

export type MiniInquiryHistoryItem = Readonly<{
  targetType: MiniUserAssetTargetType
  targetSlug: string | null
  targetTitle: string
  submittedAt: string
  status: Readonly<{
    value: keyof typeof LEAD_STAGE_LABELS
    label: string
  }>
}>

export type MiniMeData = Readonly<{
  counts: Readonly<{ favorites: number; inquiries: number }>
  favorites: Readonly<{
    listings: readonly SafeListingFavorite[]
    buildings: readonly SafeBuildingFavorite[]
  }>
  inquiries: readonly MiniInquiryHistoryItem[]
}>

export type MiniMeProjectionDeps = Readonly<{
  mediaOrigin: string
  resolveListing(slug: string): Promise<ListingCardViewModel | null>
  resolveBuilding(slug: string): Promise<BuildingDetailViewModel | null>
}>

function authFailure(code: 'session_invalid' | 'service_unavailable', status: 401 | 503): Response {
  const requestId = miniRequestId()
  return NextResponse.json(
    miniError(
      code,
      code === 'session_invalid' ? '匿名会话已失效，请重试' : '服务暂不可用，请稍后重试',
      requestId,
    ),
    {
      status,
      headers: {
        'Cache-Control': MINI_CACHE_CONTROL,
        'X-Request-Id': requestId,
      },
    },
  )
}

/** Bearer 语法、配置和签名任一步不成立都不得产生 subject。 */
export function verifyMiniBearer(request: Request): MiniBearerVerification {
  const header = request.headers.get('authorization')
  const match = typeof header === 'string' ? /^Bearer ([^\s]+)$/.exec(header) : null
  if (!match || match[1].length > MAX_BEARER_LENGTH) {
    return { ok: false, response: authFailure('session_invalid', 401) }
  }

  const config = readMiniSessionSigningRuntimeConfig()
  if (!config.ok) {
    return { ok: false, response: authFailure('service_unavailable', 503) }
  }
  const verification = verifyAnonymousContextToken(match[1], {
    signingSecret: config.value.sessionSigningSecret,
    now: () => Date.now(),
  })
  if (!verification.ok) {
    return { ok: false, response: authFailure('session_invalid', 401) }
  }
  return { ok: true, subject: verification.context.subject }
}

export function computeMiniUserAssetKey(
  subject: string,
  kind: MiniUserAssetKind,
  targetType: MiniUserAssetTargetType,
  targetSlug: string | null,
): string {
  return createHash('sha256')
    .update(JSON.stringify([subject, kind, targetType, targetSlug]), 'utf8')
    .digest('hex')
}

function favoriteKind(targetType: MiniFavoriteTarget['targetType']): MiniUserAssetKind {
  return targetType === 'listing' ? 'favorite-listing' : 'favorite-building'
}

function isExactFavoriteRecord(
  record: MiniUserAssetRecord,
  subject: string,
  kind: MiniUserAssetKind,
  target: MiniFavoriteTarget,
): boolean {
  return record.subject === subject
    && record.kind === kind
    && record.targetType === target.targetType
    && record.targetSlug === target.targetSlug
}

export async function upsertFavorite(
  store: MiniUserAssetStore,
  subject: string,
  target: MiniFavoriteTarget,
): Promise<Readonly<{ created: boolean; assetKey: string }>> {
  const kind = favoriteKind(target.targetType)
  const assetKey = computeMiniUserAssetKey(subject, kind, target.targetType, target.targetSlug)
  const existing = await store.findByAssetKey(assetKey)
  if (existing) {
    if (isExactFavoriteRecord(existing, subject, kind, target)) {
      return { created: false, assetKey }
    }
    throw new Error('mini_user_asset_key_collision')
  }

  try {
    await store.create({
      assetKey,
      subject,
      kind,
      targetType: target.targetType,
      targetSlug: target.targetSlug,
    })
    return { created: true, assetKey }
  } catch (error) {
    const raced = await store.findByAssetKey(assetKey)
    if (
      raced
      && isExactFavoriteRecord(raced, subject, kind, target)
    ) {
      return { created: false, assetKey }
    }
    if (raced) throw new Error('mini_user_asset_key_collision')
    throw error
  }
}

export async function removeFavorite(
  store: MiniUserAssetStore,
  subject: string,
  target: MiniFavoriteTarget,
): Promise<Readonly<{ removed: boolean; assetKey: string }>> {
  const kind = favoriteKind(target.targetType)
  const assetKey = computeMiniUserAssetKey(subject, kind, target.targetType, target.targetSlug)
  const deleted = await store.deleteExact(assetKey, subject, kind, target)
  return { removed: deleted > 0, assetKey }
}

function inquiryTargetSlug(target: MiniInquiryLinkTarget): string | null {
  if (target.targetType === 'listing') return target.listingSlug
  if (target.targetType === 'building') return target.buildingSlug
  return null
}

function isExactInquiryRecord(
  record: MiniUserAssetRecord,
  subject: string,
  lead: number,
  target: MiniInquiryLinkTarget,
): boolean {
  return record.subject === subject
    && record.kind === 'inquiry'
    && record.targetType === target.targetType
    && record.targetSlug === inquiryTargetSlug(target)
    && record.lead === lead
}

/** Lead 已存在也必须确认同 subject 的精确 inquiry link；失败交给调用方 fail-closed。 */
export async function linkInquiry(
  store: MiniUserAssetStore,
  subject: string,
  lead: number,
  target: MiniInquiryLinkTarget,
): Promise<Readonly<{ created: boolean; assetKey: string }>> {
  const targetSlug = inquiryTargetSlug(target)
  const assetKey = computeMiniUserAssetKey(subject, 'inquiry', target.targetType, targetSlug)
  const existing = await store.findByAssetKey(assetKey)
  if (existing) {
    if (isExactInquiryRecord(existing, subject, lead, target)) {
      return { created: false, assetKey }
    }
    throw new Error('mini_inquiry_link_conflict')
  }

  try {
    const created = await store.create({
      assetKey,
      subject,
      kind: 'inquiry',
      targetType: target.targetType,
      targetSlug,
      lead,
    })
    if (!isExactInquiryRecord(created, subject, lead, target)) {
      throw new Error('mini_inquiry_link_unconfirmed')
    }
    return { created: true, assetKey }
  } catch (error) {
    const raced = await store.findByAssetKey(assetKey)
    if (raced && isExactInquiryRecord(raced, subject, lead, target)) {
      return { created: false, assetKey }
    }
    if (raced) throw new Error('mini_inquiry_link_conflict')
    throw error
  }
}

function isAssetKind(value: unknown): value is MiniUserAssetKind {
  return value === 'favorite-listing' || value === 'favorite-building' || value === 'inquiry'
}

function isTargetType(value: unknown): value is MiniUserAssetTargetType {
  return value === 'listing' || value === 'building' || value === 'general'
}

type MiniUserAssetDocument = Readonly<{
  id: number | string
  assetKey?: unknown
  subject?: unknown
  kind?: unknown
  targetType?: unknown
  targetSlug?: unknown
  lead?: unknown
  createdAt?: unknown
}>

function assetRecord(doc: MiniUserAssetDocument): MiniUserAssetRecord | null {
  if (
    typeof doc.assetKey !== 'string'
    || typeof doc.subject !== 'string'
    || !isAssetKind(doc.kind)
    || !isTargetType(doc.targetType)
    || !(doc.targetSlug === undefined || doc.targetSlug === null || typeof doc.targetSlug === 'string')
    || typeof doc.createdAt !== 'string'
  ) {
    return null
  }
  return {
    databaseId: doc.id,
    assetKey: doc.assetKey,
    subject: doc.subject,
    kind: doc.kind,
    targetType: doc.targetType,
    targetSlug: doc.targetSlug ?? null,
    lead: doc.lead ?? null,
    createdAt: doc.createdAt,
  }
}

export function createPayloadMiniUserAssetStore(payload: Payload): MiniUserAssetStore {
  return {
    async findByAssetKey(assetKey) {
      const result = await payload.find({
        collection: 'mini-user-assets',
        where: { assetKey: { equals: assetKey } },
        limit: 1,
        depth: 0,
        overrideAccess: true,
      })
      const doc = result.docs[0]
      return doc ? assetRecord(doc) : null
    },
    async create(data) {
      const doc = await payload.create({
        collection: 'mini-user-assets',
        data,
        overrideAccess: true,
      })
      const record = assetRecord(doc)
      if (!record) throw new Error('mini_user_asset_create_invalid')
      return record
    },
    async deleteExact(assetKey, subject, kind, target) {
      const result = await payload.delete({
        collection: 'mini-user-assets',
        where: {
          and: [
            { assetKey: { equals: assetKey } },
            { subject: { equals: subject } },
            { kind: { equals: kind } },
            { targetType: { equals: target.targetType } },
            { targetSlug: { equals: target.targetSlug } },
          ],
        },
        overrideAccess: true,
      })
      return result.docs.length
    },
    async findBySubject(subject) {
      const result = await payload.find({
        collection: 'mini-user-assets',
        where: { subject: { equals: subject } },
        depth: 1,
        pagination: false,
        sort: '-createdAt',
        select: {
          assetKey: true,
          subject: true,
          kind: true,
          targetType: true,
          targetSlug: true,
          lead: true,
          createdAt: true,
        },
        populate: { leads: { stage: true, status: true } },
        overrideAccess: true,
      })
      return result.docs.flatMap((doc) => {
        const record = assetRecord(doc)
        return record?.subject === subject ? [record] : []
      })
    },
  }
}

function safeListing(card: ListingCardViewModel, mediaOrigin: string): SafeListingFavorite {
  const mapped = mapMiniListingCard(card, mediaOrigin)
  return {
    slug: mapped.slug,
    title: mapped.title,
    citySlug: mapped.citySlug,
    cityName: mapped.cityName,
    price: mapped.price
      ? {
          amount: mapped.price.amount,
          currency: mapped.price.currency,
          businessType: mapped.price.businessType,
          period: mapped.price.period,
          basis: mapped.price.basis,
          displayUnit: mapped.price.displayUnit,
          text: mapped.price.text,
          monthlyEstimate: mapped.price.monthlyEstimate,
        }
      : null,
    area: mapped.area,
    seats: mapped.seats,
    listingType: {
      value: mapped.listingType.value,
      label: mapped.listingType.label,
    },
    availableFrom: mapped.availableFrom,
    building: mapped.building
      ? {
          slug: mapped.building.slug,
          name: mapped.building.name,
          address: mapped.building.address,
          district: mapped.building.district,
        }
      : null,
    coverImage: mapped.coverImage
      ? {
          src: mapped.coverImage.src,
          width: mapped.coverImage.width,
          height: mapped.coverImage.height,
          alt: mapped.coverImage.alt,
          blurDataURL: mapped.coverImage.blurDataURL,
        }
      : null,
    highlights: [...mapped.highlights],
  }
}

function safeBuilding(card: BuildingDetailViewModel, mediaOrigin: string): SafeBuildingFavorite {
  const mapped = mapMiniBuildingCard({
    id: card.id,
    slug: card.slug,
    name: card.name,
    address: card.address,
    citySlug: card.citySlug,
    cityName: card.cityName,
    grade: card.grade,
    district: card.district,
    coverImage: card.coverImage ?? undefined,
    nearestMetro: card.nearestMetro,
  }, mediaOrigin)
  return {
    slug: mapped.slug,
    name: mapped.name,
    district: mapped.district,
    address: mapped.address,
    grade: mapped.grade,
    completedYear: mapped.completedYear,
    totalFloors: mapped.totalFloors,
    occupancyRate: mapped.occupancyRate,
    activeListingCount: mapped.activeListingCount,
    priceRange: mapped.priceRange
      ? {
          min: mapped.priceRange.min,
          max: mapped.priceRange.max,
          unit: mapped.priceRange.unit,
          displayUnit: mapped.priceRange.displayUnit,
          text: mapped.priceRange.text,
        }
      : null,
    coverImage: mapped.coverImage
      ? {
          src: mapped.coverImage.src,
          width: mapped.coverImage.width,
          height: mapped.coverImage.height,
          alt: mapped.coverImage.alt,
          blurDataURL: mapped.coverImage.blurDataURL,
        }
      : null,
    nearestMetro: mapped.nearestMetro
      ? {
          station: mapped.nearestMetro.station,
          line: mapped.nearestMetro.line,
          distanceMeters: mapped.nearestMetro.distanceMeters,
        }
      : null,
  }
}

function populatedLead(value: unknown): Readonly<{ stage: unknown; status: unknown }> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const stage = Object.getOwnPropertyDescriptor(value, 'stage')?.value
  const status = Object.getOwnPropertyDescriptor(value, 'status')?.value
  return {
    stage,
    status,
  }
}

function safeLeadStatus(value: unknown): MiniInquiryHistoryItem['status'] | null {
  const lead = populatedLead(value)
  if (!lead) return null
  const stage = isLeadStage(lead.stage)
    ? lead.stage
    : (typeof lead.status === 'string' ? mapLegacyStatusToStage(lead.status) : null)
  return stage ? { value: stage, label: LEAD_STAGE_LABELS[stage] } : null
}

export async function projectMiniMeData(
  assets: readonly MiniUserAssetRecord[],
  deps: MiniMeProjectionDeps,
): Promise<MiniMeData> {
  const listingFavorites: SafeListingFavorite[] = []
  const buildingFavorites: SafeBuildingFavorite[] = []
  const inquiries: MiniInquiryHistoryItem[] = []

  for (const asset of assets) {
    if (asset.kind === 'favorite-listing' && asset.targetType === 'listing' && asset.targetSlug) {
      const listing = await deps.resolveListing(asset.targetSlug)
      if (listing) listingFavorites.push(safeListing(listing, deps.mediaOrigin))
      continue
    }
    if (asset.kind === 'favorite-building' && asset.targetType === 'building' && asset.targetSlug) {
      const building = await deps.resolveBuilding(asset.targetSlug)
      if (building) buildingFavorites.push(safeBuilding(building, deps.mediaOrigin))
      continue
    }
    if (asset.kind !== 'inquiry') continue

    const status = safeLeadStatus(asset.lead)
    if (!status) continue
    let targetTitle = '通用找房需求'
    if (asset.targetType === 'listing') {
      if (!asset.targetSlug) continue
      const listing = await deps.resolveListing(asset.targetSlug)
      targetTitle = listing?.title ?? '房源已失效'
    } else if (asset.targetType === 'building') {
      if (!asset.targetSlug) continue
      const building = await deps.resolveBuilding(asset.targetSlug)
      targetTitle = building?.name ?? '楼盘已失效'
    }
    inquiries.push({
      targetType: asset.targetType,
      targetSlug: asset.targetSlug,
      targetTitle,
      submittedAt: asset.createdAt,
      status,
    })
  }

  return {
    counts: {
      favorites: listingFavorites.length + buildingFavorites.length,
      inquiries: inquiries.length,
    },
    favorites: { listings: listingFavorites, buildings: buildingFavorites },
    inquiries,
  }
}
