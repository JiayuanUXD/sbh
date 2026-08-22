/**
 * 楼盘停用影响预检（tasks.md M3.5 → M4.7「统一有效供给查询」/ R3, R4, R8）
 *
 * 口径：停用某楼盘会从前台有效供给中撤除该楼盘下「当前对外可见」的房源，这里统计其
 * 数量，供 UI 在停用前二次确认展示。停用不阻断（人为决策），也不改写任何房源的审核 /
 * 发布状态——仅撤销有效供给谓词的楼盘侧可用性（design §9/§10, R3）。
 *
 * M4.7：度量口径与前台 / 详情 / 楼盘聚合完全一致——查询层 getEffectiveSupplyWhere
 * （§1-4 状态 + §7 楼盘/城市/行政区在营）粗筛 + building 约束 + §5 举报暂停 not_in
 * 排除，取候选后逐条 resolveEffectiveSupply 精筛（商户 §8-§10，OPT-034 起直接读
 * listings.merchant）。count = 精筛后长度（精筛现在是纯内存计算，不再查
 * listing-merchant-relations，但仍需逐条判定才能拿到 eligible 子集，不用 payload.count）。
 *
 * MVP 计数口径：取候选（limit LISTING_CANDIDATE_CAP=500）后精筛数长度；>500 会封顶
 * （后续优化点，与 supply-adapter / building-aggregate 一致）。关系型数据经 unknown +
 * 守卫读取，禁 any。
 */

import type { Payload, PayloadRequest, Where } from 'payload'

import {
  getEffectiveSupplyWhere,
  getPausedListingIds,
  type PayloadQueryPort,
} from '@/domain/review/effective-supply'
import { resolveEffectiveSupply } from '@/domain/review/effective-supply-snapshot'

export type BuildingReferenceSource = {
  collection: string
  label: string
  count: number
}

export type BuildingDeactivationImpactReport = {
  buildingId: number | string
  sources: BuildingReferenceSource[]
  total: number
  referenced: boolean
}

/** 候选房源上限：MVP 内存精筛口径，超过封顶（后续优化点，与 supply-adapter 对齐）。 */
const LISTING_CANDIDATE_CAP = 500

/**
 * 统计停用某楼盘的受影响房源数量（分来源聚合）。
 *
 * 当前唯一来源是该楼盘下有效供给房源：停用后随楼盘从前台消失。房源与楼盘的其他关系型
 * collection 建立后可同法登记为新来源。
 *
 * @param options.overrideAccess 「停用影响」展示按数据权限脱敏，默认 false；
 *                               需全量统计（如后台完整性视图）时传 true。
 */
export async function countBuildingDeactivationImpact(
  payload: Payload,
  buildingId: number | string,
  req?: PayloadRequest,
  options?: { overrideAccess?: boolean },
): Promise<BuildingDeactivationImpactReport> {
  const overrideAccess = options?.overrideAccess ?? false
  // 楼盘停用预检取"现在"为基准；查询层谓词与 asOf 无关，精筛的关系/资质有效期需基准时刻。
  const asOf = new Date()
  const port = payload as unknown as PayloadQueryPort

  // §5 举报暂停：查 listing-reports 拿被暂停 ID，not_in 排除。
  const pausedIds = await getPausedListingIds(port)

  const where: Where = {
    building: { equals: buildingId },
    ...(getEffectiveSupplyWhere(asOf) as Where),
    ...(pausedIds.length > 0 ? { id: { not_in: pausedIds } } : {}),
  }

  const findRes = await payload.find({
    collection: 'listings',
    where,
    overrideAccess,
    req,
    pagination: false,
    limit: LISTING_CANDIDATE_CAP,
    depth: 2, // building + merchant + gallery，供精筛判定
  })

  let effectiveCount = 0
  for (const raw of findRes.docs as unknown[]) {
    if (typeof raw !== 'object' || raw === null) continue
    const supply = await resolveEffectiveSupply(port, raw as Record<string, unknown>, asOf, req)
    if (supply.eligible) effectiveCount += 1
  }

  const sources: BuildingReferenceSource[] =
    effectiveCount > 0
      ? [{ collection: 'listings', label: '对外可见房源', count: effectiveCount }]
      : []
  const total = effectiveCount
  return { buildingId, sources, total, referenced: total > 0 }
}
