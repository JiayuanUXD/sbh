/**
 * 待办注册表（tasks.md M6.4 / design §3.7 tasks / R6, R7, R8）
 *
 * 职责：
 *   - 定义 TaskRegistration 接口：taskType → 触发事件 / buildTask / 自动闭环事件类型
 *   - TaskRegistry：按 taskType 注册规则，按 eventType / taskType 查询
 *   - 6 种任务类型的规则注册（M4.5/M5 业务事件部分用 fixture 简化实现）
 *
 * 业务不变量（AGENTS.md §10）：
 *   - 待办由来源业务事件完成或取消，不允许只在待办页手工标记完成
 *   - 重复事件不会生成重复待办或通知（幂等键：taskType + sourceId + sourceVersion）
 *   - 跨对象副作用使用事务 Outbox（M6.3 已完成）
 *
 * 6 种任务规则（tasks.md M6.4）：
 *   1. review-pending
 *      - sourceEventType = 'listing.review_submitted'
 *      - completeOnEventTypes = ['listing.review_approved']
 *      - cancelOnEventTypes   = ['listing.review_rejected']
 *      - dueAt = occurredAt + 4h，priority = high
 *   2. report-triage
 *      - sourceEventType = 'report.sustained'（report.created 不存在，用 sustained 触发）
 *      - completeOnEventTypes = [] （sustained 即关闭，任务创建即来源已结束）
 *      - cancelOnEventTypes   = ['report.dismissed']
 *      - dueAt = occurredAt + 24h，priority = normal
 *   3. lead-unassigned
 *      - sourceEventType = 'lead.created'
 *      - completeOnEventTypes = ['lead.assigned']
 *      - cancelOnEventTypes   = ['lead.lost']
 *      - dueAt = occurredAt + 4h，priority = high
 *   4. followup-first
 *      - sourceEventType = 'lead.assigned'
 *      - completeOnEventTypes = ['followup.completed']
 *      - cancelOnEventTypes   = ['lead.lost']
 *      - dueAt = occurredAt + 4h，priority = urgent
 *   5. followup-next
 *      - sourceEventType = 'followup.completed'
 *      - completeOnEventTypes = ['followup.completed']（下次跟进完成后再次创建）
 *      - cancelOnEventTypes   = ['lead.lost']
 *      - 仅当 payload.nextFollowupAt 存在时创建；dueAt = nextFollowupAt
 *   6. listing-stale-maintenance
 *      - sourceEventType = null（SLA 扫描器直接调用 buildTaskFromScan）
 *      - completeOnEventTypes = []
 *      - cancelOnEventTypes   = ['listing.published', 'listing.unpublished']
 *      - dueAt / priority 由扫描器计算
 */

import type { DomainEvent } from './event-publisher'
import type { EventType } from './event-types'
import {
  TASK_TYPE_DEFAULT_PRIORITY,
  TASK_TYPE_DEFAULT_SLA_MS,
  TASK_TYPE_SOURCE_TYPE,
  TASK_TYPE_TRIGGER_EVENT,
  type TaskType,
} from './task-types'
import type { TaskPriority } from './task-status'

/**
 * 待办构建上下文：提供给 buildTask 使用，主要用于时间冻结和测试注入。
 */
export interface TaskBuildContext {
  /**
   * 推导 dueAt 的参考时刻（UTC ISO 字符串）。
   * 默认取当前 UTC；测试中可注入冻结时间。
   */
  now?: string
}

/**
 * 待办草稿（buildTask 输出，尚未落库）。
 *
 * 由 task-service.createTaskFromEvent 调用 TaskStore.create 写入 Collection。
 * 字段对齐 Tasks Collection：sourceType 由 taskType 派生，不需调用方传入。
 */
export interface TaskDraft {
  /** 任务类型 */
  taskType: TaskType
  /** 来源业务对象 ID（字符串形式） */
  sourceId: string
  /** 来源版本号（≥1，用于幂等键） */
  sourceVersion: number
  /** 截止时间（UTC ISO 字符串） */
  dueAt: string
  /** 优先级 */
  priority: TaskPriority
  /** 指派给（user ID，可选） */
  assigneeId?: string | number | null
  /** 团队（team ID，可选） */
  teamId?: string | number | null
  /** 元数据（扩展字段，可选） */
  metadata?: Record<string, unknown> | null
}

/**
 * 任务注册项：声明一种任务类型的生成规则。
 *
 * - sourceEventType=null 表示由 SLA 扫描器直接调用，不响应领域事件
 * - buildTask 返回 null 表示该事件不创建任务（如 followup.completed 但无 nextFollowupAt）
 * - completeOnEventTypes: 这些事件发生时，task-service 调用 completeTask 自动闭环
 * - cancelOnEventTypes: 这些事件发生时，task-service 调用 cancelTask 自动取消
 *
 * 注意：completeOnEventTypes 与 cancelOnEventTypes 不应重叠（同一事件不能既完成又取消）。
 */
export interface TaskRegistration {
  /** 任务类型 */
  taskType: TaskType
  /** 触发该任务创建的来源事件类型；null 表示由扫描器调用 */
  sourceEventType: EventType | null
  /**
   * 根据事件构建任务草稿。
   * 返回 null 表示该事件不创建任务（条件不满足，如 followup.completed 但无 nextFollowupAt）。
   */
  buildTask(event: DomainEvent, ctx: TaskBuildContext): TaskDraft | null
  /** 来源"完成"事件类型：这些事件发生时自动闭环任务为 completed */
  completeOnEventTypes: readonly EventType[]
  /** 来源"取消"事件类型：这些事件发生时自动取消任务为 cancelled */
  cancelOnEventTypes: readonly EventType[]
}

/**
 * 待办注册表。
 *
 * 注册 TaskRegistration，按 eventType / taskType 查询：
 *   - findByEventType(eventType): 返回所有 sourceEventType=eventType 的注册
 *   - findByCompleteEvent(eventType): 返回所有 completeOnEventTypes 包含 eventType 的注册
 *   - findByCancelEvent(eventType): 返回所有 cancelOnEventTypes 包含 eventType 的注册
 *   - findByTaskType(taskType): 返回 taskType 对应的注册
 *
 * 一个 eventType 可触发多个 taskType 的创建（如 followup.completed 同时
 * 完成 followup-first 并创建 followup-next），故 findByEventType 返回数组。
 */
export class TaskRegistry {
  private readonly byTaskType = new Map<TaskType, TaskRegistration>()
  /** sourceEventType → Registrations（一个事件可触发多个 taskType） */
  private readonly bySourceEvent = new Map<EventType, TaskRegistration[]>()
  /** completeEventType → Registrations */
  private readonly byCompleteEvent = new Map<EventType, TaskRegistration[]>()
  /** cancelEventType → Registrations */
  private readonly byCancelEvent = new Map<EventType, TaskRegistration[]>()

  /** 注册任务生成规则；同一 taskType 重复注册将抛错（防止意外覆盖） */
  register(registration: TaskRegistration): void {
    if (this.byTaskType.has(registration.taskType)) {
      throw new Error(`TaskRegistry: 任务类型 ${registration.taskType} 已注册`)
    }
    this.byTaskType.set(registration.taskType, registration)
    if (registration.sourceEventType !== null) {
      const list = this.bySourceEvent.get(registration.sourceEventType) ?? []
      list.push(registration)
      this.bySourceEvent.set(registration.sourceEventType, list)
    }
    for (const et of registration.completeOnEventTypes) {
      const list = this.byCompleteEvent.get(et) ?? []
      list.push(registration)
      this.byCompleteEvent.set(et, list)
    }
    for (const et of registration.cancelOnEventTypes) {
      const list = this.byCancelEvent.get(et) ?? []
      list.push(registration)
      this.byCancelEvent.set(et, list)
    }
  }

  /** 按 taskType 查找注册 */
  findByTaskType(taskType: TaskType): TaskRegistration | undefined {
    return this.byTaskType.get(taskType)
  }

  /** 按 sourceEventType 查找所有受触发的注册 */
  findByEventType(eventType: EventType): TaskRegistration[] {
    return this.bySourceEvent.get(eventType) ?? []
  }

  /** 按 completeEventType 查找所有应自动完成的任务类型注册 */
  findByCompleteEvent(eventType: EventType): TaskRegistration[] {
    return this.byCompleteEvent.get(eventType) ?? []
  }

  /** 按 cancelEventType 查找所有应自动取消的任务类型注册 */
  findByCancelEvent(eventType: EventType): TaskRegistration[] {
    return this.byCancelEvent.get(eventType) ?? []
  }

  /** 当前已注册的全部 taskType */
  listTaskTypes(): TaskType[] {
    return Array.from(this.byTaskType.keys())
  }
}

// ────────────────────────────────────────────────────────────
// 默认 buildTask 实现（6 种 taskType）
// ────────────────────────────────────────────────────────────

/**
 * 通用 dueAt 推导：事件 occurredAt + 默认 SLA 时限。
 *
 * - occurredAt 必须为合法 ISO 字符串；非法时回退到 ctx.now 或当前时间
 * - slaMs=0 表示无默认时限，返回 null
 */
function deriveDueAt(
  occurredAt: string | undefined,
  slaMs: number,
  ctx: TaskBuildContext,
): string | null {
  if (slaMs <= 0) return null
  const ref =
    occurredAt && !Number.isNaN(new Date(occurredAt).getTime())
      ? occurredAt
      : (ctx.now ?? new Date().toISOString())
  return new Date(new Date(ref).getTime() + slaMs).toISOString()
}

/** review-pending buildTask：来自 listing.review_submitted 事件 */
function buildReviewPending(
  event: DomainEvent,
  ctx: TaskBuildContext,
): TaskDraft | null {
  const payload = event.payload as { reviewId?: string; listingId?: string }
  const sourceId = String(payload.reviewId ?? event.aggregateId)
  const dueAt =
    deriveDueAt(event.occurredAt, TASK_TYPE_DEFAULT_SLA_MS['review-pending'], ctx) ??
    (ctx.now ?? new Date().toISOString())
  return {
    taskType: 'review-pending',
    sourceId,
    sourceVersion: event.aggregateVersion,
    dueAt,
    priority: TASK_TYPE_DEFAULT_PRIORITY['review-pending'],
    metadata: { listingId: payload.listingId ?? null, eventId: event.eventId },
  }
}

/** report-triage buildTask：来自 report.sustained 事件 */
function buildReportTriage(
  event: DomainEvent,
  ctx: TaskBuildContext,
): TaskDraft | null {
  const payload = event.payload as { reportId?: string; targetListingId?: string }
  const sourceId = String(payload.reportId ?? event.aggregateId)
  const dueAt =
    deriveDueAt(event.occurredAt, TASK_TYPE_DEFAULT_SLA_MS['report-triage'], ctx) ??
    (ctx.now ?? new Date().toISOString())
  return {
    taskType: 'report-triage',
    sourceId,
    sourceVersion: event.aggregateVersion,
    dueAt,
    priority: TASK_TYPE_DEFAULT_PRIORITY['report-triage'],
    metadata: { targetListingId: payload.targetListingId ?? null, eventId: event.eventId },
  }
}

/** lead-unassigned buildTask：来自 lead.created 事件 */
function buildLeadUnassigned(
  event: DomainEvent,
  ctx: TaskBuildContext,
): TaskDraft | null {
  const payload = event.payload as { leadId?: string }
  const sourceId = String(payload.leadId ?? event.aggregateId)
  const dueAt =
    deriveDueAt(event.occurredAt, TASK_TYPE_DEFAULT_SLA_MS['lead-unassigned'], ctx) ??
    (ctx.now ?? new Date().toISOString())
  return {
    taskType: 'lead-unassigned',
    sourceId,
    sourceVersion: event.aggregateVersion,
    dueAt,
    priority: TASK_TYPE_DEFAULT_PRIORITY['lead-unassigned'],
    metadata: { leadId: sourceId, eventId: event.eventId },
  }
}

/** followup-first buildTask：来自 lead.assigned 事件 */
function buildFollowupFirst(
  event: DomainEvent,
  ctx: TaskBuildContext,
): TaskDraft | null {
  const payload = event.payload as { leadId?: string; assigneeId?: string | number }
  const sourceId = String(payload.leadId ?? event.aggregateId)
  const dueAt =
    deriveDueAt(event.occurredAt, TASK_TYPE_DEFAULT_SLA_MS['followup-first'], ctx) ??
    (ctx.now ?? new Date().toISOString())
  return {
    taskType: 'followup-first',
    sourceId,
    sourceVersion: event.aggregateVersion,
    dueAt,
    priority: TASK_TYPE_DEFAULT_PRIORITY['followup-first'],
    assigneeId: payload.assigneeId ?? null,
    metadata: { leadId: sourceId, eventId: event.eventId },
  }
}

/** followup-next buildTask：来自 followup.completed 事件，仅当 nextFollowupAt 存在时创建 */
function buildFollowupNext(event: DomainEvent, _ctx: TaskBuildContext): TaskDraft | null {
  const payload = event.payload as {
    followupId?: string
    leadId?: string
    nextFollowupAt?: string | null
  }
  // 仅当 payload 含 nextFollowupAt 时创建下次跟进任务
  if (!payload.nextFollowupAt) return null
  const dueAt = payload.nextFollowupAt
  return {
    taskType: 'followup-next',
    sourceId: String(payload.followupId ?? event.aggregateId),
    sourceVersion: event.aggregateVersion,
    dueAt,
    priority: TASK_TYPE_DEFAULT_PRIORITY['followup-next'],
    metadata: { leadId: payload.leadId ?? null, eventId: event.eventId },
  }
}

/**
 * listing-stale-maintenance buildTask：由 SLA 扫描器调用，不响应事件。
 *
 * 此处仅占位（不会被事件触发）；扫描器通过 buildStaleMaintenanceTask 直接构造草稿。
 */
function buildStaleMaintenance(
  event: DomainEvent,
  _ctx: TaskBuildContext,
): TaskDraft | null {
  // 不响应事件路径；返回 null 让 task-service 跳过
  void event
  return null
}

/**
 * 显式构造 listing-stale-maintenance 草稿（供 SLA 扫描器使用，非事件驱动）。
 *
 * 扫描器传入 listingId / asOf / dueAt / priority，直接构造草稿写入 Collection。
 */
export function buildStaleMaintenanceTask(params: {
  listingId: string | number
  asOf: string
  dueAt: string
  priority?: TaskPriority
  metadata?: Record<string, unknown> | null
}): TaskDraft {
  const { listingId, asOf, dueAt, priority, metadata } = params
  return {
    taskType: 'listing-stale-maintenance',
    sourceId: String(listingId),
    sourceVersion: 1,
    dueAt,
    priority: priority ?? TASK_TYPE_DEFAULT_PRIORITY['listing-stale-maintenance'],
    metadata: { asOf, ...metadata },
  }
}

// ────────────────────────────────────────────────────────────
// 默认 TaskRegistry 实例（注册 6 种任务类型）
// ────────────────────────────────────────────────────────────

/**
 * 创建默认 TaskRegistry，注册全部 6 种任务类型规则。
 *
 * 调用方：
 *   - 生产：const registry = createDefaultTaskRegistry()
 *   - 测试：可单独 import TaskRegistry 自定义注册或覆盖
 */
export function createDefaultTaskRegistry(): TaskRegistry {
  const registry = new TaskRegistry()

  // 1. review-pending
  registry.register({
    taskType: 'review-pending',
    sourceEventType: TASK_TYPE_TRIGGER_EVENT['review-pending'],
    buildTask: buildReviewPending,
    completeOnEventTypes: ['listing.review_approved'],
    cancelOnEventTypes: ['listing.review_rejected'],
  })

  // 2. report-triage
  registry.register({
    taskType: 'report-triage',
    sourceEventType: TASK_TYPE_TRIGGER_EVENT['report-triage'],
    buildTask: buildReportTriage,
    // sustained 即关闭，无 complete 事件
    completeOnEventTypes: [],
    cancelOnEventTypes: ['report.dismissed'],
  })

  // 3. lead-unassigned
  registry.register({
    taskType: 'lead-unassigned',
    sourceEventType: TASK_TYPE_TRIGGER_EVENT['lead-unassigned'],
    buildTask: buildLeadUnassigned,
    completeOnEventTypes: ['lead.assigned', 'lead.transferred'],
    cancelOnEventTypes: ['lead.lost'],
  })

  // 4. followup-first
  registry.register({
    taskType: 'followup-first',
    sourceEventType: TASK_TYPE_TRIGGER_EVENT['followup-first'],
    buildTask: buildFollowupFirst,
    completeOnEventTypes: ['followup.completed'],
    cancelOnEventTypes: ['lead.lost'],
  })

  // 5. followup-next
  registry.register({
    taskType: 'followup-next',
    sourceEventType: TASK_TYPE_TRIGGER_EVENT['followup-next'],
    buildTask: buildFollowupNext,
    completeOnEventTypes: ['followup.completed'],
    cancelOnEventTypes: ['lead.lost'],
  })

  // 6. listing-stale-maintenance（不响应事件，由扫描器直接调用）
  registry.register({
    taskType: 'listing-stale-maintenance',
    sourceEventType: TASK_TYPE_TRIGGER_EVENT['listing-stale-maintenance'],
    buildTask: buildStaleMaintenance,
    completeOnEventTypes: [],
    cancelOnEventTypes: ['listing.published', 'listing.unpublished'],
  })

  return registry
}

/**
 * 暴露 buildTask 工厂函数集合，便于单元测试单独断言每种 taskType 的草稿构造。
 *
 * 测试可直接 import 这些函数，无需经过 registry 路径。
 */
export const TASK_BUILDERS = {
  'review-pending': buildReviewPending,
  'report-triage': buildReportTriage,
  'lead-unassigned': buildLeadUnassigned,
  'followup-first': buildFollowupFirst,
  'followup-next': buildFollowupNext,
  'listing-stale-maintenance': buildStaleMaintenance,
} as const
