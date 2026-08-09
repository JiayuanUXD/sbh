import { describe, it, expect, beforeEach } from 'vitest'

import {
  AGGREGATE_TYPES,
  EVENT_TYPES,
  EVENT_TYPE_LABELS,
  aggregateTypeFromEventType,
  isAggregateType,
  isEventType,
  type EventType,
} from '@/domain/workflow/event-types'
import {
  buildEventId,
  publishEvent,
  type DomainEvent,
} from '@/domain/workflow/event-publisher'
import {
  DEFAULT_MAX_ATTEMPTS,
  EventDispatcher,
  createInMemoryConsumerContext,
  createInMemoryEventStore,
  type ConsumerContext,
  type EventConsumer,
  type EventStore,
} from '@/domain/workflow/event-consumer'
import { protectDomainEvent } from '@/domain/workflow/workflow-protect'
import { InvalidOperationError } from '@/domain/shared/errors'
import {
  EVENT_FIXTURE_ALREADY_PROCESSED,
  EVENT_FIXTURE_FOLLOWUP_COMPLETED,
  EVENT_FIXTURE_LEAD_ASSIGNED,
  EVENT_FIXTURE_LISTING_PUBLISHED,
  EVENT_FIXTURE_LISTING_UNPUBLISHED,
  EVENT_FIXTURE_MAX_ATTEMPTS_REACHED,
  EVENT_FIXTURE_REPORT_DISMISSED,
  EVENT_FIXTURE_REPORT_SUSTAINED,
  EVENT_FIXTURE_SLA_BREACHED,
} from '@/test/factory/events'

/**
 * M6.3 事务 Outbox 测试（design §3 domain_events / R8）
 *
 * 覆盖：
 *   - eventId 唯一性与自动生成（buildEventId / publishEvent）
 *   - 事件类型枚举覆盖
 *   - publishEvent 生成正确的字段
 *   - publishEvent 非法入参拒绝
 *   - EventDispatcher 按 eventType 分发
 *   - 幂等：已处理事件不重复处理
 *   - 失败重试：attemptCount 递增、lastError 记录
 *   - 重试上限达到后停止重试
 *   - protectDomainEvent create / update 校验
 */

// ────────────────────────────────────────────────────────────
// 辅助：构造消费器
// ────────────────────────────────────────────────────────────
function makeConsumer(
  eventType: EventType,
  behavior: 'ok' | 'fail' | 'throw',
  errorMessage = '消费器模拟失败',
): EventConsumer {
  return {
    eventType,
    async handle(_event, _ctx) {
      if (behavior === 'ok') {
        return { ok: true, data: undefined }
      }
      if (behavior === 'fail') {
        return {
          ok: false,
          error: new InvalidOperationError({
            domain: 'workflow',
            code: 'CONSUMER_SIMULATED_FAIL',
            message: errorMessage,
          }),
        }
      }
      // throw
      throw new Error(errorMessage)
    },
  }
}

// ────────────────────────────────────────────────────────────
// 1. 事件类型枚举与守卫
// ────────────────────────────────────────────────────────────
describe('event-types — 枚举与守卫', () => {
  it('事件类型枚举覆盖 M4/M5/M6 业务事件', () => {
    expect(EVENT_TYPES).toContain('listing.published')
    expect(EVENT_TYPES).toContain('listing.review_approved')
    expect(EVENT_TYPES).toContain('report.sustained')
    expect(EVENT_TYPES).toContain('lead.assigned')
    expect(EVENT_TYPES).toContain('followup.completed')
    expect(EVENT_TYPES).toContain('sla.breached')
  })

  it('isEventType 守卫合法值', () => {
    expect(isEventType('listing.published')).toBe(true)
    expect(isEventType('unknown.event')).toBe(false)
    expect(isEventType(undefined)).toBe(false)
    expect(isEventType(123)).toBe(false)
  })

  it('isAggregateType 守卫合法值', () => {
    expect(isAggregateType('listing')).toBe(true)
    expect(isAggregateType('unknown')).toBe(false)
  })

  it('aggregateTypeFromEventType 按前缀推导', () => {
    expect(aggregateTypeFromEventType('listing.published')).toBe('listing')
    expect(aggregateTypeFromEventType('report.sustained')).toBe('report')
    expect(aggregateTypeFromEventType('lead.assigned')).toBe('lead')
    expect(aggregateTypeFromEventType('invalid')).toBeNull()
    expect(aggregateTypeFromEventType('')).toBeNull()
  })

  it('EVENT_TYPE_LABELS 全覆盖', () => {
    for (const t of EVENT_TYPES) {
      expect(EVENT_TYPE_LABELS[t]).toBeTruthy()
    }
  })

  it('AGGREGATE_TYPES 包含 listing / report / lead / followup / sla / task / correction', () => {
    expect(AGGREGATE_TYPES).toEqual([
      'listing',
      'report',
      'lead',
      'followup',
      'sla',
      'task',
      'correction',
      'supply-submission',
    ])
  })
})

// ────────────────────────────────────────────────────────────
// 2. buildEventId 唯一性
// ────────────────────────────────────────────────────────────
describe('buildEventId — 唯一性', () => {
  it('生成 21 字符 URL 安全字符串', () => {
    const id = buildEventId()
    expect(id).toHaveLength(21)
    expect(/^[A-Za-z0-9_-]+$/.test(id)).toBe(true)
  })

  it('连续生成 1000 个无碰撞', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 1000; i++) {
      ids.add(buildEventId())
    }
    expect(ids.size).toBe(1000)
  })
})

// ────────────────────────────────────────────────────────────
// 3. publishEvent 主路径
// ────────────────────────────────────────────────────────────
describe('publishEvent — 主路径生成字段', () => {
  it('生成完整 DomainEvent：eventId/occurredAt/attemptCount=0/processedAt=null', () => {
    const result = publishEvent({
      eventType: 'listing.published',
      aggregateId: 'listing-1',
      aggregateVersion: 1,
      payload: { listingId: 'listing-1', actorId: 'user-1' },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const ev = result.data
    expect(ev.eventId).toHaveLength(21)
    expect(ev.eventType).toBe('listing.published')
    expect(ev.aggregateType).toBe('listing')
    expect(ev.aggregateId).toBe('listing-1')
    expect(ev.aggregateVersion).toBe(1)
    expect(ev.payload).toEqual({ listingId: 'listing-1', actorId: 'user-1' })
    expect(ev.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    expect(ev.processedAt).toBeNull()
    expect(ev.attemptCount).toBe(0)
    expect(ev.lastError).toBeNull()
  })

  it('aggregateType 缺省时按事件类型前缀推导', () => {
    const result = publishEvent({
      eventType: 'report.sustained',
      aggregateId: 'report-1',
      aggregateVersion: 2,
      payload: { reason: 'test' },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.aggregateType).toBe('report')
  })

  it('显式 aggregateType 优先于前缀推导', () => {
    const result = publishEvent({
      eventType: 'sla.breached',
      aggregateType: 'sla',
      aggregateId: 'lead-1',
      aggregateVersion: 1,
      payload: { slaType: 'first_followup' },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.aggregateType).toBe('sla')
  })

  it('occurredAt 显式传入时使用传入值（字符串）', () => {
    const result = publishEvent({
      eventType: 'lead.assigned',
      aggregateId: 'lead-1',
      aggregateVersion: 1,
      payload: {},
      occurredAt: '2026-07-01T00:00:00.000Z',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.occurredAt).toBe('2026-07-01T00:00:00.000Z')
  })

  it('occurredAt 显式传入 Date 时转 ISO', () => {
    const d = new Date('2026-07-15T12:00:00.000Z')
    const result = publishEvent({
      eventType: 'lead.assigned',
      aggregateId: 'lead-1',
      aggregateVersion: 1,
      payload: {},
      occurredAt: d,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.occurredAt).toBe(d.toISOString())
  })

  it('aggregateId 数字被转为字符串', () => {
    const result = publishEvent({
      eventType: 'listing.published',
      aggregateId: 12345,
      aggregateVersion: 1,
      payload: {},
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.aggregateId).toBe('12345')
  })
})

// ────────────────────────────────────────────────────────────
// 4. publishEvent 非法入参拒绝
// ────────────────────────────────────────────────────────────
describe('publishEvent — 非法入参拒绝', () => {
  it('未注册的事件类型拒绝', () => {
    const result = publishEvent({
      eventType: 'unknown.event' as EventType,
      aggregateId: 'x',
      aggregateVersion: 1,
      payload: {},
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('EVENT_TYPE_NOT_REGISTERED')
  })

  it('非法 aggregateType 拒绝', () => {
    const result = publishEvent({
      eventType: 'listing.published',
      aggregateType: 'unknown',
      aggregateId: 'x',
      aggregateVersion: 1,
      payload: {},
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('EVENT_AGGREGATE_TYPE_INVALID')
  })

  it('空 aggregateId 拒绝', () => {
    const result = publishEvent({
      eventType: 'listing.published',
      aggregateId: '',
      aggregateVersion: 1,
      payload: {},
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('EVENT_AGGREGATE_ID_EMPTY')
  })

  it('aggregateVersion < 1 拒绝', () => {
    const result = publishEvent({
      eventType: 'listing.published',
      aggregateId: 'x',
      aggregateVersion: 0,
      payload: {},
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('EVENT_AGGREGATE_VERSION_INVALID')
  })

  it('aggregateVersion 非整数拒绝', () => {
    const result = publishEvent({
      eventType: 'listing.published',
      aggregateId: 'x',
      aggregateVersion: 1.5,
      payload: {},
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('EVENT_AGGREGATE_VERSION_INVALID')
  })

  it('payload 非 object 拒绝', () => {
    const result = publishEvent({
      eventType: 'listing.published',
      aggregateId: 'x',
      aggregateVersion: 1,
      payload: 'not-object' as unknown as Record<string, unknown>,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('EVENT_PAYLOAD_INVALID')
  })

  it('payload 为数组拒绝', () => {
    const result = publishEvent({
      eventType: 'listing.published',
      aggregateId: 'x',
      aggregateVersion: 1,
      payload: [1, 2, 3] as unknown as Record<string, unknown>,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('EVENT_PAYLOAD_INVALID')
  })
})

// ────────────────────────────────────────────────────────────
// 5. EventDispatcher 按 eventType 分发
// ────────────────────────────────────────────────────────────
describe('EventDispatcher — 分发与注册', () => {
  let store: ReturnType<typeof createInMemoryEventStore>
  let ctx: ConsumerContext
  let dispatcher: EventDispatcher

  beforeEach(() => {
    store = createInMemoryEventStore()
    ctx = createInMemoryConsumerContext(store)
    dispatcher = new EventDispatcher(store)
  })

  it('注册消费器后 hasConsumer 返回 true', () => {
    const consumer = makeConsumer('listing.published', 'ok')
    expect(dispatcher.hasConsumer('listing.published')).toBe(false)
    dispatcher.register(consumer)
    expect(dispatcher.hasConsumer('listing.published')).toBe(true)
  })

  it('重复注册同 eventType 抛错', () => {
    dispatcher.register(makeConsumer('listing.published', 'ok'))
    expect(() => dispatcher.register(makeConsumer('listing.published', 'ok'))).toThrow(
      /已注册消费器/,
    )
  })

  it('unregister 后 hasConsumer 返回 false', () => {
    dispatcher.register(makeConsumer('listing.published', 'ok'))
    dispatcher.unregister('listing.published')
    expect(dispatcher.hasConsumer('listing.published')).toBe(false)
  })

  it('成功分发：消费器 ok → succeeded=true、attemptCount=1、processedAt 写入', async () => {
    dispatcher.register(makeConsumer('listing.published', 'ok'))
    store.seed([EVENT_FIXTURE_LISTING_PUBLISHED])
    const result = await dispatcher.dispatch(EVENT_FIXTURE_LISTING_PUBLISHED, ctx)
    expect(result.succeeded).toBe(true)
    expect(result.attemptCount).toBe(1)
    expect(result.skipped).toBeUndefined()
    const updated = store.snapshot().get(EVENT_FIXTURE_LISTING_PUBLISHED.eventId)
    expect(updated?.processedAt).not.toBeNull()
    expect(updated?.attemptCount).toBe(1)
    expect(updated?.lastError).toBeNull()
  })

  it('未注册消费器：skipped=no_consumer，processedAt 不写入', async () => {
    store.seed([EVENT_FIXTURE_LISTING_PUBLISHED])
    const result = await dispatcher.dispatch(EVENT_FIXTURE_LISTING_PUBLISHED, ctx)
    expect(result.succeeded).toBe(false)
    expect(result.skipped).toBe('no_consumer')
    const updated = store.snapshot().get(EVENT_FIXTURE_LISTING_PUBLISHED.eventId)
    expect(updated?.processedAt).toBeNull()
  })

  it('默认 maxAttempts = 5', () => {
    expect(dispatcher.getMaxAttempts()).toBe(DEFAULT_MAX_ATTEMPTS)
    expect(DEFAULT_MAX_ATTEMPTS).toBe(5)
  })
})

// ────────────────────────────────────────────────────────────
// 6. EventDispatcher 幂等性
// ────────────────────────────────────────────────────────────
describe('EventDispatcher — 幂等性', () => {
  let store: ReturnType<typeof createInMemoryEventStore>
  let ctx: ConsumerContext
  let dispatcher: EventDispatcher
  let callCount: number

  beforeEach(() => {
    store = createInMemoryEventStore()
    ctx = createInMemoryConsumerContext(store)
    dispatcher = new EventDispatcher(store)
    callCount = 0
  })

  it('已处理事件（processedAt != null）跳过，不调用消费器', async () => {
    const consumer: EventConsumer = {
      eventType: 'listing.published',
      async handle() {
        callCount++
        return { ok: true, data: undefined }
      },
    }
    dispatcher.register(consumer)
    store.seed([EVENT_FIXTURE_ALREADY_PROCESSED])
    const result = await dispatcher.dispatch(EVENT_FIXTURE_ALREADY_PROCESSED, ctx)
    expect(result.succeeded).toBe(true)
    expect(result.skipped).toBe('already_processed')
    expect(callCount).toBe(0)
  })

  it('同一事件二次分发不重复调用消费器', async () => {
    const consumer: EventConsumer = {
      eventType: 'listing.published',
      async handle() {
        callCount++
        return { ok: true, data: undefined }
      },
    }
    dispatcher.register(consumer)
    store.seed([EVENT_FIXTURE_LISTING_PUBLISHED])
    const r1 = await dispatcher.dispatch(EVENT_FIXTURE_LISTING_PUBLISHED, ctx)
    expect(r1.succeeded).toBe(true)
    expect(callCount).toBe(1)
    // 二次分发：store 中 processedAt 已设置 → 跳过
    const r2 = await dispatcher.dispatch(EVENT_FIXTURE_LISTING_PUBLISHED, ctx)
    expect(r2.succeeded).toBe(true)
    expect(r2.skipped).toBe('already_processed')
    expect(callCount).toBe(1) // 未再次调用
  })

  it('不同 eventType 事件互不干扰', async () => {
    let listingCount = 0
    let reportCount = 0
    dispatcher.register({
      eventType: 'listing.published',
      async handle() {
        listingCount++
        return { ok: true, data: undefined }
      },
    })
    dispatcher.register({
      eventType: 'report.sustained',
      async handle() {
        reportCount++
        return { ok: true, data: undefined }
      },
    })
    store.seed([EVENT_FIXTURE_LISTING_PUBLISHED, EVENT_FIXTURE_REPORT_SUSTAINED])
    await dispatcher.dispatch(EVENT_FIXTURE_LISTING_PUBLISHED, ctx)
    await dispatcher.dispatch(EVENT_FIXTURE_REPORT_SUSTAINED, ctx)
    expect(listingCount).toBe(1)
    expect(reportCount).toBe(1)
  })
})

// ────────────────────────────────────────────────────────────
// 7. EventDispatcher 失败重试
// ────────────────────────────────────────────────────────────
describe('EventDispatcher — 失败重试与死信', () => {
  let store: ReturnType<typeof createInMemoryEventStore>
  let ctx: ConsumerContext

  beforeEach(() => {
    store = createInMemoryEventStore()
    ctx = createInMemoryConsumerContext(store)
  })

  it('消费器返回 err：attemptCount +1、lastError 记录、processedAt 仍为 null', async () => {
    const dispatcher = new EventDispatcher(store)
    dispatcher.register(makeConsumer('listing.published', 'fail', '下游服务 503'))
    store.seed([EVENT_FIXTURE_LISTING_PUBLISHED])
    const result = await dispatcher.dispatch(EVENT_FIXTURE_LISTING_PUBLISHED, ctx)
    expect(result.succeeded).toBe(false)
    expect(result.attemptCount).toBe(1)
    expect(result.error).toBe('下游服务 503')
    const updated = store.snapshot().get(EVENT_FIXTURE_LISTING_PUBLISHED.eventId)
    expect(updated?.attemptCount).toBe(1)
    expect(updated?.lastError).toBe('下游服务 503')
    expect(updated?.processedAt).toBeNull()
  })

  it('消费器抛异常：兜底记录 attemptCount +1 + lastError', async () => {
    const dispatcher = new EventDispatcher(store)
    dispatcher.register(makeConsumer('listing.published', 'throw', '意外崩溃'))
    store.seed([EVENT_FIXTURE_LISTING_PUBLISHED])
    const result = await dispatcher.dispatch(EVENT_FIXTURE_LISTING_PUBLISHED, ctx)
    expect(result.succeeded).toBe(false)
    expect(result.attemptCount).toBe(1)
    expect(result.error).toBe('意外崩溃')
  })

  it('多次失败 attemptCount 递增', async () => {
    const dispatcher = new EventDispatcher(store, { maxAttempts: 5 })
    dispatcher.register(makeConsumer('listing.published', 'fail'))
    store.seed([EVENT_FIXTURE_LISTING_PUBLISHED])
    // 3 次重试
    for (let i = 1; i <= 3; i++) {
      const result = await dispatcher.dispatch(EVENT_FIXTURE_LISTING_PUBLISHED, ctx)
      expect(result.attemptCount).toBe(i)
    }
    const updated = store.snapshot().get(EVENT_FIXTURE_LISTING_PUBLISHED.eventId)
    expect(updated?.attemptCount).toBe(3)
    expect(updated?.processedAt).toBeNull()
  })

  it('达到 maxAttempts 后停止重试，标记为 max_attempts_reached', async () => {
    const dispatcher = new EventDispatcher(store, { maxAttempts: 2 })
    dispatcher.register(makeConsumer('listing.published', 'fail'))
    store.seed([EVENT_FIXTURE_LISTING_PUBLISHED])
    // 第 1 次：attemptCount 0 → 1
    await dispatcher.dispatch(EVENT_FIXTURE_LISTING_PUBLISHED, ctx)
    // 第 2 次：attemptCount 1 → 2
    await dispatcher.dispatch(EVENT_FIXTURE_LISTING_PUBLISHED, ctx)
    // 第 3 次：attemptCount = maxAttempts → 死信
    const r3 = await dispatcher.dispatch(EVENT_FIXTURE_LISTING_PUBLISHED, ctx)
    expect(r3.succeeded).toBe(false)
    expect(r3.skipped).toBe('max_attempts_reached')
    expect(r3.attemptCount).toBe(2)
  })

  it('EVENT_FIXTURE_MAX_ATTEMPTS_REACHED 直接分发立即死信', async () => {
    const dispatcher = new EventDispatcher(store, { maxAttempts: 5 })
    dispatcher.register(makeConsumer('listing.published', 'ok'))
    store.seed([EVENT_FIXTURE_MAX_ATTEMPTS_REACHED])
    const result = await dispatcher.dispatch(EVENT_FIXTURE_MAX_ATTEMPTS_REACHED, ctx)
    expect(result.succeeded).toBe(false)
    expect(result.skipped).toBe('max_attempts_reached')
  })
})

// ────────────────────────────────────────────────────────────
// 8. EventDispatcher dispatchPending 批量分发
// ────────────────────────────────────────────────────────────
describe('EventDispatcher — dispatchPending 批量', () => {
  it('按 eventType 拉取未处理事件并依次分发', async () => {
    const store = createInMemoryEventStore()
    const ctx = createInMemoryConsumerContext(store)
    const dispatcher = new EventDispatcher(store)
    let count = 0
    dispatcher.register({
      eventType: 'listing.published',
      async handle() {
        count++
        return { ok: true, data: undefined }
      },
    })
    // 拷贝并使用不同 eventId 避免唯一键冲突
    const ev1: DomainEvent = {
      ...EVENT_FIXTURE_LISTING_PUBLISHED,
      eventId: 'evt_batch_001',
    }
    const ev2: DomainEvent = {
      ...EVENT_FIXTURE_LISTING_PUBLISHED,
      eventId: 'evt_batch_002',
    }
    const ev3: DomainEvent = {
      ...EVENT_FIXTURE_LISTING_PUBLISHED,
      eventId: 'evt_batch_003',
    }
    store.seed([ev1, ev2, ev3])
    const results = await dispatcher.dispatchPending('listing.published', ctx, 50)
    expect(results).toHaveLength(3)
    expect(results.every((r) => r.succeeded)).toBe(true)
    expect(count).toBe(3)
  })

  it('已处理事件不出现在 pending 列表', async () => {
    const store = createInMemoryEventStore()
    const ctx = createInMemoryConsumerContext(store)
    const dispatcher = new EventDispatcher(store)
    dispatcher.register(makeConsumer('listing.published', 'ok'))
    store.seed([EVENT_FIXTURE_LISTING_PUBLISHED, EVENT_FIXTURE_ALREADY_PROCESSED])
    const results = await dispatcher.dispatchPending('listing.published', ctx, 50)
    // ALREADY_PROCESSED 不应出现在 pending（processedAt != null）
    const ids = results.map((r) => r.eventId)
    expect(ids).toContain(EVENT_FIXTURE_LISTING_PUBLISHED.eventId)
    expect(ids).not.toContain(EVENT_FIXTURE_ALREADY_PROCESSED.eventId)
  })
})

// ────────────────────────────────────────────────────────────
// 9. protectDomainEvent Collection beforeChange hook
// ────────────────────────────────────────────────────────────
describe('protectDomainEvent — Collection beforeChange hook', () => {
  // 复用 listing-report.test.ts 的模式：args as never 绕过 Payload hook 复杂类型签名
  const run = (args: Record<string, unknown>) =>
    protectDomainEvent(args as never) as Promise<Record<string, unknown>>

  const create = (data: Record<string, unknown>) =>
    run({ operation: 'create', originalDoc: undefined, data })

  const update = (
    data: Record<string, unknown>,
    originalDoc: Record<string, unknown>,
  ) => run({ operation: 'update', originalDoc, data })

  it('create：自动生成 eventId（缺省时）', async () => {
    const result = await create({
      eventType: 'listing.published',
      aggregateType: 'listing',
      aggregateId: 'listing-1',
      aggregateVersion: 1,
      payload: { actorId: 'user-1' },
    })
    expect(result.eventId).toBeTruthy()
    expect(typeof result.eventId).toBe('string')
    expect((result.eventId as string).length).toBe(21)
  })

  it('create：保留调用方传入的 eventId', async () => {
    const result = await create({
      eventId: 'evt_provided_001',
      eventType: 'listing.published',
      aggregateType: 'listing',
      aggregateId: 'listing-1',
      aggregateVersion: 1,
      payload: {},
    })
    expect(result.eventId).toBe('evt_provided_001')
  })

  it('create：缺省 occurredAt 时设置当前 UTC', async () => {
    const before = new Date().toISOString()
    const result = await create({
      eventType: 'listing.published',
      aggregateType: 'listing',
      aggregateId: 'listing-1',
      aggregateVersion: 1,
      payload: {},
    })
    const after = new Date().toISOString()
    expect(result.occurredAt).toBeTruthy()
    const occurredAt = result.occurredAt as string
    expect(occurredAt >= before).toBe(true)
    expect(occurredAt <= after).toBe(true)
  })

  it('create：初始化 attemptCount=0 / processedAt=null / lastError=null', async () => {
    const result = await create({
      eventType: 'listing.published',
      aggregateType: 'listing',
      aggregateId: 'listing-1',
      aggregateVersion: 1,
      payload: {},
      // 客户端尝试篡改处理状态
      attemptCount: 99,
      processedAt: '2026-01-01T00:00:00.000Z',
      lastError: 'fake error',
    })
    expect(result.attemptCount).toBe(0)
    expect(result.processedAt).toBeNull()
    expect(result.lastError).toBeNull()
  })

  it('create：非法 eventType 抛 EVENT_TYPE_INVALID', async () => {
    await expect(
      create({
        eventType: 'unknown.event',
        aggregateType: 'listing',
        aggregateId: 'x',
        aggregateVersion: 1,
        payload: {},
      }),
    ).rejects.toThrow(/事件类型未注册/)
  })

  it('create：非法 aggregateType 抛 EVENT_AGGREGATE_TYPE_INVALID', async () => {
    await expect(
      create({
        eventType: 'listing.published',
        aggregateType: 'unknown',
        aggregateId: 'x',
        aggregateVersion: 1,
        payload: {},
      }),
    ).rejects.toThrow(/聚合类型未注册/)
  })

  it('create：空 aggregateId 抛 EVENT_AGGREGATE_ID_EMPTY', async () => {
    await expect(
      create({
        eventType: 'listing.published',
        aggregateType: 'listing',
        aggregateId: '',
        aggregateVersion: 1,
        payload: {},
      }),
    ).rejects.toThrow(/聚合 ID 不能为空/)
  })

  it('create：aggregateVersion < 1 抛 EVENT_AGGREGATE_VERSION_INVALID', async () => {
    await expect(
      create({
        eventType: 'listing.published',
        aggregateType: 'listing',
        aggregateId: 'x',
        aggregateVersion: 0,
        payload: {},
      }),
    ).rejects.toThrow(/聚合版本号必须为 ≥ 1 的整数/)
  })

  it('create：payload 非 object 抛 EVENT_PAYLOAD_INVALID', async () => {
    await expect(
      create({
        eventType: 'listing.published',
        aggregateType: 'listing',
        aggregateId: 'x',
        aggregateVersion: 1,
        payload: 'not-object',
      }),
    ).rejects.toThrow(/事件 payload 必须为 JSON 对象/)
  })

  it('update：修改 payload 不可变字段抛 EVENT_IMMUTABLE_FIELD', async () => {
    const originalDoc = {
      eventId: 'evt_001',
      eventType: 'listing.published',
      aggregateType: 'listing',
      aggregateId: 'listing-1',
      aggregateVersion: 1,
      payload: { actorId: 'user-1' },
      occurredAt: '2026-07-01T00:00:00.000Z',
    }
    await expect(
      update(
        {
          ...originalDoc,
          payload: { actorId: 'attacker' }, // 尝试篡改 payload
        },
        originalDoc,
      ),
    ).rejects.toThrow(/事件字段不可变：payload/)
  })

  it('update：修改 eventType 不可变字段抛 EVENT_IMMUTABLE_FIELD', async () => {
    const originalDoc = {
      eventId: 'evt_001',
      eventType: 'listing.published',
      aggregateType: 'listing',
      aggregateId: 'listing-1',
      aggregateVersion: 1,
      payload: {},
      occurredAt: '2026-07-01T00:00:00.000Z',
    }
    await expect(
      update(
        {
          ...originalDoc,
          eventType: 'listing.unpublished',
        },
        originalDoc,
      ),
    ).rejects.toThrow(/事件字段不可变：eventType/)
  })

  it('update：仅修改 processedAt / attemptCount / lastError 允许', async () => {
    const originalDoc = {
      eventId: 'evt_001',
      eventType: 'listing.published',
      aggregateType: 'listing',
      aggregateId: 'listing-1',
      aggregateVersion: 1,
      payload: { actorId: 'user-1' },
      occurredAt: '2026-07-01T00:00:00.000Z',
      processedAt: null,
      attemptCount: 0,
      lastError: null,
    }
    const result = await update(
      {
        ...originalDoc,
        processedAt: '2026-07-01T00:05:00.000Z',
        attemptCount: 1,
        lastError: null,
      },
      originalDoc,
    )
    expect(result.processedAt).toBe('2026-07-01T00:05:00.000Z')
    expect(result.attemptCount).toBe(1)
  })

  it('update：Payload 重建等值 JSON payload 时仍允许处理状态更新', async () => {
    const originalDoc = {
      eventId: 'evt_001',
      eventType: 'listing.published',
      aggregateType: 'listing',
      aggregateId: 'listing-1',
      aggregateVersion: 1,
      payload: { nested: { actorId: 'user-1' } },
      occurredAt: '2026-07-01T00:00:00.000Z',
    }
    const result = await update(
      {
        ...originalDoc,
        payload: { nested: { actorId: 'user-1' } },
        attemptCount: 1,
      },
      originalDoc,
    )
    expect(result.attemptCount).toBe(1)
  })
})

// ────────────────────────────────────────────────────────────
// 10. fixture 完整性
// ────────────────────────────────────────────────────────────
describe('事件 fixture — 完整性', () => {
  const fixtures = [
    EVENT_FIXTURE_LISTING_PUBLISHED,
    EVENT_FIXTURE_LISTING_UNPUBLISHED,
    EVENT_FIXTURE_REPORT_SUSTAINED,
    EVENT_FIXTURE_REPORT_DISMISSED,
    EVENT_FIXTURE_LEAD_ASSIGNED,
    EVENT_FIXTURE_FOLLOWUP_COMPLETED,
    EVENT_FIXTURE_SLA_BREACHED,
  ]

  it('所有 fixture 满足幂等键约束（eventId 唯一 + aggregateVersion ≥ 1）', () => {
    const ids = new Set<string>()
    for (const f of fixtures) {
      expect(f.eventId).toBeTruthy()
      expect(ids.has(f.eventId)).toBe(false)
      ids.add(f.eventId)
      expect(f.aggregateVersion).toBeGreaterThanOrEqual(1)
      expect(f.attemptCount).toBeGreaterThanOrEqual(0)
    }
  })

  it('fixture 覆盖 5 种聚合类型', () => {
    const types = new Set(fixtures.map((f) => f.aggregateType))
    expect(types.has('listing')).toBe(true)
    expect(types.has('report')).toBe(true)
    expect(types.has('lead')).toBe(true)
    expect(types.has('followup')).toBe(true)
    expect(types.has('sla')).toBe(true)
  })

  it('EVENT_FIXTURE_ALREADY_PROCESSED 的 processedAt != null', () => {
    expect(EVENT_FIXTURE_ALREADY_PROCESSED.processedAt).not.toBeNull()
    expect(EVENT_FIXTURE_ALREADY_PROCESSED.attemptCount).toBe(1)
  })

  it('EVENT_FIXTURE_MAX_ATTEMPTS_REACHED 的 attemptCount = 5', () => {
    expect(EVENT_FIXTURE_MAX_ATTEMPTS_REACHED.attemptCount).toBe(5)
    expect(EVENT_FIXTURE_MAX_ATTEMPTS_REACHED.processedAt).toBeNull()
    expect(EVENT_FIXTURE_MAX_ATTEMPTS_REACHED.lastError).toBeTruthy()
  })
})
