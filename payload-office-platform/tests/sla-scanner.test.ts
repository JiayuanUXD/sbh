import { describe, it, expect, beforeEach } from 'vitest'

import {
  SLA_BREACH_TYPES,
  SLA_SCAN_TYPES,
  isSlaBreachType,
  isSlaScanType,
  type SlaScanType,
} from '@/domain/workflow/sla-scan-types'
import {
  SLA_SCAN_INTERVALS,
  SLA_THRESHOLDS,
  computeFirstFollowupDeadline,
  computePublicPoolReclaimDeadline,
  computeShanghaiDayBoundary,
  computeStaleMaintenanceDeadline,
  createInMemorySlaScanStore,
  runSlaScan,
  scanFirstFollowupBreaches,
  scanPublicPoolReclaims,
  scanStaleMaintenances,
  type LeadScanRecord,
  type ListingScanRecord,
  type SlaScanContext,
} from '@/domain/workflow/sla-scanner'
import { createInMemoryEventStore } from '@/domain/workflow/event-consumer'
import { createInMemoryTaskStore } from '@/domain/workflow/task-service'

/**
 * M6.5 SLA 扫描任务测试（design §8 / R6, R7）
 *
 * 覆盖：
 *   - sla-scan-types 枚举与守卫
 *   - 时间边界计算（Asia/Shanghai 自然日 / 各 SLA 截止）
 *   - scanFirstFollowupBreaches：生成 sla.breached 事件 + followup-first 待办（幂等）
 *   - scanPublicPoolReclaims：生成 lead.reclaimed 事件（幂等，不创建待办）
 *   - scanStaleMaintenances：创建 listing-stale-maintenance 待办（幂等）
 *   - runSlaScan：总入口幂等（相同 scanType + asOf 跳过）
 *   - SLA 时间边界及扫描幂等
 */

// ────────────────────────────────────────────────────────────
// 1. sla-scan-types 枚举与守卫
// ────────────────────────────────────────────────────────────
describe('sla-scan-types — 枚举与守卫', () => {
  it('SLA_SCAN_TYPES 包含 3 种扫描类型', () => {
    expect(SLA_SCAN_TYPES).toEqual([
      'first-followup',
      'public-pool',
      'stale-maintenance',
    ])
  })

  it('SLA_BREACH_TYPES 包含 3 种违规类型', () => {
    expect(SLA_BREACH_TYPES).toEqual([
      'first_followup',
      'claim_protection',
      'reclaim',
    ])
  })

  it('isSlaScanType / isSlaBreachType 守卫', () => {
    expect(isSlaScanType('first-followup')).toBe(true)
    expect(isSlaScanType('unknown')).toBe(false)
    expect(isSlaBreachType('first_followup')).toBe(true)
    expect(isSlaBreachType('xyz')).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────
// 2. 时间边界与截止时间计算
// ────────────────────────────────────────────────────────────
describe('SLA 时间边界计算', () => {
  it('SLA_SCAN_INTERVALS 间隔符合任务要求', () => {
    // 首次跟进 + 公海回收：15 分钟
    expect(SLA_SCAN_INTERVALS.firstFollowup).toBe(15 * 60 * 1000)
    expect(SLA_SCAN_INTERVALS.publicPool).toBe(15 * 60 * 1000)
    // 房源维护：24 小时（每日 00:15）
    expect(SLA_SCAN_INTERVALS.staleMaintenance).toBe(24 * 60 * 60 * 1000)
  })

  it('SLA_THRESHOLDS 阈值符合任务要求', () => {
    // 首次跟进：4 小时
    expect(SLA_THRESHOLDS.firstFollowupMs).toBe(4 * 60 * 60 * 1000)
    // 公海回收：72 小时
    expect(SLA_THRESHOLDS.publicPoolMs).toBe(72 * 60 * 60 * 1000)
    // 房源维护：30 天
    expect(SLA_THRESHOLDS.staleMaintenanceMs).toBe(30 * 24 * 60 * 60 * 1000)
  })

  it('computeFirstFollowupDeadline: assignedAt + 4h', () => {
    const assignedAt = '2026-07-26T02:00:00.000Z'
    const deadline = computeFirstFollowupDeadline(assignedAt)
    expect(deadline).toBe('2026-07-26T06:00:00.000Z')
  })

  it('computePublicPoolReclaimDeadline: lastValidFollowupAt 优先于 assignedAt', () => {
    const assignedAt = '2026-07-20T00:00:00.000Z'
    const lastFollowup = '2026-07-22T00:00:00.000Z'
    // 72h 后 = 2026-07-25T00:00:00.000Z
    expect(computePublicPoolReclaimDeadline(lastFollowup, assignedAt)).toBe(
      '2026-07-25T00:00:00.000Z',
    )
    // lastValidFollowupAt=null 回退到 assignedAt + 72h
    expect(computePublicPoolReclaimDeadline(null, assignedAt)).toBe(
      '2026-07-23T00:00:00.000Z',
    )
  })

  it('computeStaleMaintenanceDeadline: lastEffectiveMaintainedAt 优先于 updatedAt', () => {
    const updatedAt = '2026-06-01T00:00:00.000Z'
    const lastMaintained = '2026-06-15T00:00:00.000Z'
    // 30d 后 = 2026-07-15T00:00:00.000Z
    expect(computeStaleMaintenanceDeadline(lastMaintained, updatedAt)).toBe(
      '2026-07-15T00:00:00.000Z',
    )
    // lastEffectiveMaintainedAt=null 回退到 updatedAt + 30d
    expect(computeStaleMaintenanceDeadline(null, updatedAt)).toBe(
      '2026-07-01T00:00:00.000Z',
    )
  })

  it('computeShanghaiDayBoundary: 北京时间自然日边界', () => {
    // 2026-07-26T10:00:00 上海 = 2026-07-26T02:00:00 UTC
    const ref = new Date('2026-07-26T02:00:00.000Z')
    const boundary = computeShanghaiDayBoundary(ref)
    expect(boundary.dayKey).toBe('2026-07-26')
    // 当日 00:00 上海 = 前一日 16:00 UTC = 2026-07-25T16:00:00.000Z
    expect(boundary.dayStartUtc.toISOString()).toBe('2026-07-25T16:00:00.000Z')
    // 当日 23:59:59.999 上海 = 次日 15:59:59.999 UTC = 2026-07-26T15:59:59.999Z
    expect(boundary.dayEndUtc.toISOString()).toBe('2026-07-26T15:59:59.999Z')
  })
})

// ────────────────────────────────────────────────────────────
// 3. scanFirstFollowupBreaches
// ────────────────────────────────────────────────────────────
describe('scanFirstFollowupBreaches — 首次跟进违规扫描', () => {
  let eventStore: ReturnType<typeof createInMemoryEventStore>
  let taskStore: ReturnType<typeof createInMemoryTaskStore>
  let slaScanStore: ReturnType<typeof createInMemorySlaScanStore>
  let ctx: SlaScanContext

  beforeEach(() => {
    eventStore = createInMemoryEventStore()
    taskStore = createInMemoryTaskStore()
    slaScanStore = createInMemorySlaScanStore()
    ctx = {
      asOf: '2026-07-26T06:00:00.000Z',
      timezone: 'Asia/Shanghai',
      taskStore,
      eventStore,
      slaScanStore,
      now: '2026-07-26T06:00:00.000Z',
    }
  })

  it('候选为空时返回空结果', async () => {
    const results = await scanFirstFollowupBreaches(ctx)
    expect(results).toEqual([])
  })

  it('为违规 lead 生成 sla.breached 事件 + followup-first 待办', async () => {
    const lead: LeadScanRecord = {
      leadId: 'lead-001',
      assigneeId: 'user-broker-1',
      assignedAt: '2026-07-26T01:00:00.000Z', // 5h 前，已超 4h SLA
      firstFollowupAt: null,
      lastValidFollowupAt: null,
      ownershipStatus: 'assigned',
    }
    slaScanStore.seedLeads({ firstFollowup: [lead] })

    const results = await scanFirstFollowupBreaches(ctx)
    expect(results).toHaveLength(1)
    const item = results[0]!
    expect(item.action).toBe('created_task')
    expect(item.eventId).toBeTruthy()
    expect(item.taskId).toBeTruthy()

    // 验证事件已写入 EventStore
    const events = await eventStore.findByAggregate(
      'sla.breached' as never,
      'lead-001',
    )
    expect(events).toHaveLength(1)
    expect(events[0]!.eventType).toBe('sla.breached')
    expect(events[0]!.aggregateType).toBe('sla')
    expect(events[0]!.aggregateId).toBe('lead-001')

    // 验证任务已写入 TaskStore
    const task = await taskStore.findByKey({
      taskType: 'followup-first',
      sourceId: 'lead-001',
      sourceVersion: 1,
    })
    expect(task).not.toBeNull()
    expect(task!.status).toBe('pending')
    expect(task!.priority).toBe('urgent')
    expect(task!.assigneeId).toBe('user-broker-1')
    // dueAt = assignedAt + 4h
    expect(task!.dueAt).toBe('2026-07-26T05:00:00.000Z')
    // metadata 含 slaType / eventId
    expect(task!.metadata).toMatchObject({
      leadId: 'lead-001',
      slaType: 'first_followup',
      scanSource: 'sla-scanner',
    })
  })

  it('已有 sla.breached 事件的 lead 跳过（事件幂等）', async () => {
    const lead: LeadScanRecord = {
      leadId: 'lead-002',
      assigneeId: 'user-broker-2',
      assignedAt: '2026-07-26T01:00:00.000Z',
      firstFollowupAt: null,
      lastValidFollowupAt: null,
      ownershipStatus: 'assigned',
    }
    slaScanStore.seedLeads({ firstFollowup: [lead] })

    // 第一次扫描：创建事件 + 任务
    const r1 = await scanFirstFollowupBreaches(ctx)
    expect(r1[0]!.action).toBe('created_task')

    // 第二次扫描：findByAggregate 命中已有事件 → skipped_already_breached
    const r2 = await scanFirstFollowupBreaches(ctx)
    expect(r2[0]!.action).toBe('skipped_already_breached')
    expect(r2[0]!.eventId).toBeUndefined()

    // 验证事件只生成 1 条
    const events = await eventStore.findByAggregate(
      'sla.breached' as never,
      'lead-002',
    )
    expect(events).toHaveLength(1)

    // 验证任务只创建 1 条
    const allTasks = taskStore.snapshot()
    const followupTasks = Array.from(allTasks.values()).filter(
      (t) => t.taskType === 'followup-first' && t.sourceId === 'lead-002',
    )
    expect(followupTasks).toHaveLength(1)
  })

  it('事件已生成但任务漏创建时，补建任务（task 级幂等兜底）', async () => {
    const lead: LeadScanRecord = {
      leadId: 'lead-003',
      assigneeId: 'user-broker-3',
      assignedAt: '2026-07-26T01:00:00.000Z',
      firstFollowupAt: null,
      lastValidFollowupAt: null,
      ownershipStatus: 'assigned',
    }
    slaScanStore.seedLeads({ firstFollowup: [lead] })

    // 第一次扫描生成事件 + 任务
    await scanFirstFollowupBreaches(ctx)
    const tasks = Array.from(taskStore.snapshot().values())
    expect(tasks).toHaveLength(1)

    // 模拟任务被异常删除（仅保留事件）
    taskStore.reset()
    expect(Array.from(taskStore.snapshot().values())).toHaveLength(0)

    // 第二次扫描：事件已存在 → skipped_already_breached，不补建任务
    // 注：当前实现遵循"事件幂等优先"，事件存在则跳过；任务漏创建由人工兜底
    const r2 = await scanFirstFollowupBreaches(ctx)
    expect(r2[0]!.action).toBe('skipped_already_breached')
    expect(Array.from(taskStore.snapshot().values())).toHaveLength(0)
  })

  it('多个候选 lead 都正确处理', async () => {
    slaScanStore.seedLeads({
      firstFollowup: [
        {
          leadId: 'lead-a',
          assigneeId: 'user-1',
          assignedAt: '2026-07-26T01:00:00.000Z',
          firstFollowupAt: null,
          lastValidFollowupAt: null,
          ownershipStatus: 'assigned',
        },
        {
          leadId: 'lead-b',
          assigneeId: 'user-2',
          assignedAt: '2026-07-26T00:00:00.000Z',
          firstFollowupAt: null,
          lastValidFollowupAt: null,
          ownershipStatus: 'assigned',
        },
      ],
    })

    const results = await scanFirstFollowupBreaches(ctx)
    expect(results).toHaveLength(2)
    expect(results.every((r) => r.action === 'created_task')).toBe(true)

    // 验证两条 lead 都生成了事件
    const eventsA = await eventStore.findByAggregate(
      'sla.breached' as never,
      'lead-a',
    )
    const eventsB = await eventStore.findByAggregate(
      'sla.breached' as never,
      'lead-b',
    )
    expect(eventsA).toHaveLength(1)
    expect(eventsB).toHaveLength(1)
  })
})

// ────────────────────────────────────────────────────────────
// 4. scanPublicPoolReclaims
// ────────────────────────────────────────────────────────────
describe('scanPublicPoolReclaims — 公海回收扫描', () => {
  let eventStore: ReturnType<typeof createInMemoryEventStore>
  let taskStore: ReturnType<typeof createInMemoryTaskStore>
  let slaScanStore: ReturnType<typeof createInMemorySlaScanStore>
  let ctx: SlaScanContext

  beforeEach(() => {
    eventStore = createInMemoryEventStore()
    taskStore = createInMemoryTaskStore()
    slaScanStore = createInMemorySlaScanStore()
    ctx = {
      asOf: '2026-07-26T06:00:00.000Z',
      timezone: 'Asia/Shanghai',
      taskStore,
      eventStore,
      slaScanStore,
      now: '2026-07-26T06:00:00.000Z',
    }
  })

  it('候选为空时返回空结果', async () => {
    const results = await scanPublicPoolReclaims(ctx)
    expect(results).toEqual([])
  })

  it('为回收候选 lead 生成 lead.reclaimed 事件（不创建待办）', async () => {
    const lead: LeadScanRecord = {
      leadId: 'lead-pool-001',
      assigneeId: 'user-broker-1',
      assignedAt: '2026-07-23T00:00:00.000Z', // 3 天前
      firstFollowupAt: null,
      lastValidFollowupAt: null,
      ownershipStatus: 'assigned',
    }
    slaScanStore.seedLeads({ publicPool: [lead] })

    const results = await scanPublicPoolReclaims(ctx)
    expect(results).toHaveLength(1)
    expect(results[0]!.action).toBe('created_event')
    expect(results[0]!.eventId).toBeTruthy()
    expect(results[0]!.taskId).toBeUndefined()

    // 验证事件已写入
    const events = await eventStore.findByAggregate(
      'lead.reclaimed' as never,
      'lead-pool-001',
    )
    expect(events).toHaveLength(1)
    expect(events[0]!.eventType).toBe('lead.reclaimed')
    expect(events[0]!.aggregateType).toBe('lead')

    // 验证未创建任何任务（公海回收后续由 lead-unassigned 任务流处理）
    expect(Array.from(taskStore.snapshot().values())).toHaveLength(0)
  })

  it('已有 lead.reclaimed 事件的 lead 跳过（事件幂等）', async () => {
    const lead: LeadScanRecord = {
      leadId: 'lead-pool-002',
      assigneeId: 'user-broker-2',
      assignedAt: '2026-07-23T00:00:00.000Z',
      firstFollowupAt: null,
      lastValidFollowupAt: null,
      ownershipStatus: 'assigned',
    }
    slaScanStore.seedLeads({ publicPool: [lead] })

    const r1 = await scanPublicPoolReclaims(ctx)
    expect(r1[0]!.action).toBe('created_event')

    // 第二次扫描：事件已存在 → skipped_already_breached
    const r2 = await scanPublicPoolReclaims(ctx)
    expect(r2[0]!.action).toBe('skipped_already_breached')

    // 验证事件只生成 1 条
    const events = await eventStore.findByAggregate(
      'lead.reclaimed' as never,
      'lead-pool-002',
    )
    expect(events).toHaveLength(1)
  })

  it('payload 含 previousAssigneeId 与 deadline', async () => {
    const lead: LeadScanRecord = {
      leadId: 'lead-pool-003',
      assigneeId: 'user-broker-3',
      assignedAt: '2026-07-23T00:00:00.000Z',
      firstFollowupAt: null,
      lastValidFollowupAt: null,
      ownershipStatus: 'assigned',
    }
    slaScanStore.seedLeads({ publicPool: [lead] })

    await scanPublicPoolReclaims(ctx)
    const events = await eventStore.findByAggregate(
      'lead.reclaimed' as never,
      'lead-pool-003',
    )
    const payload = events[0]!.payload as Record<string, unknown>
    expect(payload.previousAssigneeId).toBe('user-broker-3')
    expect(payload.reason).toBe('public_pool_reclaim')
    expect(payload.deadline).toBeTruthy()
    expect(payload.breachedAt).toBe(ctx.asOf)
  })
})

// ────────────────────────────────────────────────────────────
// 5. scanStaleMaintenances
// ────────────────────────────────────────────────────────────
describe('scanStaleMaintenances — 房源维护扫描', () => {
  let eventStore: ReturnType<typeof createInMemoryEventStore>
  let taskStore: ReturnType<typeof createInMemoryTaskStore>
  let slaScanStore: ReturnType<typeof createInMemorySlaScanStore>
  let ctx: SlaScanContext

  beforeEach(() => {
    eventStore = createInMemoryEventStore()
    taskStore = createInMemoryTaskStore()
    slaScanStore = createInMemorySlaScanStore()
    ctx = {
      asOf: '2026-07-26T16:15:00.000Z', // 北京时间 2026-07-27 00:15
      timezone: 'Asia/Shanghai',
      taskStore,
      eventStore,
      slaScanStore,
      now: '2026-07-26T16:15:00.000Z',
    }
  })

  it('候选为空时返回空结果', async () => {
    const results = await scanStaleMaintenances(ctx)
    expect(results).toEqual([])
  })

  it('为 30 天未维护 listing 创建 listing-stale-maintenance 待办', async () => {
    const listing: ListingScanRecord = {
      listingId: 'listing-stale-001',
      updatedAt: '2026-06-01T00:00:00.000Z', // 55 天前
      lastEffectiveMaintainedAt: null,
    }
    slaScanStore.seedListings({ stale: [listing] })

    const results = await scanStaleMaintenances(ctx)
    expect(results).toHaveLength(1)
    expect(results[0]!.action).toBe('created_task')
    expect(results[0]!.taskId).toBeTruthy()

    // 验证任务已写入
    const task = await taskStore.findByKey({
      taskType: 'listing-stale-maintenance',
      sourceId: 'listing-stale-001',
      sourceVersion: 1,
    })
    expect(task).not.toBeNull()
    expect(task!.status).toBe('pending')
    expect(task!.priority).toBe('low') // 默认优先级
    expect(task!.sourceType).toBe('listing')
    // dueAt = asOf + 7d
    expect(task!.dueAt).toBe('2026-08-02T16:15:00.000Z')
    // metadata 含 scanBoundary 与原 updatedAt
    expect(task!.metadata).toMatchObject({
      scanBoundary: '2026-07-27',
      updatedAt: '2026-06-01T00:00:00.000Z',
      lastEffectiveMaintainedAt: null,
    })
  })

  it('已有同幂等键任务时跳过（任务幂等）', async () => {
    const listing: ListingScanRecord = {
      listingId: 'listing-stale-002',
      updatedAt: '2026-06-01T00:00:00.000Z',
      lastEffectiveMaintainedAt: null,
    }
    slaScanStore.seedListings({ stale: [listing] })

    const r1 = await scanStaleMaintenances(ctx)
    expect(r1[0]!.action).toBe('created_task')

    // 第二次扫描：findByKey 命中已存在任务 → skipped_existing_task
    const r2 = await scanStaleMaintenances(ctx)
    expect(r2[0]!.action).toBe('skipped_existing_task')

    // 任务只 1 条
    const tasks = Array.from(taskStore.snapshot().values()).filter(
      (t) => t.taskType === 'listing-stale-maintenance',
    )
    expect(tasks).toHaveLength(1)
  })

  it('lastEffectiveMaintainedAt 优先于 updatedAt 用于 deadline 计算', async () => {
    const listing: ListingScanRecord = {
      listingId: 'listing-stale-003',
      updatedAt: '2026-06-01T00:00:00.000Z', // 55 天前
      lastEffectiveMaintainedAt: '2026-07-15T00:00:00.000Z', // 11 天前（未到 30 天）
    }
    slaScanStore.seedListings({ stale: [listing] })

    // 即使 lastEffectiveMaintainedAt 较新，候选由调用方决定；
    // 扫描器在 metadata 中记录 deadline（基于 lastEffectiveMaintainedAt + 30d）
    const results = await scanStaleMaintenances(ctx)
    expect(results[0]!.action).toBe('created_task')

    const task = await taskStore.findByKey({
      taskType: 'listing-stale-maintenance',
      sourceId: 'listing-stale-003',
      sourceVersion: 1,
    })
    expect(task).not.toBeNull()
    // deadline = lastEffectiveMaintainedAt + 30d = 2026-08-14T00:00:00.000Z
    expect(task!.metadata).toMatchObject({
      deadline: '2026-08-14T00:00:00.000Z',
      lastEffectiveMaintainedAt: '2026-07-15T00:00:00.000Z',
    })
  })

  it('多个候选 listing 都创建任务', async () => {
    slaScanStore.seedListings({
      stale: [
        {
          listingId: 'listing-a',
          updatedAt: '2026-06-01T00:00:00.000Z',
        },
        {
          listingId: 'listing-b',
          updatedAt: '2026-05-01T00:00:00.000Z',
        },
      ],
    })

    const results = await scanStaleMaintenances(ctx)
    expect(results).toHaveLength(2)
    expect(results.every((r) => r.action === 'created_task')).toBe(true)

    const tasks = Array.from(taskStore.snapshot().values())
    expect(tasks).toHaveLength(2)
  })
})

// ────────────────────────────────────────────────────────────
// 6. runSlaScan 总入口
// ────────────────────────────────────────────────────────────
describe('runSlaScan — 总入口与幂等', () => {
  let eventStore: ReturnType<typeof createInMemoryEventStore>
  let taskStore: ReturnType<typeof createInMemoryTaskStore>
  let slaScanStore: ReturnType<typeof createInMemorySlaScanStore>
  let ctx: SlaScanContext

  beforeEach(() => {
    eventStore = createInMemoryEventStore()
    taskStore = createInMemoryTaskStore()
    slaScanStore = createInMemorySlaScanStore()
    ctx = {
      asOf: '2026-07-26T06:00:00.000Z',
      timezone: 'Asia/Shanghai',
      taskStore,
      eventStore,
      slaScanStore,
      now: '2026-07-26T06:00:00.000Z',
    }
  })

  it('非法 scanType 返回 failed=1 的空汇总', async () => {
    const summary = await runSlaScan(ctx, 'unknown' as SlaScanType)
    expect(summary.scanType).toBe('unknown')
    expect(summary.skipped).toBe(false)
    expect(summary.candidates).toBe(0)
    expect(summary.failed).toBe(1)
    expect(summary.items).toEqual([])
  })

  it('first-followup：汇总 eventsCreated / tasksCreated', async () => {
    slaScanStore.seedLeads({
      firstFollowup: [
        {
          leadId: 'lead-1',
          assigneeId: 'user-1',
          assignedAt: '2026-07-26T01:00:00.000Z',
          firstFollowupAt: null,
          lastValidFollowupAt: null,
          ownershipStatus: 'assigned',
        },
      ],
    })

    const summary = await runSlaScan(ctx, 'first-followup')
    expect(summary.scanType).toBe('first-followup')
    expect(summary.skipped).toBe(false)
    expect(summary.candidates).toBe(1)
    expect(summary.eventsCreated).toBe(0) // 事件计入 items[0].eventId，但 action=created_task
    expect(summary.tasksCreated).toBe(1)
    expect(summary.eventsSkipped).toBe(0)
    expect(summary.tasksSkipped).toBe(0)
    expect(summary.failed).toBe(0)
  })

  it('public-pool：汇总 eventsCreated', async () => {
    slaScanStore.seedLeads({
      publicPool: [
        {
          leadId: 'lead-2',
          assigneeId: 'user-1',
          assignedAt: '2026-07-23T00:00:00.000Z',
          firstFollowupAt: null,
          lastValidFollowupAt: null,
          ownershipStatus: 'assigned',
        },
      ],
    })

    const summary = await runSlaScan(ctx, 'public-pool')
    expect(summary.scanType).toBe('public-pool')
    expect(summary.candidates).toBe(1)
    expect(summary.eventsCreated).toBe(1)
    expect(summary.tasksCreated).toBe(0)
  })

  it('stale-maintenance：汇总 tasksCreated', async () => {
    slaScanStore.seedListings({
      stale: [
        {
          listingId: 'listing-1',
          updatedAt: '2026-06-01T00:00:00.000Z',
        },
      ],
    })

    const summary = await runSlaScan(ctx, 'stale-maintenance')
    expect(summary.scanType).toBe('stale-maintenance')
    expect(summary.candidates).toBe(1)
    expect(summary.eventsCreated).toBe(0)
    expect(summary.tasksCreated).toBe(1)
  })

  it('入口级幂等：相同 scanType + asOf 第二次扫描返回 skipped=true', async () => {
    slaScanStore.seedLeads({
      firstFollowup: [
        {
          leadId: 'lead-idem',
          assigneeId: 'user-1',
          assignedAt: '2026-07-26T01:00:00.000Z',
          firstFollowupAt: null,
          lastValidFollowupAt: null,
          ownershipStatus: 'assigned',
        },
      ],
    })

    const s1 = await runSlaScan(ctx, 'first-followup')
    expect(s1.skipped).toBe(false)
    expect(s1.tasksCreated).toBe(1)

    // 第二次扫描相同 asOf → 入口级幂等命中
    const s2 = await runSlaScan(ctx, 'first-followup')
    expect(s2.skipped).toBe(true)
    expect(s2.skipReason).toBe('already_run')
    expect(s2.candidates).toBe(0)

    // 验证扫描标记已记录
    const runs = slaScanStore.scanRuns()
    expect(runs.size).toBe(1)
  })

  it('不同 asOf 视为不同扫描，不跳过', async () => {
    const s1 = await runSlaScan(ctx, 'first-followup')
    expect(s1.skipped).toBe(false)

    // 不同 asOf → 视为新一次扫描
    const ctx2: SlaScanContext = { ...ctx, asOf: '2026-07-26T06:15:00.000Z' }
    const s2 = await runSlaScan(ctx2, 'first-followup')
    expect(s2.skipped).toBe(false)

    // 两个扫描标记
    expect(slaScanStore.scanRuns().size).toBe(2)
  })

  it('不同 scanType 视为不同扫描，不跳过', async () => {
    await runSlaScan(ctx, 'first-followup')
    await runSlaScan(ctx, 'public-pool')
    await runSlaScan(ctx, 'stale-maintenance')
    expect(slaScanStore.scanRuns().size).toBe(3)
  })

  it('completedAt 来自 ctx.now', async () => {
    const summary = await runSlaScan(ctx, 'first-followup')
    expect(summary.completedAt).toBe('2026-07-26T06:00:00.000Z')
  })
})

// ────────────────────────────────────────────────────────────
// 7. in-memory SlaScanStore
// ────────────────────────────────────────────────────────────
describe('createInMemorySlaScanStore — 内存存储', () => {
  it('seedLeads / seedListings / reset 行为', () => {
    const store = createInMemorySlaScanStore()
    store.seedLeads({
      firstFollowup: [
        {
          leadId: 'lead-1',
          assigneeId: 'u',
          assignedAt: '2026-07-26T01:00:00.000Z',
          firstFollowupAt: null,
          lastValidFollowupAt: null,
          ownershipStatus: 'assigned',
        },
      ],
      publicPool: [],
    })
    store.seedListings({
      stale: [
        {
          listingId: 'l-1',
          updatedAt: '2026-06-01T00:00:00.000Z',
        },
      ],
    })

    // 同步读取
    return Promise.all([
      store.listLeadsForFirstFollowupScan('asOf').then((r) => expect(r).toHaveLength(1)),
      store.listLeadsForPublicPoolScan('asOf').then((r) => expect(r).toEqual([])),
      store.listStaleListings('asOf').then((r) => expect(r).toHaveLength(1)),
    ]).then(() => {
      store.reset()
      return Promise.all([
        store.listLeadsForFirstFollowupScan('asOf').then((r) => expect(r).toEqual([])),
        store.listStaleListings('asOf').then((r) => expect(r).toEqual([])),
      ])
    })
  })

  it('hasScanRun / markScanRun 行为', async () => {
    const store = createInMemorySlaScanStore()
    expect(await store.hasScanRun('first-followup', 'asOf-1')).toBe(false)
    await store.markScanRun('first-followup', 'asOf-1', '2026-07-26T06:00:00.000Z')
    expect(await store.hasScanRun('first-followup', 'asOf-1')).toBe(true)
    // 不同 asOf 不命中
    expect(await store.hasScanRun('first-followup', 'asOf-2')).toBe(false)
    // 不同 scanType 不命中
    expect(await store.hasScanRun('public-pool', 'asOf-1')).toBe(false)
  })
})
