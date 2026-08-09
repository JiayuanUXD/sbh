/**
 * 领域事件类型枚举（tasks.md M6.3 / design §3 domain_events / R8）
 *
 * 单一真源：覆盖 M4 / M5 / M6 业务事件的全部事件类型。
 *
 * 命名约定：
 *   - {aggregate}.{action} 小写 kebab-case
 *   - 聚合类型与事件类型前缀对齐（如 listing.* → aggregate_type=listing）
 *
 * 业务不变量（AGENTS.md §10）：
 *   - 领域事件必须有稳定 event_id、聚合 ID 和聚合版本
 *   - 消费器必须幂等，重复投递不能生成重复待办 / 通知 / 审计
 *
 * 新增事件类型必须在此注册；不允许 Collection 内散落字符串字面量。
 */

/** 房源发布轴事件（M4） */
export const LISTING_EVENT_TYPES = [
  'listing.published',
  'listing.unpublished',
] as const

/** 房源审核事件（M4.4） */
export const LISTING_REVIEW_EVENT_TYPES = [
  'listing.review_submitted',
  'listing.review_approved',
  'listing.review_rejected',
] as const

/** 房源举报事件（M6.1-M6.2） */
export const REPORT_EVENT_TYPES = [
  'report.sustained',
  'report.dismissed',
  'report.supply_paused',
  'report.supply_resumed',
] as const

/** 线索归属事件（M5） */
export const LEAD_EVENT_TYPES = [
  'lead.created',
  'lead.assigned',
  'lead.transferred',
  'lead.reclaimed',
  'lead.lost',
] as const

/** 跟进与 SLA 事件（M5-M6） */
export const FOLLOWUP_EVENT_TYPES = [
  'followup.completed',
  'followup.corrected',
  'sla.breached',
] as const

/** 待办状态变更事件（M6.7 站内通知触发器） */
export const TASK_EVENT_TYPES = [
  'task.completed',
  'task.cancelled',
] as const

/** 信息纠错事件（FPD-P1 Task 6） */
export const CORRECTION_EVENT_TYPES = [
  'correction.created',
] as const

/** 公开房源投放申请事件（/publish） */
export const SUPPLY_SUBMISSION_EVENT_TYPES = [
  'supply-submission.created',
] as const

/** 全部领域事件类型 */
export const EVENT_TYPES = [
  ...LISTING_EVENT_TYPES,
  ...LISTING_REVIEW_EVENT_TYPES,
  ...REPORT_EVENT_TYPES,
  ...LEAD_EVENT_TYPES,
  ...FOLLOWUP_EVENT_TYPES,
  ...TASK_EVENT_TYPES,
  ...CORRECTION_EVENT_TYPES,
  ...SUPPLY_SUBMISSION_EVENT_TYPES,
] as const

export type EventType = (typeof EVENT_TYPES)[number]

/** 事件类型中文标签（用于后台展示和审计） */
export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  'listing.published': '房源已上架',
  'listing.unpublished': '房源已下架',
  'listing.review_submitted': '审核已提交',
  'listing.review_approved': '审核已通过',
  'listing.review_rejected': '审核已驳回',
  'report.sustained': '举报成立',
  'report.dismissed': '举报不成立',
  'report.supply_paused': '供给已暂停',
  'report.supply_resumed': '供给已恢复',
  'lead.created': '线索已创建',
  'lead.assigned': '线索已分配',
  'lead.transferred': '线索已转派',
  'lead.reclaimed': '线索已回收',
  'lead.lost': '线索已流失',
  'followup.completed': '跟进已完成',
  'followup.corrected': '跟进已纠错',
  'sla.breached': 'SLA 已超时',
  'task.completed': '待办已完成',
  'task.cancelled': '待办已取消',
  'correction.created': '纠错已提交',
  'supply-submission.created': '投放申请已创建',
}

/** 是否为已注册的领域事件类型 */
export function isEventType(value: unknown): value is EventType {
  return typeof value === 'string' && (EVENT_TYPES as readonly string[]).includes(value)
}

/**
 * 从事件类型推导聚合类型。
 *
 * 约定：事件类型前缀（点号前）即为聚合类型。
 * 例如 'listing.published' → 'listing'，'report.sustained' → 'report'。
 */
export function aggregateTypeFromEventType(eventType: string): string | null {
  const idx = eventType.indexOf('.')
  if (idx <= 0) return null
  return eventType.slice(0, idx)
}

/** 聚合类型枚举（与 aggregate_type 字段对齐） */
export const AGGREGATE_TYPES = [
  'listing',
  'report',
  'lead',
  'followup',
  'sla',
  'task',
  'correction',
  'supply-submission',
] as const

export type AggregateType = (typeof AGGREGATE_TYPES)[number]

/** 是否为已注册的聚合类型 */
export function isAggregateType(value: unknown): value is AggregateType {
  return typeof value === 'string' && (AGGREGATE_TYPES as readonly string[]).includes(value)
}
