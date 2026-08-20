/**
 * 楼盘有效房源聚合（tasks.md M3.4 → M4.7「统一有效供给查询」/ design §5.5, R3）
 *
 * M4.7 口径：统计口径与前台 / 详情 / 楼盘页完全一致（M4 验收门）——
 *   查询层 getEffectiveSupplyWhere（§1-4 状态 + §7 楼盘/城市/行政区在营）粗筛，
 *   叠加 building 约束 + §5 举报暂停 not_in 排除，取候选后逐条 resolveEffectiveSupply
 *   精筛（商户 §8-§10，OPT-034 起直接读 listings.merchant），在精筛结果上算
 *   count/面积/租金。
 *
 * 聚合三项：
 *   - 套数：精筛后有效房源数（不再走 payload.count；精筛现在是纯内存计算，
 *     不查库，但仍需逐条判定才能拿到 eligible 子集，无法用纯 count 表达）。
 *   - 面积：按 ㎡ 直接 SUM（单位统一，可合并）。
 *   - 租金：按 rentUnit 分组求 min/max——三种单位语义不同,跨单位绝不合并
 *     （design §5.5，镜像 public-catalog/facade.ts buildPriceRangesByUnit）。
 *
 * MVP 计数口径：取候选（limit LISTING_CANDIDATE_CAP=500）后精筛数长度；
 *   >500 的超大楼盘会封顶,属后续优化点（与 supply-adapter 一致）。
 *
 * 依赖 payload（副作用），单测 mock find。关系型数据经 unknown + 守卫读取，禁 any。
 */

import type { Payload, PayloadRequest, Where } from 'payload'

import {
  getEffectiveSupplyWhere,
  getPausedListingIds,
  type PayloadQueryPort,
} from '@/domain/review/effective-supply'
import { resolveEffectiveSupply } from '@/domain/review/effective-supply-snapshot'

/** 单一 rentUnit 下的租金区间。 */
export type BuildingRentRange = {
  unit: string
  min: number
  max: number
  count: number
}

/** 楼盘有效房源聚合结果。 */
export type BuildingSupplyAggregate = {
  buildingId: number | string
  count: number
  totalArea: number
  rentRanges: BuildingRentRange[]
}

const LISTING_QUERY_PAGE_SIZE = 200

/** 安全读取有限数值,非数值/NaN/Infinity 返回 undefined。 */
function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** 安全读取非空字符串。 */
function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * 计算楼盘有效房源聚合。
 *
 * @param options.overrideAccess 聚合按数据权限脱敏,默认 false；需全量统计传 true。
 *                               透传给 listings find（后台卡片场景传 true）。
 */
export async function computeBuildingSupplyAggregate(
  payload: Payload,
  buildingId: number | string,
  req?: PayloadRequest,
  options?: { overrideAccess?: boolean },
): Promise<BuildingSupplyAggregate> {
  const overrideAccess = options?.overrideAccess ?? false
  // 楼盘卡片无 doc/req 侧 asOf，取"现在"；查询层谓词本身与 asOf 无关，
  // 精筛的关系/资质有效期需要一个基准时刻。
  const asOf = new Date()

  // 端口适配：楼盘聚合复用统一有效供给服务（举报暂停、逐条精筛）。
  const port = payload as unknown as PayloadQueryPort

  // §5 举报暂停：查 listing-reports 拿被暂停 ID，not_in 排除。
  const pausedIds = await getPausedListingIds(port)

  const where: Where = {
    building: { equals: buildingId },
    ...(getEffectiveSupplyWhere(asOf) as Where),
    ...(pausedIds.length > 0 ? { id: { not_in: pausedIds } } : {}),
  }

  const candidates: unknown[] = []
  let page = 1
  for (;;) {
    const findRes = await payload.find({
      collection: 'listings',
      where,
      overrideAccess,
      req,
      page,
      limit: LISTING_QUERY_PAGE_SIZE,
      depth: 2,
      sort: 'id',
    })
    candidates.push(...(findRes.docs as unknown[]))
    if (!findRes.hasNextPage || findRes.nextPage == null) break
    page = findRes.nextPage
  }

  let count = 0
  let totalArea = 0
  const rentGroups = new Map<string, { min: number; max: number; count: number }>()

  for (const raw of candidates) {
    if (typeof raw !== 'object' || raw === null) continue
    const doc = raw as Record<string, unknown>

    // 逐条精筛（媒体 §6 / 关系 §8 / 商户 §9-§10）——不合格不计入任一聚合。
    const supply = await resolveEffectiveSupply(port, doc, asOf, req)
    if (!supply.eligible) continue
    count += 1

    const area = readFiniteNumber(doc.area)
    if (area !== undefined) totalArea += area

    const rent = readFiniteNumber(doc.rent)
    const unit = readNonEmptyString(doc.rentUnit)
    if (rent !== undefined && unit !== undefined) {
      const existing = rentGroups.get(unit)
      if (existing) {
        existing.min = Math.min(existing.min, rent)
        existing.max = Math.max(existing.max, rent)
        existing.count += 1
      } else {
        rentGroups.set(unit, { min: rent, max: rent, count: 1 })
      }
    }
  }

  const rentRanges: BuildingRentRange[] = Array.from(rentGroups.entries()).map(([unit, r]) => ({
    unit,
    ...r,
  }))

  return { buildingId, count, totalArea, rentRanges }
}
