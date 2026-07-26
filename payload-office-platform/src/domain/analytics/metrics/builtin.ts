/**
 * 内置指标定义（tasks.md M7.1 / R7）
 *
 * 本文件注册 M7 工作台、经营概览、房源分析、线索分析所需的全部指标元数据。
 *
 * M7.1 阶段：query 适配器统一使用 stubQuery（返回 0），仅校验注册表与权限基础设施。
 * M7.3-M7.5 阶段：按里程碑替换为真实查询适配器：
 *   - M7.3 经营概览：替换 listing/building/merchant 类指标
 *   - M7.4 房源分析：替换 listing 类细分指标（含有效供给口径）
 *   - M7.5 线索分析：替换 lead 类指标（依赖 M5 CRM 完成）
 *
 * 业务不变量：
 *   - 所有有效供给类指标必须复用 getEffectiveSupplyWhere / listingReportPauseWhere
 *   - 时间窗口按 Asia/Shanghai 自然日计算（today / rolling_7d / rolling_30d）
 *   - 单卡失败局部重试由调用方捕获 query 抛出的错误实现
 */

import type { MetricDefinition, MetricQueryAdapter, MetricQueryResult } from '../metric-types'
import type { MetricRegistry } from '../metric-registry'

// ────────────────────────────────────────────────────────────
// Stub 查询适配器（M7.1 阶段占位）
// ────────────────────────────────────────────────────────────

/**
 * M7.1 阶段 stub：返回 0。
 *
 * M7.3-M7.5 阶段按指标替换为真实查询。
 * 真实查询必须：
 *   - 使用 ctx.payload 查询 Collection
 *   - 复用 getEffectiveSupplyWhere / listingReportPauseWhere 等已有谓词
 *   - 应用 ctx.filters 中的 city/team/merchant/assignee 过滤
 *   - 按 metric.timeRange 解释时间窗口
 *   - 返回 asOf = ctx.asOf.toISOString()
 */
export const stubQuery: MetricQueryAdapter = async (ctx): Promise<MetricQueryResult> => {
  return {
    kind: 'scalar',
    value: 0,
    asOf: ctx.asOf.toISOString(),
  }
}

/** 空序列 stub（用于 series 类指标的占位） */
export const stubSeriesQuery: MetricQueryAdapter = async (ctx): Promise<MetricQueryResult> => {
  return {
    kind: 'series',
    buckets: [],
    asOf: ctx.asOf.toISOString(),
  }
}

// ────────────────────────────────────────────────────────────
// 指标定义
// ────────────────────────────────────────────────────────────

const listingMetrics: MetricDefinition[] = [
  {
    code: 'listings.total',
    label: '房源总数',
    description: '所有未逻辑删除的房源数量（含未发布 / 审核中 / 已下架）',
    category: 'listing',
    unit: 'count',
    dedup: 'distinct:id',
    timeRange: 'snapshot',
    requiredPermissions: ['listing:read'],
    allowedScopeDims: ['city', 'team', 'merchant'],
    cacheTtlMs: 60_000,
    drilldown: {
      target: 'collection-list',
      collection: 'listings',
      pathTemplate: '/admin/collections/listings?{{filter_keys}}',
      filterKeys: ['cityIds', 'teamIds', 'merchantIds'],
    },
    query: stubQuery,
  },
  {
    code: 'listings.published',
    label: '已上架房源',
    description: 'publicationStatus=published 的房源数量',
    category: 'listing',
    unit: 'count',
    dedup: 'distinct:id',
    timeRange: 'snapshot',
    requiredPermissions: ['listing:read'],
    allowedScopeDims: ['city', 'team', 'merchant'],
    cacheTtlMs: 60_000,
    drilldown: {
      target: 'collection-list',
      collection: 'listings',
      pathTemplate: '/admin/collections/listings?publicationStatus=published&{{filter_keys}}',
      filterKeys: ['cityIds', 'teamIds', 'merchantIds'],
    },
    query: stubQuery,
  },
  {
    code: 'listings.pending_review',
    label: '待审核房源',
    description: 'reviewStatus=pending 的房源数量',
    category: 'listing',
    unit: 'count',
    dedup: 'distinct:id',
    timeRange: 'snapshot',
    requiredPermissions: ['review:read'],
    allowedScopeDims: ['city', 'team', 'merchant'],
    cacheTtlMs: 30_000,
    drilldown: {
      target: 'collection-list',
      collection: 'listings',
      pathTemplate: '/admin/collections/listings?reviewStatus=pending&{{filter_keys}}',
      filterKeys: ['cityIds', 'teamIds', 'merchantIds'],
    },
    query: stubQuery,
  },
  {
    code: 'listings.rejected',
    label: '已驳回房源',
    description: 'reviewStatus=rejected 的房源数量',
    category: 'listing',
    unit: 'count',
    dedup: 'distinct:id',
    timeRange: 'snapshot',
    requiredPermissions: ['review:read'],
    allowedScopeDims: ['city', 'team', 'merchant'],
    cacheTtlMs: 30_000,
    drilldown: {
      target: 'collection-list',
      collection: 'listings',
      pathTemplate: '/admin/collections/listings?reviewStatus=rejected&{{filter_keys}}',
      filterKeys: ['cityIds', 'teamIds', 'merchantIds'],
    },
    query: stubQuery,
  },
  {
    code: 'listings.offline',
    label: '已下架房源',
    description: 'publicationStatus=offline 的房源数量',
    category: 'listing',
    unit: 'count',
    dedup: 'distinct:id',
    timeRange: 'snapshot',
    requiredPermissions: ['listing:read'],
    allowedScopeDims: ['city', 'team', 'merchant'],
    cacheTtlMs: 60_000,
    drilldown: {
      target: 'collection-list',
      collection: 'listings',
      pathTemplate: '/admin/collections/listings?publicationStatus=offline&{{filter_keys}}',
      filterKeys: ['cityIds', 'teamIds', 'merchantIds'],
    },
    query: stubQuery,
  },
  {
    code: 'listings.rented',
    label: '已出租房源',
    description: '已出租标记的房源数量',
    category: 'listing',
    unit: 'count',
    dedup: 'distinct:id',
    timeRange: 'snapshot',
    requiredPermissions: ['listing:read'],
    allowedScopeDims: ['city', 'team', 'merchant'],
    cacheTtlMs: 60_000,
    drilldown: {
      target: 'collection-list',
      collection: 'listings',
      pathTemplate: '/admin/collections/listings?rented=true&{{filter_keys}}',
      filterKeys: ['cityIds', 'teamIds', 'merchantIds'],
    },
    query: stubQuery,
  },
  {
    code: 'listings.completeness_below_80',
    label: '完整度低于 80% 房源',
    description: 'listing completeness < 80 的房源数量（待维护）',
    category: 'listing',
    unit: 'count',
    dedup: 'distinct:id',
    timeRange: 'snapshot',
    requiredPermissions: ['listing:read'],
    allowedScopeDims: ['city', 'team', 'merchant'],
    cacheTtlMs: 5 * 60_000,
    drilldown: {
      target: 'collection-list',
      collection: 'listings',
      pathTemplate: '/admin/collections/listings?completenessLt=80&{{filter_keys}}',
      filterKeys: ['cityIds', 'teamIds', 'merchantIds'],
    },
    query: stubQuery,
  },
]

const buildingMetrics: MetricDefinition[] = [
  {
    code: 'buildings.total',
    label: '楼盘总数',
    description: '所有未逻辑删除的楼盘数量',
    category: 'building',
    unit: 'count',
    dedup: 'distinct:id',
    timeRange: 'snapshot',
    requiredPermissions: ['building:read'],
    allowedScopeDims: ['city'],
    cacheTtlMs: 5 * 60_000,
    drilldown: {
      target: 'collection-list',
      collection: 'buildings',
      pathTemplate: '/admin/collections/buildings?{{filter_keys}}',
      filterKeys: ['cityIds'],
    },
    query: stubQuery,
  },
  {
    code: 'buildings.active',
    label: '启用楼盘',
    description: 'operationalStatus=active 的楼盘数量',
    category: 'building',
    unit: 'count',
    dedup: 'distinct:id',
    timeRange: 'snapshot',
    requiredPermissions: ['building:read'],
    allowedScopeDims: ['city'],
    cacheTtlMs: 5 * 60_000,
    drilldown: {
      target: 'collection-list',
      collection: 'buildings',
      pathTemplate: '/admin/collections/buildings?operationalStatus=active&{{filter_keys}}',
      filterKeys: ['cityIds'],
    },
    query: stubQuery,
  },
  {
    code: 'buildings.inactive',
    label: '停用楼盘',
    description: 'operationalStatus!=active 的楼盘数量',
    category: 'building',
    unit: 'count',
    dedup: 'distinct:id',
    timeRange: 'snapshot',
    requiredPermissions: ['building:read'],
    allowedScopeDims: ['city'],
    cacheTtlMs: 5 * 60_000,
    drilldown: {
      target: 'collection-list',
      collection: 'buildings',
      pathTemplate: '/admin/collections/buildings?operationalStatus=inactive&{{filter_keys}}',
      filterKeys: ['cityIds'],
    },
    query: stubQuery,
  },
]

const leadMetrics: MetricDefinition[] = [
  {
    code: 'leads.new',
    label: '新增线索',
    description: '今日 Asia/Shanghai 新创建的线索数量',
    category: 'lead',
    unit: 'count',
    dedup: 'distinct:id',
    timeRange: 'today',
    requiredPermissions: ['lead:read'],
    allowedScopeDims: ['city', 'team', 'assignee'],
    cacheTtlMs: 30_000,
    drilldown: {
      target: 'lead-list',
      collection: 'leads',
      pathTemplate: '/admin/collections/leads?createdAt=gte:today&{{filter_keys}}',
      filterKeys: ['cityIds', 'teamIds', 'assigneeId'],
    },
    query: stubQuery,
  },
  {
    code: 'leads.valid',
    label: '有效线索',
    description: '当前阶段为「新建/待分配/跟进中/有效商机/带看/谈判」的有效线索',
    category: 'lead',
    unit: 'count',
    dedup: 'distinct:id',
    timeRange: 'snapshot',
    requiredPermissions: ['lead:read'],
    allowedScopeDims: ['city', 'team', 'assignee'],
    cacheTtlMs: 30_000,
    drilldown: {
      target: 'lead-list',
      collection: 'leads',
      pathTemplate: '/admin/collections/leads?status=active&{{filter_keys}}',
      filterKeys: ['cityIds', 'teamIds', 'assigneeId'],
    },
    query: stubQuery,
  },
  {
    code: 'leads.invalid',
    label: '无效线索',
    description: '当前阶段为「已流失 / 重复 / 无效」的线索',
    category: 'lead',
    unit: 'count',
    dedup: 'distinct:id',
    timeRange: 'snapshot',
    requiredPermissions: ['lead:read'],
    allowedScopeDims: ['city', 'team', 'assignee'],
    cacheTtlMs: 30_000,
    drilldown: {
      target: 'lead-list',
      collection: 'leads',
      pathTemplate: '/admin/collections/leads?status=invalid&{{filter_keys}}',
      filterKeys: ['cityIds', 'teamIds', 'assigneeId'],
    },
    query: stubQuery,
  },
  {
    code: 'leads.assigned',
    label: '已分配线索',
    description: 'ownership=assigned 的线索数量',
    category: 'lead',
    unit: 'count',
    dedup: 'distinct:id',
    timeRange: 'snapshot',
    requiredPermissions: ['lead:read'],
    allowedScopeDims: ['city', 'team', 'assignee'],
    cacheTtlMs: 30_000,
    drilldown: {
      target: 'lead-list',
      collection: 'leads',
      pathTemplate: '/admin/collections/leads?ownership=assigned&{{filter_keys}}',
      filterKeys: ['cityIds', 'teamIds', 'assigneeId'],
    },
    query: stubQuery,
  },
  {
    code: 'leads.timely_rate',
    label: '线索及时率',
    description: '创建后 4 小时内首次跟进的线索占比（0-1）',
    category: 'lead',
    unit: 'rate',
    dedup: 'distinct:id',
    timeRange: 'rolling_7d',
    requiredPermissions: ['lead:read'],
    allowedScopeDims: ['city', 'team', 'assignee'],
    cacheTtlMs: 5 * 60_000,
    drilldown: {
      target: 'lead-list',
      collection: 'leads',
      pathTemplate: '/admin/collections/leads?timely=true&{{filter_keys}}',
      filterKeys: ['cityIds', 'teamIds', 'assigneeId'],
    },
    query: stubQuery,
  },
  {
    code: 'leads.recommendation_rate',
    label: '线索推荐率',
    description: '跟进结果至少一次「已推荐」的线索占比（0-1）',
    category: 'lead',
    unit: 'rate',
    dedup: 'distinct:id',
    timeRange: 'rolling_7d',
    requiredPermissions: ['lead:read'],
    allowedScopeDims: ['city', 'team', 'assignee'],
    cacheTtlMs: 5 * 60_000,
    drilldown: {
      target: 'lead-list',
      collection: 'leads',
      pathTemplate: '/admin/collections/leads?recommended=true&{{filter_keys}}',
      filterKeys: ['cityIds', 'teamIds', 'assigneeId'],
    },
    query: stubQuery,
  },
  {
    code: 'leads.conversion_rate',
    label: '线索转化率',
    description: '阶段进入「已转化」的线索占所有创建线索的比率（0-1）',
    category: 'lead',
    unit: 'rate',
    dedup: 'distinct:id',
    timeRange: 'rolling_30d',
    requiredPermissions: ['lead:read'],
    allowedScopeDims: ['city', 'team', 'assignee'],
    cacheTtlMs: 10 * 60_000,
    drilldown: {
      target: 'lead-list',
      collection: 'leads',
      pathTemplate: '/admin/collections/leads?stage=converted&{{filter_keys}}',
      filterKeys: ['cityIds', 'teamIds', 'assigneeId'],
    },
    query: stubQuery,
  },
]

const taskMetrics: MetricDefinition[] = [
  {
    code: 'tasks.pending_claim',
    label: '待领取待办',
    description: 'status=pending 且未分配负责人的待办数量',
    category: 'task',
    unit: 'count',
    dedup: 'distinct:id',
    timeRange: 'snapshot',
    requiredPermissions: ['task:read'],
    allowedScopeDims: ['city', 'team', 'assignee'],
    cacheTtlMs: 0,
    drilldown: {
      target: 'task-list',
      collection: 'tasks',
      pathTemplate: '/admin/collections/tasks?status=pending&assignee=null&{{filter_keys}}',
      filterKeys: ['cityIds', 'teamIds', 'assigneeId'],
    },
    query: stubQuery,
  },
  {
    code: 'tasks.overdue',
    label: '逾期待办',
    description: 'dueAt < now 且 status 未终态的待办数量',
    category: 'task',
    unit: 'count',
    dedup: 'distinct:id',
    timeRange: 'snapshot',
    requiredPermissions: ['task:read'],
    allowedScopeDims: ['city', 'team', 'assignee'],
    cacheTtlMs: 0,
    drilldown: {
      target: 'task-list',
      collection: 'tasks',
      pathTemplate: '/admin/collections/tasks?overdue=true&{{filter_keys}}',
      filterKeys: ['cityIds', 'teamIds', 'assigneeId'],
    },
    query: stubQuery,
  },
  {
    code: 'tasks.today_followup',
    label: '今日待跟进',
    description: 'dueAt 落在今日 Asia/Shanghai 的待办数量',
    category: 'task',
    unit: 'count',
    dedup: 'distinct:id',
    timeRange: 'today',
    requiredPermissions: ['task:read'],
    allowedScopeDims: ['city', 'team', 'assignee'],
    cacheTtlMs: 0,
    drilldown: {
      target: 'task-list',
      collection: 'tasks',
      pathTemplate: '/admin/collections/tasks?dueAt=today&{{filter_keys}}',
      filterKeys: ['cityIds', 'teamIds', 'assigneeId'],
    },
    query: stubQuery,
  },
  {
    code: 'tasks.sla_breached',
    label: 'SLA 超时',
    description: 'SLA 扫描触发超时事件的待办数量（近 7 天）',
    category: 'task',
    unit: 'count',
    dedup: 'distinct:id',
    timeRange: 'rolling_7d',
    requiredPermissions: ['task:read'],
    allowedScopeDims: ['city', 'team', 'assignee'],
    cacheTtlMs: 5 * 60_000,
    drilldown: {
      target: 'task-list',
      collection: 'tasks',
      pathTemplate: '/admin/collections/tasks?slaBreached=true&{{filter_keys}}',
      filterKeys: ['cityIds', 'teamIds', 'assigneeId'],
    },
    query: stubQuery,
  },
]

const supplyMetrics: MetricDefinition[] = [
  {
    code: 'supply.effective_count',
    label: '有效供给房源',
    description: '符合统一有效供给 10 条的房源数量（前台可见）',
    category: 'supply',
    unit: 'count',
    dedup: 'distinct:id',
    timeRange: 'snapshot',
    requiredPermissions: ['listing:read'],
    allowedScopeDims: ['city', 'team', 'merchant'],
    cacheTtlMs: 60_000,
    drilldown: {
      target: 'collection-list',
      collection: 'listings',
      pathTemplate: '/admin/collections/listings?effectiveSupply=true&{{filter_keys}}',
      filterKeys: ['cityIds', 'teamIds', 'merchantIds'],
    },
    query: stubQuery,
  },
]

const reviewMetrics: MetricDefinition[] = [
  {
    code: 'reviews.pending',
    label: '待审核任务',
    description: 'reviewStatus=pending 的 listing-reviews 数量',
    category: 'review',
    unit: 'count',
    dedup: 'distinct:id',
    timeRange: 'snapshot',
    requiredPermissions: ['review:read'],
    allowedScopeDims: ['city', 'team', 'merchant'],
    cacheTtlMs: 30_000,
    drilldown: {
      target: 'collection-list',
      collection: 'listing-reviews',
      pathTemplate: '/admin/collections/listing-reviews?status=pending&{{filter_keys}}',
      filterKeys: ['cityIds', 'teamIds', 'merchantIds'],
    },
    query: stubQuery,
  },
  {
    code: 'reviews.rejected_today',
    label: '今日驳回',
    description: '今日 Asia/Shanghai reviewStatus 变为 rejected 的数量',
    category: 'review',
    unit: 'count',
    dedup: 'distinct:id+status_at',
    timeRange: 'today',
    requiredPermissions: ['review:read'],
    allowedScopeDims: ['city', 'team', 'merchant'],
    cacheTtlMs: 30_000,
    drilldown: {
      target: 'collection-list',
      collection: 'listing-reviews',
      pathTemplate: '/admin/collections/listing-reviews?status=rejected&updatedAt=today&{{filter_keys}}',
      filterKeys: ['cityIds', 'teamIds', 'merchantIds'],
    },
    query: stubQuery,
  },
  {
    code: 'reviews.approved_today',
    label: '今日通过',
    description: '今日 Asia/Shanghai reviewStatus 变为 approved 的数量',
    category: 'review',
    unit: 'count',
    dedup: 'distinct:id+status_at',
    timeRange: 'today',
    requiredPermissions: ['review:read'],
    allowedScopeDims: ['city', 'team', 'merchant'],
    cacheTtlMs: 30_000,
    drilldown: {
      target: 'collection-list',
      collection: 'listing-reviews',
      pathTemplate: '/admin/collections/listing-reviews?status=approved&updatedAt=today&{{filter_keys}}',
      filterKeys: ['cityIds', 'teamIds', 'merchantIds'],
    },
    query: stubQuery,
  },
]

const reportMetrics: MetricDefinition[] = [
  {
    code: 'reports.pending_triage',
    label: '待分诊举报',
    description: 'status=pending-triage 的房源举报数量',
    category: 'report',
    unit: 'count',
    dedup: 'distinct:id',
    timeRange: 'snapshot',
    requiredPermissions: ['report:read'],
    allowedScopeDims: ['city'],
    cacheTtlMs: 30_000,
    drilldown: {
      target: 'collection-list',
      collection: 'listing-reports',
      pathTemplate: '/admin/collections/listing-reports?status=pending-triage&{{filter_keys}}',
      filterKeys: ['cityIds'],
    },
    query: stubQuery,
  },
  {
    code: 'reports.supply_paused',
    label: '已暂停供给',
    description: 'supplyPaused=true 的房源举报数量',
    category: 'report',
    unit: 'count',
    dedup: 'distinct:id',
    timeRange: 'snapshot',
    requiredPermissions: ['report:read'],
    allowedScopeDims: ['city'],
    cacheTtlMs: 30_000,
    drilldown: {
      target: 'collection-list',
      collection: 'listing-reports',
      pathTemplate: '/admin/collections/listing-reports?supplyPaused=true&{{filter_keys}}',
      filterKeys: ['cityIds'],
    },
    query: stubQuery,
  },
]

const merchantMetrics: MetricDefinition[] = [
  {
    code: 'merchants.active',
    label: '启用商户',
    description: 'status=active 的商户数量',
    category: 'merchant',
    unit: 'count',
    dedup: 'distinct:id',
    timeRange: 'snapshot',
    requiredPermissions: ['merchant:read'],
    allowedScopeDims: ['city'],
    cacheTtlMs: 5 * 60_000,
    drilldown: {
      target: 'collection-list',
      collection: 'merchants',
      pathTemplate: '/admin/collections/merchants?status=active&{{filter_keys}}',
      filterKeys: ['cityIds'],
    },
    query: stubQuery,
  },
  {
    code: 'merchants.qualification_expiring',
    label: '资质即将过期',
    description: '商户资质 30 天内即将过期的数量',
    category: 'merchant',
    unit: 'count',
    dedup: 'distinct:id',
    timeRange: 'snapshot',
    requiredPermissions: ['merchant:read'],
    allowedScopeDims: ['city'],
    cacheTtlMs: 60 * 60_000,
    drilldown: {
      target: 'collection-list',
      collection: 'merchants',
      pathTemplate: '/admin/collections/merchants?qualificationExpiresIn=30d&{{filter_keys}}',
      filterKeys: ['cityIds'],
    },
    query: stubQuery,
  },
]

// ────────────────────────────────────────────────────────────
// 全部内置指标
// ────────────────────────────────────────────────────────────

export const BUILTIN_METRICS: ReadonlyArray<MetricDefinition> = [
  ...listingMetrics,
  ...buildingMetrics,
  ...leadMetrics,
  ...taskMetrics,
  ...supplyMetrics,
  ...reviewMetrics,
  ...reportMetrics,
  ...merchantMetrics,
]

/**
 * 注册全部内置指标到指定注册表。
 *
 * 幂等：已注册的 code 会抛 DuplicateMetricError，调用方需先 clear() 或在测试隔离。
 * 应用启动时调用一次即可。
 */
export function registerBuiltinMetrics(registry: MetricRegistry): void {
  for (const def of BUILTIN_METRICS) {
    registry.register(def)
  }
}
