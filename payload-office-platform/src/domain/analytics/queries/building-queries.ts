/**
 * 楼盘类指标查询适配器（tasks.md M7.3 / R7）
 *
 * 覆盖：
 *   - buildings.total / active / inactive
 *
 * 业务不变量：
 *   - 城市过滤通过 building.city 直接关联（Building 顶层有 city 字段）
 *   - 不应用商户过滤（Building 与商户通过 building-merchant-relations 关联）
 */

import type {
  MetricQueryAdapter,
  MetricScalarResult,
} from '../metric-types'
import { buildCityWhere, mergeWhere } from './scope-where'

/**
 * 通用楼盘计数。
 *
 * @param statusWhere 状态过滤片段（如 { operationalStatus: { equals: 'active' } }）
 */
function makeBuildingCount(
  statusWhere: Record<string, unknown>,
): MetricQueryAdapter {
  return async (ctx): Promise<MetricScalarResult> => {
    const where = mergeWhere(
      { deletedAt: { exists: false } },
      statusWhere,
      buildCityWhere(ctx.filters),
    )
    const value = await ctx.payload.count({
      collection: 'buildings',
      where,
      overrideAccess: true,
    })
    return { kind: 'scalar', value, asOf: ctx.asOf.toISOString() }
  }
}

/** buildings.total：所有未逻辑删除的楼盘 */
export const countBuildingsTotal: MetricQueryAdapter = makeBuildingCount({})

/** buildings.active：operationalStatus=active */
export const countBuildingsActive: MetricQueryAdapter = makeBuildingCount({
  operationalStatus: { equals: 'active' },
})

/** buildings.inactive：operationalStatus!=active（含 disabled 与 null） */
export const countBuildingsInactive: MetricQueryAdapter = makeBuildingCount({
  or: [
    { operationalStatus: { equals: 'disabled' } },
    { operationalStatus: { exists: false } },
  ],
})
