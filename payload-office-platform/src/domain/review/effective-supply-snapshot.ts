/**
 * 有效供给精筛快照助手（tasks.md M4.7 / design §3.6 / R3, R4, R7）
 *
 * 这些助手原先内联在 listing-publish-endpoint.ts，M4.7 提取为共享模块，供
 * 发布 endpoint 与 C 端 PayloadSupplyAdapter 复用同一套「已解析文档 → 精筛」口径，
 * 确保前台、预览、楼盘聚合、Dashboard 对同一房源的可见性结论一致（M4 验收门）。
 *
 * OPT-034 起供给商户不再经由 listing-merchant-relations 关系表解析：`buildEffectiveSnapshot`
 * 直接读已解析（depth≥1）房源文档上的 `listing.merchant`，`resolveEffectiveSupply` /
 * `resolveEffectiveSupplies` 因此不再查关系表，也不再需要额外的关系加载步骤——
 * `payload` / `req` 参数仅为保持既有调用方（发布 endpoint、楼盘聚合/预检、Dashboard、
 * C 端适配器）签名不变而保留，函数体内不再使用。
 *
 * 分层：
 *   - toId：关系字段（number|string|{id}）归一为 id。
 *   - buildEffectiveSnapshot：depth≥1 已展开的房源文档 → EffectiveSupplySnapshot 精筛入参。
 *   - resolveEffectiveSupply / resolveEffectiveSupplies：建快照 + isListingEffectivelySupplied 精筛。
 */

import {
  isListingEffectivelySupplied,
  type EffectiveSupplyResult,
  type EffectiveSupplySnapshot,
  type PayloadQueryPort,
} from '@/domain/review/effective-supply'

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

/**
 * 从已解析（depth≥1）房源文档构造有效供给精筛快照。
 *
 * 商户直接读 `listing.merchant`：非 null 对象（depth≥1 展开形态）才视为「已设置
 * 供给商户」；缺失、null，或仍是裸 id（depth=0，未展开）都取 null——精筛层据此
 * 判 NO_SUPPLY_MERCHANT。裸 id 场景理论上不该发生（本函数的前提就是 depth≥1 已
 * 展开的文档），出现即视为调用方误用，fail closed 比默默按未设置商户合格更安全。
 */
export function buildEffectiveSnapshot(
  listing: Record<string, unknown>,
): EffectiveSupplySnapshot {
  const building = (listing.building ?? null) as Record<string, unknown> | null
  const merchantRaw = listing.merchant
  const merchant =
    typeof merchantRaw === 'object' && merchantRaw !== null
      ? (merchantRaw as Record<string, unknown>)
      : null
  const serviceCities =
    merchant && Array.isArray(merchant.serviceCities) ? merchant.serviceCities : []
  return {
    merchant:
      merchant === null
        ? null
        : {
            id: toId(merchant),
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
  }
}

/**
 * 一站式有效供给精筛：建快照 → isListingEffectivelySupplied。
 * 逐条回显不合格原因（商户 §8-§10）。
 *
 * 注意：仅覆盖精筛层（查询层 §1-§4、§7 由 getEffectiveSupplyWhere 在库侧保证；
 * §5 举报暂停由 getPausedListingIds 在调用方排除）。`payload` / `req` 保留只为
 * 兼容既有调用签名（listing-publish-endpoint.ts、building-aggregate.ts 等），
 * 精筛本身不再需要查库。
 */
export async function resolveEffectiveSupply(
  _payload: PayloadQueryPort,
  listing: Record<string, unknown>,
  asOf: Date,
  _req?: unknown,
): Promise<EffectiveSupplyResult> {
  const snapshot = buildEffectiveSnapshot(listing)
  return isListingEffectivelySupplied(snapshot, asOf)
}

/**
 * 批量解析候选房源的有效供给结果。
 *
 * OPT-034 前需要一次批量关系查询避免 N+1；现在商户已经在 depth≥1 的房源文档上，
 * 纯内存计算，不再有查询、自然也不再有 N+1 问题。
 */
export async function resolveEffectiveSupplies(
  _payload: PayloadQueryPort,
  listings: readonly Record<string, unknown>[],
  asOf: Date,
  _req?: unknown,
): Promise<ReadonlyMap<string, EffectiveSupplyResult>> {
  const results = new Map<string, EffectiveSupplyResult>()
  for (const listing of listings) {
    const listingId = toId(listing.id)
    if (listingId === null) continue
    const snapshot = buildEffectiveSnapshot(listing)
    results.set(String(listingId), isListingEffectivelySupplied(snapshot, asOf))
  }
  return results
}
