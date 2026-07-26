/**
 * 待办 fixture（tasks.md M6.4 / design §3.7 tasks / R6, R7, R8）
 *
 * 业务不变量（AGENTS.md §10）：
 *   - 待办状态机：pending → in_progress → completed；pending/in_progress → cancelled
 *   - 待办由来源业务事件完成或取消，不允许只在待办页手工标记完成
 *   - 重复事件不会生成重复待办（幂等键：taskType + sourceId + sourceVersion）
 *
 * fixture 用途：
 *   - 单元测试：直接 import fixture，断言 task-service / task-status 行为
 *   - 集成测试：通过 createInMemoryTaskStore() seed 写入 store
 *
 * 注意：fixture 的 dueAt / 时间戳为测试稳定字符串。
 */

import type { DomainEvent } from '@/domain/workflow/event-publisher'
import type { EventType } from '@/domain/workflow/event-types'
import type {
  TaskPriority,
  TaskStatus,
} from '@/domain/workflow/task-status'
import type { TaskSourceType, TaskType } from '@/domain/workflow/task-types'
import type { TaskRecord } from '@/domain/workflow/task-service'

/** 待办 fixture 类型（与 TaskRecord 对齐，便于 seed 到 in-memory store） */
export type TaskFixture = TaskRecord

// ────────────────────────────────────────────────────────────
// 6 种 taskType 的待办 fixture（pending 状态）
// ────────────────────────────────────────────────────────────

/** review-pending 待办：来自 listing.review_submitted 事件 */
export const TASK_FIXTURE_REVIEW_PENDING: TaskFixture = {
  id: 'task-review-pending-001',
  taskType: 'review-pending',
  sourceId: 'review-001',
  sourceVersion: 1,
  sourceType: 'listing-review',
  status: 'pending',
  priority: 'high',
  dueAt: '2026-07-26T06:00:00.000Z', // 提交后 4 小时
  assigneeId: null,
  teamId: null,
  completedAt: null,
  cancelledAt: null,
  cancellationReason: null,
  completionEventId: null,
  metadata: { listingId: 'listing-001', eventId: 'evt-review-submitted-001' },
}

/** report-triage 待办：来自 report.sustained 事件 */
export const TASK_FIXTURE_REPORT_TRIAGE: TaskFixture = {
  id: 'task-report-triage-001',
  taskType: 'report-triage',
  sourceId: 'report-closed-sustained',
  sourceVersion: 6,
  sourceType: 'listing-report',
  status: 'pending',
  priority: 'normal',
  dueAt: '2026-07-27T02:00:00.000Z', // 创建后 24 小时
  assigneeId: null,
  teamId: null,
  completedAt: null,
  cancelledAt: null,
  cancellationReason: null,
  completionEventId: null,
  metadata: { targetListingId: 'listing-001', eventId: 'evt-report-sustained-001' },
}

/** lead-unassigned 待办：来自 lead.created 事件 */
export const TASK_FIXTURE_LEAD_UNASSIGNED: TaskFixture = {
  id: 'task-lead-unassigned-001',
  taskType: 'lead-unassigned',
  sourceId: 'lead-001',
  sourceVersion: 1,
  sourceType: 'lead',
  status: 'pending',
  priority: 'high',
  dueAt: '2026-07-26T06:00:00.000Z', // 创建后 4 小时
  assigneeId: null,
  teamId: null,
  completedAt: null,
  cancelledAt: null,
  cancellationReason: null,
  completionEventId: null,
  metadata: { leadId: 'lead-001', eventId: 'evt-lead-created-001' },
}

/** followup-first 待办：来自 lead.assigned 事件，已分配给经纪人 */
export const TASK_FIXTURE_FOLLOWUP_FIRST: TaskFixture = {
  id: 'task-followup-first-001',
  taskType: 'followup-first',
  sourceId: 'lead-001',
  sourceVersion: 2,
  sourceType: 'lead',
  status: 'pending',
  priority: 'urgent',
  dueAt: '2026-07-26T10:00:00.000Z', // 分配后 4 小时
  assigneeId: 'user-broker-1',
  teamId: null,
  completedAt: null,
  cancelledAt: null,
  cancellationReason: null,
  completionEventId: null,
  metadata: { leadId: 'lead-001', eventId: 'evt-lead-assigned-001' },
}

/** followup-next 待办：来自 followup.completed 事件，含 nextFollowupAt */
export const TASK_FIXTURE_FOLLOWUP_NEXT: TaskFixture = {
  id: 'task-followup-next-001',
  taskType: 'followup-next',
  sourceId: 'followup-001',
  sourceVersion: 1,
  sourceType: 'followup',
  status: 'pending',
  priority: 'normal',
  dueAt: '2026-07-27T08:00:00.000Z', // = nextFollowupAt
  assigneeId: 'user-broker-1',
  teamId: null,
  completedAt: null,
  cancelledAt: null,
  cancellationReason: null,
  completionEventId: null,
  metadata: { leadId: 'lead-001', eventId: 'evt-followup-completed-001' },
}

/** listing-stale-maintenance 待办：由 SLA 扫描器创建 */
export const TASK_FIXTURE_LISTING_STALE_MAINTENANCE: TaskFixture = {
  id: 'task-listing-stale-maintenance-001',
  taskType: 'listing-stale-maintenance',
  sourceId: 'listing-001',
  sourceVersion: 1,
  sourceType: 'listing',
  status: 'pending',
  priority: 'low',
  dueAt: '2026-08-01T00:00:00.000Z',
  assigneeId: null,
  teamId: null,
  completedAt: null,
  cancelledAt: null,
  cancellationReason: null,
  completionEventId: null,
  metadata: { asOf: '2026-07-26T02:00:00.000Z' },
}

/** 已完成的 review-pending 待办（用于幂等性测试） */
export const TASK_FIXTURE_REVIEW_PENDING_COMPLETED: TaskFixture = {
  ...TASK_FIXTURE_REVIEW_PENDING,
  id: 'task-review-pending-002',
  status: 'completed',
  completedAt: '2026-07-26T04:30:00.000Z',
  completionEventId: 'evt-review-approved-001',
}

/** 已取消的 lead-unassigned 待办（用于幂等性测试） */
export const TASK_FIXTURE_LEAD_UNASSIGNED_CANCELLED: TaskFixture = {
  ...TASK_FIXTURE_LEAD_UNASSIGNED,
  id: 'task-lead-unassigned-002',
  status: 'cancelled',
  cancelledAt: '2026-07-26T03:00:00.000Z',
  cancellationReason: '线索已流失',
}

/** in_progress 状态的 followup-first 待办（用于状态机测试） */
export const TASK_FIXTURE_FOLLOWUP_FIRST_IN_PROGRESS: TaskFixture = {
  ...TASK_FIXTURE_FOLLOWUP_FIRST,
  status: 'in_progress',
}

// ────────────────────────────────────────────────────────────
// 触发任务创建的事件 fixture（用于 createTaskFromEvent 测试）
// ────────────────────────────────────────────────────────────

/** listing.review_submitted 事件（触发 review-pending 创建） */
export const TASK_EVENT_REVIEW_SUBMITTED: DomainEvent<{
  reviewId: string
  listingId: string
  actorId: string
}> = {
  eventId: 'evt-task-review-submitted-001',
  eventType: 'listing.review_submitted' as EventType,
  aggregateType: 'listing',
  aggregateId: 'listing-001',
  aggregateVersion: 2,
  payload: {
    reviewId: 'review-001',
    listingId: 'listing-001',
    actorId: 'user-ops-1',
  },
  occurredAt: '2026-07-26T02:00:00.000Z',
  processedAt: null,
  attemptCount: 0,
  lastError: null,
}

/** report.sustained 事件（触发 report-triage 创建） */
export const TASK_EVENT_REPORT_SUSTAINED: DomainEvent<{
  reportId: string
  targetListingId: string
  conclusion: 'sustained'
  supplyPaused: boolean
  actorId: string
}> = {
  eventId: 'evt-task-report-sustained-001',
  eventType: 'report.sustained' as EventType,
  aggregateType: 'report',
  aggregateId: 'report-closed-sustained',
  aggregateVersion: 6,
  payload: {
    reportId: 'report-closed-sustained',
    targetListingId: 'listing-001',
    conclusion: 'sustained',
    supplyPaused: true,
    actorId: 'user-csr-1',
  },
  occurredAt: '2026-07-26T02:00:00.000Z',
  processedAt: null,
  attemptCount: 0,
  lastError: null,
}

/** lead.created 事件（触发 lead-unassigned 创建） */
export const TASK_EVENT_LEAD_CREATED: DomainEvent<{
  leadId: string
  actorId: string
}> = {
  eventId: 'evt-task-lead-created-001',
  eventType: 'lead.created' as EventType,
  aggregateType: 'lead',
  aggregateId: 'lead-001',
  aggregateVersion: 1,
  payload: {
    leadId: 'lead-001',
    actorId: 'user-system',
  },
  occurredAt: '2026-07-26T02:00:00.000Z',
  processedAt: null,
  attemptCount: 0,
  lastError: null,
}

/** lead.assigned 事件（触发 followup-first 创建 + 完成 lead-unassigned） */
export const TASK_EVENT_LEAD_ASSIGNED: DomainEvent<{
  leadId: string
  assigneeId: string
  previousAssigneeId: string | null
  assignerId: string
}> = {
  eventId: 'evt-task-lead-assigned-001',
  eventType: 'lead.assigned' as EventType,
  aggregateType: 'lead',
  aggregateId: 'lead-001',
  aggregateVersion: 2,
  payload: {
    leadId: 'lead-001',
    assigneeId: 'user-broker-1',
    previousAssigneeId: null,
    assignerId: 'user-mgr-1',
  },
  occurredAt: '2026-07-26T06:00:00.000Z',
  processedAt: null,
  attemptCount: 0,
  lastError: null,
}

/** followup.completed 事件（含 nextFollowupAt，触发 followup-next 创建） */
export const TASK_EVENT_FOLLOWUP_COMPLETED_WITH_NEXT: DomainEvent<{
  followupId: string
  leadId: string
  channel: 'phone' | 'wechat' | 'visit'
  actorId: string
  nextFollowupAt: string
}> = {
  eventId: 'evt-task-followup-completed-001',
  eventType: 'followup.completed' as EventType,
  aggregateType: 'followup',
  aggregateId: 'followup-001',
  aggregateVersion: 1,
  payload: {
    followupId: 'followup-001',
    leadId: 'lead-001',
    channel: 'phone',
    actorId: 'user-broker-1',
    nextFollowupAt: '2026-07-27T08:00:00.000Z',
  },
  occurredAt: '2026-07-26T08:00:00.000Z',
  processedAt: null,
  attemptCount: 0,
  lastError: null,
}

/** followup.completed 事件（无 nextFollowupAt，不触发 followup-next 创建） */
export const TASK_EVENT_FOLLOWUP_COMPLETED_NO_NEXT: DomainEvent<{
  followupId: string
  leadId: string
  channel: 'phone' | 'wechat' | 'visit'
  actorId: string
}> = {
  eventId: 'evt-task-followup-completed-002',
  eventType: 'followup.completed' as EventType,
  aggregateType: 'followup',
  aggregateId: 'followup-002',
  aggregateVersion: 1,
  payload: {
    followupId: 'followup-002',
    leadId: 'lead-001',
    channel: 'phone',
    actorId: 'user-broker-1',
  },
  occurredAt: '2026-07-26T08:00:00.000Z',
  processedAt: null,
  attemptCount: 0,
  lastError: null,
}

/** listing.review_approved 事件（自动完成 review-pending） */
export const TASK_EVENT_REVIEW_APPROVED: DomainEvent<{
  reviewId: string
  listingId: string
  reviewerId: string
}> = {
  eventId: 'evt-task-review-approved-001',
  eventType: 'listing.review_approved' as EventType,
  aggregateType: 'listing',
  aggregateId: 'listing-001',
  aggregateVersion: 3,
  payload: {
    reviewId: 'review-001',
    listingId: 'listing-001',
    reviewerId: 'user-ops-1',
  },
  occurredAt: '2026-07-26T04:30:00.000Z',
  processedAt: null,
  attemptCount: 0,
  lastError: null,
}

/** listing.review_rejected 事件（自动取消 review-pending） */
export const TASK_EVENT_REVIEW_REJECTED: DomainEvent<{
  reviewId: string
  listingId: string
  reviewerId: string
  reason: string
}> = {
  eventId: 'evt-task-review-rejected-001',
  eventType: 'listing.review_rejected' as EventType,
  aggregateType: 'listing',
  aggregateId: 'listing-001',
  aggregateVersion: 3,
  payload: {
    reviewId: 'review-001',
    listingId: 'listing-001',
    reviewerId: 'user-ops-1',
    reason: '面积描述与实际不符',
  },
  occurredAt: '2026-07-26T04:30:00.000Z',
  processedAt: null,
  attemptCount: 0,
  lastError: null,
}

/** lead.lost 事件（自动取消 lead-unassigned / followup-first / followup-next） */
export const TASK_EVENT_LEAD_LOST: DomainEvent<{
  leadId: string
  reason: string
}> = {
  eventId: 'evt-task-lead-lost-001',
  eventType: 'lead.lost' as EventType,
  aggregateType: 'lead',
  aggregateId: 'lead-001',
  aggregateVersion: 5,
  payload: {
    leadId: 'lead-001',
    reason: '客户长期未响应',
  },
  occurredAt: '2026-07-26T10:00:00.000Z',
  processedAt: null,
  attemptCount: 0,
  lastError: null,
}

/** report.dismissed 事件（自动取消 report-triage） */
export const TASK_EVENT_REPORT_DISMISSED: DomainEvent<{
  reportId: string
  targetListingId: string
  conclusion: 'dismissed'
  supplyPaused: boolean
  actorId: string
}> = {
  eventId: 'evt-task-report-dismissed-001',
  eventType: 'report.dismissed' as EventType,
  aggregateType: 'report',
  aggregateId: 'report-closed-dismissed',
  aggregateVersion: 4,
  payload: {
    reportId: 'report-closed-dismissed',
    targetListingId: 'listing-002',
    conclusion: 'dismissed',
    supplyPaused: false,
    actorId: 'user-csr-1',
  },
  occurredAt: '2026-07-26T05:00:00.000Z',
  processedAt: null,
  attemptCount: 0,
  lastError: null,
}

// ────────────────────────────────────────────────────────────
// 便捷工厂函数（生成可变 fixture）
// ────────────────────────────────────────────────────────────

/** 生成 pending 待办 fixture（可覆盖字段） */
export function makeTaskFixture(
  overrides: Partial<TaskFixture> & { taskType: TaskType },
): TaskFixture {
  const sourceType: TaskSourceType = (
    {
      'review-pending': 'listing-review',
      'report-triage': 'listing-report',
      'lead-unassigned': 'lead',
      'followup-first': 'lead',
      'followup-next': 'followup',
      'listing-stale-maintenance': 'listing',
    } as const
  )[overrides.taskType]
  return {
    id: `task-${overrides.taskType}-${Math.random().toString(36).slice(2, 8)}`,
    sourceId: 'source-001',
    sourceVersion: 1,
    sourceType,
    status: 'pending' as TaskStatus,
    priority: 'normal' as TaskPriority,
    dueAt: '2026-07-27T02:00:00.000Z',
    assigneeId: null,
    teamId: null,
    completedAt: null,
    cancelledAt: null,
    cancellationReason: null,
    completionEventId: null,
    metadata: null,
    ...overrides,
  }
}

/** 全部待办 fixture（用于遍历断言） */
export const TASK_FIXTURES: Record<string, TaskFixture> = {
  'review-pending': TASK_FIXTURE_REVIEW_PENDING,
  'report-triage': TASK_FIXTURE_REPORT_TRIAGE,
  'lead-unassigned': TASK_FIXTURE_LEAD_UNASSIGNED,
  'followup-first': TASK_FIXTURE_FOLLOWUP_FIRST,
  'followup-next': TASK_FIXTURE_FOLLOWUP_NEXT,
  'listing-stale-maintenance': TASK_FIXTURE_LISTING_STALE_MAINTENANCE,
  'review-pending-completed': TASK_FIXTURE_REVIEW_PENDING_COMPLETED,
  'lead-unassigned-cancelled': TASK_FIXTURE_LEAD_UNASSIGNED_CANCELLED,
  'followup-first-in-progress': TASK_FIXTURE_FOLLOWUP_FIRST_IN_PROGRESS,
}
