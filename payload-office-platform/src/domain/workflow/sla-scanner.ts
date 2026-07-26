/**
 * SLA 扫描器（tasks.md M6.5 / design §8 / R6, R7）
 *
 * 职责：
 *   - scanFirstFollowupBreaches：扫描已分配但 4 小时未首次跟进的 lead，
 *     生成 'sla.breached' 事件 + 'followup-first' 待办（任务幂等键兜底）
 *   - scanPublicPoolReclaims：扫描 72 小时无有效跟进的 lead，
 *     触发公海回收（生成 'lead.reclaimed' 事件）
 *   - scanStaleMaintenances：扫描 30 天未有效维护的 listing，
 *     生成 'listing-stale-maintenance' 待办
 *   - runSlaScan(ctx, scanType)：总入口，根据 scanType 调用对应扫描
 *
 * 业务不变量（AGENTS.md §10 / design §8）：
 *   - 固定同一 as_of 和 Asia/Shanghai 时间边界（每日 00:15 维护扫描）
 *   - 扫描幂等：相同 asOf 不重复扫描（hasScanRun / markScanRun 兜底）
 *   - 事件幂等：相同 lead 不重复生成 sla.breached 事件（findByAggregate 兜底）
 *   - 待办幂等：taskType + sourceId + sourceVersion（taskStore.findByKey 兜底）
 *   - 跨对象副作用使用事务 Outbox（M6.3 已完成）
 *
 * 设计取舍：
 *   - scanner 不直接依赖 Payload Local API：通过 SlaScanStore 接口抽象，
 *     便于单元测试和未来替换为消息队列
 *   - M5 跟进记录未完整实现，scanFirstFollowupBreaches / scanPublicPoolReclaims
 *     使用 fixture 数据测试（listLeadsFor*Scan 由调用方实现）
 *   - scanStaleMaintenances 基于 listings 的 updatedAt + lastEffectiveMaintainedAt
 *   - 时区边界统一使用 Asia/Shanghai 自然日（shanghaiDayStartUtc / shanghaiDayEndUtc）
 */

import { InvalidOperationError } from '@/domain/shared/errors'
import { ok, err, type OperationResult } from '@/domain/shared/result'
import {
  shanghaiDayEndUtc,
  shanghaiDayStartUtc,
  shanghaiDate,
} from '@/domain/shared/time'

import type { DomainEvent } from './event-publisher'
import { publishEvent } from './event-publisher'
import type { EventStore } from './event-consumer'
import type { EventType } from './event-types'
import {
  SLA_BREACH_TYPES,
  isSlaBreachType,
  isSlaScanType,
  type SlaBreachType,
  type SlaScanType,
} from './sla-scan-types'
import { buildStaleMaintenanceTask, type TaskDraft } from './task-registry'
import type { TaskStore } from './task-service'
import { TASK_TYPE_DEFAULT_SLA_MS } from './task-types'

/** 扫描间隔（毫秒） */
export const SLA_SCAN_INTERVALS = {
  /** 首次跟进扫描间隔：15 分钟（design §8 MVP-R1） */
  firstFollowup: 15 * 60 * 1000,
  /** 公海回收扫描间隔：15 分钟（design §8 MVP-R1） */
  publicPool: 15 * 60 * 1000,
  /** 房源维护扫描间隔：24 小时（design §8 每日 00:15） */
  staleMaintenance: 24 * 60 * 60 * 1000,
} as const

/** SLA 阈值（毫秒） */
export const SLA_THRESHOLDS = {
  /** 首次跟进 SLA：4 小时（任务要求） */
  firstFollowupMs: 4 * 60 * 60 * 1000,
  /** 公海回收 SLA：72 小时（任务要求） */
  publicPoolMs: 72 * 60 * 60 * 1000,
  /** 房源维护 SLA：30 天（任务要求） */
  staleMaintenanceMs: 30 * 24 * 60 * 60 * 1000,
} as const

/**
 * Lead 扫描记录（最小字段集，由调用方从 leads + follow_ups 派生）。
 *
 * M5 跟进记录未完整实现，扫描器消费此最小视图，不直接耦合 M5 collection。
 */
export interface LeadScanRecord {
  /** 线索 ID（字符串形式） */
  leadId: string
  /** 当前负责人 ID（null 表示未分配） */
  assigneeId: string | number | null
  /** 分配时间（UTC ISO） */
  assignedAt: string
  /** 首次有效跟进时间（null 表示未跟进） */
  firstFollowupAt: string | null
  /** 最近有效跟进时间（null 表示从未跟进） */
  lastValidFollowupAt: string | null
  /** 归属状态 */
  ownershipStatus: 'unassigned' | 'assigned' | 'public_pool'
}

/**
 * Listing 扫描记录（最小字段集，由调用方从 listings 派生）。
 *
 * 用于 scanStaleMaintenances：基于 updatedAt + lastEffectiveMaintainedAt
 * 判断是否进入 30 天未维护扫描范围。
 */
export interface ListingScanRecord {
  /** 房源 ID */
  listingId: string | number
  /** 最后更新时间（UTC ISO） */
  updatedAt: string
  /** 最后有效维护时间（可选；缺省回退到 updatedAt） */
  lastEffectiveMaintainedAt?: string | null
}

/**
 * SLA 扫描存储接口（抽象 lead / listing 候选查询 + 扫描幂等标记）。
 *
 * 真实实现由 Payload Local API 提供（基于 leads / listings collection 查询）；
 * 测试用 in-memory 实现。
 *
 * 设计取舍：
 *   - 候选查询返回最小视图（LeadScanRecord / ListingScanRecord），
 *     避免 scanner 直接依赖 leads / listings collection 字段
 *   - 扫描幂等由 hasScanRun / markScanRun 兜底（scanType + asOf 唯一键）
 *   - 事件幂等由 eventStore.findByAggregate 兜底（M6.5 扩展 EventStore）
 */
export interface SlaScanStore {
  /** 查询首次跟进违规候选 lead（已分配但 firstFollowupAt=null 且 assignedAt + 4h <= asOf） */
  listLeadsForFirstFollowupScan(asOf: string): Promise<LeadScanRecord[]>
  /** 查询公海回收候选 lead（72 小时无有效跟进） */
  listLeadsForPublicPoolScan(asOf: string): Promise<LeadScanRecord[]>
  /** 查询 30 天未维护房源（updatedAt + 30d <= asOf 或 lastEffectiveMaintainedAt 同样过期） */
  listStaleListings(asOf: string): Promise<ListingScanRecord[]>

  /** 是否已运行过该 scanType + asOf 的扫描（幂等检查） */
  hasScanRun(scanType: SlaScanType, asOf: string): Promise<boolean>
  /** 标记该 scanType + asOf 的扫描已完成（幂等记录） */
  markScanRun(scanType: SlaScanType, asOf: string, completedAt: string): Promise<void>
}

/** SLA 扫描上下文 */
export interface SlaScanContext {
  /** 扫描基准时间（UTC ISO，扫描数据截止时刻） */
  asOf: string
  /** 时区固定为 Asia/Shanghai（design §8 时间边界） */
  timezone: 'Asia/Shanghai'
  /** 待办存储（用于创建 / 查询待办） */
  taskStore: TaskStore
  /** 领域事件存储（用于写入 Outbox + 幂等查询） */
  eventStore: EventStore
  /** SLA 扫描存储（lead / listing 候选查询 + 扫描幂等标记） */
  slaScanStore: SlaScanStore
  /** 当前时间（可冻结用于测试；缺省取当前 UTC） */
  now?: string
}

/** 单条扫描结果（用于汇总报告） */
export interface SlaScanItemResult<TRecord = LeadScanRecord | ListingScanRecord> {
  /** 候选记录 */
  record: TRecord
  /** 处理动作：created（新生成事件 / 待办）/ skipped_already_breached（已有事件）/ skipped_existing_task（已有待办）/ failed（处理失败） */
  action:
    | 'created_event'
    | 'created_task'
    | 'skipped_already_breached'
    | 'skipped_existing_task'
    | 'failed'
  /** 生成的事件 ID（action=created_event 时填） */
  eventId?: string
  /** 生成的待办 ID（action=created_task 时填） */
  taskId?: string | number
  /** 失败原因（action=failed 时填） */
  error?: string
}

/** 单次扫描汇总结果 */
export interface SlaScanSummary {
  /** 扫描类型 */
  scanType: SlaScanType
  /** 扫描基准时间 */
  asOf: string
  /** 是否跳过（已扫描过同 asOf） */
  skipped: boolean
  /** 跳过原因 */
  skipReason?: 'already_run'
  /** 候选总数 */
  candidates: number
  /** 生成事件数 */
  eventsCreated: number
  /** 生成待办数 */
  tasksCreated: number
  /** 跳过事件数（已有同类型事件） */
  eventsSkipped: number
  /** 跳过待办数（已有同幂等键任务） */
  tasksSkipped: number
  /** 失败数 */
  failed: number
  /** 逐条结果 */
  items: SlaScanItemResult[]
  /** 扫描完成时间（UTC ISO） */
  completedAt: string
}

/** 北京时间自然日边界（用于 staleMaintenance 扫描锚定每日 00:15） */
export interface ShanghaiDayBoundary {
  /** 自然日 YYYY-MM-DD（Asia/Shanghai） */
  dayKey: string
  /** 自然日 00:00:00 UTC（含 -8h 偏移） */
  dayStartUtc: Date
  /** 自然日 23:59:59.999 UTC */
  dayEndUtc: Date
}

/**
 * 计算 asOf 时刻对应的 Asia/Shanghai 自然日边界。
 *
 * 用于 staleMaintenance 扫描：每日 00:15 调用时，asOf 落在当日，
 * 自然日边界用于"今日已扫描过"幂等检查。
 */
export function computeShanghaiDayBoundary(asOf: string | Date): ShanghaiDayBoundary {
  const ref = typeof asOf === 'string' ? new Date(asOf) : asOf
  return {
    dayKey: shanghaiDate(ref),
    dayStartUtc: shanghaiDayStartUtc(ref),
    dayEndUtc: shanghaiDayEndUtc(ref),
  }
}

/**
 * 计算首次跟进截止时间：assignedAt + 4h。
 *
 * 用于 scanFirstFollowupBreaches 判断是否违规：
 *   - now - assignedAt >= 4h 且 firstFollowupAt=null → 违规
 */
export function computeFirstFollowupDeadline(assignedAt: string): string {
  return new Date(new Date(assignedAt).getTime() + SLA_THRESHOLDS.firstFollowupMs).toISOString()
}

/**
 * 计算公海回收截止时间：lastValidFollowupAt (或 assignedAt) + 72h。
 *
 * 用于 scanPublicPoolReclaims 判断是否触发回收：
 *   - now - lastFollowup >= 72h → 回收
 */
export function computePublicPoolReclaimDeadline(
  lastValidFollowupAt: string | null,
  assignedAt: string,
): string {
  const ref = lastValidFollowupAt ?? assignedAt
  return new Date(new Date(ref).getTime() + SLA_THRESHOLDS.publicPoolMs).toISOString()
}

/**
 * 计算房源维护截止时间：lastEffectiveMaintainedAt (或 updatedAt) + 30d。
 */
export function computeStaleMaintenanceDeadline(
  lastEffectiveMaintainedAt: string | null,
  updatedAt: string,
): string {
  const ref = lastEffectiveMaintainedAt ?? updatedAt
  return new Date(new Date(ref).getTime() + SLA_THRESHOLDS.staleMaintenanceMs).toISOString()
}

/**
 * 扫描首次跟进违规：为每个违规 lead 生成 'sla.breached' 事件 + 'followup-first' 待办。
 *
 * 幂等：
 *   1. 事件级：eventStore.findByAggregate 检查 lead 是否已有 sla.breached 事件
 *   2. 待办级：taskStore.findByKey 检查 (followup-first, leadId, sourceVersion) 是否已存在
 *
 * 返回每个候选的处理结果。
 */
export async function scanFirstFollowupBreaches(
  ctx: SlaScanContext,
): Promise<SlaScanItemResult<LeadScanRecord>[]> {
  const candidates = await ctx.slaScanStore.listLeadsForFirstFollowupScan(ctx.asOf)
  const results: SlaScanItemResult<LeadScanRecord>[] = []

  for (const lead of candidates) {
    // 1. 事件幂等：检查是否已有 sla.breached 事件
    const existing = await ctx.eventStore.findByAggregate(
      'sla.breached' as EventType,
      lead.leadId,
    )
    if (existing.length > 0) {
      results.push({
        record: lead,
        action: 'skipped_already_breached',
      })
      continue
    }

    // 2. 发布 sla.breached 事件
    const deadline = computeFirstFollowupDeadline(lead.assignedAt)
    const eventParams = {
      eventType: 'sla.breached' as EventType,
      aggregateType: 'sla' as const,
      aggregateId: lead.leadId,
      aggregateVersion: 1,
      payload: {
        leadId: lead.leadId,
        slaType: 'first_followup' satisfies SlaBreachType,
        breachedAt: ctx.asOf,
        deadline,
        assigneeId: lead.assigneeId ?? null,
      },
      occurredAt: ctx.now ?? ctx.asOf,
    }
    const eventResult = publishEvent(eventParams)
    if (!eventResult.ok) {
      results.push({
        record: lead,
        action: 'failed',
        error: eventResult.error.message,
      })
      continue
    }
    const event = eventResult.data
    const createRes = await ctx.eventStore.createEvent(event)
    if (!createRes.ok) {
      results.push({
        record: lead,
        action: 'failed',
        error: createRes.error.message,
      })
      continue
    }

    // 3. 创建 followup-first 待办（幂等键：taskType + sourceId + sourceVersion）
    // sourceVersion 取 1：扫描器创建的任务不依赖 lead 的 aggregateVersion
    // （事件驱动的 followup-first 任务由 lead.assigned 事件创建，使用其 aggregateVersion）
    const taskResult = await ensureFollowupFirstTask(ctx, lead, event.eventId)
    if (taskResult.ok) {
      results.push({
        record: lead,
        action: taskResult.created ? 'created_task' : 'skipped_existing_task',
        eventId: event.eventId,
        taskId: taskResult.taskId,
      })
    } else {
      // 任务创建失败不阻断事件已生成的事实
      results.push({
        record: lead,
        action: 'failed',
        eventId: event.eventId,
        error: taskResult.error,
      })
    }
  }

  return results
}

/**
 * 扫描公海回收：72 小时无有效跟进触发 lead.reclaimed 事件。
 *
 * 幂等：
 *   1. 事件级：eventStore.findByAggregate 检查 lead 是否已有 lead.reclaimed 事件
 *   2. 不创建待办（公海回收后续由 lead-unassigned 任务流处理）
 */
export async function scanPublicPoolReclaims(
  ctx: SlaScanContext,
): Promise<SlaScanItemResult<LeadScanRecord>[]> {
  const candidates = await ctx.slaScanStore.listLeadsForPublicPoolScan(ctx.asOf)
  const results: SlaScanItemResult<LeadScanRecord>[] = []

  for (const lead of candidates) {
    // 1. 事件幂等：检查是否已有 lead.reclaimed 事件
    const existing = await ctx.eventStore.findByAggregate(
      'lead.reclaimed' as EventType,
      lead.leadId,
    )
    if (existing.length > 0) {
      results.push({
        record: lead,
        action: 'skipped_already_breached',
      })
      continue
    }

    // 2. 发布 lead.reclaimed 事件
    const deadline = computePublicPoolReclaimDeadline(
      lead.lastValidFollowupAt,
      lead.assignedAt,
    )
    const eventParams = {
      eventType: 'lead.reclaimed' as EventType,
      aggregateType: 'lead' as const,
      aggregateId: lead.leadId,
      aggregateVersion: 1,
      payload: {
        leadId: lead.leadId,
        reason: 'public_pool_reclaim',
        breachedAt: ctx.asOf,
        deadline,
        previousAssigneeId: lead.assigneeId ?? null,
      },
      occurredAt: ctx.now ?? ctx.asOf,
    }
    const eventResult = publishEvent(eventParams)
    if (!eventResult.ok) {
      results.push({
        record: lead,
        action: 'failed',
        error: eventResult.error.message,
      })
      continue
    }
    const createRes = await ctx.eventStore.createEvent(eventResult.data)
    if (!createRes.ok) {
      results.push({
        record: lead,
        action: 'failed',
        error: createRes.error.message,
      })
      continue
    }

    results.push({
      record: lead,
      action: 'created_event',
      eventId: eventResult.data.eventId,
    })
  }

  return results
}

/**
 * 扫描房源维护：30 天未维护生成 listing-stale-maintenance 待办。
 *
 * 幂等：taskStore.findByKey 检查 (listing-stale-maintenance, listingId, sourceVersion=1) 是否已存在。
 *
 * 时间边界：使用 Asia/Shanghai 自然日边界（computeShanghaiDayBoundary），
 * 每日 00:15 调用，asOf 落在当日；同日重复调用由 hasScanRun 兜底跳过。
 */
export async function scanStaleMaintenances(
  ctx: SlaScanContext,
): Promise<SlaScanItemResult<ListingScanRecord>[]> {
  const candidates = await ctx.slaScanStore.listStaleListings(ctx.asOf)
  const results: SlaScanItemResult<ListingScanRecord>[] = []
  // 维护扫描的 dueAt：扫描时间 + 默认 SLA 时限（M6.5 设为 7 天提醒）
  // 注意 TASK_TYPE_DEFAULT_SLA_MS['listing-stale-maintenance'] = 0（无默认时限）
  // 扫描器直接指定 dueAt = asOf + 7 天（design 未明示，按低优先级 normal 处理）
  const dueAt = new Date(
    new Date(ctx.asOf).getTime() + 7 * 24 * 60 * 60 * 1000,
  ).toISOString()

  for (const listing of candidates) {
    const deadline = computeStaleMaintenanceDeadline(
      listing.lastEffectiveMaintainedAt ?? null,
      listing.updatedAt,
    )

    // 1. 构造 listing-stale-maintenance 草稿
    const draft: TaskDraft = buildStaleMaintenanceTask({
      listingId: listing.listingId,
      asOf: ctx.asOf,
      dueAt,
      metadata: {
        deadline,
        updatedAt: listing.updatedAt,
        lastEffectiveMaintainedAt: listing.lastEffectiveMaintainedAt ?? null,
        scanBoundary: computeShanghaiDayBoundary(ctx.asOf).dayKey,
      },
    })

    // 2. 幂等检查：相同 taskType + sourceId + sourceVersion 已存在则跳过
    const existing = await ctx.taskStore.findByKey({
      taskType: draft.taskType,
      sourceId: draft.sourceId,
      sourceVersion: draft.sourceVersion,
    })
    if (existing) {
      results.push({
        record: listing,
        action: 'skipped_existing_task',
        taskId: existing.id,
      })
      continue
    }

    // 3. 创建任务
    try {
      const task = await ctx.taskStore.create({
        taskType: draft.taskType,
        sourceId: draft.sourceId,
        sourceVersion: draft.sourceVersion,
        sourceType: 'listing',
        status: 'pending',
        priority: draft.priority,
        dueAt: draft.dueAt,
        assigneeId: draft.assigneeId ?? null,
        teamId: draft.teamId ?? null,
        metadata: draft.metadata ?? null,
      })
      results.push({
        record: listing,
        action: 'created_task',
        taskId: task.id,
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      results.push({
        record: listing,
        action: 'failed',
        error: message,
      })
    }
  }

  return results
}

/**
 * SLA 扫描总入口：根据 scanType 调用对应扫描，并汇总结果。
 *
 * 幂等：
 *   - 入口级：hasScanRun(scanType, asOf) 检查是否已扫描过；已扫描则直接返回 skipped=true
 *   - 事件级 / 任务级：各扫描函数内部做幂等检查
 *
 * 返回 SlaScanSummary，调用方按需记录日志或触发告警。
 */
export async function runSlaScan(
  ctx: SlaScanContext,
  scanType: SlaScanType,
): Promise<SlaScanSummary> {
  if (!isSlaScanType(scanType)) {
    return {
      scanType,
      asOf: ctx.asOf,
      skipped: false,
      candidates: 0,
      eventsCreated: 0,
      tasksCreated: 0,
      eventsSkipped: 0,
      tasksSkipped: 0,
      failed: 1,
      items: [],
      completedAt: ctx.now ?? new Date().toISOString(),
    }
  }

  // 1. 入口级幂等：相同 scanType + asOf 不重复扫描
  const alreadyRun = await ctx.slaScanStore.hasScanRun(scanType, ctx.asOf)
  if (alreadyRun) {
    return {
      scanType,
      asOf: ctx.asOf,
      skipped: true,
      skipReason: 'already_run',
      candidates: 0,
      eventsCreated: 0,
      tasksCreated: 0,
      eventsSkipped: 0,
      tasksSkipped: 0,
      failed: 0,
      items: [],
      completedAt: ctx.now ?? new Date().toISOString(),
    }
  }

  // 2. 调用对应扫描函数
  let items: SlaScanItemResult[]
  if (scanType === 'first-followup') {
    items = await scanFirstFollowupBreaches(ctx)
  } else if (scanType === 'public-pool') {
    items = await scanPublicPoolReclaims(ctx)
  } else {
    items = await scanStaleMaintenances(ctx)
  }

  // 3. 标记扫描完成
  const completedAt = ctx.now ?? new Date().toISOString()
  await ctx.slaScanStore.markScanRun(scanType, ctx.asOf, completedAt)

  // 4. 汇总
  let eventsCreated = 0
  let tasksCreated = 0
  let eventsSkipped = 0
  let tasksSkipped = 0
  let failed = 0
  for (const item of items) {
    if (item.action === 'created_event') eventsCreated++
    else if (item.action === 'created_task') tasksCreated++
    else if (item.action === 'skipped_already_breached') eventsSkipped++
    else if (item.action === 'skipped_existing_task') tasksSkipped++
    else if (item.action === 'failed') failed++
  }

  return {
    scanType,
    asOf: ctx.asOf,
    skipped: false,
    candidates: items.length,
    eventsCreated,
    tasksCreated,
    eventsSkipped,
    tasksSkipped,
    failed,
    items,
    completedAt,
  }
}

// ────────────────────────────────────────────────────────────
// 内部辅助：扫描器创建 followup-first 任务（幂等）
// ────────────────────────────────────────────────────────────

/** ensureFollowupFirstTask 结果 */
type EnsureTaskResult =
  | { ok: true; created: boolean; taskId: string | number }
  | { ok: false; error: string }

/**
 * 创建 followup-first 待办（幂等）。
 *
 * 幂等键：taskType='followup-first' + sourceId=leadId + sourceVersion=1（扫描器固定版本号）
 *
 * 注意：扫描器固定 sourceVersion=1，与事件驱动路径（lead.assigned 事件用其 aggregateVersion）
 * 不同。这意味着扫描器创建的任务与事件驱动创建的任务可能并存（不同 sourceVersion）。
 * 实际业务上扫描器仅在事件驱动漏创建时兜底；M6.5 阶段接受这种设计。
 */
async function ensureFollowupFirstTask(
  ctx: SlaScanContext,
  lead: LeadScanRecord,
  eventId: string,
): Promise<EnsureTaskResult> {
  // 幂等检查
  const existing = await ctx.taskStore.findByKey({
    taskType: 'followup-first',
    sourceId: lead.leadId,
    sourceVersion: 1,
  })
  if (existing) {
    return { ok: true, created: false, taskId: existing.id }
  }

  // 计算截止时间：assignedAt + 4h（与事件驱动一致）
  const dueAt = new Date(
    new Date(lead.assignedAt).getTime() + TASK_TYPE_DEFAULT_SLA_MS['followup-first'],
  ).toISOString()

  try {
    const task = await ctx.taskStore.create({
      taskType: 'followup-first',
      sourceId: lead.leadId,
      sourceVersion: 1,
      sourceType: 'lead',
      status: 'pending',
      priority: 'urgent',
      dueAt,
      assigneeId: lead.assigneeId ?? null,
      teamId: null,
      metadata: {
        leadId: lead.leadId,
        eventId,
        scanSource: 'sla-scanner',
        slaType: 'first_followup',
      },
    })
    return { ok: true, created: true, taskId: task.id }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { ok: false, error: message }
  }
}

// ────────────────────────────────────────────────────────────
// In-memory SlaScanStore（用于单元测试）
// ────────────────────────────────────────────────────────────

/**
 * 创建内存版 SlaScanStore（用于单元测试）。
 *
 * 真实环境由 Payload Local API 包装实现（查询 leads / listings + scan_runs 标记表）。
 *
 * 测试用法：
 *   ```ts
 *   const slaScanStore = createInMemorySlaScanStore()
 *   slaScanStore.seedLeads({ firstFollowup: [...], publicPool: [...] })
 *   slaScanStore.seedListings({ stale: [...] })
 *   ```
 */
export function createInMemorySlaScanStore(): SlaScanStore & {
  /** 测试辅助：seed lead 候选数据 */
  seedLeads(params: {
    firstFollowup?: LeadScanRecord[]
    publicPool?: LeadScanRecord[]
  }): void
  /** 测试辅助：seed listing 候选数据 */
  seedListings(params: { stale?: ListingScanRecord[] }): void
  /** 测试辅助：读取已扫描标记 */
  scanRuns(): ReadonlyMap<string, { scanType: SlaScanType; asOf: string; completedAt: string }>
  /** 测试辅助：重置内部状态 */
  reset(): void
} {
  let firstFollowupLeads: LeadScanRecord[] = []
  let publicPoolLeads: LeadScanRecord[] = []
  let staleListings: ListingScanRecord[] = []
  const scanRunsMap = new Map<string, { scanType: SlaScanType; asOf: string; completedAt: string }>()

  const keyOf = (scanType: SlaScanType, asOf: string) => `${scanType}::${asOf}`

  return {
    async listLeadsForFirstFollowupScan(): Promise<LeadScanRecord[]> {
      return [...firstFollowupLeads]
    },
    async listLeadsForPublicPoolScan(): Promise<LeadScanRecord[]> {
      return [...publicPoolLeads]
    },
    async listStaleListings(): Promise<ListingScanRecord[]> {
      return [...staleListings]
    },
    async hasScanRun(scanType, asOf): Promise<boolean> {
      return scanRunsMap.has(keyOf(scanType, asOf))
    },
    async markScanRun(scanType, asOf, completedAt): Promise<void> {
      scanRunsMap.set(keyOf(scanType, asOf), { scanType, asOf, completedAt })
    },
    seedLeads(params): void {
      if (params.firstFollowup) firstFollowupLeads = [...params.firstFollowup]
      if (params.publicPool) publicPoolLeads = [...params.publicPool]
    },
    seedListings(params): void {
      if (params.stale) staleListings = [...params.stale]
    },
    scanRuns(): ReadonlyMap<string, { scanType: SlaScanType; asOf: string; completedAt: string }> {
      return scanRunsMap
    },
    reset(): void {
      firstFollowupLeads = []
      publicPoolLeads = []
      staleListings = []
      scanRunsMap.clear()
    },
  }
}

// 兼容性导出（供调用方校验 SLA_BREACH_TYPES 完整性）
export { SLA_BREACH_TYPES, isSlaBreachType }

// 工具函数：将 OperationResult 风格转换为错误（仅用于内部测试辅助）
// 注：保持模块导出干净，不暴露 InvalidOperationError 实例
export function _validateScanContext(ctx: SlaScanContext): OperationResult<void> {
  if (!ctx.asOf || typeof ctx.asOf !== 'string') {
    return err(
      new InvalidOperationError({
        domain: 'workflow',
        code: 'SLA_SCAN_AS_OF_INVALID',
        message: 'asOf 必须为非空 ISO 字符串',
        details: { asOf: ctx.asOf },
      }),
    )
  }
  if (ctx.timezone !== 'Asia/Shanghai') {
    return err(
      new InvalidOperationError({
        domain: 'workflow',
        code: 'SLA_SCAN_TIMEZONE_INVALID',
        message: 'timezone 必须固定为 Asia/Shanghai',
        details: { timezone: ctx.timezone },
      }),
    )
  }
  return ok(undefined)
}
