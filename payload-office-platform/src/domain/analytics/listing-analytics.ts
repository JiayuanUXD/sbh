/**
 * 房源分析看板（tasks.md M7.4 / design.md §7.4 / R4, R7）
 *
 * 职责：
 *   - 把房源类指标卡 / 趋势 / 分布组合为「房源分析」结构
 *   - 复用 role-dashboard 的 resolveSingleCard 单卡隔离机制
 *   - 每个卡 / 趋势 / 分布都按自身 metric.allowedScopeDims 重新 sanitize
 *   - URL 参数不能扩大数据范围
 *
 * 业务不变量：
 *   - 不同角色只看到授权指标和范围（registry.resolve 内部权限校验）
 *   - 所有有效供给类指标复用 getEffectiveSupplyWhere + getPausedListingIds
 *   - 卡片 = 趋势桶之和（M7.6 assertCardEqualsSeriesSum 断言）
 *   - 卡片 = 图表点击 = 明细数量（同 query ID 一致性）
 *   - 单卡失败局部标记并展示数据截至时间
 *
 * 配置依据（tasks.md M7.4）：
 *   - 总数、上架、待审核、下架、出租、完整度低于 80% → 卡片组
 *   - 每日新建房源趋势 → 趋势组
 *   - 按状态分布 / 按城市分布 → 分布组
 */

import type { PermissionContext } from '@/domain/auth/permission-context'
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
// 房源分析配置：卡 / 趋势 / 分布的指标 code 列表
// ────────────────────────────────────────────────────────────

/**
 * 房源分析的指标卡（标量）。
 *
 * 设计依据（tasks.md M7.4）：
 *   - listings.total：房源总数
 *   - listings.published：已上架
 *   - listings.pending_review：待审核
 *   - listings.offline：已下架
 *   - listings.rented：已出租
 *   - listings.completeness_below_80：完整度低于 80%（待维护）
 *
 * 有效供给 supply.effective_count 不在此处（在经营概览中），但本看板通过
 * metric 复用保证口径一致：listings.* 类查询都通过 makeListingCount 工厂，
 * useEffectiveSupply 选项决定是否叠加 getEffectiveSupplyWhere + 举报暂停排除。
 */
export const LISTING_ANALYTICS_CARDS: ReadonlyArray<MetricCode> = Object.freeze([
  'listings.total',
  'listings.published',
  'listings.pending_review',
  'listings.offline',
  'listings.rented',
  'listings.completeness_below_80',
])

/**
 * 房源分析的趋势序列。
 *
 * 趋势与卡片对应：listings.created_per_day_7d 反映房源新增节奏。
 * 卡片 = 趋势桶之和（M7.6 assertCardEqualsSeriesSum）。
 */
export const LISTING_ANALYTICS_TRENDS: ReadonlyArray<MetricCode> = Object.freeze([
  'listings.created_per_day_7d',
])

/**
 * 房源分析的分布序列。
 *
 * - listings.by_status：按发布状态分布（draft/published/unpublished/leased）
 * - listings.by_city：按城市分布（仅当 filters.cityIds 提供时返回）
 */
export const LISTING_ANALYTICS_DISTRIBUTIONS: ReadonlyArray<MetricCode> = Object.freeze([
  'listings.by_status',
  'listings.by_city',
])

// ────────────────────────────────────────────────────────────
// 房源分析结果
// ────────────────────────────────────────────────────────────

/**
 * 房源分析整体结果。
 *
 * cards / trends / distributions 各自独立失败隔离，
 * 一组失败不影响其他组（也不影响组内其他卡）。
 */
export interface ListingAnalyticsResult {
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
// 解析房源分析
// ────────────────────────────────────────────────────────────

/**
 * 解析房源分析。
 *
 * 设计要点：
 *   - 单卡失败局部标记：每张卡 try/catch 独立，失败 → status=failed/no-permission/not-found
 *   - 每张卡按自身 metric.allowedScopeDims 重新 sanitize → URL 不扩大范围
 *   - 所有卡 / 趋势 / 分布共用同一 asOf，保证一致性（design.md §7.4）
 *   - 趋势和分布的桶使用 ctx.asOf 锚点，与卡片查询时间一致
 *
 * @param base 基础上下文（asOf + permission + payload + 客户端 input）
 * @param registry 指标注册表（默认单例）
 */
export async function resolveListingAnalytics(
  base: DashboardBaseContext,
  registry: MetricRegistry = defaultRegistry,
): Promise<ListingAnalyticsResult> {
  const asOf = base.asOf.toISOString()

  // 并发解析所有组（组内也并发），单卡失败局部标记
  const [cards, trends, distributions] = await Promise.all([
    Promise.all(
      LISTING_ANALYTICS_CARDS.map((code) => resolveSingleCard(code, base, registry)),
    ),
    Promise.all(
      LISTING_ANALYTICS_TRENDS.map((code) => resolveSingleCard(code, base, registry)),
    ),
    Promise.all(
      LISTING_ANALYTICS_DISTRIBUTIONS.map((code) =>
        resolveSingleCard(code, base, registry),
      ),
    ),
  ])

  return { cards, trends, distributions, asOf }
}

// ────────────────────────────────────────────────────────────
// 权限校验辅助
// ────────────────────────────────────────────────────────────

/**
 * 检查调用者是否有任一房源分析指标的查看权限。
 *
 * 用于 endpoint 层提前拦截：无任何权限 → 403，避免无谓解析。
 */
export function canViewListingAnalytics(
  permission: PermissionContext,
  registry: MetricRegistry = defaultRegistry,
): boolean {
  const allCodes = [
    ...LISTING_ANALYTICS_CARDS,
    ...LISTING_ANALYTICS_TRENDS,
    ...LISTING_ANALYTICS_DISTRIBUTIONS,
  ]
  for (const code of allCodes) {
    const def = registry.get(code)
    if (def && def.requiredPermissions.length === 0) return true
    if (
      def &&
      def.requiredPermissions.some((p) => permission.operationPermissions.has(p))
    ) {
      return true
    }
  }
  return false
}
