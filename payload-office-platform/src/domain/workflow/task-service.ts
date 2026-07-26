/**
 * 待办领域服务（tasks.md M6.4 / design §3.7 tasks / R6, R7, R8）
 *
 * 职责：
 *   - createTaskFromEvent: 根据事件创建待办（幂等：taskType+sourceId+sourceVersion）
 *   - completeTask: 完成任务（校验状态、设置 completedAt/completionEventId）
 *   - cancelTask: 取消任务（校验状态、设置 cancelledAt/cancellationReason）
 *   - autoCloseOnSourceCompletion: 来源完成事件 → 自动闭环任务为 completed
 *   - autoCancelOnSourceCancellation: 来源取消事件 → 自动取消任务为 cancelled
 *
 * 业务不变量（AGENTS.md §10）：
 *   - 待办由来源业务事件完成或取消，不允许只在待办页手工标记完成
 *   - 重复事件不会生成重复待办或通知（幂等键：taskType + sourceId + sourceVersion）
 *   - 跨对象副作用使用事务 Outbox（M6.3 已完成；任务自身状态变更不入 Outbox，
 *     仅记录 completionEventId 引用来源事件，避免事件循环依赖）
 *
 * 设计取舍：
 *   - task-service 不直接依赖 Payload Local API：通过 TaskStore 接口抽象，
 *     便于单元测试和未来替换为消息队列
 *   - 任务状态变更不写入 Outbox（design §3.7 未定义 task.* 事件类型）；
 *     completionEventId 字段记录来源事件 ID 供审计回溯
 *   - autoClose/autoCancel 内部调用 completeTask/cancelTask，复用幂等和状态校验
 */

import { InvalidOperationError } from '@/domain/shared/errors'
import { ok, err, type OperationResult } from '@/domain/shared/result'

import type { DomainEvent } from './event-publisher'
import type { EventType } from './event-types'
import {
  TASK_TYPE_SOURCE_TYPE,
  type TaskType,
} from './task-types'
import {
  canTransitionTask,
  isTerminalTaskStatus,
  isTaskStatus,
  type TaskStatus,
} from './task-status'
import type {
  TaskBuildContext,
  TaskDraft,
  TaskRegistration,
  TaskRegistry,
} from './task-registry'

/** 已落库的待办记录（与 Tasks Collection 字段对齐）。 */
export interface TaskRecord {
  id: string | number
  taskType: TaskType
  sourceId: string
  sourceVersion: number
  sourceType: string
  status: TaskStatus
  priority: string
  dueAt: string
  assigneeId?: string | number | null
  teamId?: string | number | null
  completedAt?: string | null
  cancelledAt?: string | null
  cancellationReason?: string | null
  completionEventId?: string | null
  metadata?: Record<string, unknown> | null
}

/**
 * 待办存储接口（抽象持久层）。
 *
 * 真实实现由 Payload Local API 提供；测试用 in-memory 实现。
 *
 * 所有方法均以 taskType + sourceId + sourceVersion 作为幂等键。
 */
export interface TaskStore {
  /**
   * 查找匹配幂等键的任务。
   * 用于 createTaskFromEvent 幂等检查：重复事件不重复创建。
   */
  findByKey(params: {
    taskType: TaskType
    sourceId: string
    sourceVersion: number
  }): Promise<TaskRecord | null>

  /** 按 ID 读取任务 */
  getById(id: string | number): Promise<TaskRecord | null>

  /** 查找某来源业务对象（sourceType + sourceId）下的所有非终态任务 */
  findActiveBySource(params: {
    sourceType: string
    sourceId: string
  }): Promise<TaskRecord[]>

  /** 创建任务 */
  create(params: {
    taskType: TaskType
    sourceId: string
    sourceVersion: number
    sourceType: string
    status: TaskStatus
    priority: string
    dueAt: string
    assigneeId?: string | number | null
    teamId?: string | number | null
    metadata?: Record<string, unknown> | null
    /** M6.6 测试辅助：种子终态任务时直接指定完成 / 取消时间戳 */
    completedAt?: string | null
    cancelledAt?: string | null
    cancellationReason?: string | null
  }): Promise<TaskRecord>

  /** 更新任务状态及关联字段（M6.6 扩展：assigneeId / teamId 用于领取 / 转派） */
  update(params: {
    id: string | number
    status?: TaskStatus
    completedAt?: string | null
    cancelledAt?: string | null
    cancellationReason?: string | null
    completionEventId?: string | null
    /** 领取 / 转派后的新负责人 ID */
    assigneeId?: string | number | null
    /** 转派后的新团队 ID */
    teamId?: string | number | null
  }): Promise<TaskRecord>
}

/** 服务调用上下文：提供时间冻结和操作人 ID。 */
export interface TaskServiceContext extends TaskBuildContext {
  /** 当前操作人 ID（用于审计；M6.4 暂不写审计日志，留作扩展） */
  actorId?: string | number
}

/**
 * 根据事件创建待办（幂等）。
 *
 * 幂等机制：
 *   1. 通过 registry.findByEventType 找到该事件触发的所有注册
 *   2. 对每个注册调用 buildTask 得到草稿（返回 null 跳过）
 *   3. 通过 store.findByKey 检查 (taskType, sourceId, sourceVersion) 是否已存在
 *   4. 已存在 → 跳过（返回 skipped）；不存在 → store.create 创建
 *
 * 返回每个注册的处理结果（数组），调用方按需记录日志或触发通知。
 */
export async function createTaskFromEvent(
  event: DomainEvent,
  ctx: TaskServiceContext,
  registry: TaskRegistry,
  store: TaskStore,
): Promise<Array<
  | { ok: true; task: TaskRecord; taskType: TaskType; skipped: false }
  | { ok: true; task: null; taskType: TaskType; skipped: true }
  | { ok: false; taskType: TaskType; error: Error }
>> {
  const registrations = registry.findByEventType(event.eventType as EventType)
  const results: Array<
    | { ok: true; task: TaskRecord; taskType: TaskType; skipped: false }
    | { ok: true; task: null; taskType: TaskType; skipped: true }
    | { ok: false; taskType: TaskType; error: Error }
  > = []

  for (const reg of registrations) {
    try {
      // 调用 buildTask 构造草稿
      const draft: TaskDraft | null = reg.buildTask(event, { now: ctx.now })
      if (draft === null) {
        // 该事件不创建任务（如 followup.completed 无 nextFollowupAt）
        results.push({ ok: true, task: null, taskType: reg.taskType, skipped: true })
        continue
      }

      // 幂等检查：相同 taskType+sourceId+sourceVersion 已存在则跳过
      const existing = await store.findByKey({
        taskType: draft.taskType,
        sourceId: draft.sourceId,
        sourceVersion: draft.sourceVersion,
      })
      if (existing) {
        results.push({ ok: true, task: null, taskType: reg.taskType, skipped: true })
        continue
      }

      // sourceType 由 taskType 派生（防止调用方传入不一致值）
      const sourceType = TASK_TYPE_SOURCE_TYPE[draft.taskType]

      // 创建任务
      const record = await store.create({
        taskType: draft.taskType,
        sourceId: draft.sourceId,
        sourceVersion: draft.sourceVersion,
        sourceType,
        status: 'pending',
        priority: draft.priority,
        dueAt: draft.dueAt,
        assigneeId: draft.assigneeId ?? null,
        teamId: draft.teamId ?? null,
        metadata: draft.metadata ?? null,
      })

      results.push({ ok: true, task: record, taskType: reg.taskType, skipped: false })
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e))
      results.push({ ok: false, taskType: reg.taskType, error })
    }
  }

  return results
}

/**
 * 完成任务。
 *
 * - 校验当前状态为 in_progress（pending → completed 不允许直跳，需先领取）
 *   但来源事件驱动的自动闭环通常 pending 直接 complete，故此处放宽：
 *   pending 或 in_progress 均允许转 completed（业务事件驱动是合法路径）
 *   （AGENTS.md §10：待办由来源业务事件完成，不允许只在待办页手工标记完成）
 * - 设置 completedAt + completionEventId
 * - 终态任务拒绝再次完成
 */
export async function completeTask(
  taskId: string | number,
  completionEventId: string,
  ctx: TaskServiceContext,
  store: TaskStore,
): Promise<OperationResult<TaskRecord>> {
  const record = await store.getById(taskId)
  if (!record) {
    return err(
      new InvalidOperationError({
        domain: 'workflow',
        code: 'TASK_NOT_FOUND',
        message: '待办不存在',
        details: { taskId },
      }),
    )
  }

  if (!isTaskStatus(record.status)) {
    return err(
      new InvalidOperationError({
        domain: 'workflow',
        code: 'TASK_STATUS_INVALID',
        message: '待办当前状态非法',
        details: { taskId, status: record.status },
      }),
    )
  }

  if (isTerminalTaskStatus(record.status)) {
    return err(
      new InvalidOperationError({
        domain: 'workflow',
        code: 'TASK_ALREADY_TERMINAL',
        message: `待办已处于终态（${record.status}），不可再次完成`,
        details: { taskId, status: record.status },
      }),
    )
  }

  // pending → completed：业务事件驱动允许（design §10 / AGENTS.md §10）
  // in_progress → completed：常规路径
  // 终态已被 isTerminalTaskStatus 拦截，此处仅剩 pending / in_progress，
  // 两者均允许转 completed，无需再调 canTransitionTask（状态机对 pending → completed
  // 严格禁止手工直跳，但服务层放行事件驱动路径）。

  const completedAt = ctx.now ?? new Date().toISOString()
  const updated = await store.update({
    id: taskId,
    status: 'completed',
    completedAt,
    completionEventId,
  })

  void ctx // actorId 暂留扩展位
  return ok(updated)
}

/**
 * 取消任务。
 *
 * - pending / in_progress → cancelled 允许
 * - 终态任务拒绝再次取消
 * - 必须填写 cancellationReason（来源取消原因）
 */
export async function cancelTask(
  taskId: string | number,
  reason: string,
  ctx: TaskServiceContext,
  store: TaskStore,
): Promise<OperationResult<TaskRecord>> {
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    return err(
      new InvalidOperationError({
        domain: 'workflow',
        code: 'TASK_CANCEL_REASON_REQUIRED',
        message: '取消待办必须填写原因',
        details: { taskId },
      }),
    )
  }

  const record = await store.getById(taskId)
  if (!record) {
    return err(
      new InvalidOperationError({
        domain: 'workflow',
        code: 'TASK_NOT_FOUND',
        message: '待办不存在',
        details: { taskId },
      }),
    )
  }

  if (!isTaskStatus(record.status)) {
    return err(
      new InvalidOperationError({
        domain: 'workflow',
        code: 'TASK_STATUS_INVALID',
        message: '待办当前状态非法',
        details: { taskId, status: record.status },
      }),
    )
  }

  if (isTerminalTaskStatus(record.status)) {
    return err(
      new InvalidOperationError({
        domain: 'workflow',
        code: 'TASK_ALREADY_TERMINAL',
        message: `待办已处于终态（${record.status}），不可再次取消`,
        details: { taskId, status: record.status },
      }),
    )
  }

  if (!canTransitionTask(record.status, 'cancelled')) {
    return err(
      new InvalidOperationError({
        domain: 'workflow',
        code: 'TASK_ILLEGAL_TRANSITION',
        message: `待办不允许从 ${record.status} 切换到 cancelled`,
        details: { taskId, from: record.status, to: 'cancelled' },
      }),
    )
  }

  const cancelledAt = ctx.now ?? new Date().toISOString()
  const updated = await store.update({
    id: taskId,
    status: 'cancelled',
    cancelledAt,
    cancellationReason: reason,
  })

  void ctx
  return ok(updated)
}

/**
 * 来源"完成"事件触发：自动闭环所有相关任务为 completed。
 *
 * 流程：
 *   1. registry.findByCompleteEvent(eventType) 找到所有 completeOnEventTypes 包含该事件的注册
 *   2. 对每个注册，找出该 sourceType + sourceId 下活跃（非终态）的任务
 *   3. 逐个调用 completeTask（completionEventId = event.eventId）
 *
 * 幂等：
 *   - 终态任务在 completeTask 内被拒绝（不会重复完成）
 *   - 同一事件重复投递由 Outbox 消费器保证（M6.3 已实现）
 */
export async function autoCloseOnSourceCompletion(
  event: DomainEvent,
  ctx: TaskServiceContext,
  registry: TaskRegistry,
  store: TaskStore,
): Promise<Array<{ taskType: TaskType; taskId: string | number; ok: boolean; error?: string }>> {
  const registrations = registry.findByCompleteEvent(event.eventType as EventType)
  const results: Array<{
    taskType: TaskType
    taskId: string | number
    ok: boolean
    error?: string
  }> = []

  for (const reg of registrations) {
    const sourceType = TASK_TYPE_SOURCE_TYPE[reg.taskType]
    // 优先使用 payload 中的派生 ID（reviewId / reportId / leadId / followupId / listingId）
    // 回退到 event.aggregateId（适用于 aggregateId 即 sourceId 的场景，如 lead.assigned）
    const payload = (event.payload ?? {}) as Record<string, unknown>
    const derivedId = deriveSourceIdFromPayload(payload, event.aggregateId)
    const sourceId = String(derivedId)
    const activeTasks = await store.findActiveBySource({ sourceType, sourceId })

    for (const task of activeTasks) {
      // 仅匹配该注册的 taskType（来源业务对象下可能存在多种任务）
      if (task.taskType !== reg.taskType) continue
      const result = await completeTask(task.id, event.eventId, ctx, store)
      if (result.ok) {
        results.push({ taskType: reg.taskType, taskId: task.id, ok: true })
      } else {
        results.push({
          taskType: reg.taskType,
          taskId: task.id,
          ok: false,
          error: result.error.message,
        })
      }
    }
  }

  return results
}

/**
 * 来源"取消"事件触发：自动取消所有相关任务为 cancelled。
 *
 * 流程：
 *   1. registry.findByCancelEvent(eventType) 找到所有 cancelOnEventTypes 包含该事件的注册
 *   2. 对每个注册，找出该 sourceType + sourceId 下活跃任务
 *   3. 逐个调用 cancelTask（reason 由事件 payload 派生）
 */
export async function autoCancelOnSourceCancellation(
  event: DomainEvent,
  ctx: TaskServiceContext,
  registry: TaskRegistry,
  store: TaskStore,
): Promise<Array<{ taskType: TaskType; taskId: string | number; ok: boolean; error?: string }>> {
  const registrations = registry.findByCancelEvent(event.eventType as EventType)
  const results: Array<{
    taskType: TaskType
    taskId: string | number
    ok: boolean
    error?: string
  }> = []

  for (const reg of registrations) {
    const sourceType = TASK_TYPE_SOURCE_TYPE[reg.taskType]
    // 优先使用 payload 中的派生 ID（reviewId / reportId / leadId / followupId / listingId）
    const payload = (event.payload ?? {}) as Record<string, unknown>
    const derivedId = deriveSourceIdFromPayload(payload, event.aggregateId)
    const sourceId = String(derivedId)

    const activeTasks = await store.findActiveBySource({ sourceType, sourceId })

    for (const task of activeTasks) {
      if (task.taskType !== reg.taskType) continue
      // 派生取消原因：从事件类型 + payload.reason / conclusionReason 派生
      const reason = deriveCancellationReason(event, payload)
      const result = await cancelTask(task.id, reason, ctx, store)
      if (result.ok) {
        results.push({ taskType: reg.taskType, taskId: task.id, ok: true })
      } else {
        results.push({
          taskType: reg.taskType,
          taskId: task.id,
          ok: false,
          error: result.error.message,
        })
      }
    }
  }

  return results
}

/**
 * 从事件 payload 派生来源业务对象 ID（sourceId）。
 *
 * 不同 taskType 的 sourceId 字段名不同：
 *   - review-pending → reviewId
 *   - report-triage → reportId
 *   - lead-unassigned / followup-first → leadId
 *   - followup-next → followupId
 *   - listing-stale-maintenance → listingId
 *
 * 由于 autoClose/autoCancel 遍历所有注册，无法预知当前 reg 的字段名，
 * 故按优先级依次检查所有可能的字段；回退到 event.aggregateId。
 */
function deriveSourceIdFromPayload(
  payload: Record<string, unknown>,
  fallback: string | number,
): string | number {
  const candidates = [
    payload.reviewId,
    payload.reportId,
    payload.leadId,
    payload.followupId,
    payload.listingId,
  ]
  for (const c of candidates) {
    if (typeof c === 'string' || typeof c === 'number') {
      return c
    }
  }
  return fallback
}

/**
 * 从事件 payload 派生取消原因。
 *
 * 优先取 payload.reason / conclusionReason；缺省使用事件类型。
 */
function deriveCancellationReason(
  event: DomainEvent,
  payload: Record<string, unknown>,
): string {
  const reasonFromPayload =
    (typeof payload.reason === 'string' && payload.reason) ||
    (typeof payload.conclusionReason === 'string' && payload.conclusionReason) ||
    (typeof payload.cancellationReason === 'string' && payload.cancellationReason)
  if (reasonFromPayload) {
    return `来源事件 ${event.eventType}：${reasonFromPayload}`
  }
  return `来源事件 ${event.eventType} 触发自动取消`
}

// ────────────────────────────────────────────────────────────
// In-memory TaskStore（用于单元测试）
// ────────────────────────────────────────────────────────────

let _inMemoryIdCounter = 1

/**
 * 创建内存版 TaskStore（用于单元测试）。
 *
 * 真实环境由 Payload Local API 包装实现。
 */
export function createInMemoryTaskStore(): TaskStore & {
  /** 测试辅助：读取内部存储 */
  snapshot(): ReadonlyMap<string | number, TaskRecord>
  /** 测试辅助：清空存储并重置 ID 计数 */
  reset(): void
} {
  const store = new Map<string | number, TaskRecord>()
  return {
    async findByKey({ taskType, sourceId, sourceVersion }) {
      for (const r of store.values()) {
        if (
          r.taskType === taskType &&
          r.sourceId === sourceId &&
          r.sourceVersion === sourceVersion
        ) {
          return r
        }
      }
      return null
    },
    async getById(id) {
      return store.get(id) ?? null
    },
    async findActiveBySource({ sourceType, sourceId }) {
      const list: TaskRecord[] = []
      for (const r of store.values()) {
        if (r.sourceType !== sourceType) continue
        if (r.sourceId !== sourceId) continue
        if (!isTerminalTaskStatus(r.status as TaskStatus)) {
          list.push(r)
        }
      }
      return list
    },
    async create(params) {
      const id = _inMemoryIdCounter++
      const record: TaskRecord = {
        id,
        taskType: params.taskType,
        sourceId: params.sourceId,
        sourceVersion: params.sourceVersion,
        sourceType: params.sourceType,
        status: params.status,
        priority: params.priority,
        dueAt: params.dueAt,
        assigneeId: params.assigneeId ?? null,
        teamId: params.teamId ?? null,
        // M6.6：种子终态任务时由调用方指定；缺省 null
        completedAt: params.completedAt ?? null,
        cancelledAt: params.cancelledAt ?? null,
        cancellationReason: params.cancellationReason ?? null,
        completionEventId: null,
        metadata: params.metadata ?? null,
      }
      store.set(id, record)
      return record
    },
    async update(params) {
      const existing = store.get(params.id)
      if (!existing) {
        throw new InvalidOperationError({
          domain: 'workflow',
          code: 'TASK_NOT_FOUND',
          message: '待办不存在',
          details: { taskId: params.id },
        })
      }
      const updated: TaskRecord = {
        ...existing,
        status: params.status ?? existing.status,
        completedAt: params.completedAt ?? existing.completedAt,
        cancelledAt: params.cancelledAt ?? existing.cancelledAt,
        cancellationReason: params.cancellationReason ?? existing.cancellationReason,
        completionEventId: params.completionEventId ?? existing.completionEventId,
        // M6.6 扩展：领取 / 转派时更新 assigneeId / teamId
        assigneeId:
          params.assigneeId !== undefined ? params.assigneeId : existing.assigneeId,
        teamId: params.teamId !== undefined ? params.teamId : existing.teamId,
      }
      store.set(params.id, updated)
      return updated
    },
    snapshot() {
      return store
    },
    reset() {
      store.clear()
      _inMemoryIdCounter = 1
    },
  }
}
