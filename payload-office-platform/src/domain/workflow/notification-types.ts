/**
 * 站内通知类型枚举（tasks.md M6.7 / design §3.7 / R6, R7, R8）
 *
 * 单一真源：覆盖审核驳回 / 线索分配转派 / SLA 超时 / 待办变更等通知类型。
 *
 * 命名约定：
 *   - {domain}-{action} 小写 kebab-case
 *   - 与触发事件一一对应（如 listing.review_rejected → notification type 'review-rejected'）
 *
 * 业务不变量（AGENTS.md §10）：
 *   - 通知由领域事件驱动生成，与业务状态解耦（失败可重试，不阻断业务事务）
 *   - 通知幂等键：eventId + recipient + type（同事件同收件人不重复）
 */

/**
 * 通知类型枚举。
 *
 * 与触发事件对应关系：
 *   - review-rejected      ← listing.review_rejected
 *   - lead-assigned         ← lead.assigned
 *   - lead-transferred      ← lead.transferred
 *   - sla-breached          ← sla.breached
 *   - task-completed        ← task.completed
 *   - task-cancelled        ← task.cancelled
 */
export const NOTIFICATION_TYPES = [
  'review-rejected',
  'lead-assigned',
  'lead-transferred',
  'sla-breached',
  'task-completed',
  'task-cancelled',
  'supply-submission-created',
  'city-partner-application-created',
] as const

export type NotificationType = (typeof NOTIFICATION_TYPES)[number]

/** 通知类型中文标签（用于后台展示） */
export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  'city-partner-application-created': '新的城市合伙人申请',
  'review-rejected': '审核驳回',
  'lead-assigned': '线索分配',
  'lead-transferred': '线索转派',
  'sla-breached': 'SLA 超时',
  'task-completed': '待办完成',
  'task-cancelled': '待办取消',
  'supply-submission-created': '新的房源投放申请',
}

/** 是否为已注册的通知类型 */
export function isNotificationType(value: unknown): value is NotificationType {
  return (
    typeof value === 'string' &&
    (NOTIFICATION_TYPES as readonly string[]).includes(value)
  )
}

/**
 * 通知来源对象类型（与触发事件的聚合类型对齐）。
 *
 * 用于通知 Collection 的 source_type 字段，方便按来源筛选与下钻。
 */
export const NOTIFICATION_SOURCE_TYPES = [
  'listing-review',
  'lead',
  'followup',
  'task',
  'supply-submission',
  'city-partner-application',
] as const

export type NotificationSourceType =
  (typeof NOTIFICATION_SOURCE_TYPES)[number]

/** 通知来源类型中文标签 */
export const NOTIFICATION_SOURCE_TYPE_LABELS: Record<
  NotificationSourceType,
  string
> = {
  'city-partner-application': '城市合伙人申请',
  'listing-review': '审核',
  lead: '线索',
  followup: '跟进',
  task: '待办',
  'supply-submission': '房源投放申请',
}

/** 是否为已注册的通知来源类型 */
export function isNotificationSourceType(
  value: unknown,
): value is NotificationSourceType {
  return (
    typeof value === 'string' &&
    (NOTIFICATION_SOURCE_TYPES as readonly string[]).includes(value)
  )
}
