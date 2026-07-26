/**
 * 指标注册表核心类型（tasks.md M7.1 / design.md §7.2 / R7）
 *
 * 设计目标：
 *   - 每个指标「编码 / 公式 / 去重 / 时间 / 权限 / 缓存 / 下钻模板」一体定义
 *   - 禁止页面独立拼装指标条件（前端 / 工作台 / 看板只能查注册表）
 *   - URL 参数不能扩大数据范围（服务端 sanitizeFilters 兜底）
 *
 * 业务不变量（design.md §7.3 / AGENTS.md §5.2）：
 *   - 卡片 = 趋势桶之和（同一查询上下文）
 *   - 卡片 = 图表点击 = 明细数量
 *   - 高成本聚合使用分钟级缓存并展示数据截至时间
 *   - 「今日」和时间范围按 Asia/Shanghai 计算
 *
 * 注意：本文件只放类型与枚举守卫，不放实现逻辑。
 */

import type { PermissionContext } from '@/domain/auth/permission-context'

// ────────────────────────────────────────────────────────────
// 指标编码与分类
// ────────────────────────────────────────────────────────────

/**
 * 指标编码：唯一稳定标识，使用点号分层。
 *
 * 约定：`<domain>.<scope>[.<sub-scope>]`
 *   - listings.total / listings.published / listings.pending_review
 *   - leads.new / leads.valid / leads.conversion_rate
 *   - tasks.overdue / tasks.pending_claim
 *
 * 一旦发布禁止改码，废弃使用 deprecated 标记，不删除。
 */
export type MetricCode = string

/** 指标业务分类（用于工作台分组与权限映射） */
export const METRIC_CATEGORIES = [
  'listing', // 房源
  'building', // 楼盘
  'lead', // 线索
  'task', // 待办
  'supply', // 有效供给
  'review', // 审核
  'report', // 举报
  'merchant', // 商户
  'team', // 团队
] as const
export type MetricCategory = (typeof METRIC_CATEGORIES)[number]

export function isMetricCategory(v: unknown): v is MetricCategory {
  return typeof v === 'string' && (METRIC_CATEGORIES as readonly string[]).includes(v)
}

// ────────────────────────────────────────────────────────────
// 单位与去重 / 时间窗口
// ────────────────────────────────────────────────────────────

export const METRIC_UNITS = [
  'count', // 计数
  'rate', // 比率（0-1）
  'percent', // 百分比（0-100）
  'duration_ms', // 时长（毫秒）
  'currency_cny', // 金额（人民币，分）
] as const
export type MetricUnit = (typeof METRIC_UNITS)[number]

export function isMetricUnit(v: unknown): v is MetricUnit {
  return typeof v === 'string' && (METRIC_UNITS as readonly string[]).includes(v)
}

/**
 * 去重策略
 *
 * - none：不去重（如待办总数）
 * - distinct:id：按业务 id 去重（如线索数量按 leadId）
 * - distinct:id+status_at：按 id+状态变更时刻去重（统计阶段变更次数时用）
 * - latest_status_per_id：每个 id 仅取最新状态（如「当前跟进中线索」）
 */
export const METRIC_DEDUP_STRATEGIES = [
  'none',
  'distinct:id',
  'distinct:id+status_at',
  'latest_status_per_id',
] as const
export type MetricDedupStrategy = (typeof METRIC_DEDUP_STRATEGIES)[number]

export function isMetricDedupStrategy(v: unknown): v is MetricDedupStrategy {
  return (
    typeof v === 'string' &&
    (METRIC_DEDUP_STRATEGIES as readonly string[]).includes(v)
  )
}

/**
 * 时间窗口口径
 *
 * - snapshot：当前快照，无时间过滤
 * - today：Asia/Shanghai 自然日 [00:00, 24:00)
 * - rolling_7d：Asia/Shanghai 近 7 自然日
 * - rolling_30d：Asia/Shanghai 近 30 自然日
 * - range：自定义 [start, end)，由查询上下文 range 字段提供
 * - cumulative：累计（无时间过滤，与 snapshot 区别在于语义强调"历史总量"）
 */
export const METRIC_TIME_RANGES = [
  'snapshot',
  'today',
  'rolling_7d',
  'rolling_30d',
  'range',
  'cumulative',
] as const
export type MetricTimeRange = (typeof METRIC_TIME_RANGES)[number]

export function isMetricTimeRange(v: unknown): v is MetricTimeRange {
  return (
    typeof v === 'string' &&
    (METRIC_TIME_RANGES as readonly string[]).includes(v)
  )
}

/**
 * 数据范围维度
 *
 * - city：按城市筛选
 * - team：按团队筛选
 * - merchant：按商户筛选
 * - assignee：按负责人筛选
 * - none：不支持数据范围筛选（如全局统计）
 */
export const METRIC_SCOPE_DIMS = ['city', 'team', 'merchant', 'assignee', 'none'] as const
export type MetricScopeDim = (typeof METRIC_SCOPE_DIMS)[number]

export function isMetricScopeDim(v: unknown): v is MetricScopeDim {
  return typeof v === 'string' && (METRIC_SCOPE_DIMS as readonly string[]).includes(v)
}

// ────────────────────────────────────────────────────────────
// 查询上下文与结果
// ────────────────────────────────────────────────────────────

/**
 * Payload Local API 查询端口（最小化接口，便于测试 mock）。
 *
 * 与 effective-supply.ts PayloadQueryPort 对齐，但扩展支持 count。
 */
export interface MetricPayloadPort {
  /** 计数查询（不加载文档） */
  count: (params: {
    collection: string
    where: Record<string, unknown>
    overrideAccess?: boolean
  }) => Promise<number>
  /** 列表查询（用于桶聚合 / 明细下钻） */
  find: (params: {
    collection: string
    where: Record<string, unknown>
    depth?: number
    limit?: number
    page?: number
    sort?: string
    overrideAccess?: boolean
  }) => Promise<{
    docs: ReadonlyArray<Record<string, unknown>>
    totalDocs: number
    totalPages: number
    page: number
  }>
}

/** 客户端传入的过滤参数（不可信，需 sanitize） */
export interface MetricFilterInput {
  cityIds?: ReadonlyArray<number | string>
  teamIds?: ReadonlyArray<number | string>
  merchantIds?: ReadonlyArray<number | string>
  assigneeId?: number | string | null
  /** 自定义时间范围（仅 timeRange=range 生效） */
  rangeStart?: string | Date
  rangeEnd?: string | Date
}

/**
 * 服务端 sanitize 后的过滤参数（可信）。
 *
 * 保证：
 *   - 只包含 metric.allowedScopeDims 中允许的维度
 *   - cityIds 限定在 permission.cityIds 内（或为 'all'）
 *   - teamIds 限定在 permission.teamIds 内
 *   - assigneeId 仅当 dataScope=self 时强制 = userId
 *   - rangeStart/rangeEnd 在合理范围内（不超过 365 天）
 */
export interface MetricFilters {
  readonly cityIds: ReadonlyArray<number | string>
  readonly teamIds: ReadonlyArray<number | string>
  readonly merchantIds: ReadonlyArray<number | string>
  readonly assigneeId: number | string | null
  readonly range: { start: Date; end: Date } | null
}

/** 指标查询上下文 */
export interface MetricQueryContext {
  /** 时间锚点（北京时间） */
  asOf: Date
  /** 调用者权限上下文 */
  permission: PermissionContext
  /** sanitize 后的过滤参数 */
  filters: MetricFilters
  /** Payload 查询端口 */
  payload: MetricPayloadPort
}

// ────────────────────────────────────────────────────────────
// 查询结果
// ────────────────────────────────────────────────────────────

/** 单值结果 */
export interface MetricScalarResult {
  kind: 'scalar'
  value: number
  /** 数据截至时刻 ISO UTC */
  asOf: string
  /** 缓存命中标记（M7.3+ 接入缓存层） */
  cached?: boolean
}

/** 时间序列 / 分组桶结果 */
export interface MetricBucket {
  /** 桶标签（如 '2026-07-20' / 'pending' / 'shanghai'） */
  label: string
  /** 桶值 */
  value: number
  /** 桶元数据（供下钻使用，如 cityId / status / start） */
  metadata?: Readonly<Record<string, unknown>>
}

export interface MetricSeriesResult {
  kind: 'series'
  buckets: ReadonlyArray<MetricBucket>
  asOf: string
  cached?: boolean
}

export type MetricQueryResult = MetricScalarResult | MetricSeriesResult

// ────────────────────────────────────────────────────────────
// 下钻模板
// ────────────────────────────────────────────────────────────

export const METRIC_DRILLDOWN_TARGETS = [
  'collection-list', // Payload Collection 列表
  'custom-view', // Custom View 页面（如我的待办、数据概览）
  'task-list', // 我的待办（带 sourceId 过滤）
  'lead-list', // 线索列表
  'report-detail', // 举报详情
  'listing-detail', // 房源详情
] as const
export type MetricDrilldownTarget = (typeof METRIC_DRILLDOWN_TARGETS)[number]

export function isMetricDrilldownTarget(v: unknown): v is MetricDrilldownTarget {
  return (
    typeof v === 'string' &&
    (METRIC_DRILLDOWN_TARGETS as readonly string[]).includes(v)
  )
}

/**
 * 下钻模板
 *
 * pathTemplate 使用 {{占位符}} 引用以下变量：
 *   - {{collection}}：目标 Collection slug
 *   - {{filter_keys}}：URL 查询参数键列表（按顺序拼装）
 *   - {{bucket.label}}：当前桶标签（仅 series 类型下钻使用）
 *   - {{bucket.value}}：当前桶值
 *   - {{ctx.asOf}}、{{ctx.userId}} 等 MetricQueryContext 字段
 *
 * 占位符外的字面量保留原样，由 buildDrilldownUrl 替换。
 */
export interface MetricDrilldown {
  target: MetricDrilldownTarget
  /** 目标 Collection slug（target=collection-list/lead-list/task-list 时必填） */
  collection?: string
  /** 路径模板，如 `/admin/collections/listings?where={{filter_keys}}` */
  pathTemplate: string
  /** 携带的过滤参数键（由 sanitizeFilters 派生，不允许客户端拼装） */
  filterKeys: ReadonlyArray<string>
}

// ────────────────────────────────────────────────────────────
// 指标定义与查询适配器
// ────────────────────────────────────────────────────────────

/**
 * 指标查询适配器
 *
 * 接收查询上下文，返回单值或序列。实现要点：
 *   - 必须复用统一供给查询 / 任务查询等已有谓词，禁止独立拼装 where
 *   - 必须使用 ctx.filters 中的 city/team/merchant/assignee 过滤
 *   - 时间窗口按 metric.timeRange 解释（today / rolling_7d / ...）
 *   - 失败时抛 Error，由调用方捕获并标记局部失败
 *   - 返回的 asOf 必须等于 ctx.asOf.toISOString()
 *
 * M7.1 阶段：query 适配器可为 stub（返回 0），具体实现在 M7.3-M7.5 补齐。
 */
export type MetricQueryAdapter = (ctx: MetricQueryContext) => Promise<MetricQueryResult>

/** 指标完整定义 */
export interface MetricDefinition {
  code: MetricCode
  /** 显示名（简体中文） */
  label: string
  /** 业务说明（公式 / 口径） */
  description: string
  category: MetricCategory
  unit: MetricUnit
  dedup: MetricDedupStrategy
  timeRange: MetricTimeRange
  /** 所需操作权限（任一即可） */
  requiredPermissions: ReadonlyArray<string>
  /** 允许的数据范围维度 */
  allowedScopeDims: ReadonlyArray<MetricScopeDim>
  /** 缓存时长（毫秒）；0=实时 */
  cacheTtlMs: number
  /** 下钻模板（可选，部分指标无明细） */
  drilldown?: MetricDrilldown
  /** 查询适配器 */
  query: MetricQueryAdapter
  /** 是否已废弃（true 表示不再展示，但保留 code 防止历史引用报错） */
  deprecated?: boolean
}

/** 最小可注册的指标元数据（不含 query，便于在 M7.1 阶段批量注册） */
export type MetricMetadata = Omit<MetricDefinition, 'query'> & {
  /** M7.1 阶段可为 stub；M7.3-M7.5 阶段补齐真实查询 */
  query?: MetricQueryAdapter
}

// ────────────────────────────────────────────────────────────
// 守卫
// ────────────────────────────────────────────────────────────

/** 是否为合法的 MetricDefinition（用于注册前的运行时校验） */
export function isMetricDefinition(v: unknown): v is MetricDefinition {
  if (typeof v !== 'object' || v === null) return false
  const m = v as Record<string, unknown>
  return (
    typeof m.code === 'string' &&
    m.code.length > 0 &&
    typeof m.label === 'string' &&
    typeof m.description === 'string' &&
    isMetricCategory(m.category) &&
    isMetricUnit(m.unit) &&
    isMetricDedupStrategy(m.dedup) &&
    isMetricTimeRange(m.timeRange) &&
    Array.isArray(m.requiredPermissions) &&
    Array.isArray(m.allowedScopeDims) &&
    typeof m.cacheTtlMs === 'number' &&
    m.cacheTtlMs >= 0 &&
    typeof m.query === 'function' &&
    (m.drilldown === undefined || isMetricDrilldown(m.drilldown))
  )
}

function isMetricDrilldown(v: unknown): v is MetricDrilldown {
  if (typeof v !== 'object' || v === null) return false
  const d = v as Record<string, unknown>
  return (
    isMetricDrilldownTarget(d.target) &&
    typeof d.pathTemplate === 'string' &&
    d.pathTemplate.length > 0 &&
    Array.isArray(d.filterKeys)
  )
}
