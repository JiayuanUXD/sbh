/**
 * 有效供给精筛快照助手（tasks.md M4.7 / design §3.6 / R3, R4, R7）
 *
 * 这些助手原先内联在 listing-publish-endpoint.ts，M4.7 提取为共享模块，供
 * 发布 endpoint 与 C 端 PayloadSupplyAdapter 复用同一套「已解析文档 → 精筛」口径，
 * 确保前台、预览、楼盘聚合、Dashboard 对同一房源的可见性结论一致（M4 验收门）。
 *
 * 分层：
 *   - toId：关系字段（number|string|{id}）归一为 id。
 *   - buildEffectiveSnapshot：depth≥1 已展开的房源文档 → EffectiveSupplySnapshot 精筛入参。
 *   - loadRelationPeriod：查当前生效的房源-商户关系区间（按 -effectiveFrom 取最近一条）。
 *   - resolveEffectiveSupply：一站式（载关系 + 建快照 + isListingEffectivelySupplied 精筛）。
 *
 * 依赖注入 payload.find（PayloadQueryPort 端口），便于单测 mock，无 React 依赖。
 */

import {
  isListingEffectivelySupplied,
  type EffectiveSupplyResult,
  type EffectiveSupplySnapshot,
  type PayloadQueryPort,
} from '@/domain/review/effective-supply'
import { toRelationPeriod } from '@/domain/supply/building-merchant-relation'
import type { ValidityPeriod } from '@/domain/shared/validity'

/** 关系字段归一为 id（number|string 直接返回；对象取 id；否则 null）。 */
export function toId(value: unknown): number | string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number' || typeof value === 'string') return value
  if (typeof value === 'object') {
    const id = (value as { id?: unknown }).id
    if (typeof id === 'number' || typeof id === 'string') return id
  }
  return null
}

/** 从已解析（depth≥1）房源文档构造有效供给精筛快照。 */
export function buildEffectiveSnapshot(
  listing: Record<string, unknown>,
  relationPeriod: ValidityPeriod | null,
  relationMerchant?: Record<string, unknown> | null,
): EffectiveSupplySnapshot {
  const building = (listing.building ?? null) as Record<string, unknown> | null
  const merchant = relationMerchant ?? ((listing.merchant ?? {}) as Record<string, unknown>)
  const serviceCities = Array.isArray(merchant.serviceCities) ? merchant.serviceCities : []
  return {
    merchant: {
      status: merchant.status,
      qualificationStatus: merchant.qualificationStatus,
      qualificationExpiresAt: (merchant.qualificationExpiresAt ?? null) as
        | string
        | Date
        | null
        | undefined,
      serviceCityIds: serviceCities
        .map((c) => toId(c))
        .filter((id): id is number | string => id !== null),
    },
    buildingCityId: building ? toId(building.city) : null,
    relationPeriod,
  }
}

type EffectiveRelation = {
  period: ValidityPeriod
  merchant: Record<string, unknown> | null
}

const RELATION_QUERY_PAGE_SIZE = 1_000

function nextEffectiveRelationPage(
  result: Awaited<ReturnType<PayloadQueryPort['find']>>,
  currentPage: number,
): number | null {
  const { hasNextPage, nextPage } = result
  const hasPaginationMetadata = hasNextPage !== undefined || nextPage !== undefined
  const hasValidHasNextPage = hasNextPage === undefined || typeof hasNextPage === 'boolean'

  if (!hasPaginationMetadata || !hasValidHasNextPage) {
    throw new Error('invalid effective-relation pagination metadata')
  }

  if (nextPage !== undefined) {
    if (nextPage === null) {
      if (hasNextPage === true) {
        throw new Error('invalid effective-relation pagination metadata')
      }
      return null
    }
    if (
      hasNextPage === false ||
      !Number.isSafeInteger(nextPage) ||
      nextPage <= currentPage
    ) {
      throw new Error('invalid effective-relation pagination metadata')
    }
    return nextPage
  }

  if (hasNextPage === true) {
    const followingPage = currentPage + 1
    if (!Number.isSafeInteger(followingPage)) {
      throw new Error('invalid effective-relation pagination metadata')
    }
    return followingPage
  }
  if (hasNextPage === false) return null

  throw new Error('invalid effective-relation pagination metadata')
}

/**
 * 批量查询多个房源在指定时刻生效的商户关系。
 *
 * 关系按归一化后的 listing ID 分组；只有恰好一条当前生效关系才会写入结果。
 * 缺失、重叠或无效的关系均不返回，以便调用方 fail closed。
 */
export async function loadEffectiveRelations(
  payload: PayloadQueryPort,
  listings: readonly Record<string, unknown>[],
  asOf: Date,
  req?: unknown,
): Promise<ReadonlyMap<string, EffectiveRelation>> {
  const listingIds = [...new Set(
    listings
      .map((listing) => toId(listing.id))
      .filter((id): id is number | string => id !== null),
  )]
  const grouped = new Map<string, EffectiveRelation[]>()
  const rawRelationCounts = new Map<string, number>()

  if (listingIds.length === 0) return new Map()

  const instant = asOf.toISOString()
  let page = 1
  while (true) {
    const result = await payload.find({
      collection: 'listing-merchant-relations',
      where: {
        and: [
          { listing: { in: listingIds } },
          { effectiveFrom: { less_than_equal: instant } },
          {
            or: [
              { effectiveTo: { exists: false } },
              { effectiveTo: { greater_than: instant } },
            ],
          },
        ],
      },
      sort: '-effectiveFrom',
      limit: RELATION_QUERY_PAGE_SIZE,
      page,
      depth: 1,
      overrideAccess: true,
      ...(req !== undefined ? { req } : {}),
    })

    for (const relation of result.docs) {
      const listingId = toId(relation.listing)
      if (listingId === null) continue
      const key = String(listingId)
      rawRelationCounts.set(key, (rawRelationCounts.get(key) ?? 0) + 1)
      try {
        const candidate: EffectiveRelation = {
          period: toRelationPeriod(
            relation.effectiveFrom as string | Date | null | undefined,
            relation.effectiveTo as string | Date | null | undefined,
          ),
          merchant:
            typeof relation.merchant === 'object' && relation.merchant !== null
              ? relation.merchant as Record<string, unknown>
              : null,
        }
        grouped.set(key, [...(grouped.get(key) ?? []), candidate])
      } catch {
        // Invalid periods fail closed below.
      }
    }

    const nextPage = nextEffectiveRelationPage(result, page)
    if (nextPage === null) break
    page = nextPage
  }

  const unique = new Map<string, EffectiveRelation>()
  for (const [listingId, relations] of grouped) {
    if (rawRelationCounts.get(listingId) === 1 && relations.length === 1) {
      unique.set(listingId, relations[0])
    }
  }
  return unique
}

async function loadEffectiveRelation(
  payload: PayloadQueryPort,
  listingId: number | string,
  asOf: Date,
  req?: unknown,
): Promise<EffectiveRelation | null> {
  const instant = asOf.toISOString()
  const res = await payload.find({
    collection: 'listing-merchant-relations',
    where: {
      and: [
        { listing: { equals: listingId } },
        { effectiveFrom: { less_than_equal: instant } },
        {
          or: [
            { effectiveTo: { exists: false } },
            { effectiveTo: { greater_than: instant } },
          ],
        },
      ],
    },
    sort: '-effectiveFrom',
    limit: 2,
    depth: 2,
    overrideAccess: true,
    ...(req !== undefined ? { req } : {}),
  })

  // Zero or overlapping active relations are both invalid supply facts.
  if (res.docs.length !== 1) return null
  const doc = res.docs[0]
  try {
    const merchant =
      typeof doc.merchant === 'object' && doc.merchant !== null
        ? (doc.merchant as Record<string, unknown>)
        : null
    return {
      period: toRelationPeriod(
        doc.effectiveFrom as string | Date | null | undefined,
        doc.effectiveTo as string | Date | null | undefined,
      ),
      merchant,
    }
  } catch {
    return null
  }
}

/**
 * 查询房源当前生效的商户关系区间：listing 命中、按 effectiveFrom 降序取最近一条，
 * 转 ValidityPeriod。无记录或时刻非法 → null（精筛层据此判 RELATION_NOT_EFFECTIVE）。
 *
 * @param payload  Payload Local API 查询端口（真实环境 req.payload；测试用 mock）。
 * @param listingId 房源 ID。
 * @param req      可选 PayloadRequest，透传以走登录态查询（endpoint 场景）；C 端不传。
 */
export async function loadRelationPeriod(
  payload: PayloadQueryPort,
  listingId: number | string,
  req?: unknown,
): Promise<ValidityPeriod | null> {
  const res = await payload.find({
    collection: 'listing-merchant-relations',
    where: { listing: { equals: listingId } },
    sort: '-effectiveFrom',
    limit: 1,
    depth: 0,
    ...(req !== undefined ? { req } : {}),
  })
  const doc = res.docs[0]
  if (!doc) return null
  try {
    return toRelationPeriod(
      doc.effectiveFrom as string | Date | null | undefined,
      doc.effectiveTo as string | Date | null | undefined,
    )
  } catch {
    return null
  }
}

/**
 * 一站式有效供给精筛：载关系区间 → 建快照 → isListingEffectivelySupplied。
 * 逐条回显不合格原因（媒体 §6 / 关系 §8 / 商户 §9-§10）。
 *
 * 注意：仅覆盖精筛层（查询层 §1-§4、§7 由 getEffectiveSupplyWhere 在库侧保证；
 * §5 举报暂停由 getPausedListingIds 在调用方排除）。
 */
export async function resolveEffectiveSupply(
  payload: PayloadQueryPort,
  listing: Record<string, unknown>,
  asOf: Date,
  req?: unknown,
): Promise<EffectiveSupplyResult> {
  const listingId = toId(listing.id)
  const relation =
    listingId === null ? null : await loadEffectiveRelation(payload, listingId, asOf, req)
  const snapshot = buildEffectiveSnapshot(
    listing,
    relation?.period ?? null,
    relation?.merchant ?? {},
  )
  return isListingEffectivelySupplied(snapshot, asOf)
}

/**
 * 批量解析候选房源的有效供给结果，避免逐条查询关系造成 N+1。
 *
 * 每个房源均使用 `loadEffectiveRelations` 的 exact-one 结果；没有唯一当前关系的
 * 房源以空关系快照参与判定，因此保持 fail-closed 语义。
 */
export async function resolveEffectiveSupplies(
  payload: PayloadQueryPort,
  listings: readonly Record<string, unknown>[],
  asOf: Date,
  req?: unknown,
): Promise<ReadonlyMap<string, EffectiveSupplyResult>> {
  const relations = await loadEffectiveRelations(payload, listings, asOf, req)
  const results = new Map<string, EffectiveSupplyResult>()
  for (const listing of listings) {
    const listingId = toId(listing.id)
    if (listingId === null) continue
    const relation = relations.get(String(listingId)) ?? null
    const snapshot = buildEffectiveSnapshot(
      listing,
      relation?.period ?? null,
      relation?.merchant ?? {},
    )
    results.set(String(listingId), isListingEffectivelySupplied(snapshot, asOf))
  }
  return results
}
