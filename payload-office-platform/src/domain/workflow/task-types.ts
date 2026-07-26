/**
 * 待办类型枚举与生成规则元数据（tasks.md M6.4 / design §3.7 tasks / R6, R7, R8）
 *
 * 单一真源：6 种待办类型 + 对应 sourceType + 默认优先级 + 来源事件类型。
 * 规则的具体执行（buildTask / cancelOnEventTypes）在 task-registry.ts。
 *
 * 业务不变量（AGENTS.md §10）：
 *   - 待办由来源业务事件完成或取消，不允许只在待办页手工标记完成
 *   - 重复事件不会生成重复待办或通知（幂等键：taskType + sourceId + sourceVersion）
 *   - 跨对象副作用使用事务 Outbox（M6.3 已完成）
 *
 * 6 种待办类型（tasks.md M6.4）：
 *   1. review-pending              房源审核待办（listing.review_submitted 触发）
 *   2. report-triage               举报分诊待办（report.sustained 触发，原 report.created 不存在）
 *   3. lead-unassigned             未分配线索待办（lead.created 触发）
 *   4. followup-first              首次跟进待办（lead.assigned 触发）
 *   5. followup-next               下次跟进待办（followup.completed 触发，含 nextFollowupAt）
 *   6. listing-stale-maintenance   房源维护待办（SLA 扫描触发，非事件驱动）
 *
 * 6 种 sourceType：
 *   - listing-review   来源房源审核记录
 *   - listing-report   来源房源举报记录
 *   - lead             来源线索
 *   - followup         来源跟进记录
 *   - listing          来源房源本身
 */

import type { EventType } from './event-types'
import type { TaskPriority } from './task-status'

/** 待办类型。 */
export const TASK_TYPES = [
  'review-pending',
  'report-triage',
  'lead-unassigned',
  'followup-first',
  'followup-next',
  'listing-stale-maintenance',
] as const
export type TaskType = (typeof TASK_TYPES)[number]

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  'review-pending': '审核待办',
  'report-triage': '举报分诊',
  'lead-unassigned': '未分配线索',
  'followup-first': '首次跟进',
  'followup-next': '下次跟进',
  'listing-stale-maintenance': '房源维护',
}

export function isTaskType(value: unknown): value is TaskType {
  return (
    typeof value === 'string' &&
    (TASK_TYPES as readonly string[]).includes(value)
  )
}

/** 待办来源对象类型（对应来源业务 Collection）。 */
export const TASK_SOURCE_TYPES = [
  'listing-review',
  'listing-report',
  'lead',
  'followup',
  'listing',
] as const
export type TaskSourceType = (typeof TASK_SOURCE_TYPES)[number]

export const TASK_SOURCE_TYPE_LABELS: Record<TaskSourceType, string> = {
  'listing-review': '房源审核',
  'listing-report': '房源举报',
  lead: '线索',
  followup: '跟进记录',
  listing: '房源',
}

export function isTaskSourceType(value: unknown): value is TaskSourceType {
  return (
    typeof value === 'string' &&
    (TASK_SOURCE_TYPES as readonly string[]).includes(value)
  )
}

/**
 * taskType → sourceType 映射（一对一）。
 *
 * 用于：
 *   - Collection beforeValidate 校验 taskType / sourceType 配对一致
 *   - buildTask 派生 sourceType（避免调用方传入不一致的 sourceType）
 */
export const TASK_TYPE_SOURCE_TYPE: Record<TaskType, TaskSourceType> = {
  'review-pending': 'listing-review',
  'report-triage': 'listing-report',
  'lead-unassigned': 'lead',
  'followup-first': 'lead',
  'followup-next': 'followup',
  'listing-stale-maintenance': 'listing',
}

/**
 * taskType → 默认优先级。
 *
 * 用于 buildTask 在事件 payload 未指定优先级时填充默认值。
 */
export const TASK_TYPE_DEFAULT_PRIORITY: Record<TaskType, TaskPriority> = {
  'review-pending': 'high',
  'report-triage': 'normal',
  'lead-unassigned': 'high',
  'followup-first': 'urgent',
  'followup-next': 'normal',
  'listing-stale-maintenance': 'low',
}

/**
 * taskType → 触发该待办创建的来源事件类型。
 *
 * listing-stale-maintenance 由 SLA 扫描定时触发，非事件驱动，
 * 这里映射到 'sla.breached' 仅作元数据标识（实际由扫描器调用 buildTask）。
 */
export const TASK_TYPE_TRIGGER_EVENT: Record<TaskType, EventType | null> = {
  'review-pending': 'listing.review_submitted',
  'report-triage': 'report.sustained',
  'lead-unassigned': 'lead.created',
  'followup-first': 'lead.assigned',
  'followup-next': 'followup.completed',
  'listing-stale-maintenance': 'sla.breached',
}

/**
 * taskType → 默认 SLA 时限（毫秒）。
 *
 * 用于 buildTask 在事件 payload 未指定 dueAt 时按OccurredAt + 时限推导。
 *
 * - review-pending: 提交后 4 小时（任务要求）
 * - report-triage: 创建后 24 小时（任务要求）
 * - lead-unassigned: 创建后 4 小时（任务要求）
 * - followup-first: 分配后 4 小时（任务要求）
 * - followup-next: 由 nextFollowupAt 指定，0 表示不使用默认时限
 * - listing-stale-maintenance: 由扫描器计算，0 表示不使用默认时限
 */
export const TASK_TYPE_DEFAULT_SLA_MS: Record<TaskType, number> = {
  'review-pending': 4 * 60 * 60 * 1000,
  'report-triage': 24 * 60 * 60 * 1000,
  'lead-unassigned': 4 * 60 * 60 * 1000,
  'followup-first': 4 * 60 * 60 * 1000,
  'followup-next': 0,
  'listing-stale-maintenance': 0,
}

/** 任务完成时由系统发布的事件类型（写入 Outbox 供消费器使用）。 */
export const TASK_COMPLETED_EVENT_TYPE = 'task.completed' as const
/** 任务取消时由系统发布的事件类型（写入 Outbox 供消费器使用）。 */
export const TASK_CANCELLED_EVENT_TYPE = 'task.cancelled' as const
