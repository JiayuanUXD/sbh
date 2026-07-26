/**
 * 我的待办（tasks.md M6.6 / design §7.2 Custom Views / R1, R7）
 *
 * 职责：
 *   - sortMyTasks：按逾期 → 优先级 → 截止时间 → 创建时间稳定排序
 *   - buildSourceDeepLink：从 TaskRecord 派生来源深链（去处理入口）
 *   - claimTask：单条领取（pending → in_progress，写入 assigneeId）
 *   - transferTask：单条转派（保留 status，更新 assigneeId / teamId）
 *   - batchClaimTasks / batchTransferTasks：批量操作，限制 ≤ 50 条，逐条返回结果
 *
 * 业务不变量（AGENTS.md §10 / R7）：
 *   - 待办由来源业务事件完成或取消，但允许在工作台「领取」转为 in_progress
 *     或「转派」给他人（task:assign 权限门）
 *   - 批量操作上限 50 条且逐条返回成功 / 失败原因（design §10 批量限制）
 *   - 重复领取 / 转派幂等：相同状态再次领取视为成功（不报错）
 *
 * 设计取舍：
 *   - my-tasks 不直接依赖 Payload Local API：通过 TaskStore 接口抽象
 *   - 排序为纯函数，便于前端复用同一口径（服务端 + 客户端排序一致）
 *   - 深链由 taskType 派生（前缀 → Collection slug + 详情页路径）
 */

import { InvalidOperationError } from '@/domain/shared/errors'
import { ok, err, type OperationResult } from '@/domain/shared/result'

import {
  canTransitionTask,
  isTerminalTaskStatus,
  type TaskStatus,
} from './task-status'
import {
  TASK_PRIORITY_WEIGHT,
  type TaskPriority,
} from './task-status'
import { TASK_TYPE_SOURCE_TYPE, type TaskType } from './task-types'
import type { TaskRecord, TaskStore } from './task-service'

/** 批量操作上限（design §10 批量操作上限 50） */
export const MY_TASKS_BATCH_LIMIT = 50

/**
 * 待办排序上下文（用于 sortMyTasks 计算逾期）。
 */
export interface MyTasksSortContext {
  /** 当前时间（UTC ISO；测试可注入冻结时间） */
  now: string
}

/**
 * 按逾期 → 优先级 → 截止时间 → 创建时间稳定排序。
 *
 * 排序键（升序）：
 *   1. overdue（逾期 = 1，未逾期 = 0）：逾期任务排前
 *   2. priority weight（urgent < high < normal < low）：紧急在前
 *   3. dueAt（截止时间早的在前）
 *   4. createdAt（创建时间早的在前）
 *
 * 终态任务（completed / cancelled）排到末尾，并按 completedAt/cancelledAt 倒序。
 * 同状态同优先级同 dueAt 同 createdAt 时保持稳定（原数组顺序）。
 */
export function sortMyTasks(
  tasks: TaskRecord[],
  ctx: MyTasksSortContext,
): TaskRecord[] {
  const nowMs = new Date(ctx.now).getTime()
  // 拷贝后排序（不污染原数组）
  return [...tasks].sort((a, b) => {
    const aTerminal = isTerminalTaskStatus(a.status as TaskStatus)
    const bTerminal = isTerminalTaskStatus(b.status as TaskStatus)

    // 终态排末尾
    if (aTerminal !== bTerminal) return aTerminal ? 1 : -1

    // 活跃态：按逾期 → 优先级 → dueAt → createdAt 排序
    if (!aTerminal && !bTerminal) {
      const aOverdue = isOverdue(a, nowMs) ? 1 : 0
      const bOverdue = isOverdue(b, nowMs) ? 1 : 0
      if (aOverdue !== bOverdue) return aOverdue === 1 ? -1 : 1

      const aPri = TASK_PRIORITY_WEIGHT[a.priority as TaskPriority] ?? 99
      const bPri = TASK_PRIORITY_WEIGHT[b.priority as TaskPriority] ?? 99
      if (aPri !== bPri) return aPri - bPri

      const aDue = parseMs(a.dueAt)
      const bDue = parseMs(b.dueAt)
      if (aDue !== bDue) return aDue - bDue

      const aCreated = parseMs(getCreatedAt(a))
      const bCreated = parseMs(getCreatedAt(b))
      if (aCreated !== bCreated) return aCreated - bCreated
    }

    // 终态：按 completedAt / cancelledAt 倒序（最近处理的在前）
    if (aTerminal && bTerminal) {
      const aFinal = parseMs(a.completedAt ?? a.cancelledAt ?? a.dueAt)
      const bFinal = parseMs(b.completedAt ?? b.cancelledAt ?? b.dueAt)
      return bFinal - aFinal
    }

    return 0
  })
}

/** 任务是否逾期（活跃态且 dueAt < now） */
export function isOverdue(task: TaskRecord, nowMs: number): boolean {
  if (isTerminalTaskStatus(task.status as TaskStatus)) return false
  const dueMs = parseMs(task.dueAt)
  return dueMs < nowMs
}

/** 安全解析 ISO 时间字符串为毫秒数；非法返回 0 */
function parseMs(iso: string | null | undefined): number {
  if (!iso) return 0
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? 0 : t
}

/** 从 TaskRecord 提取 createdAt（M6.4 in-memory store 未直接维护 createdAt，回退 dueAt） */
function getCreatedAt(task: TaskRecord): string | null {
  // metadata.createdAt 优先；缺省回退 dueAt（保证稳定排序）
  const meta = task.metadata as Record<string, unknown> | null
  const fromMeta = meta?.createdAt
  if (typeof fromMeta === 'string') return fromMeta
  return task.dueAt
}

// ────────────────────────────────────────────────────────────
// 来源深链
// ────────────────────────────────────────────────────────────

/**
 * 来源深链（去处理入口）。
 * 前端按 taskType 跳转到对应 Collection 详情页。
 */
export interface TaskSourceDeepLink {
  /** Collection slug（如 'listing-reviews' / 'listing-reports' / 'leads' / 'listings'） */
  collectionSlug: string
  /** 来源业务对象 ID */
  sourceId: string
  /** 后台详情页相对路径（如 /admin/collections/listing-reviews/:id） */
  url: string
  /** 显示标签（如 '审核详情' / '举报详情' / '线索详情'） */
  label: string
}

/**
 * 从 TaskRecord 派生来源深链。
 *
 * taskType → Collection slug 映射：
 *   - review-pending         → listing-reviews（审核详情）
 *   - report-triage           → listing-reports（举报详情）
 *   - lead-unassigned         → leads（线索详情）
 *   - followup-first/next     → leads（线索详情，源 ID 为 leadId）
 *   - listing-stale-maintenance → listings（房源详情）
 *
 * followup-* 的 sourceId 是 followupId / leadId，跳转目标仍为 leads
 * （经纪人去处理 = 跟进线索）。metadata.leadId 优先于 sourceId。
 */
export function buildSourceDeepLink(task: TaskRecord): TaskSourceDeepLink {
  const meta = (task.metadata ?? {}) as Record<string, unknown>
  switch (task.taskType) {
    case 'review-pending': {
      return {
        collectionSlug: 'listing-reviews',
        sourceId: task.sourceId,
        url: `/admin/collections/listing-reviews/${task.sourceId}`,
        label: '审核详情',
      }
    }
    case 'report-triage': {
      return {
        collectionSlug: 'listing-reports',
        sourceId: task.sourceId,
        url: `/admin/collections/listing-reports/${task.sourceId}`,
        label: '举报详情',
      }
    }
    case 'lead-unassigned': {
      return {
        collectionSlug: 'leads',
        sourceId: task.sourceId,
        url: `/admin/collections/leads/${task.sourceId}`,
        label: '线索详情',
      }
    }
    case 'followup-first':
    case 'followup-next': {
      // followup 的 sourceId 可能是 followupId 或 leadId；
      // metadata.leadId 优先（更稳定的跳转目标）
      const leadId = typeof meta.leadId === 'string' ? meta.leadId : task.sourceId
      return {
        collectionSlug: 'leads',
        sourceId: leadId,
        url: `/admin/collections/leads/${leadId}`,
        label: '线索跟进',
      }
    }
    case 'listing-stale-maintenance': {
      return {
        collectionSlug: 'listings',
        sourceId: task.sourceId,
        url: `/admin/collections/listings/${task.sourceId}`,
        label: '房源维护',
      }
    }
    default: {
      return {
        collectionSlug: 'tasks',
        sourceId: String(task.id),
        url: `/admin/collections/tasks/${task.id}`,
        label: '待办详情',
      }
    }
  }
}

// ────────────────────────────────────────────────────────────
// 单条领取 / 转派
// ────────────────────────────────────────────────────────────

/** 领取上下文 */
export interface MyTasksActionContext {
  /** 当前操作人 ID */
  userId: string | number
  /** 当前时间（UTC ISO；测试可注入冻结时间） */
  now: string
  /** 待办存储 */
  taskStore: TaskStore
}

/**
 * 单条领取：将任务从 pending → in_progress 并设置 assigneeId。
 *
 * 幂等：
 *   - 已是 in_progress 且 assigneeId 已为当前用户 → 视为成功（不报错）
 *   - 已被他人领取（assigneeId != currentUser）→ 409（CLAIMED_BY_OTHER）
 *   - 终态任务 → 409（TASK_ALREADY_TERMINAL）
 *   - pending → in_progress 合法转换；in_progress → in_progress 不变（同用户）
 *
 * 返回 OperationResult<TaskRecord>。
 */
export async function claimTask(
  taskId: string | number,
  ctx: MyTasksActionContext,
): Promise<OperationResult<TaskRecord>> {
  const record = await ctx.taskStore.getById(taskId)
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

  // 终态拒绝
  if (isTerminalTaskStatus(record.status as TaskStatus)) {
    return err(
      new InvalidOperationError({
        domain: 'workflow',
        code: 'TASK_ALREADY_TERMINAL',
        message: `待办已处于终态（${record.status}），不可领取`,
        details: { taskId, status: record.status },
      }),
    )
  }

  // 已被他人领取 → 409
  if (
    record.status === 'in_progress' &&
    record.assigneeId !== null &&
    record.assigneeId !== undefined &&
    String(record.assigneeId) !== String(ctx.userId)
  ) {
    return err(
      new InvalidOperationError({
        domain: 'workflow',
        code: 'TASK_CLAIMED_BY_OTHER',
        message: '待办已被他人领取',
        details: { taskId, currentAssigneeId: record.assigneeId },
      }),
    )
  }

  // 同用户已领取（in_progress + assignee=self）→ 幂等返回当前记录
  if (
    record.status === 'in_progress' &&
    String(record.assigneeId) === String(ctx.userId)
  ) {
    return ok(record)
  }

  // pending → in_progress（合法转换）
  if (record.status === 'pending') {
    if (!canTransitionTask('pending', 'in_progress')) {
      return err(
        new InvalidOperationError({
          domain: 'workflow',
          code: 'TASK_ILLEGAL_TRANSITION',
          message: '待办不允许从 pending 切换到 in_progress',
          details: { taskId, from: 'pending', to: 'in_progress' },
        }),
      )
    }
  }

  const updated = await ctx.taskStore.update({
    id: taskId,
    status: 'in_progress',
    assigneeId: ctx.userId,
  })
  return ok(updated)
}

/**
 * 单条转派：保留 status，更新 assigneeId / teamId。
 *
 * 业务规则：
 *   - 终态任务拒绝转派
 *   - toUserId 必填
 *   - 转派不改变 status（pending 仍 pending / in_progress 仍 in_progress）
 *   - 转派后 assigneeId 切换为新用户；teamId 可选
 *
 * 返回 OperationResult<TaskRecord>。
 */
export async function transferTask(
  taskId: string | number,
  params: { toUserId: string | number; teamId?: string | number | null },
  ctx: MyTasksActionContext,
): Promise<OperationResult<TaskRecord>> {
  if (
    params.toUserId === null ||
    params.toUserId === undefined ||
    String(params.toUserId).length === 0
  ) {
    return err(
      new InvalidOperationError({
        domain: 'workflow',
        code: 'TASK_TRANSFER_TARGET_REQUIRED',
        message: '转派必须指定目标用户',
        details: { taskId },
      }),
    )
  }

  const record = await ctx.taskStore.getById(taskId)
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

  if (isTerminalTaskStatus(record.status as TaskStatus)) {
    return err(
      new InvalidOperationError({
        domain: 'workflow',
        code: 'TASK_ALREADY_TERMINAL',
        message: `待办已处于终态（${record.status}），不可转派`,
        details: { taskId, status: record.status },
      }),
    )
  }

  const updated = await ctx.taskStore.update({
    id: taskId,
    assigneeId: params.toUserId,
    teamId: params.teamId ?? null,
  })
  return ok(updated)
}

// ────────────────────────────────────────────────────────────
// 批量领取 / 转派
// ────────────────────────────────────────────────────────────

/** 单条批量操作结果 */
export interface BatchItemResult {
  /** 任务 ID */
  taskId: string | number
  /** 是否成功 */
  ok: boolean
  /** 失败错误码 */
  errorCode?: string
  /** 失败原因 */
  error?: string
  /** 成功时返回更新后的任务（可选） */
  task?: TaskRecord
}

/** 批量操作汇总 */
export interface BatchSummary {
  /** 总数（不超过 BATCH_LIMIT） */
  total: number
  /** 成功数 */
  succeeded: number
  /** 失败数 */
  failed: number
  /** 跳过数（超过上限的） */
  truncated: number
  /** 逐条结果 */
  items: BatchItemResult[]
}

/**
 * 批量领取：逐条调用 claimTask，限制 ≤ MY_TASKS_BATCH_LIMIT。
 *
 * 超过上限的 taskIds 截断并记入 truncated。
 * 每条独立处理，单条失败不影响其他条。
 */
export async function batchClaimTasks(
  taskIds: Array<string | number>,
  ctx: MyTasksActionContext,
): Promise<BatchSummary> {
  return runBatch(taskIds, async (taskId) => {
    const result = await claimTask(taskId, ctx)
    if (result.ok) {
      return { ok: true, task: result.data }
    }
    return {
      ok: false,
      errorCode: result.error.code,
      error: result.error.message,
    }
  })
}

/**
 * 批量转派：逐条调用 transferTask，限制 ≤ MY_TASKS_BATCH_LIMIT。
 *
 * 入参为 [{ taskId, toUserId, teamId? }, ...]，超过上限截断。
 */
export async function batchTransferTasks(
  items: Array<{
    taskId: string | number
    toUserId: string | number
    teamId?: string | number | null
  }>,
  ctx: MyTasksActionContext,
): Promise<BatchSummary> {
  return runBatch(items, async (item) => {
    const result = await transferTask(item.taskId, item, ctx)
    if (result.ok) {
      return { ok: true, task: result.data }
    }
    return {
      ok: false,
      errorCode: result.error.code,
      error: result.error.message,
    }
  }, (it) => it.taskId)
}

/**
 * 通用批量执行器：截断到 MY_TASKS_BATCH_LIMIT，逐条执行。
 *
 * keyOf 用于从 item 提取 taskId（batchClaim 的 item 本身就是 taskId）。
 */
async function runBatch<T>(
  items: T[],
  executor: (item: T) => Promise<Omit<BatchItemResult, 'taskId'>>,
  keyOf: (item: T) => string | number = (item) => String(item),
): Promise<BatchSummary> {
  const total = items.length
  const limited = items.slice(0, MY_TASKS_BATCH_LIMIT)
  const truncated = total - limited.length

  const results: BatchItemResult[] = []
  let succeeded = 0
  let failed = 0
  for (const item of limited) {
    const taskId = keyOf(item)
    try {
      const r = await executor(item)
      if (r.ok) succeeded++
      else failed++
      results.push({ taskId, ...r })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      failed++
      results.push({ taskId, ok: false, error: message })
    }
  }

  return {
    total: limited.length,
    succeeded,
    failed,
    truncated: truncated > 0 ? truncated : 0,
    items: results,
  }
}

// ────────────────────────────────────────────────────────────
// 工具：从 TaskRecord 提取展示用字段
// ────────────────────────────────────────────────────────────

/** 我的待办列表展示用字段（精简视图） */
export interface MyTaskView {
  id: string | number
  taskType: TaskType
  sourceType: string
  sourceId: string
  status: TaskStatus
  priority: TaskPriority
  dueAt: string
  assigneeId: string | number | null
  teamId: string | number | null
  /** 是否逾期（基于 ctx.now 计算） */
  overdue: boolean
  /** 来源深链 */
  deepLink: TaskSourceDeepLink
  /** 元数据（透传） */
  metadata: Record<string, unknown> | null
}

/** 将 TaskRecord 转为展示视图（含逾期标记 + 深链） */
export function toMyTaskView(
  task: TaskRecord,
  ctx: MyTasksSortContext,
): MyTaskView {
  const nowMs = new Date(ctx.now).getTime()
  return {
    id: task.id,
    taskType: task.taskType,
    sourceType: task.sourceType,
    sourceId: task.sourceId,
    status: task.status as TaskStatus,
    priority: task.priority as TaskPriority,
    dueAt: task.dueAt,
    assigneeId: task.assigneeId ?? null,
    teamId: task.teamId ?? null,
    overdue: isOverdue(task, nowMs),
    deepLink: buildSourceDeepLink(task),
    metadata: task.metadata ?? null,
  }
}

// 测试辅助：避免 unused import 警告（TASK_TYPE_SOURCE_TYPE 用于校验 taskType 与 sourceType 配对）
void TASK_TYPE_SOURCE_TYPE
