/**
 * 站内通知事件消费器（tasks.md M6.7 / design §3.7 / R6, R7, R8）
 *
 * 职责：
 *   - 实现 EventConsumer 接口，监听触发通知的领域事件
 *   - 每个事件类型对应一个 NotificationConsumer 实例
 *   - handle 内调用 createNotification 幂等创建通知
 *
 * 业务不变量（AGENTS.md §10 / R8）：
 *   - 通知与业务状态解耦：消费器从 Outbox 拉取事件后异步生成通知，
 *     通知创建失败不影响业务事务（EventDispatcher 重试兜底）
 *   - 重复事件不会生成重复通知（幂等键：eventId + recipient + type）
 *
 * 设计取舍：
 *   - 消费器只关心"事件 → 通知草稿"，存储写入由 NotificationStore 抽象
 *   - buildNotificationFromEvent 派生失败（如 payload 缺 recipientId）→
 *     视为成功跳过（不重试，避免死信）
 */

import { ok, type OperationResult } from '@/domain/shared/result'

import type { EventConsumer, ConsumerContext } from './event-consumer'
import type { DomainEvent } from './event-publisher'
import type { EventType } from './event-types'
import {
  buildNotificationFromEvent,
  createNotification,
  type NotificationContext,
  type NotificationStore,
} from './notification-service'

/**
 * 创建通知消费器。
 *
 * 工厂模式：每个事件类型对应一个独立 NotificationConsumer 实例，
 * 便于 EventDispatcher 按 eventType 注册。
 *
 * 参数：
 *   - eventType: 监听的领域事件类型
 *   - store: 通知存储
 *   - ctx: 时间上下文（用于 createdAt）
 */
export function createNotificationConsumer(
  eventType: EventType,
  store: NotificationStore,
  ctx: NotificationContext,
): EventConsumer {
  return {
    eventType,
    async handle(
      event: DomainEvent,
      _consumerCtx: ConsumerContext,
    ): Promise<OperationResult<void>> {
      // 1. 从事件派生通知草稿
      const draft = buildNotificationFromEvent(event)
      if (!draft) {
        // payload 缺 recipientId 或事件类型无映射 → 视为成功跳过
        return ok(undefined)
      }

      // 2. 幂等创建通知
      const result = await createNotification(
        {
          recipientId: draft.recipientId,
          type: draft.type,
          title: draft.title,
          body: draft.body,
          sourceType: draft.sourceType,
          sourceId: draft.sourceId,
          eventId: event.eventId,
        },
        ctx,
        store,
      )

      if (!result.ok) {
        // 失败：返回 err 让 EventDispatcher 重试
        return result
      }

      return ok(undefined)
    },
  }
}

/**
 * 批量注册通知消费器到 EventDispatcher。
 *
 * 为每个触发通知的事件类型创建独立的 NotificationConsumer 实例。
 *
 * 返回已注册的事件类型列表，便于日志记录。
 */
export function registerNotificationConsumers(
  dispatcher: {
    register: (consumer: EventConsumer) => void
  },
  store: NotificationStore,
  ctx: NotificationContext,
): EventType[] {
  const eventTypes: EventType[] = [
    'listing.review_rejected',
    'lead.assigned',
    'lead.transferred',
    'sla.breached',
    'task.completed',
    'task.cancelled',
  ]

  for (const eventType of eventTypes) {
    const consumer = createNotificationConsumer(eventType, store, ctx)
    dispatcher.register(consumer)
  }

  return eventTypes
}
