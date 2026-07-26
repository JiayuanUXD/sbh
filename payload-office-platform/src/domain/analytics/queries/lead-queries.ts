/**
 * 线索类指标查询适配器（tasks.md M7.5 / R6, R7）
 *
 * 覆盖：
 *   - leads.new / valid / invalid / assigned（标量计数）
 *   - leads.conversion_rate（won / total in 30d）
 *   - leads.timely_rate（first-follow-up task 完成于线索创建后 4h 内）
 *   - leads.created_per_day_7d（趋势）
 *   - leads.by_status / leads.by_source（分布）
 *
 * 业务不变量：
 *   - 时间窗口按 Asia/Shanghai 自然日（today / rolling_7d / rolling_30d）
 *   - URL 参数不扩大数据范围（ctx.filters 已由 sanitizeFilters 服务端兜底）
 *   - 合并目标、有效创建时间和终态事件时间口径一致（统一使用 createdAt 作为有效创建时间）
 *
 * M5 依赖说明：
 *   - 当前 Leads collection 仅 status 字段（new/contacted/visited/won/lost）
 *   - M5.2 将引入 stage 字段（lead-stage.ts 已就绪），届时查询切换到 stage 维度
 *   - 当前 status 映射：
 *       new/contacted/visited → 有效（active stages）
 *       won → 已转化（terminal converted）
 *       lost → 已流失（terminal lost）
 *   - leads.timely_rate 通过 Tasks（taskType='followup-first'）派生，依赖 M6.4 已完成
 *   - leads.recommendation_rate 需 FollowUps collection（M5.5 未完成），暂保留 stubQuery
 */

import { FIRST_FOLLOW_UP_SLA_SECONDS } from '@/domain/crm/policy'

import type {
  MetricBucket,
  MetricQueryAdapter,
  MetricQueryContext,
  MetricScalarResult,
  MetricSeriesResult,
} from '../metric-types'
import type { MetricFilters, MetricPayloadPort } from '../metric-types'
import { buildAssigneeWhere, mergeWhere } from './scope-where'
import { buildDailyBuckets, emptyBuckets, toShanghaiDayStart } from './time-bucket'

// ────────────────────────────────────────────────────────────
// 时间窗口工具
// ────────────────────────────────────────────────────────────

/** 今日 Asia/Shanghai 自然日 [00:00, 次日 00:00) */
function getTodayRange(asOf: Date): { start: Date; end: Date } {
  const start = toShanghaiDayStart(asOf)
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  return { start, end }
}

/** 近 N 天 Asia/Shanghai 自然日 [today-(n-1), today+1) */
function getRollingRange(asOf: Date, days: number): { start: Date; end: Date } {
  const todayStart = toShanghaiDayStart(asOf)
  const start = new Date(todayStart.getTime() - (days - 1) * 24 * 60 * 60 * 1000)
  const end = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000)
  return { start, end }
}

function buildTimeWhere(start: Date, end: Date): Record<string, unknown> {
  return {
    createdAt: {
      greater_than_equal: start.toISOString(),
      less_than: end.toISOString(),
    },
  }
}

// ────────────────────────────────────────────────────────────
// 城市过滤：扩展 cityIds 到所有后代 location IDs
// ────────────────────────────────────────────────────────────

/**
 * 把城市 IDs 扩展为 [cityIds, 所有行政区 IDs, 所有商圈 IDs]。
 *
 * Leads 的 district 字段可关联 city/district/business_area 任一类型（见 Leads.ts
 * filterOptions: activeLocationFilter(['city', 'district', 'business_area'])）。
 * 因此按城市过滤线索时,需要扩展到所有后代节点,否则会漏掉选了行政区 / 商圈的线索。
 *
 * 业务不变量：
 *   - 仅启用节点（status='active'）参与扩展,停用节点不进过滤
 *   - 城市本身也作为候选（线索可能直接选了城市作为意向区域）
 *   - M5.2 引入 lead.city 字段后,本扩展可简化为直接 cityId 匹配
 */
async function expandCityToLocationIds(
  cityIds: ReadonlyArray<number | string>,
  payload: MetricPayloadPort,
): Promise<Array<number | string>> {
  if (cityIds.length === 0) return []

  // Step 1: 查所有行政区（parent in cityIds, type=district, status=active）
  const districtResult = await payload.find({
    collection: 'locations',
    where: {
      and: [
        { type: { equals: 'district' } },
        { parent: { in: [...cityIds] } },
        { status: { equals: 'active' } },
      ],
    },
    depth: 0,
    limit: 200,
    overrideAccess: true,
  })
  const districtIds = districtResult.docs.map(
    (d) => (d as { id: number | string }).id,
  )

  // Step 2: 查所有商圈（parent in districtIds, type=business_area, status=active）
  let businessAreaIds: Array<number | string> = []
  if (districtIds.length > 0) {
    const businessResult = await payload.find({
      collection: 'locations',
      where: {
        and: [
          { type: { equals: 'business_area' } },
          { parent: { in: districtIds } },
          { status: { equals: 'active' } },
        ],
      },
      depth: 0,
      limit: 500,
      overrideAccess: true,
    })
    businessAreaIds = businessResult.docs.map(
      (d) => (d as { id: number | string }).id,
    )
  }

  return [...cityIds, ...districtIds, ...businessAreaIds]
}

/**
 * 构造线索的城市过滤 where 片段。
 *
 * 返回 { district: { in: [cityIds + 后代] } } 或 null（无过滤）。
 */
async function buildLeadLocationWhere(
  filters: MetricFilters,
  payload: MetricPayloadPort,
): Promise<Record<string, unknown> | null> {
  if (filters.cityIds.length === 0) return null
  const locationIds = await expandCityToLocationIds(filters.cityIds, payload)
  if (locationIds.length === 0) return { district: { in: [] } }
  return { district: { in: locationIds } }
}

/**
 * 构造线索的负责人过滤（assignee → owner 字段映射）。
 *
 * assigneeId 为 null 时返回 null（无过滤）。
 */
function buildLeadOwnerWhere(
  filters: MetricFilters,
): Record<string, unknown> | null {
  const assigneeId = buildAssigneeWhere(filters)
  if (assigneeId === null) return null
  return { owner: { equals: assigneeId } }
}

// ────────────────────────────────────────────────────────────
// 标量计数查询
// ────────────────────────────────────────────────────────────

/**
 * 通用线索计数：按 statusWhere + filters + 可选时间窗口。
 *
 * @param statusWhere 状态过滤片段（如 { status: { in: [...] } }）
 * @param options.timeRange 时间窗口（today / rolling_7d / rolling_30d / 不传=快照）
 */
function makeLeadCount(
  statusWhere: Record<string, unknown>,
  options: {
    timeRange?: 'today' | 'rolling_7d' | 'rolling_30d'
  } = {},
): MetricQueryAdapter {
  return async (ctx: MetricQueryContext): Promise<MetricScalarResult> => {
    let timeWhere: Record<string, unknown> | null = null
    if (options.timeRange === 'today') {
      const range = getTodayRange(ctx.asOf)
      timeWhere = buildTimeWhere(range.start, range.end)
    } else if (options.timeRange === 'rolling_7d') {
      const range = getRollingRange(ctx.asOf, 7)
      timeWhere = buildTimeWhere(range.start, range.end)
    } else if (options.timeRange === 'rolling_30d') {
      const range = getRollingRange(ctx.asOf, 30)
      timeWhere = buildTimeWhere(range.start, range.end)
    }

    const cityWhere = await buildLeadLocationWhere(ctx.filters, ctx.payload)
    const ownerWhere = buildLeadOwnerWhere(ctx.filters)

    const where = mergeWhere(
      { deletedAt: { exists: false } },
      statusWhere,
      cityWhere,
      ownerWhere,
      timeWhere,
    )

    const value = await ctx.payload.count({
      collection: 'leads',
      where,
      overrideAccess: true,
    })

    return {
      kind: 'scalar',
      value,
      asOf: ctx.asOf.toISOString(),
    }
  }
}

/** leads.new：今日 Asia/Shanghai 新建的线索 */
export const countLeadsNew: MetricQueryAdapter = makeLeadCount(
  {},
  { timeRange: 'today' },
)

/**
 * leads.valid：当前阶段为「新建/待分配/跟进中/有效商机/带看/谈判」的有效线索。
 *
 * 当前 schema 映射：status in [new, contacted, visited]（不含 won/lost 终态）。
 * M5.2 引入 stage 后,改为 stage in [new, pending_assignment, following, qualified, viewing, negotiation]。
 */
export const countLeadsValid: MetricQueryAdapter = makeLeadCount({
  status: { in: ['new', 'contacted', 'visited'] },
})

/**
 * leads.invalid：已流失 / 重复 / 无效的线索。
 *
 * 当前 schema 映射：status = 'lost'。
 * M5.2 引入 stage 后,改为 stage = 'lost'（含流失原因）。
 */
export const countLeadsInvalid: MetricQueryAdapter = makeLeadCount({
  status: { equals: 'lost' },
})

/** leads.assigned：已分配负责人的线索（owner != null） */
export const countLeadsAssigned: MetricQueryAdapter = makeLeadCount({
  owner: { exists: true },
})

// ────────────────────────────────────────────────────────────
// 比率指标
// ────────────────────────────────────────────────────────────

/**
 * leads.conversion_rate：阶段进入「已转化」的线索占所有创建线索的比率（0-1）。
 *
 * 口径一致（tasks.md M7.5）：
 *   - 分子：近 30 天内创建且 status='won' 的线索数
 *   - 分母：近 30 天内创建的线索总数
 *   - 「创建时间」与「终态事件时间」口径一致：均以 lead.createdAt 为锚点
 *
 * 注意：M5.2 引入 stage 后,改为 stage='converted'。当前 status='won' 是同义映射。
 */
export const computeLeadsConversionRate: MetricQueryAdapter = async (
  ctx,
): Promise<MetricScalarResult> => {
  const range = getRollingRange(ctx.asOf, 30)
  const timeWhere = buildTimeWhere(range.start, range.end)

  const cityWhere = await buildLeadLocationWhere(ctx.filters, ctx.payload)
  const ownerWhere = buildLeadOwnerWhere(ctx.filters)

  const baseWhere = mergeWhere(
    { deletedAt: { exists: false } },
    cityWhere,
    ownerWhere,
    timeWhere,
  )
  const wonWhere = mergeWhere(baseWhere, { status: { equals: 'won' } })

  const [wonCount, totalCount] = await Promise.all([
    ctx.payload.count({
      collection: 'leads',
      where: wonWhere,
      overrideAccess: true,
    }),
    ctx.payload.count({
      collection: 'leads',
      where: baseWhere,
      overrideAccess: true,
    }),
  ])

  const rate = totalCount > 0 ? wonCount / totalCount : 0
  return {
    kind: 'scalar',
    value: rate,
    asOf: ctx.asOf.toISOString(),
  }
}

/**
 * leads.timely_rate：创建后 4 小时内首次跟进的线索占比（0-1）。
 *
 * 口径（tasks.md M7.5 / R6 / R8）：
 *   - 分子：近 7 天创建且已分配的线索中,首次跟进任务（taskType='followup-first'）
 *           在 lead.createdAt + 4h 内完成的数量
 *   - 分母：近 7 天创建且已分配的线索总数
 *
 * 数据来源：
 *   - lead.createdAt 来自 Leads collection
 *   - 首次跟进完成时间来自 Tasks collection（taskType='followup-first', status='completed'）
 *   - task.sourceId = String(lead.id), task.completedAt - lead.createdAt <= 4h
 *
 * 业务不变量：
 *   - 候选 cap = 500（与 listing-completeness 一致）,超过需人工介入
 *   - 仅统计已分配线索（owner != null）,未分配线索无首次跟进任务
 *   - SLA = FIRST_FOLLOW_UP_SLA_SECONDS = 4h（M5.4 policy.ts）
 *   - M5.5 引入 FollowUps collection 后,可改用 firstValidFollowUpAt 字段直接计算
 *
 * 注意：
 *   - 当前实现依赖 M6.4 已完成的 Tasks collection,无需 M5.5 FollowUps
 *   - 若线索无对应 first-follow-up task（task 未生成或未完成）,不计入分子
 */
const TIMELY_RATE_CANDIDATE_CAP = 500
const FIRST_FOLLOW_UP_SLA_MS = FIRST_FOLLOW_UP_SLA_SECONDS * 1000

export const computeLeadsTimelyRate: MetricQueryAdapter = async (
  ctx,
): Promise<MetricScalarResult> => {
  const range = getRollingRange(ctx.asOf, 7)
  const timeWhere = buildTimeWhere(range.start, range.end)

  const cityWhere = await buildLeadLocationWhere(ctx.filters, ctx.payload)
  const ownerWhere = buildLeadOwnerWhere(ctx.filters)

  // 拉取候选线索：近 7d 创建且已分配
  const baseWhere = mergeWhere(
    { deletedAt: { exists: false } },
    { owner: { exists: true } },
    cityWhere,
    ownerWhere,
    timeWhere,
  )

  const leadResult = await ctx.payload.find({
    collection: 'leads',
    where: baseWhere,
    depth: 0,
    limit: TIMELY_RATE_CANDIDATE_CAP,
    overrideAccess: true,
  })

  const leads = leadResult.docs as ReadonlyArray<{
    id: string | number
    createdAt: string
  }>
  if (leads.length === 0) {
    return { kind: 'scalar', value: 0, asOf: ctx.asOf.toISOString() }
  }

  // 拉取所有相关 first-follow-up 任务（taskType='followup-first', status='completed'）
  const leadIds = leads.map((l) => String(l.id))
  const taskWhere = mergeWhere(
    { taskType: { equals: 'followup-first' } },
    { sourceId: { in: leadIds } },
    { status: { equals: 'completed' } },
  )
  const taskResult = await ctx.payload.find({
    collection: 'tasks',
    where: taskWhere,
    depth: 0,
    limit: TIMELY_RATE_CANDIDATE_CAP,
    overrideAccess: true,
  })

  // 按 sourceId 索引 completedAt（同一 lead 可能有多条任务,取最早的）
  const taskByLead = new Map<string, string>()
  for (const task of taskResult.docs) {
    const sourceId = String(
      (task as Record<string, unknown>).sourceId ?? '',
    )
    const completedAt = (task as Record<string, unknown>).completedAt
    if (!sourceId || typeof completedAt !== 'string') continue

    const existing = taskByLead.get(sourceId)
    if (!existing || new Date(completedAt).getTime() < new Date(existing).getTime()) {
      taskByLead.set(sourceId, completedAt)
    }
  }

  // 统计 timely（completedAt - lead.createdAt <= 4h）
  let timely = 0
  for (const lead of leads) {
    const completedAt = taskByLead.get(String(lead.id))
    if (!completedAt) continue
    const leadCreated = new Date(lead.createdAt).getTime()
    const taskCompleted = new Date(completedAt).getTime()
    if (taskCompleted - leadCreated <= FIRST_FOLLOW_UP_SLA_MS) {
      timely += 1
    }
  }

  const rate = leads.length > 0 ? timely / leads.length : 0
  return {
    kind: 'scalar',
    value: rate,
    asOf: ctx.asOf.toISOString(),
  }
}

// ────────────────────────────────────────────────────────────
// 趋势序列查询
// ────────────────────────────────────────────────────────────

/**
 * 创建 per-day 创建趋势序列查询。
 *
 * 桶 i = 第 i 天 Asia/Shanghai 自然日 [00:00, 次日 00:00) UTC。
 *
 * @param days 桶数量（7 / 30）
 */
function makeLeadsCreatedPerDayTrend(days: number): MetricQueryAdapter {
  return async (ctx: MetricQueryContext): Promise<MetricSeriesResult> => {
    const buckets = buildDailyBuckets(ctx.asOf, days)
    const result: MetricSeriesResult = {
      kind: 'series',
      buckets: emptyBuckets(buckets),
      asOf: ctx.asOf.toISOString(),
    }

    const cityWhere = await buildLeadLocationWhere(ctx.filters, ctx.payload)
    const ownerWhere = buildLeadOwnerWhere(ctx.filters)

    // 并发查每个桶
    const counts = await Promise.all(
      buckets.map(async (b) => {
        const where = mergeWhere(
          { deletedAt: { exists: false } },
          cityWhere,
          ownerWhere,
          {
            createdAt: {
              greater_than_equal: b.start.toISOString(),
              less_than: b.end.toISOString(),
            },
          },
        )
        return ctx.payload.count({
          collection: 'leads',
          where,
          overrideAccess: true,
        })
      }),
    )

    result.buckets = buckets.map((b, i) => ({
      label: b.label,
      value: counts[i],
    }))
    return result
  }
}

/** leads.created_per_day_7d：近 7 天每日新建线索趋势 */
export const trendLeadsCreatedPerDay7d: MetricQueryAdapter =
  makeLeadsCreatedPerDayTrend(7)

// ────────────────────────────────────────────────────────────
// 分布序列查询
// ────────────────────────────────────────────────────────────

/**
 * leads.by_status：按线索状态分组的数量分布。
 *
 * 用于线索分析「来源分布」：new / contacted / visited / won / lost。
 * M5.2 引入 stage 后改为按 stage 分组（8 个阶段）。
 */
export const distributionLeadsByStatus: MetricQueryAdapter = async (
  ctx,
): Promise<MetricSeriesResult> => {
  const statuses = ['new', 'contacted', 'visited', 'won', 'lost'] as const
  const cityWhere = await buildLeadLocationWhere(ctx.filters, ctx.payload)
  const ownerWhere = buildLeadOwnerWhere(ctx.filters)

  const counts = await Promise.all(
    statuses.map(async (status) => {
      const where = mergeWhere(
        { deletedAt: { exists: false } },
        { status: { equals: status } },
        cityWhere,
        ownerWhere,
      )
      return ctx.payload.count({
        collection: 'leads',
        where,
        overrideAccess: true,
      })
    }),
  )

  return {
    kind: 'series',
    buckets: statuses.map((status, i) => ({
      label: status,
      value: counts[i],
    })),
    asOf: ctx.asOf.toISOString(),
  }
}

/**
 * leads.by_source：按线索来源分组的数量分布。
 *
 * 来源：frontend-form（前台表单）/ phone（电话）/ import（导入）/ other（其他）。
 */
export const distributionLeadsBySource: MetricQueryAdapter = async (
  ctx,
): Promise<MetricSeriesResult> => {
  const sources = ['frontend-form', 'phone', 'import', 'other'] as const
  const cityWhere = await buildLeadLocationWhere(ctx.filters, ctx.payload)
  const ownerWhere = buildLeadOwnerWhere(ctx.filters)

  const counts = await Promise.all(
    sources.map(async (source) => {
      const where = mergeWhere(
        { deletedAt: { exists: false } },
        { source: { equals: source } },
        cityWhere,
        ownerWhere,
      )
      return ctx.payload.count({
        collection: 'leads',
        where,
        overrideAccess: true,
      })
    }),
  )

  return {
    kind: 'series',
    buckets: sources.map((source, i) => ({
      label: source,
      value: counts[i],
    })),
    asOf: ctx.asOf.toISOString(),
  }
}

// 显式导出辅助类型以便测试 mock
export type {
  MetricBucket,
  MetricQueryContext,
  MetricScalarResult,
  MetricSeriesResult,
} from '../metric-types'
