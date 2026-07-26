/**
 * 领域事件消费器与分发器（tasks.md M6.3 / design §3 domain_events / R8）
 *
 * 职责：
 *   - 定义 EventConsumer 接口：按 eventType 注册并幂等处理事件
 *   - EventDispatcher：注册消费者、按 eventType 分发、记录 processedAt 与 attemptCount
 *   - 幂等机制：消费前检查 processedAt 是否已设置，已处理则跳过返回 ok
 *   - 失败处理：attemptCount +1、记录 lastError、未达重试上限则重试
 *
 * 业务不变量（AGENTS.md §10）：
 *   - 消费器必须幂等，重复投递不能生成重复待办 / 通知 / 审计
 *   - 高风险操作的副作用由消费器从 Outbox 拉取事件后产生
 *
 * 设计取舍：
 *   - Dispatcher 不直接依赖 Payload Local API：通过 EventStore 接口抽象，
 *     便于单元测试和未来替换为消息队列
 *   - 重试策略：达到 maxAttempts 后标记为"死信"（不再自动重试），由人工介入
 *   - 消费器执行用户副作用时必须在自身实现内做幂等检查（按 event_id + aggregate_version）
 */

import { InvalidOperationError } from '@/domain/shared/errors'
import { ok, err, type OperationResult } from '@/domain/shared/result'

import type { EventType } from './event-types'
import type { DomainEvent } from './event-publisher'

/**
 * 消费器上下文：提供事件存储访问能力。
 *
 * 消费器通过 ctx.updateEvent 更新事件状态（processedAt / attemptCount / lastError），
 * 不直接读写数据库，保持与存储层解耦。
 */
export interface ConsumerContext {
  /**
   * 更新事件状态：写入 processedAt / attemptCount / lastError。
   * 由 EventStore 实现负责落库。
   */
  updateEvent: (params: {
    eventId: string
    processedAt?: string | null
    attemptCount?: number
    lastError?: string | null
  }) => Promise<OperationResult<void>>
}

/**
 * 事件消费器接口。
 *
 * 每个消费器声明自己关心的 eventType，并在 handle 中实现幂等副作用。
 *
 * 幂等责任：
 *   - Dispatcher 已做"processedAt 已设置则跳过"的快速路径
 *   - 消费器内部仍需按 event_id + aggregate_version 做去重，
 *     防止并行消费或重试过程中产生的重复副作用
 */
export interface EventConsumer<TPayload = Record<string, unknown>> {
  /** 该消费器关心的事件类型 */
  eventType: EventType
  /** 处理事件：成功返回 ok(void)，失败返回 err */
  handle(event: DomainEvent<TPayload>, ctx: ConsumerContext): Promise<OperationResult<void>>
}

/**
 * 事件存储接口（抽象 Outbox 持久层）。
 *
 * Dispatcher 通过该接口读取待处理事件并更新状态。
 * 真实实现由 Payload Local API 提供，测试用 in-memory 实现。
 *
 * M6.5 扩展：新增 createEvent（写入 Outbox）和 findByAggregate（按聚合根查询事件，
 * 用于 SLA 扫描器的事件级幂等检查：相同 lead 不重复生成 sla.breached 事件）。
 */
export interface EventStore {
  /** 按 eventId 读取事件 */
  getByEventId(eventId: string): Promise<DomainEvent | null>
  /** 按 eventType 读取未处理事件列表（processedAt 为 null） */
  listPendingByEventType(eventType: EventType, limit?: number): Promise<DomainEvent[]>
  /** 更新事件状态 */
  updateEvent(params: {
    eventId: string
    processedAt?: string | null
    attemptCount?: number
    lastError?: string | null
  }): Promise<OperationResult<void>>
  /**
   * 写入事件到 Outbox（M6.5 新增）。
   *
   * 由 SLA 扫描器在发现违规时调用，将 'sla.breached' / 'lead.reclaimed' 等事件
   * 写入 domain_events Collection。生产实现为 req.payload.create。
   */
  createEvent(event: DomainEvent): Promise<OperationResult<void>>
  /**
   * 按 eventType + aggregateId 查询已存在事件（M6.5 新增）。
   *
   * 用于 SLA 扫描器幂等检查：若该聚合根已有同类型事件，则跳过生成。
   * 返回数组（可能多版本）；调用方按需检查非空。
   */
  findByAggregate(
    eventType: EventType,
    aggregateId: string,
  ): Promise<DomainEvent[]>
}

/** 默认最大重试次数（达到后标记为死信，不再自动重试） */
export const DEFAULT_MAX_ATTEMPTS = 5

/** 分发结果（单次 dispatch 调用的汇总） */
export interface DispatchResult {
  /** 事件 ID */
  eventId: string
  /** 是否成功处理（已处理或本次成功） */
  succeeded: boolean
  /** 跳过原因（如已处理 / 无注册消费者 / 重试上限达到） */
  skipped?: 'already_processed' | 'no_consumer' | 'max_attempts_reached'
  /** 错误信息（失败时填） */
  error?: string
  /** 当前 attemptCount */
  attemptCount: number
}

/**
 * 事件分发器。
 *
 * 注册 EventConsumer，按 eventType 路由事件到对应消费器，
 * 记录处理状态，失败重试。
 *
 * 使用：
 *   ```ts
 *   const dispatcher = new EventDispatcher(store, { maxAttempts: 5 })
 *   dispatcher.register(listingPublishedConsumer)
 *   const result = await dispatcher.dispatch(event, ctx)
 *   ```
 */
export class EventDispatcher {
  private readonly consumers = new Map<EventType, EventConsumer>()
  private readonly maxAttempts: number

  constructor(
    private readonly store: EventStore,
    options: { maxAttempts?: number } = {},
  ) {
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  }

  /** 注册消费器；同一 eventType 重复注册将抛错（防止意外覆盖） */
  register(consumer: EventConsumer): void {
    if (this.consumers.has(consumer.eventType)) {
      throw new InvalidOperationError({
        domain: 'workflow',
        code: 'EVENT_CONSUMER_DUPLICATE',
        message: `事件类型 ${consumer.eventType} 已注册消费器`,
        details: { eventType: consumer.eventType },
      })
    }
    this.consumers.set(consumer.eventType, consumer)
  }

  /** 取消注册（主要用于测试） */
  unregister(eventType: EventType): void {
    this.consumers.delete(eventType)
  }

  /** 是否已注册某 eventType 的消费器 */
  hasConsumer(eventType: EventType): boolean {
    return this.consumers.has(eventType)
  }

  /**
   * 分发单个事件到对应消费器。
   *
   * 幂等保证：
   *   1. 从 store 读取最新事件状态（防止并发处理）
   *   2. processedAt != null → 跳过返回 succeeded
   *   3. attemptCount >= maxAttempts → 标记 max_attempts_reached，不再处理
   *   4. 无注册消费器 → skipped: no_consumer
   *   5. 调用消费器 handle；成功写 processedAt，失败 attemptCount +1 + lastError
   *
   * 返回 DispatchResult，调用方按需记录日志或触发告警。
   */
  async dispatch(
    event: DomainEvent,
    ctx: ConsumerContext,
  ): Promise<DispatchResult> {
    // 1. 从 store 读取最新状态（防并发处理）
    const latest = await this.store.getByEventId(event.eventId)
    const current = latest ?? event
    const attemptCount = current.attemptCount

    // 2. 幂等：已处理 → 跳过
    if (current.processedAt !== null && current.processedAt !== undefined) {
      return {
        eventId: event.eventId,
        succeeded: true,
        skipped: 'already_processed',
        attemptCount,
      }
    }

    // 3. 重试上限达到 → 死信
    if (attemptCount >= this.maxAttempts) {
      return {
        eventId: event.eventId,
        succeeded: false,
        skipped: 'max_attempts_reached',
        attemptCount,
      }
    }

    // 4. 无注册消费器 → 跳过（事件保留待处理状态，便于后续注册消费器后再处理）
    const consumer = this.consumers.get(current.eventType)
    if (!consumer) {
      return {
        eventId: event.eventId,
        succeeded: false,
        skipped: 'no_consumer',
        attemptCount,
      }
    }

    // 5. 调用消费器
    const nextAttempt = attemptCount + 1
    try {
      const result = await consumer.handle(current, ctx)
      if (result.ok) {
        // 成功：写入 processedAt，清空 lastError
        const processedAt = new Date().toISOString()
        const updateRes = await ctx.updateEvent({
          eventId: event.eventId,
          processedAt,
          attemptCount: nextAttempt,
          lastError: null,
        })
        if (!updateRes.ok) {
          return {
            eventId: event.eventId,
            succeeded: false,
            error: `消费器成功但状态更新失败：${updateRes.error.message}`,
            attemptCount: nextAttempt,
          }
        }
        return {
          eventId: event.eventId,
          succeeded: true,
          attemptCount: nextAttempt,
        }
      }
      // 失败：attemptCount +1，记录 lastError
      const lastError = result.error.message
      await ctx.updateEvent({
        eventId: event.eventId,
        attemptCount: nextAttempt,
        lastError,
      })
      return {
        eventId: event.eventId,
        succeeded: false,
        error: lastError,
        attemptCount: nextAttempt,
      }
    } catch (e) {
      // 消费器抛异常：兜底记录
      const lastError = e instanceof Error ? e.message : String(e)
      await ctx.updateEvent({
        eventId: event.eventId,
        attemptCount: nextAttempt,
        lastError,
      })
      return {
        eventId: event.eventId,
        succeeded: false,
        error: lastError,
        attemptCount: nextAttempt,
      }
    }
  }

  /**
   * 批量分发：按 eventType 拉取未处理事件并依次分发。
   *
   * 用于后台 SLA 扫描任务或定时拉取场景。
   * 返回每个事件的分发结果，调用方按需记录日志。
   */
  async dispatchPending(
    eventType: EventType,
    ctx: ConsumerContext,
    limit = 50,
  ): Promise<DispatchResult[]> {
    const events = await this.store.listPendingByEventType(eventType, limit)
    const results: DispatchResult[] = []
    for (const event of events) {
      const result = await this.dispatch(event, ctx)
      results.push(result)
    }
    return results
  }

  /** 当前最大重试次数配置 */
  getMaxAttempts(): number {
    return this.maxAttempts
  }
}

/**
 * 创建内存版 EventStore（用于单元测试）。
 *
 * 真实环境由 Payload Local API 包装实现，提供数据库持久化。
 */
export function createInMemoryEventStore(): EventStore & {
  /** 测试辅助：直接向 store 写入事件 */
  seed(events: DomainEvent[]): void
  /** 测试辅助：读取内部存储 */
  snapshot(): ReadonlyMap<string, DomainEvent>
} {
  const store = new Map<string, DomainEvent>()
  return {
    async getByEventId(eventId: string): Promise<DomainEvent | null> {
      return store.get(eventId) ?? null
    },
    async listPendingByEventType(
      eventType: EventType,
      limit = 50,
    ): Promise<DomainEvent[]> {
      const pending: DomainEvent[] = []
      for (const ev of store.values()) {
        if (ev.eventType !== eventType) continue
        if (ev.processedAt !== null && ev.processedAt !== undefined) continue
        pending.push(ev)
        if (pending.length >= limit) break
      }
      return pending
    },
    async updateEvent(params): Promise<OperationResult<void>> {
      const ev = store.get(params.eventId)
      if (!ev) {
        return err(
          new InvalidOperationError({
            domain: 'workflow',
            code: 'EVENT_NOT_FOUND',
            message: `事件不存在：${params.eventId}`,
            details: { eventId: params.eventId },
          }),
        )
      }
      if (params.processedAt !== undefined) ev.processedAt = params.processedAt
      if (params.attemptCount !== undefined) ev.attemptCount = params.attemptCount
      if (params.lastError !== undefined) ev.lastError = params.lastError
      return ok(undefined)
    },
    async createEvent(event: DomainEvent): Promise<OperationResult<void>> {
      // eventId 唯一性兜底（防重复写入）
      if (store.has(event.eventId)) {
        return err(
          new InvalidOperationError({
            domain: 'workflow',
            code: 'EVENT_DUPLICATE_ID',
            message: `事件 ID 已存在：${event.eventId}`,
            details: { eventId: event.eventId },
          }),
        )
      }
      store.set(event.eventId, { ...event })
      return ok(undefined)
    },
    async findByAggregate(
      eventType: EventType,
      aggregateId: string,
    ): Promise<DomainEvent[]> {
      const matched: DomainEvent[] = []
      for (const ev of store.values()) {
        if (ev.eventType === eventType && ev.aggregateId === aggregateId) {
          matched.push(ev)
        }
      }
      return matched
    },
    seed(events: DomainEvent[]): void {
      for (const ev of events) store.set(ev.eventId, { ...ev })
    },
    snapshot(): ReadonlyMap<string, DomainEvent> {
      return store
    },
  }
}

/**
 * 创建内存版 ConsumerContext（绑定到给定 EventStore，用于单元测试）。
 */
export function createInMemoryConsumerContext(store: EventStore): ConsumerContext {
  return {
    updateEvent: (params) => store.updateEvent(params),
  }
}
