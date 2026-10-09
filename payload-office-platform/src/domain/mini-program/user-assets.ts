import { createHash } from 'node:crypto'

import { sql, type SQL } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { createLocalReq, type Payload, type PayloadRequest } from 'payload'

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
import { assertTransactionIntact } from '@/domain/shared/transaction-safety'

const MAX_BEARER_LENGTH = 4096
const FAVORITE_SUBJECT_LOCK_DOMAIN = 'sbh:mini-program:favorite-subject-limit:v1\0'
export const MINI_FAVORITES_PER_SUBJECT_LIMIT = 200
export const MINI_ME_FAVORITES_PAGE_LIMIT = MINI_FAVORITES_PER_SUBJECT_LIMIT
export const MINI_ME_INQUIRIES_PAGE_LIMIT = 100

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

export type MiniUserAssetPage = Readonly<{
  records: readonly MiniUserAssetRecord[]
  hasMore: boolean
}>

export type MiniInquiryLinkTarget = MiniInquiryTarget

export interface MiniUserAssetStore {
  runFavoriteSubjectTransaction<T>(
    subject: string,
    action: (transactionStore: MiniUserAssetStore) => Promise<T>,
  ): Promise<T>
  findByAssetKey(assetKey: string): Promise<MiniUserAssetRecord | null>
  create(data: MiniUserAssetCreate): Promise<MiniUserAssetRecord>
  countBySubjectAndKinds(
    subject: string,
    kinds: readonly MiniUserAssetKind[],
  ): Promise<number>
  deleteExact(
    assetKey: string,
    subject: string,
    kind: MiniUserAssetKind,
    target: MiniFavoriteTarget,
  ): Promise<number>
  findBySubjectAndKinds(
    subject: string,
    kinds: readonly MiniUserAssetKind[],
    limit: number,
  ): Promise<MiniUserAssetPage>
}

type TransactionIdentifier = number | string

type TransactionExecutor = Readonly<{
  execute(statement: SQL): Promise<unknown>
}>

function transactionUnavailable(): Error {
  return new Error('mini_user_asset_transaction_unavailable')
}

function transactionIdentifier(value: unknown): TransactionIdentifier | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null
  }
  return typeof value === 'string' && value.trim() === value && value.length > 0
    ? value
    : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function transactionExecutor(
  payload: Payload,
  transactionID: TransactionIdentifier,
): TransactionExecutor | null {
  const session = payload.db.sessions?.[String(transactionID)]
  if (!session || !isRecord(session.db) || typeof session.db.execute !== 'function') return null
  return session.db as TransactionExecutor
}

function lockConfirmed(value: unknown): boolean {
  return isRecord(value)
    && Array.isArray(value.rows)
    && value.rows.length === 1
    && isRecord(value.rows[0])
    && value.rows[0].locked === true
}

function favoriteSubjectLockKeys(subject: string): readonly [number, number] {
  const digest = createHash('sha256')
    .update(FAVORITE_SUBJECT_LOCK_DOMAIN, 'utf8')
    .update(subject, 'utf8')
    .digest()
  return [digest.readInt32BE(0), digest.readInt32BE(4)]
}

async function runPayloadFavoriteSubjectTransaction<T>(
  payload: Payload,
  subject: string,
  action: (store: MiniUserAssetStore) => Promise<T>,
): Promise<T> {
  const [key1, key2] = favoriteSubjectLockKeys(subject)
  let transactionID: TransactionIdentifier
  try {
    const parsed = transactionIdentifier(await payload.db.beginTransaction())
    if (parsed === null) throw transactionUnavailable()
    transactionID = parsed
  } catch {
    throw transactionUnavailable()
  }

  let transactionReq: PayloadRequest | null = null
  let actionFailure: unknown
  let commitAttempted = false
  let rollbackAttempted = false
  let committed = false

  const rollback = async (): Promise<void> => {
    rollbackAttempted = true
    if (transactionReq && transactionReq.transactionID !== transactionID) {
      throw transactionUnavailable()
    }
    try {
      await payload.db.rollbackTransaction(transactionID)
    } catch {
      throw transactionUnavailable()
    }
  }

  try {
    const executor = transactionExecutor(payload, transactionID)
    if (!executor) throw transactionUnavailable()
    let lockResult: unknown
    try {
      lockResult = await executor.execute(sql`
        SELECT pg_advisory_xact_lock(${key1}, ${key2}), true AS "locked"
      `)
    } catch {
      throw transactionUnavailable()
    }
    if (!lockConfirmed(lockResult)) throw transactionUnavailable()

    try {
      transactionReq = await createLocalReq({}, payload)
    } catch {
      throw transactionUnavailable()
    }
    transactionReq.transactionID = transactionID

    let value: T
    try {
      value = await action(createPayloadMiniUserAssetStore(payload, transactionReq))
    } catch (error) {
      actionFailure = error
      throw error
    }
    assertTransactionIntact(transactionReq, transactionID, 'mini-user-assets:favorite-subject')

    try {
      commitAttempted = true
      await payload.db.commitTransaction(transactionID)
      committed = true
    } catch {
      throw transactionUnavailable()
    }
    return value
  } catch (error) {
    if (!committed && !rollbackAttempted && !commitAttempted) await rollback()
    if (actionFailure !== undefined && error === actionFailure) throw error
    throw transactionUnavailable()
  } finally {
    if (transactionReq) delete transactionReq.transactionID
  }
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
  pageInfo: Readonly<{
    favorites: Readonly<{ limit: number; hasMore: boolean }>
    inquiries: Readonly<{ limit: number; hasMore: boolean }>
  }>
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
  maxFavorites: number = MINI_FAVORITES_PER_SUBJECT_LIMIT,
): Promise<Readonly<{ created: boolean; assetKey: string }>> {
  if (
    !Number.isSafeInteger(maxFavorites)
    || maxFavorites < 1
    || maxFavorites > MINI_FAVORITES_PER_SUBJECT_LIMIT
  ) {
    throw new Error('mini_user_asset_limit_invalid')
  }
  const result = await store.runFavoriteSubjectTransaction(
    subject,
    (transactionStore) => upsertFavoriteLocked(transactionStore, subject, target, maxFavorites),
  )
  if (!result.created) return result

  // Payload 3.86 的 commitTransaction 可能吞掉底层 COMMIT 失败。
  // 必须用未绑定事务的 store 回读；当前 PG 配置无只读副本，Local API 直读主库。
  // 精确比对本次创建的行，不能把另一请求随后创建的同 key 行当成本次提交成功。
  try {
    const confirmed = await store.findByAssetKey(result.assetKey)
    if (
      !confirmed
      || confirmed.assetKey !== result.assetKey
      || !isExactFavoriteRecord(confirmed, subject, favoriteKind(target.targetType), target)
      || transactionIdentifier(confirmed.databaseId) === null
      || confirmed.databaseId !== result.record.databaseId
      || !Number.isFinite(Date.parse(confirmed.createdAt))
      || confirmed.createdAt !== result.record.createdAt
      || confirmed.lead !== null
    ) {
      throw transactionUnavailable()
    }
  } catch {
    // 提交已尝试：不重放写入，也不把 rollback 当补偿。
    throw transactionUnavailable()
  }
  return { created: true, assetKey: result.assetKey }
}

async function upsertFavoriteLocked(
  store: MiniUserAssetStore,
  subject: string,
  target: MiniFavoriteTarget,
  maxFavorites: number,
): Promise<
  | Readonly<{ created: false; assetKey: string }>
  | Readonly<{ created: true; assetKey: string; record: MiniUserAssetRecord }>
> {
  const kind = favoriteKind(target.targetType)
  const assetKey = computeMiniUserAssetKey(subject, kind, target.targetType, target.targetSlug)
  const existing = await store.findByAssetKey(assetKey)
  if (existing) {
    if (isExactFavoriteRecord(existing, subject, kind, target)) {
      return { created: false, assetKey }
    }
    throw new Error('mini_user_asset_key_collision')
  }

  const favoriteCount = await store.countBySubjectAndKinds(
    subject,
    ['favorite-listing', 'favorite-building'],
  )
  if (favoriteCount >= maxFavorites) throw new Error('mini_user_asset_limit_reached')

  try {
    const record = await store.create({
      assetKey,
      subject,
      kind,
      targetType: target.targetType,
      targetSlug: target.targetSlug,
    })
    return { created: true, assetKey, record }
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

function computeMiniInquiryAssetKey(
  subject: string,
  lead: number,
  target: MiniInquiryLinkTarget,
): string {
  return createHash('sha256')
    .update(JSON.stringify([
      subject,
      'inquiry',
      target.targetType,
      inquiryTargetSlug(target),
      lead,
    ]), 'utf8')
    .digest('hex')
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
  if (!Number.isSafeInteger(lead) || lead <= 0) {
    throw new Error('mini_inquiry_lead_invalid')
  }
  const targetSlug = inquiryTargetSlug(target)
  const assetKey = computeMiniInquiryAssetKey(subject, lead, target)
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

export function createPayloadMiniUserAssetStore(
  payload: Payload,
  transactionReq: PayloadRequest | null = null,
): MiniUserAssetStore {
  return {
    async runFavoriteSubjectTransaction(subject, action) {
      if (transactionReq) throw transactionUnavailable()
      return runPayloadFavoriteSubjectTransaction(payload, subject, action)
    },
    async findByAssetKey(assetKey) {
      const result = await payload.find({
        collection: 'mini-user-assets',
        where: { assetKey: { equals: assetKey } },
        limit: 1,
        depth: 0,
        overrideAccess: true,
        req: transactionReq ?? undefined,
      })
      const doc = result.docs[0]
      return doc ? assetRecord(doc) : null
    },
    async create(data) {
      const doc = await payload.create({
        collection: 'mini-user-assets',
        data,
        overrideAccess: true,
        req: transactionReq ?? undefined,
      })
      const record = assetRecord(doc)
      if (!record) throw new Error('mini_user_asset_create_invalid')
      return record
    },
    async countBySubjectAndKinds(subject, kinds) {
      const result = await payload.count({
        collection: 'mini-user-assets',
        where: {
          and: [
            { subject: { equals: subject } },
            { kind: { in: [...kinds] } },
          ],
        },
        overrideAccess: true,
        req: transactionReq ?? undefined,
      })
      return result.totalDocs
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
        req: transactionReq ?? undefined,
      })
      return result.docs.length
    },
    async findBySubjectAndKinds(subject, kinds, limit) {
      if (
        !Number.isSafeInteger(limit)
        || limit < 1
        || limit > MINI_ME_FAVORITES_PAGE_LIMIT
        || kinds.length < 1
        || kinds.some((kind) => !isAssetKind(kind))
      ) {
        throw new Error('mini_user_asset_query_limit_invalid')
      }
      const result = await payload.find({
        collection: 'mini-user-assets',
        where: {
          and: [
            { subject: { equals: subject } },
            { kind: { in: [...kinds] } },
          ],
        },
        depth: 1,
        limit: limit + 1,
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
        req: transactionReq ?? undefined,
      })
      const records = result.docs.slice(0, limit).flatMap((doc) => {
        const record = assetRecord(doc)
        return record?.subject === subject && kinds.includes(record.kind) ? [record] : []
      })
      return { records, hasMore: result.docs.length > limit }
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
  pageInfo: MiniMeData['pageInfo'],
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
    pageInfo,
    favorites: { listings: listingFavorites, buildings: buildingFavorites },
    inquiries,
  }
}
