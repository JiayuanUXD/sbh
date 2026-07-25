/**
 * 楼盘有效房源聚合（tasks.md M3.4「展示有效房源套数、面积和租金聚合」/ design §5.5, R3）
 *
 * 口径（M3 过渡）：只统计符合有效供给过渡谓词的房源——
 *   status='available' + building.operationalStatus='active' + deletedAt exists:false，
 * 与 filters.ts / building-references.ts 的过渡口径一致（完整 10 条谓词待 M4.7 接入）。
 *
 * 聚合三项：
 *   - 套数：payload.count（只需 totalDocs）。
 *   - 面积：payload.find + JS reduce，按 ㎡ 直接 SUM（单位统一，可合并）。
 *   - 租金：按 rentUnit 分组求 min/max——三种单位语义不同，跨单位绝不合并
 *     （design §5.5，镜像 public-catalog/facade.ts buildPriceRangesByUnit）。
 *
 * 与 building-references.ts 同构：依赖 payload（副作用），单测 mock count/find。
 * 关系型数据经 unknown + 守卫读取，禁 any。
 */

import type { Payload, PayloadRequest, Where } from 'payload'

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

/** find 的取数上限,对齐 supply-adapter 的分页上限，避免大楼盘一次拉爆。 */
const AGGREGATE_FIND_LIMIT = 200

/**
 * 有效供给过渡谓词（楼盘侧聚合专用）。此处内联而非复用 building.ts 的
 * listingBuildingOperationalWhere()，因为聚合还需叠加 building/status/deletedAt，
 * 三处口径合成为一个完整 where，语义集中于本函数便于 M4.7 整体替换。
 */
function aggregateWhere(buildingId: number | string): Where {
  return {
    building: { equals: buildingId },
    status: { equals: 'available' },
    'building.operationalStatus': { equals: 'active' },
    deletedAt: { exists: false },
  }
}

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
 *                               透传给 count 与 find,与 building-references 约定一致。
 */
export async function computeBuildingSupplyAggregate(
  payload: Payload,
  buildingId: number | string,
  req?: PayloadRequest,
  options?: { overrideAccess?: boolean },
): Promise<BuildingSupplyAggregate> {
  const overrideAccess = options?.overrideAccess ?? false
  const where = aggregateWhere(buildingId)

  const [countRes, findRes] = await Promise.all([
    payload.count({ collection: 'listings', where, overrideAccess, req }),
    payload.find({
      collection: 'listings',
      where,
      overrideAccess,
      req,
      pagination: false,
      limit: AGGREGATE_FIND_LIMIT,
      depth: 0,
    }),
  ])

  let totalArea = 0
  const rentGroups = new Map<string, { min: number; max: number; count: number }>()

  for (const raw of findRes.docs as unknown[]) {
    if (typeof raw !== 'object' || raw === null) continue
    const doc = raw as Record<string, unknown>

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

  return { buildingId, count: countRes.totalDocs, totalArea, rentRanges }
}
