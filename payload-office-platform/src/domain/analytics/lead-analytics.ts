/**
 * 线索分析看板（tasks.md M7.5 / design.md §7.5 / R6, R7）
 *
 * 职责：
 *   - 把线索类指标卡 / 趋势 / 分布组合为「线索分析」结构
 *   - 复用 role-dashboard 的 resolveSingleCard 单卡隔离机制
 *   - 每个卡 / 趋势 / 分布都按自身 metric.allowedScopeDims 重新 sanitize
 *   - URL 参数不能扩大数据范围
 *
 * 业务不变量：
 *   - 不同角色只看到授权指标和范围（registry.resolve 内部权限校验）
 *   - 合并目标、有效创建时间和终态事件时间口径一致（统一用 createdAt）
 *   - 卡片 = 趋势桶之和（M7.6 assertCardEqualsSeriesSum 断言）
 *   - 卡片 = 图表点击 = 明细数量（同 query ID 一致性）
 *   - 单卡失败局部标记并展示数据截至时间
 *
 * 配置依据（tasks.md M7.5）：
 *   - 新增 / 有效 / 无效 / 已分配 / 及时率 / 推荐率 / 转化率 → 卡片组
 *   - 每日新建线索趋势 → 趋势组
 *   - 按状态分布 / 按来源分布 → 分布组
 *
 * M5 依赖说明：
 *   - leads.recommendation_rate 暂为 stubQuery（依赖 M5.5 FollowUps collection）
 *   - 其余 6 个标量指标已接入真实查询（lead-queries.ts）
 *   - 当前 Leads 用 status 字段（new/contacted/visited/won/lost），M5.2 引入 stage 后切换
 */

import { hasOperationPermission, type PermissionContext } from '@/domain/auth/permission-context'
import { metricRegistry as defaultRegistry, type MetricRegistry } from './metric-registry'
import type {
  DashboardCardResult,
  DashboardBaseContext,
} from './role-dashboard'
import { resolveSingleCard } from './role-dashboard'
import type { MetricCode } from './metric-types'

// 重新导出 DashboardBaseContext 供 endpoint / 测试直接从本模块导入
export type { DashboardBaseContext } from './role-dashboard'

// ────────────────────────────────────────────────────────────
// 线索分析配置：卡 / 趋势 / 分布的指标 code 列表
// ────────────────────────────────────────────────────────────

/**
 * 线索分析的指标卡（标量）。
 *
 * 设计依据（tasks.md M7.5）：
 *   - leads.new：新增线索（今日 Asia/Shanghai）
 *   - leads.valid：有效线索（status in [new, contacted, visited]）
 *   - leads.invalid：无效线索（status = 'lost'）
 *   - leads.assigned：已分配线索（owner != null）
 *   - leads.timely_rate：及时率（first-follow-up task 4h 内完成）
 *   - leads.recommendation_rate：推荐率（M5.5 stub，暂返回 0）
 *   - leads.conversion_rate：转化率（won / total in 30d）
 *
 * 「合并目标、有效创建时间和终态事件时间口径一致」实现：
 *   - 所有时间窗口以 lead.createdAt 为锚点
 *   - conversion_rate 分子 / 分母都用 createdAt 时间范围过滤
 *   - timely_rate 通过 task.completedAt - lead.createdAt <= 4h 判定
 */
export const LEAD_ANALYTICS_CARDS: ReadonlyArray<MetricCode> = Object.freeze([
  'leads.new',
  'leads.valid',
  'leads.invalid',
  'leads.assigned',
  'leads.timely_rate',
  'leads.recommendation_rate',
  'leads.conversion_rate',
])

/**
 * 线索分析的趋势序列。
 *
 * 趋势与卡片对应：leads.created_per_day_7d 反映线索新增节奏。
 * 卡片 = 趋势桶之和（M7.6 assertCardEqualsSeriesSum）。
 */
export const LEAD_ANALYTICS_TRENDS: ReadonlyArray<MetricCode> = Object.freeze([
  'leads.created_per_day_7d',
])

/**
 * 线索分析的分布序列。
 *
 * - leads.by_status：按状态分布（new/contacted/visited/won/lost）
 * - leads.by_source：按来源分布（frontend-form/phone/import/other）
 */
export const LEAD_ANALYTICS_DISTRIBUTIONS: ReadonlyArray<MetricCode> = Object.freeze([
  'leads.by_status',
  'leads.by_source',
])

// ────────────────────────────────────────────────────────────
// 线索分析结果
// ────────────────────────────────────────────────────────────

/**
 * 线索分析整体结果。
 *
 * cards / trends / distributions 各自独立失败隔离，
 * 一组失败不影响其他组（也不影响组内其他卡）。
 */
export interface LeadAnalyticsResult {
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
// 解析线索分析
// ────────────────────────────────────────────────────────────

/**
 * 解析线索分析。
 *
 * 设计要点：
 *   - 单卡失败局部标记：每张卡 try/catch 独立，失败 → status=failed/no-permission/not-found
 *   - 每张卡按自身 metric.allowedScopeDims 重新 sanitize → URL 不扩大范围
 *   - 所有卡 / 趋势 / 分布共用同一 asOf，保证一致性（design.md §7.5）
 *   - 趋势和分布的桶使用 ctx.asOf 锚点，与卡片查询时间一致
 *
 * @param base 基础上下文（asOf + permission + payload + 客户端 input）
 * @param registry 指标注册表（默认单例）
 */
export async function resolveLeadAnalytics(
  base: DashboardBaseContext,
  registry: MetricRegistry = defaultRegistry,
): Promise<LeadAnalyticsResult> {
  const asOf = base.asOf.toISOString()

  // 并发解析所有组（组内也并发），单卡失败局部标记
  const [cards, trends, distributions] = await Promise.all([
    Promise.all(
      LEAD_ANALYTICS_CARDS.map((code) => resolveSingleCard(code, base, registry)),
    ),
    Promise.all(
      LEAD_ANALYTICS_TRENDS.map((code) => resolveSingleCard(code, base, registry)),
    ),
    Promise.all(
      LEAD_ANALYTICS_DISTRIBUTIONS.map((code) =>
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
 * 检查调用者是否有任一线索分析指标的查看权限。
 *
 * 用于 endpoint 层提前拦截：无任何权限 → 403，避免无谓解析。
 */
export function canViewLeadAnalytics(
  permission: PermissionContext,
  registry: MetricRegistry = defaultRegistry,
): boolean {
  const allCodes = [
    ...LEAD_ANALYTICS_CARDS,
    ...LEAD_ANALYTICS_TRENDS,
    ...LEAD_ANALYTICS_DISTRIBUTIONS,
  ]
  for (const code of allCodes) {
    const def = registry.get(code)
    if (def && def.requiredPermissions.length === 0) return true
    if (def && def.requiredPermissions.some((p) => hasOperationPermission(permission, p))) {
      return true
    }
  }
  return false
}
