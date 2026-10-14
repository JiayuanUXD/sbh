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
 * 某组楼盘下「当前对外可见」的房源（粗筛 + 精筛后的 eligible 子集）。
 *
 * 单楼盘预检与批量预检（OPT-113）共用这一份：两者只差 building 约束是 equals 还是 in，
 * 谓词、举报暂停排除、精筛、候选上限全部同源。`capped` = 候选数触顶，计数只是下限。
 */
async function findEffectiveListingsOfBuildings(
  payload: Payload,
  buildingWhere: { equals: number | string } | { in: Array<number | string> },
  req: PayloadRequest | undefined,
  overrideAccess: boolean,
): Promise<{ eligible: Record<string, unknown>[]; capped: boolean }> {
  // 楼盘停用预检取"现在"为基准；查询层谓词与 asOf 无关，精筛的关系/资质有效期需基准时刻。
  const asOf = new Date()
  const port = payload as unknown as PayloadQueryPort

  // §5 举报暂停：查 listing-reports 拿被暂停 ID，not_in 排除。
  const pausedIds = await getPausedListingIds(port)

  const where: Where = {
    building: buildingWhere,
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

  const eligible: Record<string, unknown>[] = []
  for (const raw of findRes.docs as unknown[]) {
    if (typeof raw !== 'object' || raw === null) continue
    const doc = raw as Record<string, unknown>
    const supply = await resolveEffectiveSupply(port, doc, asOf, req)
    if (supply.eligible) eligible.push(doc)
  }
  return { eligible, capped: findRes.docs.length >= LISTING_CANDIDATE_CAP }
}

function sourcesOf(effectiveCount: number): BuildingReferenceSource[] {
  return effectiveCount > 0
    ? [{ collection: 'listings', label: '对外可见房源', count: effectiveCount }]
    : []
}

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
  const { eligible } = await findEffectiveListingsOfBuildings(
    payload,
    { equals: buildingId },
    req,
    options?.overrideAccess ?? false,
  )
  const total = eligible.length
  return { buildingId, sources: sourcesOf(total), total, referenced: total > 0 }
}

export type BuildingsDeactivationImpactReport = {
  sources: BuildingReferenceSource[]
  total: number
  /** 与入参同序，每个楼盘一行（没有受影响房源的也列出，count 为 0） */
  byBuilding: Array<{ buildingId: number | string; count: number }>
  /** 候选数触顶（LISTING_CANDIDATE_CAP），total 只是下限 */
  capped: boolean
}

/** relationship 值可能是 id，也可能是已展开的文档。 */
function relationId(value: unknown): number | string | null {
  if (typeof value === 'number' || typeof value === 'string') return value
  if (typeof value === 'object' && value !== null && 'id' in value) {
    const id = (value as { id: unknown }).id
    return typeof id === 'number' || typeof id === 'string' ? id : null
  }
  return null
}

/**
 * 批量停用预检（OPT-113）：一次查询汇总一组楼盘的受影响房源数，口径与单楼盘相同。
 *
 * 不逐个调 countBuildingDeactivationImpact：一页 100 个楼盘就是 100 次举报查询 + 100 次
 * depth:2 的房源查询，而这里是各一次。代价是候选上限对整组生效——触顶时 `capped` 为 true，
 * 界面据此把数字说成「至少」。
 */
export async function countBuildingsDeactivationImpact(
  payload: Payload,
  buildingIds: ReadonlyArray<number | string>,
  req?: PayloadRequest,
  options?: { overrideAccess?: boolean },
): Promise<BuildingsDeactivationImpactReport> {
  if (buildingIds.length === 0) {
    return { sources: [], total: 0, byBuilding: [], capped: false }
  }
  const { eligible, capped } = await findEffectiveListingsOfBuildings(
    payload,
    { in: [...buildingIds] },
    req,
    options?.overrideAccess ?? false,
  )
  const counts = new Map<string, number>()
  for (const doc of eligible) {
    const id = relationId(doc.building)
    if (id === null) continue
    counts.set(String(id), (counts.get(String(id)) ?? 0) + 1)
  }
  const total = eligible.length
  return {
    sources: sourcesOf(total),
    total,
    byBuilding: buildingIds.map((buildingId) => ({
      buildingId,
      count: counts.get(String(buildingId)) ?? 0,
    })),
    capped,
  }
}
