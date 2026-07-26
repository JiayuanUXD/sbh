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
  const gallery = Array.isArray(listing.gallery) ? listing.gallery : []
  const building = (listing.building ?? null) as Record<string, unknown> | null
  const merchant = relationMerchant ?? ((listing.merchant ?? {}) as Record<string, unknown>)
  const serviceCities = Array.isArray(merchant.serviceCities) ? merchant.serviceCities : []
  return {
    mediaCount: gallery.length,
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
  } as Parameters<PayloadQueryPort['find']>[0])

  // Zero or overlapping active relations are both invalid supply facts.
  if (res.docs.length !== 1) return null
  const doc = res.docs[0] as unknown as Record<string, unknown>
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
  } as Parameters<PayloadQueryPort['find']>[0])
  const doc = (res?.docs ?? [])[0] as unknown as Record<string, unknown> | undefined
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
