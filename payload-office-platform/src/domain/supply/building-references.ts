/**
 * 楼盘停用影响预检（tasks.md M3.5「停用前展示受影响房源数量并二次确认」/ R3, R4, R8）
 *
 * 口径：停用某楼盘会从前台有效供给中撤除该楼盘下「当前对外可见（available）」的房源，
 * 这里统计其数量，供 UI 在停用前二次确认展示。停用不阻断（人为决策），也不改写任何
 * 房源的审核 / 发布状态——仅撤销有效供给谓词的楼盘侧可用性（design §9/§10, R3）。
 *
 * 与 merchant-references / location-references 同构：依赖 payload.count（副作用），
 * 单测 mock count。房源与商户/楼盘的关系型 collection 在后续里程碑登记后自动纳入。
 */

import type { CollectionSlug, Payload, PayloadRequest, Where } from 'payload'

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

type CountSpec = {
  collection: CollectionSlug
  label: string
  where: (id: number | string) => Where
}

/**
 * 停用影响来源清单。当前统计该楼盘下「对外可见（status=available）」的房源：
 * 这些房源随楼盘停用而从前台消失。房源与楼盘的关系型 collection 建立后同法登记。
 *
 * 注意：这里刻意与前台有效供给的过渡口径（filters.ts `status=available`）保持一致，
 * 度量的是「用户当前能看到、停用后将看不到」的房源，而非全部关联房源。
 */
const REFERENCE_SPECS: CountSpec[] = [
  {
    collection: 'listings',
    label: '对外可见房源',
    where: (id) => ({
      building: { equals: id },
      status: { equals: 'available' },
    }),
  },
]

/**
 * 统计停用某楼盘的受影响房源数量（分来源聚合）。
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
  const results = await Promise.all(
    REFERENCE_SPECS.map(async (spec) => {
      const res = await payload.count({
        collection: spec.collection,
        where: spec.where(buildingId),
        overrideAccess,
        req,
      })
      return { collection: spec.collection, label: spec.label, count: res.totalDocs }
    }),
  )
  const sources = results.filter((s) => s.count > 0)
  const total = results.reduce((sum, s) => sum + s.count, 0)
  return { buildingId, sources, total, referenced: total > 0 }
}
