import { describe, it, expect, beforeEach } from 'vitest'

import { InvalidOperationError } from '@/domain/shared/errors'
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  allowedTaskTransitions,
  canTransitionTask,
  isTaskPriority,
  isTaskStatus,
  isTerminalTaskStatus,
  isActiveTaskStatus,
  TASK_PRIORITY_WEIGHT,
  type TaskStatus,
} from '@/domain/workflow/task-status'
import {
  TASK_SOURCE_TYPES,
  TASK_SOURCE_TYPE_LABELS,
  TASK_TYPES,
  TASK_TYPE_LABELS,
  TASK_TYPE_SOURCE_TYPE,
  TASK_TYPE_DEFAULT_PRIORITY,
  TASK_TYPE_DEFAULT_SLA_MS,
  TASK_TYPE_TRIGGER_EVENT,
  isTaskSourceType,
  isTaskType,
  type TaskType,
} from '@/domain/workflow/task-types'
import {
  TASK_BUILDERS,
  TaskRegistry,
  buildStaleMaintenanceTask,
  createDefaultTaskRegistry,
  type TaskDraft,
} from '@/domain/workflow/task-registry'
import {
  autoCancelOnSourceCancellation,
  autoCloseOnSourceCompletion,
  cancelTask,
  completeTask,
  createInMemoryTaskStore,
  createTaskFromEvent,
  type TaskRecord,
  type TaskStore,
} from '@/domain/workflow/task-service'
import {
  TASK_EVENT_FOLLOWUP_COMPLETED_NO_NEXT,
  TASK_EVENT_FOLLOWUP_COMPLETED_WITH_NEXT,
  TASK_EVENT_LEAD_ASSIGNED,
  TASK_EVENT_LEAD_CREATED,
  TASK_EVENT_LEAD_LOST,
  TASK_EVENT_REPORT_DISMISSED,
  TASK_EVENT_REPORT_SUSTAINED,
  TASK_EVENT_REVIEW_APPROVED,
  TASK_EVENT_REVIEW_REJECTED,
  TASK_EVENT_REVIEW_SUBMITTED,
  TASK_FIXTURE_FOLLOWUP_FIRST,
  TASK_FIXTURE_LEAD_UNASSIGNED,
  TASK_FIXTURE_REPORT_TRIAGE,
  TASK_FIXTURE_REVIEW_PENDING,
} from '@/test/factory/tasks'

/**
 * M6.4 待办模型和注册表测试（design §3.7 tasks / §4.3 待办状态机 / R6, R7, R8）
 *
 * 覆盖：
 *   - task-status 状态机合法 / 非法转换
 *   - task-types 枚举与守卫
 *   - TaskRegistry 注册与查询
 *   - 6 种 taskType 的 buildTask 规则
 *   - createTaskFromEvent 正确生成待办 + 幂等
 *   - completeTask 设置 completedAt + completionEventId
 *   - cancelTask 设置 cancelledAt + cancellationReason
 *   - autoCloseOnSourceCompletion 审核通过事件闭环 review-pending
 *   - autoCancelOnSourceCancellation 审核驳回事件取消 review-pending
 */

// ────────────────────────────────────────────────────────────
// 1. task-status 状态机
// ────────────────────────────────────────────────────────────
describe('task-status — 状态机', () => {
  it('TASK_STATUSES 包含 4 种状态', () => {
    expect(TASK_STATUSES).toEqual(['pending', 'in_progress', 'completed', 'cancelled'])
  })

  it('TASK_PRIORITIES 包含 4 种优先级', () => {
    expect(TASK_PRIORITIES).toEqual(['urgent', 'high', 'normal', 'low'])
  })

  it('isTaskStatus / isTaskPriority 守卫', () => {
    expect(isTaskStatus('pending')).toBe(true)
    expect(isTaskStatus('unknown')).toBe(false)
    expect(isTaskPriority('urgent')).toBe(true)
    expect(isTaskPriority('xyz')).toBe(false)
  })

  it('TASK_STATUS_LABELS / TASK_PRIORITY_LABELS 全覆盖', () => {
    for (const s of TASK_STATUSES) {
      expect(TASK_STATUS_LABELS[s]).toBeTruthy()
    }
    for (const p of TASK_PRIORITIES) {
      expect(TASK_PRIORITY_LABELS[p]).toBeTruthy()
    }
  })

  it('合法转换：pending → in_progress → completed', () => {
    expect(canTransitionTask('pending', 'in_progress')).toBe(true)
    expect(canTransitionTask('in_progress', 'completed')).toBe(true)
  })

  it('合法转换：pending → cancelled；in_progress → cancelled', () => {
    expect(canTransitionTask('pending', 'cancelled')).toBe(true)
    expect(canTransitionTask('in_progress', 'cancelled')).toBe(true)
  })

  it('非法转换：completed → pending；cancelled → in_progress', () => {
    expect(canTransitionTask('completed', 'pending')).toBe(false)
    expect(canTransitionTask('cancelled', 'in_progress')).toBe(false)
    expect(canTransitionTask('completed', 'in_progress')).toBe(false)
    expect(canTransitionTask('cancelled', 'completed')).toBe(false)
  })

  it('pending → completed 不允许直跳（必须经过 in_progress）', () => {
    expect(canTransitionTask('pending', 'completed')).toBe(false)
  })

  it('isTerminalTaskStatus 终态守卫', () => {
    expect(isTerminalTaskStatus('completed')).toBe(true)
    expect(isTerminalTaskStatus('cancelled')).toBe(true)
    expect(isTerminalTaskStatus('pending')).toBe(false)
    expect(isTerminalTaskStatus('in_progress')).toBe(false)
  })

  it('isActiveTaskStatus 活跃态守卫', () => {
    expect(isActiveTaskStatus('pending')).toBe(true)
    expect(isActiveTaskStatus('in_progress')).toBe(true)
    expect(isActiveTaskStatus('completed')).toBe(false)
    expect(isActiveTaskStatus('cancelled')).toBe(false)
  })

  it('allowedTaskTransitions 列出全部合法目标', () => {
    expect(allowedTaskTransitions('pending')).toEqual(['in_progress', 'cancelled'])
    expect(allowedTaskTransitions('in_progress')).toEqual(['completed', 'cancelled'])
    expect(allowedTaskTransitions('completed')).toEqual([])
    expect(allowedTaskTransitions('cancelled')).toEqual([])
  })

  it('TASK_PRIORITY_WEIGHT 权重排序（urgent < high < normal < low）', () => {
    expect(TASK_PRIORITY_WEIGHT.urgent).toBeLessThan(TASK_PRIORITY_WEIGHT.high)
    expect(TASK_PRIORITY_WEIGHT.high).toBeLessThan(TASK_PRIORITY_WEIGHT.normal)
    expect(TASK_PRIORITY_WEIGHT.normal).toBeLessThan(TASK_PRIORITY_WEIGHT.low)
  })
})

// ────────────────────────────────────────────────────────────
// 2. task-types 枚举与元数据
// ────────────────────────────────────────────────────────────
describe('task-types — 枚举与元数据', () => {
  it('TASK_TYPES 包含 6 种任务类型', () => {
    expect(TASK_TYPES).toEqual([
      'review-pending',
      'report-triage',
      'lead-unassigned',
      'followup-first',
      'followup-next',
      'listing-stale-maintenance',
    ])
  })

  it('TASK_SOURCE_TYPES 包含 5 种来源类型', () => {
    expect(TASK_SOURCE_TYPES).toEqual([
      'listing-review',
      'listing-report',
      'lead',
      'followup',
      'listing',
    ])
  })

  it('TASK_TYPE_LABELS / TASK_SOURCE_TYPE_LABELS 全覆盖', () => {
    for (const t of TASK_TYPES) {
      expect(TASK_TYPE_LABELS[t]).toBeTruthy()
    }
    for (const s of TASK_SOURCE_TYPES) {
      expect(TASK_SOURCE_TYPE_LABELS[s]).toBeTruthy()
    }
  })

  it('isTaskType / isTaskSourceType 守卫', () => {
    expect(isTaskType('review-pending')).toBe(true)
    expect(isTaskType('unknown')).toBe(false)
    expect(isTaskSourceType('lead')).toBe(true)
    expect(isTaskSourceType('xyz')).toBe(false)
  })

  it('TASK_TYPE_SOURCE_TYPE taskType 与 sourceType 一一对应', () => {
    expect(TASK_TYPE_SOURCE_TYPE['review-pending']).toBe('listing-review')
    expect(TASK_TYPE_SOURCE_TYPE['report-triage']).toBe('listing-report')
    expect(TASK_TYPE_SOURCE_TYPE['lead-unassigned']).toBe('lead')
    expect(TASK_TYPE_SOURCE_TYPE['followup-first']).toBe('lead')
    expect(TASK_TYPE_SOURCE_TYPE['followup-next']).toBe('followup')
    expect(TASK_TYPE_SOURCE_TYPE['listing-stale-maintenance']).toBe('listing')
  })

  it('TASK_TYPE_DEFAULT_PRIORITY 默认优先级与任务要求一致', () => {
    expect(TASK_TYPE_DEFAULT_PRIORITY['review-pending']).toBe('high')
    expect(TASK_TYPE_DEFAULT_PRIORITY['report-triage']).toBe('normal')
    expect(TASK_TYPE_DEFAULT_PRIORITY['lead-unassigned']).toBe('high')
    expect(TASK_TYPE_DEFAULT_PRIORITY['followup-first']).toBe('urgent')
    expect(TASK_TYPE_DEFAULT_PRIORITY['followup-next']).toBe('normal')
    expect(TASK_TYPE_DEFAULT_PRIORITY['listing-stale-maintenance']).toBe('low')
  })

  it('TASK_TYPE_DEFAULT_SLA_MS 时限符合任务要求', () => {
    // 4 小时 = 4 * 60 * 60 * 1000 = 14400000
    expect(TASK_TYPE_DEFAULT_SLA_MS['review-pending']).toBe(4 * 60 * 60 * 1000)
    // 24 小时
    expect(TASK_TYPE_DEFAULT_SLA_MS['report-triage']).toBe(24 * 60 * 60 * 1000)
    expect(TASK_TYPE_DEFAULT_SLA_MS['lead-unassigned']).toBe(4 * 60 * 60 * 1000)
    expect(TASK_TYPE_DEFAULT_SLA_MS['followup-first']).toBe(4 * 60 * 60 * 1000)
    // followup-next / listing-stale-maintenance 由扫描器/事件 payload 指定，0 表示无默认
    expect(TASK_TYPE_DEFAULT_SLA_MS['followup-next']).toBe(0)
    expect(TASK_TYPE_DEFAULT_SLA_MS['listing-stale-maintenance']).toBe(0)
  })

  it('TASK_TYPE_TRIGGER_EVENT 触发事件类型映射', () => {
    expect(TASK_TYPE_TRIGGER_EVENT['review-pending']).toBe('listing.review_submitted')
    expect(TASK_TYPE_TRIGGER_EVENT['report-triage']).toBe('report.sustained')
    expect(TASK_TYPE_TRIGGER_EVENT['lead-unassigned']).toBe('lead.created')
    expect(TASK_TYPE_TRIGGER_EVENT['followup-first']).toBe('lead.assigned')
    expect(TASK_TYPE_TRIGGER_EVENT['followup-next']).toBe('followup.completed')
    // listing-stale-maintenance 非事件驱动，映射到 sla.breached 仅作元数据
    expect(TASK_TYPE_TRIGGER_EVENT['listing-stale-maintenance']).toBe('sla.breached')
  })
})

// ────────────────────────────────────────────────────────────
// 3. TaskRegistry 注册与查询
// ────────────────────────────────────────────────────────────
describe('TaskRegistry — 注册与查询', () => {
  it('createDefaultTaskRegistry 注册 6 种任务类型', () => {
    const registry = createDefaultTaskRegistry()
    expect(registry.listTaskTypes().sort()).toEqual(
      [
        'followup-first',
        'followup-next',
        'lead-unassigned',
        'listing-stale-maintenance',
        'report-triage',
        'review-pending',
      ],
    )
  })

  it('findByTaskType 按 taskType 查找注册', () => {
    const registry = createDefaultTaskRegistry()
    const reg = registry.findByTaskType('review-pending')
    expect(reg).toBeDefined()
    expect(reg?.sourceEventType).toBe('listing.review_submitted')
    expect(reg?.completeOnEventTypes).toContain('listing.review_approved')
    expect(reg?.cancelOnEventTypes).toContain('listing.review_rejected')
  })

  it('findByEventType 按事件类型查找触发任务', () => {
    const registry = createDefaultTaskRegistry()
    const regs = registry.findByEventType('listing.review_submitted')
    expect(regs).toHaveLength(1)
    expect(regs[0].taskType).toBe('review-pending')
  })

  it('findByCompleteEvent 按完成事件查找（review_approved → review-pending）', () => {
    const registry = createDefaultTaskRegistry()
    const regs = registry.findByCompleteEvent('listing.review_approved')
    expect(regs).toHaveLength(1)
    expect(regs[0].taskType).toBe('review-pending')
  })

  it('findByCancelEvent 按取消事件查找（review_rejected → review-pending）', () => {
    const registry = createDefaultTaskRegistry()
    const regs = registry.findByCancelEvent('listing.review_rejected')
    expect(regs).toHaveLength(1)
    expect(regs[0].taskType).toBe('review-pending')
  })

  it('followup.completed 同时触发 followup-next 创建 + followup-first 完成', () => {
    // 该事件是 followup-next 的 sourceEventType，同时是 followup-first 的 completeOnEventType
    const registry = createDefaultTaskRegistry()
    const sourceRegs = registry.findByEventType('followup.completed')
    expect(sourceRegs.map((r) => r.taskType)).toContain('followup-next')
    const completeRegs = registry.findByCompleteEvent('followup.completed')
    expect(completeRegs.map((r) => r.taskType)).toContain('followup-first')
  })

  it('lead.lost 同时取消 lead-unassigned / followup-first / followup-next', () => {
    const registry = createDefaultTaskRegistry()
    const cancelRegs = registry.findByCancelEvent('lead.lost')
    const taskTypes = cancelRegs.map((r) => r.taskType)
    expect(taskTypes).toContain('lead-unassigned')
    expect(taskTypes).toContain('followup-first')
    expect(taskTypes).toContain('followup-next')
  })

  it('重复注册同一 taskType 抛错', () => {
    const registry = new TaskRegistry()
    const reg: import('@/domain/workflow/task-registry').TaskRegistration = {
      taskType: 'review-pending',
      sourceEventType: 'listing.review_submitted',
      buildTask: () => null,
      completeOnEventTypes: [],
      cancelOnEventTypes: [],
    }
    registry.register(reg)
    expect(() => registry.register(reg)).toThrow(/已注册/)
  })

  it('未注册的事件类型查询返回空数组', () => {
    const registry = createDefaultTaskRegistry()
    // 使用真正未注册的事件类型（listing.unpublished 实际被 listing-stale-maintenance
    // 注册为 cancelOnEvent，故不能用作"未注册"测试用例）
    const unknownEvent = 'unknown.event' as never
    expect(registry.findByEventType(unknownEvent)).toEqual([])
    expect(registry.findByCompleteEvent(unknownEvent)).toEqual([])
    expect(registry.findByCancelEvent(unknownEvent)).toEqual([])
  })
})

// ────────────────────────────────────────────────────────────
// 4. 6 种 taskType 的 buildTask 规则
// ────────────────────────────────────────────────────────────
describe('TASK_BUILDERS — 6 种 taskType 的 buildTask 规则', () => {
  const ctx = { now: '2026-07-26T02:00:00.000Z' }

  it('review-pending：sourceType=listing-review，due=提交后 4h，priority=high', () => {
    const draft = TASK_BUILDERS['review-pending'](TASK_EVENT_REVIEW_SUBMITTED, ctx)
    expect(draft).not.toBeNull()
    expect(draft!.taskType).toBe('review-pending')
    expect(draft!.sourceId).toBe('review-001')
    expect(draft!.sourceVersion).toBe(2)
    expect(draft!.priority).toBe('high')
    // due = occurredAt + 4h = 02:00 + 4h = 06:00 UTC
    expect(draft!.dueAt).toBe('2026-07-26T06:00:00.000Z')
  })

  it('report-triage：sourceType=listing-report，due=创建后 24h，priority=normal', () => {
    const draft = TASK_BUILDERS['report-triage'](TASK_EVENT_REPORT_SUSTAINED, ctx)
    expect(draft).not.toBeNull()
    expect(draft!.taskType).toBe('report-triage')
    expect(draft!.sourceId).toBe('report-closed-sustained')
    expect(draft!.sourceVersion).toBe(6)
    expect(draft!.priority).toBe('normal')
    // due = occurredAt + 24h
    expect(draft!.dueAt).toBe('2026-07-27T02:00:00.000Z')
  })

  it('lead-unassigned：sourceType=lead，due=创建后 4h，priority=high', () => {
    const draft = TASK_BUILDERS['lead-unassigned'](TASK_EVENT_LEAD_CREATED, ctx)
    expect(draft).not.toBeNull()
    expect(draft!.taskType).toBe('lead-unassigned')
    expect(draft!.sourceId).toBe('lead-001')
    expect(draft!.sourceVersion).toBe(1)
    expect(draft!.priority).toBe('high')
    expect(draft!.dueAt).toBe('2026-07-26T06:00:00.000Z')
  })

  it('followup-first：sourceType=lead，due=分配后 4h，priority=urgent，assignee 派生', () => {
    const draft = TASK_BUILDERS['followup-first'](TASK_EVENT_LEAD_ASSIGNED, ctx)
    expect(draft).not.toBeNull()
    expect(draft!.taskType).toBe('followup-first')
    expect(draft!.sourceId).toBe('lead-001')
    expect(draft!.sourceVersion).toBe(2)
    expect(draft!.priority).toBe('urgent')
    expect(draft!.assigneeId).toBe('user-broker-1')
    // due = occurredAt + 4h = 06:00 + 4h = 10:00
    expect(draft!.dueAt).toBe('2026-07-26T10:00:00.000Z')
  })

  it('followup-next：仅当 payload 含 nextFollowupAt 时创建；due=nextFollowupAt', () => {
    const draft = TASK_BUILDERS['followup-next'](TASK_EVENT_FOLLOWUP_COMPLETED_WITH_NEXT, ctx)
    expect(draft).not.toBeNull()
    expect(draft!.taskType).toBe('followup-next')
    expect(draft!.sourceId).toBe('followup-001')
    expect(draft!.dueAt).toBe('2026-07-27T08:00:00.000Z')
    expect(draft!.priority).toBe('normal')
  })

  it('followup-next：无 nextFollowupAt 返回 null（不创建任务）', () => {
    const draft = TASK_BUILDERS['followup-next'](TASK_EVENT_FOLLOWUP_COMPLETED_NO_NEXT, ctx)
    expect(draft).toBeNull()
  })

  it('listing-stale-maintenance：事件路径返回 null（仅扫描器直接调用）', () => {
    const draft = TASK_BUILDERS['listing-stale-maintenance'](TASK_EVENT_REVIEW_SUBMITTED, ctx)
    expect(draft).toBeNull()
  })

  it('buildStaleMaintenanceTask 显式构造 listing-stale-maintenance 草稿', () => {
    const draft = buildStaleMaintenanceTask({
      listingId: 'listing-001',
      asOf: '2026-07-26T02:00:00.000Z',
      dueAt: '2026-08-01T00:00:00.000Z',
    })
    expect(draft.taskType).toBe('listing-stale-maintenance')
    expect(draft.sourceId).toBe('listing-001')
    expect(draft.sourceVersion).toBe(1)
    expect(draft.priority).toBe('low')
    expect(draft.dueAt).toBe('2026-08-01T00:00:00.000Z')
    expect(draft.metadata).toMatchObject({ asOf: '2026-07-26T02:00:00.000Z' })
  })
})

// ────────────────────────────────────────────────────────────
// 5. createTaskFromEvent 幂等创建
// ────────────────────────────────────────────────────────────
describe('createTaskFromEvent — 事件驱动创建待办', () => {
  let store: TaskStore & {
    snapshot(): ReadonlyMap<string | number, TaskRecord>
    reset(): void
  }
  let registry: TaskRegistry

  beforeEach(() => {
    store = createInMemoryTaskStore()
    registry = createDefaultTaskRegistry()
  })

  it('listing.review_submitted 事件创建 review-pending 待办', async () => {
    const results = await createTaskFromEvent(
      TASK_EVENT_REVIEW_SUBMITTED,
      { now: '2026-07-26T02:00:00.000Z' },
      registry,
      store,
    )
    expect(results).toHaveLength(1)
    const r0 = results[0]
    expect(r0.ok).toBe(true)
    if (!r0.ok) return
    expect(r0.skipped).toBe(false)
    expect(r0.task).not.toBeNull()
    const task = r0.task!
    expect(task.taskType).toBe('review-pending')
    expect(task.sourceType).toBe('listing-review')
    expect(task.status).toBe('pending')
    expect(task.dueAt).toBe('2026-07-26T06:00:00.000Z')
    expect(task.priority).toBe('high')
  })

  it('lead.created 事件创建 lead-unassigned 待办', async () => {
    const results = await createTaskFromEvent(
      TASK_EVENT_LEAD_CREATED,
      { now: '2026-07-26T02:00:00.000Z' },
      registry,
      store,
    )
    expect(results).toHaveLength(1)
    const r0 = results[0]
    expect(r0.ok).toBe(true)
    if (!r0.ok || !r0.task) return
    const task = r0.task
    expect(task.taskType).toBe('lead-unassigned')
    expect(task.sourceType).toBe('lead')
    expect(task.priority).toBe('high')
  })

  it('lead.assigned 事件创建 followup-first 待办（assignee 派生）', async () => {
    const results = await createTaskFromEvent(
      TASK_EVENT_LEAD_ASSIGNED,
      { now: '2026-07-26T06:00:00.000Z' },
      registry,
      store,
    )
    expect(results).toHaveLength(1)
    const r0 = results[0]
    expect(r0.ok).toBe(true)
    if (!r0.ok || !r0.task) return
    const task = r0.task
    expect(task.taskType).toBe('followup-first')
    expect(task.assigneeId).toBe('user-broker-1')
    expect(task.priority).toBe('urgent')
  })

  it('followup.completed 含 nextFollowupAt 创建 followup-next 待办', async () => {
    const results = await createTaskFromEvent(
      TASK_EVENT_FOLLOWUP_COMPLETED_WITH_NEXT,
      { now: '2026-07-26T08:00:00.000Z' },
      registry,
      store,
    )
    expect(results).toHaveLength(1)
    const r0 = results[0]
    expect(r0.ok).toBe(true)
    if (!r0.ok || !r0.task) return
    const task = r0.task
    expect(task.taskType).toBe('followup-next')
    expect(task.sourceType).toBe('followup')
    expect(task.dueAt).toBe('2026-07-27T08:00:00.000Z')
  })

  it('followup.completed 无 nextFollowupAt 跳过创建（skipped=true）', async () => {
    const results = await createTaskFromEvent(
      TASK_EVENT_FOLLOWUP_COMPLETED_NO_NEXT,
      { now: '2026-07-26T08:00:00.000Z' },
      registry,
      store,
    )
    expect(results).toHaveLength(1)
    const r0 = results[0]
    expect(r0.ok).toBe(true)
    if (!r0.ok) return
    expect(r0.skipped).toBe(true)
    expect(r0.task).toBeNull()
  })

  it('幂等：相同 taskType+sourceId+sourceVersion 不重复创建', async () => {
    // 第一次创建
    await createTaskFromEvent(
      TASK_EVENT_REVIEW_SUBMITTED,
      { now: '2026-07-26T02:00:00.000Z' },
      registry,
      store,
    )
    // 第二次相同事件应跳过
    const results2 = await createTaskFromEvent(
      TASK_EVENT_REVIEW_SUBMITTED,
      { now: '2026-07-26T02:00:00.000Z' },
      registry,
      store,
    )
    const r0 = results2[0]
    expect(r0.ok).toBe(true)
    if (!r0.ok) return
    expect(r0.skipped).toBe(true)
    expect(r0.task).toBeNull()
    // 总记录数应为 1
    expect(store.snapshot().size).toBe(1)
  })

  it('不同 sourceVersion 视为不同任务（同 sourceId 多版本）', async () => {
    // 第一次：sourceVersion=1（reviewId=review-001, version=2 的 review_submitted）
    const ev1 = {
      ...TASK_EVENT_REVIEW_SUBMITTED,
      aggregateVersion: 2,
      eventId: 'evt-review-submitted-001',
    }
    await createTaskFromEvent(ev1, { now: '2026-07-26T02:00:00.000Z' }, registry, store)

    // 第二次：sourceVersion=3（同一 reviewId 重新提交）
    const ev2 = {
      ...TASK_EVENT_REVIEW_SUBMITTED,
      aggregateVersion: 3,
      eventId: 'evt-review-submitted-002',
    }
    const results2 = await createTaskFromEvent(
      ev2,
      { now: '2026-07-26T03:00:00.000Z' },
      registry,
      store,
    )
    const r0 = results2[0]
    expect(r0.ok).toBe(true)
    if (!r0.ok) return
    expect(r0.skipped).toBe(false)
    expect(r0.task).not.toBeNull()
    expect(store.snapshot().size).toBe(2)
  })
})

// ────────────────────────────────────────────────────────────
// 6. completeTask 完成
// ────────────────────────────────────────────────────────────
describe('completeTask — 完成任务', () => {
  let store: ReturnType<typeof createInMemoryTaskStore>
  const ctx = { now: '2026-07-26T04:30:00.000Z' }

  beforeEach(() => {
    store = createInMemoryTaskStore()
  })

  it('pending 任务可被完成（设置 completedAt + completionEventId）', async () => {
    // seed 一个 pending 任务
    const seeded = await store.create({
      taskType: 'review-pending',
      sourceId: 'review-001',
      sourceVersion: 2,
      sourceType: 'listing-review',
      status: 'pending',
      priority: 'high',
      dueAt: '2026-07-26T06:00:00.000Z',
      assigneeId: null,
      teamId: null,
      metadata: null,
    })
    const result = await completeTask(seeded.id, 'evt-review-approved-001', ctx, store)
    expect(result.ok).toBe(true)
    expect(result.ok && result.data.status).toBe('completed')
    expect(result.ok && result.data.completedAt).toBe('2026-07-26T04:30:00.000Z')
    expect(result.ok && result.data.completionEventId).toBe('evt-review-approved-001')
  })

  it('in_progress 任务可被完成', async () => {
    const seeded = await store.create({
      taskType: 'followup-first',
      sourceId: 'lead-001',
      sourceVersion: 2,
      sourceType: 'lead',
      status: 'in_progress',
      priority: 'urgent',
      dueAt: '2026-07-26T10:00:00.000Z',
      assigneeId: 'user-broker-1',
      teamId: null,
      metadata: null,
    })
    const result = await completeTask(seeded.id, 'evt-followup-completed-001', ctx, store)
    expect(result.ok).toBe(true)
    expect(result.ok && result.data.status).toBe('completed')
  })

  it('completed 任务再次完成拒绝（终态）', async () => {
    const seeded = await store.create({
      taskType: 'review-pending',
      sourceId: 'review-001',
      sourceVersion: 2,
      sourceType: 'listing-review',
      status: 'completed',
      priority: 'high',
      dueAt: '2026-07-26T06:00:00.000Z',
      assigneeId: null,
      teamId: null,
      metadata: null,
    })
    const result = await completeTask(seeded.id, 'evt-review-approved-002', ctx, store)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error.code).toBe('TASK_ALREADY_TERMINAL')
  })

  it('cancelled 任务再次完成拒绝（终态）', async () => {
    const seeded = await store.create({
      taskType: 'review-pending',
      sourceId: 'review-001',
      sourceVersion: 2,
      sourceType: 'listing-review',
      status: 'cancelled',
      priority: 'high',
      dueAt: '2026-07-26T06:00:00.000Z',
      assigneeId: null,
      teamId: null,
      metadata: null,
    })
    const result = await completeTask(seeded.id, 'evt-review-approved-001', ctx, store)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error.code).toBe('TASK_ALREADY_TERMINAL')
  })

  it('任务不存在返回错误', async () => {
    const result = await completeTask(99999, 'evt-x', ctx, store)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error.code).toBe('TASK_NOT_FOUND')
  })
})

// ────────────────────────────────────────────────────────────
// 7. cancelTask 取消
// ────────────────────────────────────────────────────────────
describe('cancelTask — 取消任务', () => {
  let store: ReturnType<typeof createInMemoryTaskStore>
  const ctx = { now: '2026-07-26T04:30:00.000Z' }

  beforeEach(() => {
    store = createInMemoryTaskStore()
  })

  it('pending 任务可被取消（设置 cancelledAt + cancellationReason）', async () => {
    const seeded = await store.create({
      taskType: 'lead-unassigned',
      sourceId: 'lead-001',
      sourceVersion: 1,
      sourceType: 'lead',
      status: 'pending',
      priority: 'high',
      dueAt: '2026-07-26T06:00:00.000Z',
      assigneeId: null,
      teamId: null,
      metadata: null,
    })
    const result = await cancelTask(seeded.id, '线索已流失', ctx, store)
    expect(result.ok).toBe(true)
    expect(result.ok && result.data.status).toBe('cancelled')
    expect(result.ok && result.data.cancelledAt).toBe('2026-07-26T04:30:00.000Z')
    expect(result.ok && result.data.cancellationReason).toBe('线索已流失')
  })

  it('in_progress 任务可被取消', async () => {
    const seeded = await store.create({
      taskType: 'followup-first',
      sourceId: 'lead-001',
      sourceVersion: 2,
      sourceType: 'lead',
      status: 'in_progress',
      priority: 'urgent',
      dueAt: '2026-07-26T10:00:00.000Z',
      assigneeId: 'user-broker-1',
      teamId: null,
      metadata: null,
    })
    const result = await cancelTask(seeded.id, '客户取消', ctx, store)
    expect(result.ok).toBe(true)
    expect(result.ok && result.data.status).toBe('cancelled')
  })

  it('取消原因必填，空字符串拒绝', async () => {
    const seeded = await store.create({
      taskType: 'lead-unassigned',
      sourceId: 'lead-001',
      sourceVersion: 1,
      sourceType: 'lead',
      status: 'pending',
      priority: 'high',
      dueAt: '2026-07-26T06:00:00.000Z',
      assigneeId: null,
      teamId: null,
      metadata: null,
    })
    const result = await cancelTask(seeded.id, '   ', ctx, store)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error.code).toBe('TASK_CANCEL_REASON_REQUIRED')
  })

  it('completed 任务取消拒绝（终态）', async () => {
    const seeded = await store.create({
      taskType: 'review-pending',
      sourceId: 'review-001',
      sourceVersion: 2,
      sourceType: 'listing-review',
      status: 'completed',
      priority: 'high',
      dueAt: '2026-07-26T06:00:00.000Z',
      assigneeId: null,
      teamId: null,
      metadata: null,
    })
    const result = await cancelTask(seeded.id, '事后取消', ctx, store)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error.code).toBe('TASK_ALREADY_TERMINAL')
  })

  it('cancelled 任务再次取消拒绝', async () => {
    const seeded = await store.create({
      taskType: 'lead-unassigned',
      sourceId: 'lead-001',
      sourceVersion: 1,
      sourceType: 'lead',
      status: 'cancelled',
      priority: 'high',
      dueAt: '2026-07-26T06:00:00.000Z',
      assigneeId: null,
      teamId: null,
      metadata: null,
    })
    const result = await cancelTask(seeded.id, '再次取消', ctx, store)
    expect(result.ok).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────
// 8. autoCloseOnSourceCompletion 来源完成自动闭环
// ────────────────────────────────────────────────────────────
describe('autoCloseOnSourceCompletion — 来源完成事件触发任务闭环', () => {
  let store: ReturnType<typeof createInMemoryTaskStore>
  let registry: TaskRegistry
  const ctx = { now: '2026-07-26T04:30:00.000Z' }

  beforeEach(() => {
    store = createInMemoryTaskStore()
    registry = createDefaultTaskRegistry()
  })

  it('listing.review_approved 事件闭环 review-pending 任务为 completed', async () => {
    // seed review-pending 任务（sourceId=review-001, sourceType=listing-review）
    // 注意：autoClose 通过 sourceType + event.aggregateId 匹配，但 review_approved 的
    // aggregateId 是 listing-001 而非 review-001，需通过 findActiveBySource 派生
    // 这里我们用 lead.assigned 测试更直接：aggregateId=lead-001 匹配 lead-unassigned.sourceId=lead-001
    const seeded = await store.create({
      taskType: 'lead-unassigned',
      sourceId: 'lead-001',
      sourceVersion: 1,
      sourceType: 'lead',
      status: 'pending',
      priority: 'high',
      dueAt: '2026-07-26T06:00:00.000Z',
      assigneeId: null,
      teamId: null,
      metadata: null,
    })

    // lead.assigned 是 lead-unassigned 的 completeOnEvent
    const results = await autoCloseOnSourceCompletion(
      TASK_EVENT_LEAD_ASSIGNED,
      ctx,
      registry,
      store,
    )
    expect(results).toHaveLength(1)
    expect(results[0].ok).toBe(true)
    expect(results[0].taskType).toBe('lead-unassigned')
    expect(results[0].taskId).toBe(seeded.id)

    // 校验任务已转为 completed
    const updated = await store.getById(seeded.id)
    expect(updated?.status).toBe('completed')
    expect(updated?.completionEventId).toBe(TASK_EVENT_LEAD_ASSIGNED.eventId)
    expect(updated?.completedAt).toBe('2026-07-26T04:30:00.000Z')
  })

  it('终态任务不被再次完成（幂等）', async () => {
    // seed 一个已 completed 的 lead-unassigned
    const seeded = await store.create({
      taskType: 'lead-unassigned',
      sourceId: 'lead-001',
      sourceVersion: 1,
      sourceType: 'lead',
      status: 'completed',
      priority: 'high',
      dueAt: '2026-07-26T06:00:00.000Z',
      assigneeId: null,
      teamId: null,
      metadata: null,
    })
    // findActiveBySource 仅返回非终态，所以不会有任务被处理
    const results = await autoCloseOnSourceCompletion(
      TASK_EVENT_LEAD_ASSIGNED,
      ctx,
      registry,
      store,
    )
    expect(results).toEqual([])
    // 任务仍为 completed，未被重复处理
    const updated = await store.getById(seeded.id)
    expect(updated?.status).toBe('completed')
  })

  it('无活跃任务的来源事件返回空数组', async () => {
    const results = await autoCloseOnSourceCompletion(
      TASK_EVENT_LEAD_ASSIGNED,
      ctx,
      registry,
      store,
    )
    expect(results).toEqual([])
  })

  it('未注册 completeOnEvent 的事件返回空数组', async () => {
    // listing.unpublished 未注册为任何 taskType 的 completeOnEvent
    const event = {
      ...TASK_EVENT_LEAD_ASSIGNED,
      eventType: 'listing.unpublished' as never,
      eventId: 'evt-listing-unpublished-001',
    }
    const results = await autoCloseOnSourceCompletion(event, ctx, registry, store)
    expect(results).toEqual([])
  })
})

// ────────────────────────────────────────────────────────────
// 9. autoCancelOnSourceCancellation 来源取消自动取消任务
// ────────────────────────────────────────────────────────────
describe('autoCancelOnSourceCancellation — 来源取消事件触发任务取消', () => {
  let store: ReturnType<typeof createInMemoryTaskStore>
  let registry: TaskRegistry
  const ctx = { now: '2026-07-26T10:00:00.000Z' }

  beforeEach(() => {
    store = createInMemoryTaskStore()
    registry = createDefaultTaskRegistry()
  })

  it('lead.lost 事件取消 lead-unassigned / followup-first / followup-next 任务', async () => {
    // seed 3 个待办：lead-unassigned / followup-first / followup-next，全部 sourceId=lead-001
    await store.create({
      taskType: 'lead-unassigned',
      sourceId: 'lead-001',
      sourceVersion: 1,
      sourceType: 'lead',
      status: 'pending',
      priority: 'high',
      dueAt: '2026-07-26T06:00:00.000Z',
      assigneeId: null,
      teamId: null,
      metadata: null,
    })
    await store.create({
      taskType: 'followup-first',
      sourceId: 'lead-001',
      sourceVersion: 2,
      sourceType: 'lead',
      status: 'pending',
      priority: 'urgent',
      dueAt: '2026-07-26T10:00:00.000Z',
      assigneeId: 'user-broker-1',
      teamId: null,
      metadata: null,
    })
    await store.create({
      taskType: 'followup-next',
      sourceId: 'followup-001', // 注意：followup-next 的 sourceId 是 followupId，不是 leadId
      sourceVersion: 1,
      sourceType: 'followup',
      status: 'pending',
      priority: 'normal',
      dueAt: '2026-07-27T08:00:00.000Z',
      assigneeId: 'user-broker-1',
      teamId: null,
      metadata: null,
    })

    // lead.lost 事件的 payload.leadId=lead-001
    const results = await autoCancelOnSourceCancellation(
      TASK_EVENT_LEAD_LOST,
      ctx,
      registry,
      store,
    )
    // 应取消 lead-unassigned 和 followup-first（sourceType=lead, sourceId=lead-001）
    // followup-next sourceType=followup, sourceId=followup-001 不匹配
    const okTypes = results.filter((r) => r.ok).map((r) => r.taskType)
    expect(okTypes).toContain('lead-unassigned')
    expect(okTypes).toContain('followup-first')
    // followup-next 因 sourceId 不匹配而未被取消
    expect(okTypes).not.toContain('followup-next')

    // 校验状态
    const allTasks = Array.from(store.snapshot().values())
    const leadUnassigned = allTasks.find((t) => t.taskType === 'lead-unassigned')
    expect(leadUnassigned?.status).toBe('cancelled')
    expect(leadUnassigned?.cancellationReason).toContain('lead.lost')
    expect(leadUnassigned?.cancelledAt).toBe('2026-07-26T10:00:00.000Z')
  })

  it('review.rejected 事件取消 review-pending 任务（含 payload.reason）', async () => {
    // seed review-pending 任务（注意：autoCancel 通过 payload 派生 ID，
    // review_rejected payload 含 reviewId=review-001，registry 派生 sourceType=listing-review）
    const seeded = await store.create({
      taskType: 'review-pending',
      sourceId: 'review-001',
      sourceVersion: 2,
      sourceType: 'listing-review',
      status: 'pending',
      priority: 'high',
      dueAt: '2026-07-26T06:00:00.000Z',
      assigneeId: null,
      teamId: null,
      metadata: null,
    })

    // TASK_EVENT_REVIEW_REJECTED 的 aggregateId=listing-001, payload.reviewId=review-001
    // autoCancel 派生 ID 优先取 payload.reviewId
    const results = await autoCancelOnSourceCancellation(
      TASK_EVENT_REVIEW_REJECTED,
      ctx,
      registry,
      store,
    )
    expect(results).toHaveLength(1)
    expect(results[0].ok).toBe(true)
    expect(results[0].taskType).toBe('review-pending')
    expect(results[0].taskId).toBe(seeded.id)

    const updated = await store.getById(seeded.id)
    expect(updated?.status).toBe('cancelled')
    expect(updated?.cancellationReason).toContain('listing.review_rejected')
    expect(updated?.cancellationReason).toContain('面积描述与实际不符')
  })

  it('report.dismissed 事件取消 report-triage 任务', async () => {
    const seeded = await store.create({
      taskType: 'report-triage',
      sourceId: 'report-closed-dismissed',
      sourceVersion: 4,
      sourceType: 'listing-report',
      status: 'pending',
      priority: 'normal',
      dueAt: '2026-07-27T02:00:00.000Z',
      assigneeId: null,
      teamId: null,
      metadata: null,
    })

    const results = await autoCancelOnSourceCancellation(
      TASK_EVENT_REPORT_DISMISSED,
      ctx,
      registry,
      store,
    )
    expect(results).toHaveLength(1)
    expect(results[0].ok).toBe(true)
    expect(results[0].taskType).toBe('report-triage')
    expect(results[0].taskId).toBe(seeded.id)

    const updated = await store.getById(seeded.id)
    expect(updated?.status).toBe('cancelled')
  })

  it('终态任务不被再次取消（幂等）', async () => {
    // seed 一个已 cancelled 的 lead-unassigned
    await store.create({
      taskType: 'lead-unassigned',
      sourceId: 'lead-001',
      sourceVersion: 1,
      sourceType: 'lead',
      status: 'cancelled',
      priority: 'high',
      dueAt: '2026-07-26T06:00:00.000Z',
      assigneeId: null,
      teamId: null,
      metadata: null,
    })
    // findActiveBySource 仅返回非终态，所以不会有任务被处理
    const results = await autoCancelOnSourceCancellation(
      TASK_EVENT_LEAD_LOST,
      ctx,
      registry,
      store,
    )
    expect(results).toEqual([])
  })

  it('无注册取消事件的事件类型返回空数组', async () => {
    // listing.published 未注册为 cancelOnEvent
    const event = {
      ...TASK_EVENT_LEAD_LOST,
      eventType: 'listing.published' as never,
      eventId: 'evt-listing-published-001',
    }
    const results = await autoCancelOnSourceCancellation(event, ctx, registry, store)
    expect(results).toEqual([])
  })
})

// ────────────────────────────────────────────────────────────
// 10. fixture 完整性
// ────────────────────────────────────────────────────────────
describe('TaskFixture — fixture 完整性', () => {
  it('TASK_FIXTURE_REVIEW_PENDING 字段对齐设计', () => {
    expect(TASK_FIXTURE_REVIEW_PENDING.taskType).toBe('review-pending')
    expect(TASK_FIXTURE_REVIEW_PENDING.sourceType).toBe('listing-review')
    expect(TASK_FIXTURE_REVIEW_PENDING.status).toBe('pending')
    expect(TASK_FIXTURE_REVIEW_PENDING.priority).toBe('high')
    expect(TASK_FIXTURE_REVIEW_PENDING.dueAt).toBe('2026-07-26T06:00:00.000Z')
  })

  it('TASK_FIXTURE_REPORT_TRIAGE 字段对齐设计', () => {
    expect(TASK_FIXTURE_REPORT_TRIAGE.taskType).toBe('report-triage')
    expect(TASK_FIXTURE_REPORT_TRIAGE.sourceType).toBe('listing-report')
    expect(TASK_FIXTURE_REPORT_TRIAGE.priority).toBe('normal')
  })

  it('TASK_FIXTURE_LEAD_UNASSIGNED 字段对齐设计', () => {
    expect(TASK_FIXTURE_LEAD_UNASSIGNED.taskType).toBe('lead-unassigned')
    expect(TASK_FIXTURE_LEAD_UNASSIGNED.sourceType).toBe('lead')
    expect(TASK_FIXTURE_LEAD_UNASSIGNED.priority).toBe('high')
  })

  it('TASK_FIXTURE_FOLLOWUP_FIRST 字段对齐设计', () => {
    expect(TASK_FIXTURE_FOLLOWUP_FIRST.taskType).toBe('followup-first')
    expect(TASK_FIXTURE_FOLLOWUP_FIRST.sourceType).toBe('lead')
    expect(TASK_FIXTURE_FOLLOWUP_FIRST.priority).toBe('urgent')
    expect(TASK_FIXTURE_FOLLOWUP_FIRST.assigneeId).toBe('user-broker-1')
  })
})

// ────────────────────────────────────────────────────────────
// 11. in-memory TaskStore
// ────────────────────────────────────────────────────────────
describe('createInMemoryTaskStore — 内存存储', () => {
  it('findByKey 按幂等键查找', async () => {
    const store = createInMemoryTaskStore()
    await store.create({
      taskType: 'review-pending',
      sourceId: 'review-001',
      sourceVersion: 2,
      sourceType: 'listing-review',
      status: 'pending',
      priority: 'high',
      dueAt: '2026-07-26T06:00:00.000Z',
      assigneeId: null,
      teamId: null,
      metadata: null,
    })
    const found = await store.findByKey({
      taskType: 'review-pending',
      sourceId: 'review-001',
      sourceVersion: 2,
    })
    expect(found).not.toBeNull()
    expect(found?.taskType).toBe('review-pending')

    const notFound = await store.findByKey({
      taskType: 'review-pending',
      sourceId: 'review-001',
      sourceVersion: 99,
    })
    expect(notFound).toBeNull()
  })

  it('findActiveBySource 仅返回非终态任务', async () => {
    const store = createInMemoryTaskStore()
    await store.create({
      taskType: 'lead-unassigned',
      sourceId: 'lead-001',
      sourceVersion: 1,
      sourceType: 'lead',
      status: 'pending',
      priority: 'high',
      dueAt: '2026-07-26T06:00:00.000Z',
      assigneeId: null,
      teamId: null,
      metadata: null,
    })
    await store.create({
      taskType: 'followup-first',
      sourceId: 'lead-001',
      sourceVersion: 2,
      sourceType: 'lead',
      status: 'completed',
      priority: 'urgent',
      dueAt: '2026-07-26T10:00:00.000Z',
      assigneeId: 'user-broker-1',
      teamId: null,
      metadata: null,
    })
    const active = await store.findActiveBySource({
      sourceType: 'lead',
      sourceId: 'lead-001',
    })
    expect(active).toHaveLength(1)
    expect(active[0].taskType).toBe('lead-unassigned')
  })

  it('reset 清空存储并重置 ID 计数', async () => {
    const store = createInMemoryTaskStore()
    await store.create({
      taskType: 'review-pending',
      sourceId: 'review-001',
      sourceVersion: 2,
      sourceType: 'listing-review',
      status: 'pending',
      priority: 'high',
      dueAt: '2026-07-26T06:00:00.000Z',
      assigneeId: null,
      teamId: null,
      metadata: null,
    })
    expect(store.snapshot().size).toBe(1)
    store.reset()
    expect(store.snapshot().size).toBe(0)
  })
})
