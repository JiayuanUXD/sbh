/**
 * 站内通知领域服务（tasks.md M6.7 / design §3.7 / R6, R7, R8）
 *
 * 职责：
 *   - createNotification: 幂等创建通知（eventId + recipient + type 唯一键）
 *   - markAsRead: 标记通知为已读（recipient 校验，防止越权）
 *   - listByRecipient: 列出收件人的通知（按 createdAt 倒序）
 *   - buildNotificationFromEvent: 从领域事件派生通知字段
 *
 * 业务不变量（AGENTS.md §10 / R8）：
 *   - 通知与业务状态解耦：业务事件写入 Outbox 后由消费器异步生成通知，
 *     通知创建失败不影响业务事务（消费器重试兜底）
 *   - 重复事件不会生成重复通知（幂等键：eventId + recipient + type）
 *   - 通知只能由收件人本人标记已读；不允许批量代签
 *
 * 设计取舍：
 *   - notification-service 不直接依赖 Payload Local API：通过 NotificationStore
 *     接口抽象，便于单元测试和未来替换为消息队列
 *   - 通知标题/正文由 buildNotificationFromEvent 从事件 payload 派生，避免在
 *     Collection hook 中拼装字符串
 */

import { ForbiddenError, InvalidOperationError } from '@/domain/shared/errors'
import { ok, err, type OperationResult } from '@/domain/shared/result'

import type { DomainEvent } from './event-publisher'
import type { EventType } from './event-types'
import {
  NOTIFICATION_TYPE_LABELS,
  isNotificationType,
  isNotificationSourceType,
  type NotificationSourceType,
  type NotificationType,
} from './notification-types'

/** 已落库的通知记录（与 Notifications Collection 字段对齐） */
export interface NotificationRecord {
  id: string | number
  /** 收件人 ID（users Collection 主键） */
  recipientId: string | number
  /** 通知类型 */
  type: NotificationType
  /** 通知标题 */
  title: string
  /** 通知正文 */
  body: string
  /** 来源对象类型（如 'listing-review' / 'lead' / 'followup' / 'task'） */
  sourceType: NotificationSourceType
  /** 来源业务对象 ID */
  sourceId: string
  /** 触发通知的 Outbox event_id（幂等键之一） */
  eventId: string
  /** 是否已读 */
  read: boolean
  /** 已读时间（UTC ISO；未读为 null） */
  readAt: string | null
  /** 创建时间（UTC ISO） */
  createdAt: string
}

/**
 * 通知存储接口（抽象持久层）。
 *
 * 真实实现由 Payload Local API 提供；测试用 in-memory 实现。
 */
export interface NotificationStore {
  /**
   * 按 eventId + recipientId + type 查找通知（幂等检查）。
   *
   * 重复事件投递时，若已存在同幂等键的通知，跳过创建返回已有记录。
   */
  findByEventAndRecipient(params: {
    eventId: string
    recipientId: string | number
    type: NotificationType
  }): Promise<NotificationRecord | null>

  /** 按 ID 读取通知 */
  getById(id: string | number): Promise<NotificationRecord | null>

  /** 列出收件人的通知（按 createdAt 倒序）；可选筛选 read 状态 */
  listByRecipient(params: {
    recipientId: string | number
    read?: boolean
    limit?: number
  }): Promise<NotificationRecord[]>

  /** 创建通知 */
  create(params: {
    recipientId: string | number
    type: NotificationType
    title: string
    body: string
    sourceType: NotificationSourceType
    sourceId: string
    eventId: string
    createdAt?: string
  }): Promise<NotificationRecord>

  /** 标记通知为已读（仅 recipient 本人可调用） */
  markAsRead(params: {
    id: string | number
    recipientId: string | number
    readAt: string
  }): Promise<NotificationRecord>
}

/** 服务调用上下文：提供时间冻结 */
export interface NotificationContext {
  /** 当前时间（UTC ISO；测试可注入冻结时间） */
  now: string
}

// ────────────────────────────────────────────────────────────
// 创建通知（幂等）
// ────────────────────────────────────────────────────────────

/**
 * 幂等创建通知。
 *
 * 幂等机制：
 *   1. 按 eventId + recipientId + type 查找现有通知
 *   2. 已存在 → 跳过创建返回已有记录（replayed）
 *   3. 不存在 → 调用 store.create 创建新通知（executed）
 *
 * 返回 OperationResult，调用方按需记录日志或触发推送。
 */
export async function createNotification(
  params: {
    recipientId: string | number
    type: NotificationType
    title: string
    body: string
    sourceType: NotificationSourceType
    sourceId: string
    /** 触发通知的 Outbox event_id（幂等键） */
    eventId: string
  },
  ctx: NotificationContext,
  store: NotificationStore,
): Promise<
  OperationResult<{ notification: NotificationRecord; replayed: boolean }>
> {
  // 1. 参数校验
  if (
    params.recipientId === null ||
    params.recipientId === undefined ||
    String(params.recipientId).length === 0
  ) {
    return err(
      new InvalidOperationError({
        domain: 'workflow',
        code: 'NOTIFICATION_RECIPIENT_REQUIRED',
        message: '通知收件人不能为空',
        details: { type: params.type },
      }),
    )
  }
  if (!isNotificationType(params.type)) {
    return err(
      new InvalidOperationError({
        domain: 'workflow',
        code: 'NOTIFICATION_TYPE_INVALID',
        message: `通知类型未注册：${params.type}`,
        details: { type: params.type },
      }),
    )
  }
  if (!isNotificationSourceType(params.sourceType)) {
    return err(
      new InvalidOperationError({
        domain: 'workflow',
        code: 'NOTIFICATION_SOURCE_TYPE_INVALID',
        message: `通知来源类型未注册：${params.sourceType}`,
        details: { sourceType: params.sourceType },
      }),
    )
  }
  if (!params.eventId || typeof params.eventId !== 'string') {
    return err(
      new InvalidOperationError({
        domain: 'workflow',
        code: 'NOTIFICATION_EVENT_ID_REQUIRED',
        message: '通知必须关联触发事件 ID（幂等键）',
        details: { type: params.type },
      }),
    )
  }

  // 2. 幂等检查
  const existing = await store.findByEventAndRecipient({
    eventId: params.eventId,
    recipientId: params.recipientId,
    type: params.type,
  })
  if (existing) {
    return ok({ notification: existing, replayed: true })
  }

  // 3. 创建通知
  const created = await store.create({
    recipientId: params.recipientId,
    type: params.type,
    title: params.title,
    body: params.body,
    sourceType: params.sourceType,
    sourceId: params.sourceId,
    eventId: params.eventId,
    createdAt: ctx.now,
  })

  return ok({ notification: created, replayed: false })
}

// ────────────────────────────────────────────────────────────
// 标记已读
// ────────────────────────────────────────────────────────────

/**
 * 标记通知为已读。
 *
 * 权限：
 *   - 仅收件人本人可标记（防越权代签）
 *   - 已读通知再次标记视为幂等成功（不报错）
 */
export async function markNotificationAsRead(
  params: { id: string | number; recipientId: string | number },
  ctx: NotificationContext,
  store: NotificationStore,
): Promise<OperationResult<NotificationRecord>> {
  const record = await store.getById(params.id)
  if (!record) {
    return err(
      new InvalidOperationError({
        domain: 'workflow',
        code: 'NOTIFICATION_NOT_FOUND',
        message: '通知不存在',
        details: { id: params.id },
      }),
    )
  }

  // 越权校验：仅 recipient 本人可标记
  if (String(record.recipientId) !== String(params.recipientId)) {
    return err(
      new ForbiddenError({
        domain: 'workflow',
        message: '不能标记他人通知为已读',
        details: {
          notificationId: params.id,
          recipientId: record.recipientId,
          callerId: params.recipientId,
        },
      }),
    )
  }

  // 幂等：已读通知不再标记
  if (record.read) {
    return ok(record)
  }

  const updated = await store.markAsRead({
    id: params.id,
    recipientId: params.recipientId,
    readAt: ctx.now,
  })
  return ok(updated)
}

// ────────────────────────────────────────────────────────────
// 从领域事件派生通知
// ────────────────────────────────────────────────────────────

/**
 * 事件 → 通知类型映射。
 *
 * 用于 notification-consumer 派生通知 type / sourceType / recipient。
 */
export const EVENT_NOTIFICATION_MAP: Partial<
  Record<EventType, NotificationType>
> = {
  'listing.review_rejected': 'review-rejected',
  'lead.assigned': 'lead-assigned',
  'lead.transferred': 'lead-transferred',
  'sla.breached': 'sla-breached',
  'task.completed': 'task-completed',
  'task.cancelled': 'task-cancelled',
}

/** 事件类型 → 通知类型；无映射返回 null */
export function notificationTypeForEvent(
  eventType: EventType,
): NotificationType | null {
  return EVENT_NOTIFICATION_MAP[eventType] ?? null
}

/**
 * 从领域事件派生通知草稿（type / sourceType / sourceId / title / body / recipientId）。
 *
 * recipientId 从 payload 派生（assigneeId / recipientId / userId）；
 * 缺失返回 null（消费器跳过该事件）。
 *
 * 标题/正文为简洁中文文案，调用方可按需自定义。
 */
export function buildNotificationFromEvent(
  event: DomainEvent,
): {
  type: NotificationType
  sourceType: NotificationSourceType
  sourceId: string
  title: string
  body: string
  recipientId: string | number
} | null {
  const type = notificationTypeForEvent(event.eventType)
  if (!type) return null

  const payload = (event.payload ?? {}) as Record<string, unknown>
  const recipientId = deriveRecipientId(payload)
  if (recipientId === null) return null

  const sourceId = String(
    payload.reviewId ??
      payload.leadId ??
      payload.followupId ??
      payload.taskId ??
      event.aggregateId,
  )

  const sourceType = deriveSourceType(event.eventType)
  const title = NOTIFICATION_TYPE_LABELS[type]
  const body = buildBody(type, payload)

  return { type, sourceType, sourceId, title, body, recipientId }
}

/** 从 payload 派生收件人 ID（assigneeId / recipientId / userId） */
function deriveRecipientId(
  payload: Record<string, unknown>,
): string | number | null {
  const candidates = [
    payload.assigneeId,
    payload.recipientId,
    payload.userId,
    payload.toUserId,
  ]
  for (const c of candidates) {
    if (typeof c === 'string' || typeof c === 'number') {
      return c
    }
  }
  return null
}

/** 事件类型 → 通知来源类型 */
function deriveSourceType(eventType: EventType): NotificationSourceType {
  if (eventType.startsWith('listing.review')) return 'listing-review'
  if (eventType.startsWith('lead.')) return 'lead'
  if (eventType.startsWith('sla.')) return 'followup'
  if (eventType.startsWith('task.')) return 'task'
  // 默认回退到 followup（sla.breached 也归 followup）
  return 'followup'
}

/** 派生通知正文 */
function buildBody(
  type: NotificationType,
  payload: Record<string, unknown>,
): string {
  switch (type) {
    case 'review-rejected': {
      const reason =
        typeof payload.reason === 'string' ? payload.reason : '请查看审核详情'
      return `您的房源审核已被驳回：${reason}`
    }
    case 'lead-assigned': {
      return '您有一条新分配的线索，请及时跟进'
    }
    case 'lead-transferred': {
      return '您有一条转派的线索，请及时跟进'
    }
    case 'sla-breached': {
      const breachType =
        typeof payload.breachType === 'string' ? payload.breachType : ''
      return breachType
        ? `SLA 超时提醒（${breachType}），请尽快处理`
        : 'SLA 超时提醒，请尽快处理'
    }
    case 'task-completed': {
      return '您的待办已完成'
    }
    case 'task-cancelled': {
      const reason =
        typeof payload.reason === 'string' ? payload.reason : '来源取消'
      return `您的待办已取消：${reason}`
    }
    default:
      return ''
  }
}

// ────────────────────────────────────────────────────────────
// In-memory NotificationStore（用于单元测试）
// ────────────────────────────────────────────────────────────

let _inMemoryIdCounter = 1

/**
 * 创建内存版 NotificationStore（用于单元测试）。
 *
 * 真实环境由 Payload Local API 包装实现。
 */
export function createInMemoryNotificationStore(): NotificationStore & {
  /** 测试辅助：读取内部存储 */
  snapshot(): ReadonlyMap<string | number, NotificationRecord>
  /** 测试辅助：清空存储并重置 ID 计数 */
  reset(): void
} {
  const store = new Map<string | number, NotificationRecord>()
  return {
    async findByEventAndRecipient({ eventId, recipientId, type }) {
      for (const r of store.values()) {
        if (
          r.eventId === eventId &&
          String(r.recipientId) === String(recipientId) &&
          r.type === type
        ) {
          return r
        }
      }
      return null
    },
    async getById(id) {
      return store.get(id) ?? null
    },
    async listByRecipient({ recipientId, read, limit = 50 }) {
      const list: NotificationRecord[] = []
      for (const r of store.values()) {
        if (String(r.recipientId) !== String(recipientId)) continue
        if (read !== undefined && r.read !== read) continue
        list.push(r)
      }
      // 按 createdAt 倒序
      list.sort((a, b) => {
        const at = new Date(a.createdAt).getTime()
        const bt = new Date(b.createdAt).getTime()
        return bt - at
      })
      return list.slice(0, limit)
    },
    async create(params) {
      const id = _inMemoryIdCounter++
      const record: NotificationRecord = {
        id,
        recipientId: params.recipientId,
        type: params.type,
        title: params.title,
        body: params.body,
        sourceType: params.sourceType,
        sourceId: params.sourceId,
        eventId: params.eventId,
        read: false,
        readAt: null,
        createdAt: params.createdAt ?? new Date().toISOString(),
      }
      store.set(id, record)
      return record
    },
    async markAsRead({ id, recipientId, readAt }) {
      const existing = store.get(id)
      if (!existing) {
        throw new InvalidOperationError({
          domain: 'workflow',
          code: 'NOTIFICATION_NOT_FOUND',
          message: '通知不存在',
          details: { id },
        })
      }
      if (String(existing.recipientId) !== String(recipientId)) {
        throw new ForbiddenError({
          domain: 'workflow',
          message: '不能标记他人通知为已读',
        })
      }
      const updated: NotificationRecord = {
        ...existing,
        read: true,
        readAt,
      }
      store.set(id, updated)
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
