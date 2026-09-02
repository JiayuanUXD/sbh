/**
 * 经营概览看板（tasks.md M7.3 / design.md §7.3 / R7）
 *
 * 职责：
 *   - 把指标卡 / 趋势 / 来源分布 / 明细下钻组合为经营概览结构
 *   - 复用 role-dashboard 的 resolveSingleCard 单卡隔离机制
 *   - 每个卡 / 趋势 / 分布都按自身 metric.allowedScopeDims 重新 sanitize
 *   - URL 参数不能扩大数据范围
 *
 * 业务不变量：
 *   - 不同角色只看到授权指标和范围（registry.resolve 内部权限校验）
 *   - 卡片 = 趋势桶之和（M7.6 assertCardEqualsSeriesSum 断言）
 *   - 卡片 = 图表点击 = 明细数量（同 query ID 一致性）
 *   - 单卡失败局部重试并展示数据截至时间
 */

import { hasOperationPermission, type PermissionContext } from '@/domain/auth/permission-context'
import { buildDrilldownUrl } from './metric-drilldown'
import { metricRegistry as defaultRegistry, type MetricRegistry } from './metric-registry'
import { sanitizeFilters } from './metric-context'
import type {
  DashboardCardResult,
  DashboardBaseContext,
} from './role-dashboard'
import { resolveSingleCard } from './role-dashboard'
import type { MetricCode } from './metric-types'

// 重新导出 DashboardBaseContext 供 endpoint / 测试直接从本模块导入
export type { DashboardBaseContext } from './role-dashboard'

// ────────────────────────────────────────────────────────────
// 经营概览配置：卡 / 趋势 / 分布的指标 code 列表
// ────────────────────────────────────────────────────────────

/**
 * 经营概览包含的指标卡（标量）。
 *
 * 设计依据（tasks.md M7.3）：城市 / 时间 / 团队筛选 + 指标卡。
 * 全局概览：房源总数 + 已上架 + 待审核 + 已下架 + 有效供给 + 启用楼盘 + 启用商户。
 */
export const OVERVIEW_CARDS: ReadonlyArray<MetricCode> = Object.freeze([
  'listings.total',
  'listings.published',
  'listings.pending_review',
  'listings.offline',
  'supply.effective_count',
  'buildings.active',
  'merchants.active',
])

/**
 * 经营概览的趋势序列。
 *
 * 趋势与卡片对应（如 listings.created_per_day_7d 对应「新增房源」卡）。
 * 卡片 = 趋势桶之和（M7.6 assertCardEqualsSeriesSum）。
 */
export const OVERVIEW_TRENDS: ReadonlyArray<MetricCode> = Object.freeze([
  'listings.created_per_day_7d',
])

/**
 * 经营概览的来源分布序列。
 *
 * - listings.by_status：按发布状态分布（draft/published/unpublished/leased）
 * - listings.by_city：按城市分布（仅当 filters.cityIds 提供时返回）
 */
export const OVERVIEW_DISTRIBUTIONS: ReadonlyArray<MetricCode> = Object.freeze([
  'listings.by_status',
  'listings.by_city',
])

// ────────────────────────────────────────────────────────────
// 经营概览结果
// ────────────────────────────────────────────────────────────

/**
 * 经营概览整体结果。
 *
 * cards / trends / distributions 各自独立失败隔离，
 * 一组失败不影响其他组（也不影响组内其他卡）。
 */
export interface OverviewDashboardResult {
  /** 标量指标卡 */
  cards: DashboardCardResult[]
  /** 趋势序列 */
  trends: DashboardCardResult[]
  /** 来源分布序列 */
  distributions: DashboardCardResult[]
  /** 数据截至时间 ISO UTC（所有组共用，便于一致性比对） */
  asOf: string
}

// ────────────────────────────────────────────────────────────
// 解析经营概览
// ────────────────────────────────────────────────────────────

/**
 * 解析经营概览。
 *
 * 设计要点：
 *   - 单卡失败局部标记：每张卡 try/catch 独立，失败 → status=failed/no-permission/not-found
 *   - 每张卡按自身 metric.allowedScopeDims 重新 sanitize → URL 不扩大范围
 *   - 所有卡 / 趋势 / 分布共用同一 asOf，保证一致性（design.md §7.3）
 *   - 趋势和分布的桶使用 ctx.asOf 锚点，与卡片查询时间一致
 *
 * @param base 基础上下文（asOf + permission + payload + 客户端 input）
 * @param registry 指标注册表（默认单例）
 */
export async function resolveOverviewDashboard(
  base: DashboardBaseContext,
  registry: MetricRegistry = defaultRegistry,
): Promise<OverviewDashboardResult> {
  const asOf = base.asOf.toISOString()

  // 并发解析所有组（组内也并发），单卡失败局部标记
  const [cards, trends, distributions] = await Promise.all([
    Promise.all(OVERVIEW_CARDS.map((code) => resolveSingleCard(code, base, registry))),
    Promise.all(OVERVIEW_TRENDS.map((code) => resolveSingleCard(code, base, registry))),
    Promise.all(
      OVERVIEW_DISTRIBUTIONS.map((code) => resolveSingleCard(code, base, registry)),
    ),
  ])

  return { cards, trends, distributions, asOf }
}

// ────────────────────────────────────────────────────────────
// 权限校验辅助
// ────────────────────────────────────────────────────────────

/**
 * 检查调用者是否有任一经营概览指标的查看权限。
 *
 * 用于 endpoint 层提前拦截：无任何权限 → 403，避免无谓解析。
 */
export function canViewOverviewDashboard(
  permission: PermissionContext,
  registry: MetricRegistry = defaultRegistry,
): boolean {
  const allCodes = [...OVERVIEW_CARDS, ...OVERVIEW_TRENDS, ...OVERVIEW_DISTRIBUTIONS]
  for (const code of allCodes) {
    const def = registry.get(code)
    if (def && def.requiredPermissions.length === 0) return true
    if (def && def.requiredPermissions.some((p) => hasOperationPermission(permission, p))) {
      return true
    }
  }
  return false
}
