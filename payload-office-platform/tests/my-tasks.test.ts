import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { PayloadRequest } from 'payload'

import {
  batchClaimTasks,
  batchTransferTasks,
  buildSourceDeepLink,
  claimTask,
  isOverdue,
  MY_TASKS_BATCH_LIMIT,
  sortMyTasks,
  toMyTaskView,
  transferTask,
  type MyTasksActionContext,
  type MyTasksSortContext,
} from '@/domain/workflow/my-tasks'
import { createInMemoryTaskStore } from '@/domain/workflow/task-service'
import type { TaskRecord } from '@/domain/workflow/task-service'
import {
  createBatchTaskClaimEndpoint,
  createBatchTaskTransferEndpoint,
  createMyTasksListEndpoint,
  createTaskClaimEndpoint,
  createTaskTransferEndpoint,
} from '@/endpoints/my-tasks-endpoint'
import type { Role, User } from '@/payload-types'

/**
 * M6.6 我的待办测试（design §7.2 Custom Views / R1, R7）
 *
 * 覆盖：
 *   - sortMyTasks：按逾期 → 优先级 → 截止 → 创建时间稳定排序；终态排末尾
 *   - isOverdue：逾期判定（活跃态且 dueAt < now）
 *   - buildSourceDeepLink：6 种 taskType 的深链映射
 *   - toMyTaskView：TaskRecord → 视图转换
 *   - claimTask：单条领取（pending → in_progress、幂等、CLAIMED_BY_OTHER、终态拒绝）
 *   - transferTask：单条转派（保留 status、终态拒绝、缺 toUserId）
 *   - batchClaimTasks / batchTransferTasks：批量限制 ≤ 50、逐条结果、截断 truncated
 *   - HTTP endpoint：路由参数、鉴权门、错误码映射、成功响应
 */

// ────────────────────────────────────────────────────────────
// fixtures
// ────────────────────────────────────────────────────────────

function makeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 1,
    taskType: 'review-pending',
    sourceId: 'rev-1',
    sourceVersion: 1,
    sourceType: 'listing-review',
    status: 'pending',
    priority: 'normal',
    dueAt: '2026-07-26T10:00:00.000Z',
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

function makeAdmRole(overrides: Partial<Role> = {}): Role {
  return {
    id: 1,
    code: 'ADM',
    name: '平台管理员',
    isBuiltin: true,
    status: 'active',
    dataScope: 'global',
    menuPermissions: ['*'],
    operationPermissions: ['*'],
    fieldPermissions: ['*'],
    updatedAt: '',
    createdAt: '',
    ...overrides,
  } as unknown as Role
}

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 10,
    name: 'admin',
    email: 'admin@example.com',
    status: 'active',
    sessionVersion: 1,
    roles: [1],
    updatedAt: '',
    createdAt: '',
    collection: 'users',
    ...overrides,
  } as unknown as User
}

// ────────────────────────────────────────────────────────────
// 1. sortMyTasks 排序
// ────────────────────────────────────────────────────────────

describe('sortMyTasks — 排序', () => {
  const now = '2026-07-26T12:00:00.000Z'
  const sortCtx: MyTasksSortContext = { now }

  it('活跃态任务排前，终态任务排末尾', () => {
    const tasks: TaskRecord[] = [
      makeTask({ id: 1, status: 'completed', completedAt: '2026-07-25T10:00:00.000Z' }),
      makeTask({ id: 2, status: 'pending', dueAt: '2026-07-26T15:00:00.000Z' }),
      makeTask({ id: 3, status: 'cancelled', cancelledAt: '2026-07-24T10:00:00.000Z' }),
    ]
    const sorted = sortMyTasks(tasks, sortCtx)
    expect(sorted[0]!.id).toBe(2) // 活跃在前
    // 终态在后，按 completedAt/cancelledAt 倒序
    expect([sorted[1]!.id, sorted[2]!.id].sort()).toEqual([1, 3])
  })

  it('逾期任务排前（同优先级 + dueAt 早的在前）', () => {
    const tasks: TaskRecord[] = [
      makeTask({
        id: 1,
        status: 'pending',
        priority: 'normal',
        dueAt: '2026-07-26T14:00:00.000Z', // 未逾期（now=12:00）
      }),
      makeTask({
        id: 2,
        status: 'pending',
        priority: 'normal',
        dueAt: '2026-07-26T08:00:00.000Z', // 逾期
      }),
    ]
    const sorted = sortMyTasks(tasks, sortCtx)
    expect(sorted[0]!.id).toBe(2) // 逾期在前
  })

  it('优先级 urgent < high < normal < low（紧急在前）', () => {
    const tasks: TaskRecord[] = [
      makeTask({ id: 1, status: 'pending', priority: 'low', dueAt: '2026-07-26T15:00:00.000Z' }),
      makeTask({ id: 2, status: 'pending', priority: 'urgent', dueAt: '2026-07-26T15:00:00.000Z' }),
      makeTask({ id: 3, status: 'pending', priority: 'normal', dueAt: '2026-07-26T15:00:00.000Z' }),
      makeTask({ id: 4, status: 'pending', priority: 'high', dueAt: '2026-07-26T15:00:00.000Z' }),
    ]
    const sorted = sortMyTasks(tasks, sortCtx)
    expect(sorted.map((t) => t.id)).toEqual([2, 4, 3, 1])
  })

  it('同优先级同逾期状态：dueAt 早的在前', () => {
    const tasks: TaskRecord[] = [
      makeTask({ id: 1, status: 'pending', priority: 'normal', dueAt: '2026-07-26T18:00:00.000Z' }),
      makeTask({ id: 2, status: 'pending', priority: 'normal', dueAt: '2026-07-26T14:00:00.000Z' }),
    ]
    const sorted = sortMyTasks(tasks, sortCtx)
    expect(sorted[0]!.id).toBe(2)
  })

  it('同优先级同 dueAt：createdAt 早的在前（用 metadata.createdAt 派生）', () => {
    const tasks: TaskRecord[] = [
      makeTask({
        id: 1,
        dueAt: '2026-07-26T15:00:00.000Z',
        metadata: { createdAt: '2026-07-25T10:00:00.000Z' },
      }),
      makeTask({
        id: 2,
        dueAt: '2026-07-26T15:00:00.000Z',
        metadata: { createdAt: '2026-07-25T08:00:00.000Z' },
      }),
    ]
    const sorted = sortMyTasks(tasks, sortCtx)
    expect(sorted[0]!.id).toBe(2)
  })

  it('不污染原数组', () => {
    const tasks: TaskRecord[] = [
      makeTask({ id: 1, dueAt: '2026-07-26T15:00:00.000Z' }),
      makeTask({ id: 2, dueAt: '2026-07-26T10:00:00.000Z' }),
    ]
    const originalOrder = tasks.map((t) => t.id)
    sortMyTasks(tasks, sortCtx)
    expect(tasks.map((t) => t.id)).toEqual(originalOrder)
  })
})

// ────────────────────────────────────────────────────────────
// 2. isOverdue 逾期判定
// ────────────────────────────────────────────────────────────

describe('isOverdue', () => {
  it('活跃态 + dueAt < now → 逾期', () => {
    const task = makeTask({
      status: 'pending',
      dueAt: '2026-07-26T10:00:00.000Z',
    })
    expect(isOverdue(task, new Date('2026-07-26T12:00:00.000Z').getTime())).toBe(true)
  })

  it('活跃态 + dueAt > now → 未逾期', () => {
    const task = makeTask({
      status: 'pending',
      dueAt: '2026-07-26T15:00:00.000Z',
    })
    expect(isOverdue(task, new Date('2026-07-26T12:00:00.000Z').getTime())).toBe(false)
  })

  it('终态任务 → 不逾期', () => {
    const task = makeTask({
      status: 'completed',
      dueAt: '2026-07-25T10:00:00.000Z',
      completedAt: '2026-07-25T09:00:00.000Z',
    })
    expect(isOverdue(task, new Date('2026-07-26T12:00:00.000Z').getTime())).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────
// 3. buildSourceDeepLink 深链
// ────────────────────────────────────────────────────────────

describe('buildSourceDeepLink — 6 种 taskType 深链映射', () => {
  it('review-pending → listing-reviews 详情', () => {
    const link = buildSourceDeepLink(makeTask({ taskType: 'review-pending', sourceId: 'rev-1' }))
    expect(link.collectionSlug).toBe('listing-reviews')
    expect(link.sourceId).toBe('rev-1')
    expect(link.url).toBe('/admin/collections/listing-reviews/rev-1')
    expect(link.label).toBe('审核详情')
  })

  it('report-triage → listing-reports 详情', () => {
    const link = buildSourceDeepLink(makeTask({ taskType: 'report-triage', sourceId: 'rpt-1' }))
    expect(link.collectionSlug).toBe('listing-reports')
    expect(link.url).toBe('/admin/collections/listing-reports/rpt-1')
    expect(link.label).toBe('举报详情')
  })

  it('lead-unassigned → leads 详情', () => {
    const link = buildSourceDeepLink(makeTask({ taskType: 'lead-unassigned', sourceId: 'lead-1' }))
    expect(link.collectionSlug).toBe('leads')
    expect(link.url).toBe('/admin/collections/leads/lead-1')
    expect(link.label).toBe('线索详情')
  })

  it('followup-first → leads 详情（metadata.leadId 优先）', () => {
    const link = buildSourceDeepLink(
      makeTask({
        taskType: 'followup-first',
        sourceId: 'fu-1',
        metadata: { leadId: 'lead-99' },
      }),
    )
    expect(link.collectionSlug).toBe('leads')
    expect(link.sourceId).toBe('lead-99')
    expect(link.url).toBe('/admin/collections/leads/lead-99')
    expect(link.label).toBe('线索跟进')
  })

  it('followup-next → leads 详情（缺 metadata.leadId 回退 sourceId）', () => {
    const link = buildSourceDeepLink(
      makeTask({ taskType: 'followup-next', sourceId: 'lead-7', metadata: null }),
    )
    expect(link.collectionSlug).toBe('leads')
    expect(link.sourceId).toBe('lead-7')
  })

  it('listing-stale-maintenance → listings 详情', () => {
    const link = buildSourceDeepLink(
      makeTask({ taskType: 'listing-stale-maintenance', sourceId: 'list-1' }),
    )
    expect(link.collectionSlug).toBe('listings')
    expect(link.url).toBe('/admin/collections/listings/list-1')
    expect(link.label).toBe('房源维护')
  })
})

// ────────────────────────────────────────────────────────────
// 4. toMyTaskView 视图转换
// ────────────────────────────────────────────────────────────

describe('toMyTaskView', () => {
  it('转换 TaskRecord → MyTaskView（含逾期 + 深链）', () => {
    const task = makeTask({
      id: 42,
      taskType: 'review-pending',
      sourceId: 'rev-1',
      sourceType: 'listing-review',
      status: 'pending',
      priority: 'high',
      dueAt: '2026-07-26T10:00:00.000Z',
      metadata: { foo: 'bar' },
    })
    const view = toMyTaskView(task, { now: '2026-07-26T12:00:00.000Z' })
    expect(view.id).toBe(42)
    expect(view.taskType).toBe('review-pending')
    expect(view.priority).toBe('high')
    expect(view.overdue).toBe(true)
    expect(view.deepLink.collectionSlug).toBe('listing-reviews')
    expect(view.metadata).toEqual({ foo: 'bar' })
  })
})

// ────────────────────────────────────────────────────────────
// 5. claimTask 单条领取
// ────────────────────────────────────────────────────────────

describe('claimTask — 单条领取', () => {
  let store: ReturnType<typeof createInMemoryTaskStore>
  let ctx: MyTasksActionContext

  beforeEach(() => {
    store = createInMemoryTaskStore()
    ctx = {
      userId: 10,
      now: '2026-07-26T12:00:00.000Z',
      taskStore: store,
    }
  })

  it('pending → in_progress 并设置 assigneeId', async () => {
    const task = await store.create({
      taskType: 'review-pending',
      sourceId: 'rev-1',
      sourceVersion: 1,
      sourceType: 'listing-review',
      status: 'pending',
      priority: 'high',
      dueAt: '2026-07-26T15:00:00.000Z',
      assigneeId: null,
      teamId: null,
    })
    const result = await claimTask(task.id, ctx)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.status).toBe('in_progress')
      expect(result.data.assigneeId).toBe(10)
    }
  })

  it('同用户已领取 → 幂等返回成功', async () => {
    const task = await store.create({
      taskType: 'review-pending',
      sourceId: 'rev-2',
      sourceVersion: 1,
      sourceType: 'listing-review',
      status: 'in_progress',
      priority: 'high',
      dueAt: '2026-07-26T15:00:00.000Z',
      assigneeId: 10,
      teamId: null,
    })
    const result = await claimTask(task.id, ctx)
    expect(result.ok).toBe(true)
  })

  it('他人已领取 → TASK_CLAIMED_BY_OTHER', async () => {
    const task = await store.create({
      taskType: 'review-pending',
      sourceId: 'rev-3',
      sourceVersion: 1,
      sourceType: 'listing-review',
      status: 'in_progress',
      priority: 'high',
      dueAt: '2026-07-26T15:00:00.000Z',
      assigneeId: 99,
      teamId: null,
    })
    const result = await claimTask(task.id, ctx)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('TASK_CLAIMED_BY_OTHER')
    }
  })

  it('终态任务拒绝领取', async () => {
    const task = await store.create({
      taskType: 'review-pending',
      sourceId: 'rev-4',
      sourceVersion: 1,
      sourceType: 'listing-review',
      status: 'completed',
      priority: 'high',
      dueAt: '2026-07-26T15:00:00.000Z',
      assigneeId: null,
      teamId: null,
      completedAt: '2026-07-25T10:00:00.000Z',
    })
    const result = await claimTask(task.id, ctx)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('TASK_ALREADY_TERMINAL')
    }
  })

  it('任务不存在 → TASK_NOT_FOUND', async () => {
    const result = await claimTask(9999, ctx)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('TASK_NOT_FOUND')
    }
  })
})

// ────────────────────────────────────────────────────────────
// 6. transferTask 单条转派
// ────────────────────────────────────────────────────────────

describe('transferTask — 单条转派', () => {
  let store: ReturnType<typeof createInMemoryTaskStore>
  let ctx: MyTasksActionContext

  beforeEach(() => {
    store = createInMemoryTaskStore()
    ctx = {
      userId: 10,
      now: '2026-07-26T12:00:00.000Z',
      taskStore: store,
    }
  })

  it('保留 status，更新 assigneeId', async () => {
    const task = await store.create({
      taskType: 'review-pending',
      sourceId: 'rev-1',
      sourceVersion: 1,
      sourceType: 'listing-review',
      status: 'pending',
      priority: 'high',
      dueAt: '2026-07-26T15:00:00.000Z',
      assigneeId: 10,
      teamId: null,
    })
    const result = await transferTask(task.id, { toUserId: 20, teamId: 5 }, ctx)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.status).toBe('pending') // 保留状态
      expect(result.data.assigneeId).toBe(20)
      expect(result.data.teamId).toBe(5)
    }
  })

  it('缺 toUserId → TASK_TRANSFER_TARGET_REQUIRED', async () => {
    const task = await store.create({
      taskType: 'review-pending',
      sourceId: 'rev-2',
      sourceVersion: 1,
      sourceType: 'listing-review',
      status: 'pending',
      priority: 'high',
      dueAt: '2026-07-26T15:00:00.000Z',
      assigneeId: 10,
      teamId: null,
    })
    const result = await transferTask(task.id, { toUserId: '' }, ctx)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('TASK_TRANSFER_TARGET_REQUIRED')
    }
  })

  it('终态任务拒绝转派', async () => {
    const task = await store.create({
      taskType: 'review-pending',
      sourceId: 'rev-3',
      sourceVersion: 1,
      sourceType: 'listing-review',
      status: 'cancelled',
      priority: 'high',
      dueAt: '2026-07-26T15:00:00.000Z',
      assigneeId: 10,
      teamId: null,
      cancelledAt: '2026-07-25T10:00:00.000Z',
    })
    const result = await transferTask(task.id, { toUserId: 20 }, ctx)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('TASK_ALREADY_TERMINAL')
    }
  })

  it('任务不存在 → TASK_NOT_FOUND', async () => {
    const result = await transferTask(9999, { toUserId: 20 }, ctx)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('TASK_NOT_FOUND')
    }
  })
})

// ────────────────────────────────────────────────────────────
// 7. 批量领取 / 转派
// ────────────────────────────────────────────────────────────

describe('batchClaimTasks / batchTransferTasks — 批量操作', () => {
  let store: ReturnType<typeof createInMemoryTaskStore>
  let ctx: MyTasksActionContext

  beforeEach(() => {
    store = createInMemoryTaskStore()
    ctx = {
      userId: 10,
      now: '2026-07-26T12:00:00.000Z',
      taskStore: store,
    }
  })

  it('批量领取成功：逐条返回结果', async () => {
    const t1 = await store.create({
      taskType: 'review-pending',
      sourceId: 'rev-1',
      sourceVersion: 1,
      sourceType: 'listing-review',
      status: 'pending',
      priority: 'high',
      dueAt: '2026-07-26T15:00:00.000Z',
      assigneeId: null,
      teamId: null,
    })
    const t2 = await store.create({
      taskType: 'review-pending',
      sourceId: 'rev-2',
      sourceVersion: 1,
      sourceType: 'listing-review',
      status: 'pending',
      priority: 'normal',
      dueAt: '2026-07-26T15:00:00.000Z',
      assigneeId: null,
      teamId: null,
    })
    const summary = await batchClaimTasks([t1.id, t2.id], ctx)
    expect(summary.total).toBe(2)
    expect(summary.succeeded).toBe(2)
    expect(summary.failed).toBe(0)
    expect(summary.truncated).toBe(0)
    expect(summary.items).toHaveLength(2)
  })

  it('批量领取超过 50 条：截断并记 truncated', async () => {
    // 创建 60 条任务
    const ids: Array<string | number> = []
    for (let i = 0; i < 60; i++) {
      const t = await store.create({
        taskType: 'review-pending',
        sourceId: `rev-${i}`,
        sourceVersion: 1,
        sourceType: 'listing-review',
        status: 'pending',
        priority: 'normal',
        dueAt: '2026-07-26T15:00:00.000Z',
        assigneeId: null,
        teamId: null,
      })
      ids.push(t.id)
    }
    const summary = await batchClaimTasks(ids, ctx)
    expect(summary.total).toBe(MY_TASKS_BATCH_LIMIT)
    expect(summary.truncated).toBe(60 - MY_TASKS_BATCH_LIMIT)
    expect(summary.items).toHaveLength(MY_TASKS_BATCH_LIMIT)
  })

  it('批量领取：单条失败不影响其他条', async () => {
    const t1 = await store.create({
      taskType: 'review-pending',
      sourceId: 'rev-1',
      sourceVersion: 1,
      sourceType: 'listing-review',
      status: 'pending',
      priority: 'high',
      dueAt: '2026-07-26T15:00:00.000Z',
      assigneeId: null,
      teamId: null,
    })
    // t2 是终态任务，会失败
    const t2 = await store.create({
      taskType: 'review-pending',
      sourceId: 'rev-2',
      sourceVersion: 1,
      sourceType: 'listing-review',
      status: 'completed',
      priority: 'high',
      dueAt: '2026-07-26T15:00:00.000Z',
      assigneeId: null,
      teamId: null,
      completedAt: '2026-07-25T10:00:00.000Z',
    })
    const summary = await batchClaimTasks([t1.id, t2.id, 9999], ctx)
    expect(summary.succeeded).toBe(1)
    expect(summary.failed).toBe(2)
    expect(summary.items).toHaveLength(3)
    // 失败条目包含错误码
    const failedItems = summary.items.filter((i) => !i.ok)
    expect(failedItems.length).toBe(2)
    expect(failedItems.some((i) => i.errorCode === 'TASK_ALREADY_TERMINAL')).toBe(true)
    expect(failedItems.some((i) => i.errorCode === 'TASK_NOT_FOUND')).toBe(true)
  })

  it('批量转派成功：保留 status，更新 assigneeId', async () => {
    const t1 = await store.create({
      taskType: 'review-pending',
      sourceId: 'rev-1',
      sourceVersion: 1,
      sourceType: 'listing-review',
      status: 'pending',
      priority: 'high',
      dueAt: '2026-07-26T15:00:00.000Z',
      assigneeId: 10,
      teamId: null,
    })
    const t2 = await store.create({
      taskType: 'review-pending',
      sourceId: 'rev-2',
      sourceVersion: 1,
      sourceType: 'listing-review',
      status: 'in_progress',
      priority: 'normal',
      dueAt: '2026-07-26T15:00:00.000Z',
      assigneeId: 10,
      teamId: null,
    })
    const summary = await batchTransferTasks(
      [
        { taskId: t1.id, toUserId: 20 },
        { taskId: t2.id, toUserId: 30, teamId: 5 },
      ],
      ctx,
    )
    expect(summary.succeeded).toBe(2)
    expect(summary.failed).toBe(0)
  })

  it('批量上限 MY_TASKS_BATCH_LIMIT = 50', () => {
    expect(MY_TASKS_BATCH_LIMIT).toBe(50)
  })
})

// ────────────────────────────────────────────────────────────
// 8. HTTP endpoint 装配层
// ────────────────────────────────────────────────────────────

/** 构造 mock req（参照 listing-publish-endpoint.test.ts 模式） */
function makeReq(params: {
  user?: User | null
  routeParams?: Record<string, unknown>
  body?: Record<string, unknown>
  userRoles?: Role[]
  taskDocs?: Array<Record<string, unknown>>
  taskDoc?: Record<string, unknown> | null
  findByIDThrows?: boolean
  updateResult?: Record<string, unknown>
}): {
  req: PayloadRequest
  find: ReturnType<typeof vi.fn>
  findByID: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
} {
  const {
    user = makeUser(),
    routeParams = { id: '1' },
    body = {},
    userRoles = [makeAdmRole()],
    taskDocs = [],
    taskDoc = { id: 1, taskType: 'review-pending', sourceId: 'rev-1', sourceVersion: 1, sourceType: 'listing-review', status: 'pending', priority: 'normal', dueAt: '2026-07-26T15:00:00.000Z', assignee: null, team: null },
    findByIDThrows = false,
    updateResult = { id: 1 },
  } = params

  const find = vi.fn(async (args: { collection?: string }) => {
    if (args?.collection === 'roles') return { docs: userRoles }
    if (args?.collection === 'tasks') return { docs: taskDocs }
    return { docs: [] }
  })
  const findByID = vi.fn(async () => {
    if (findByIDThrows) throw new Error('not found')
    return taskDoc
  })
  const update = vi.fn(async () => updateResult)
  const req = {
    user: user ?? null,
    routeParams,
    data: body,
    json: async () => body,
    payload: { find, findByID, update },
  }
  return { req: req as unknown as PayloadRequest, find, findByID, update }
}

async function run(
  endpointFactory: () => { handler?: unknown },
  req: PayloadRequest,
): Promise<{ status: number; body: any }> {
  const endpoint = endpointFactory() as { handler: (req: PayloadRequest) => Promise<Response> }
  const res = await endpoint.handler(req)
  const json = await res.json()
  return { status: res.status, body: json }
}

// ── GET /mine ──────────────────────────────────────────────

describe('my-tasks-endpoint/GET /mine', () => {
  it('未登录 → 401', async () => {
    const { req, find } = makeReq({ user: null })
    const { status } = await run(createMyTasksListEndpoint, req)
    expect(status).toBe(401)
    expect(find).not.toHaveBeenCalled()
  })

  it('无 task:read 权限 → 403', async () => {
    const role = makeAdmRole({ id: 2, code: 'BRK', operationPermissions: ['listing:read'] })
    const { req, find } = makeReq({
      userRoles: [role],
      user: makeUser({ roles: [2] }),
    })
    const { status } = await run(createMyTasksListEndpoint, req)
    expect(status).toBe(403)
    // 权限校验本身会 find('roles') 加载用户角色；但绝不应触发 tasks 数据查询
    const tasksCalls = find.mock.calls.filter(
      (c: unknown[]) => (c[0] as { collection?: string })?.collection === 'tasks',
    )
    expect(tasksCalls).toHaveLength(0)
  })

  it('有权限 + 有任务 → 200 + 排序后的 MyTaskView[]', async () => {
    const taskDocs = [
      {
        id: 1,
        taskType: 'review-pending',
        sourceId: 'rev-1',
        sourceVersion: 1,
        sourceType: 'listing-review',
        status: 'pending',
        priority: 'high',
        dueAt: '2026-07-26T15:00:00.000Z',
        assignee: 10,
        team: null,
      },
    ]
    const { req } = makeReq({ taskDocs })
    const { status, body } = await run(createMyTasksListEndpoint, req)
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.tasks).toHaveLength(1)
    expect(body.tasks[0].taskType).toBe('review-pending')
    expect(body.tasks[0].deepLink.collectionSlug).toBe('listing-reviews')
  })

  it('有权限 + 无任务 → 200 + 空数组', async () => {
    const { req } = makeReq({ taskDocs: [] })
    const { status, body } = await run(createMyTasksListEndpoint, req)
    expect(status).toBe(200)
    expect(body.tasks).toEqual([])
  })
})

// ── POST /:id/claim ─────────────────────────────────────────

describe('my-tasks-endpoint/POST /:id/claim', () => {
  it('未登录 → 401', async () => {
    const { req, update } = makeReq({ user: null })
    const { status } = await run(createTaskClaimEndpoint, req)
    expect(status).toBe(401)
    expect(update).not.toHaveBeenCalled()
  })

  it('无 task:assign 权限 → 403', async () => {
    const role = makeAdmRole({ id: 2, code: 'BRK', operationPermissions: ['task:read'] })
    const { req, update } = makeReq({
      userRoles: [role],
      user: makeUser({ roles: [2] }),
    })
    const { status } = await run(createTaskClaimEndpoint, req)
    expect(status).toBe(403)
    expect(update).not.toHaveBeenCalled()
  })

  it('缺任务 ID → 400', async () => {
    const { req, update } = makeReq({ routeParams: {} })
    const { status, body } = await run(createTaskClaimEndpoint, req)
    expect(status).toBe(400)
    expect(body.error).toContain('任务 ID')
    expect(update).not.toHaveBeenCalled()
  })

  it('任务不存在 → 404', async () => {
    const { req, update } = makeReq({ taskDoc: null, findByIDThrows: true })
    const { status } = await run(createTaskClaimEndpoint, req)
    expect(status).toBe(404)
    expect(update).not.toHaveBeenCalled()
  })

  it('pending 任务 → 200 + in_progress', async () => {
    const taskDoc = {
      id: 1,
      taskType: 'review-pending',
      sourceId: 'rev-1',
      sourceVersion: 1,
      sourceType: 'listing-review',
      status: 'pending',
      priority: 'normal',
      dueAt: '2026-07-26T15:00:00.000Z',
      assignee: null,
      team: null,
    }
    const updateResult = { ...taskDoc, status: 'in_progress', assignee: 10 }
    const { req, update } = makeReq({ taskDoc, updateResult })
    const { status, body } = await run(createTaskClaimEndpoint, req)
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.task.status).toBe('in_progress')
    expect(update).toHaveBeenCalled()
  })

  it('已被他人领取 → 409', async () => {
    const taskDoc = {
      id: 1,
      taskType: 'review-pending',
      sourceId: 'rev-1',
      sourceVersion: 1,
      sourceType: 'listing-review',
      status: 'in_progress',
      priority: 'normal',
      dueAt: '2026-07-26T15:00:00.000Z',
      assignee: 99,
      team: null,
    }
    const { req, update } = makeReq({ taskDoc })
    const { status, body } = await run(createTaskClaimEndpoint, req)
    expect(status).toBe(409)
    expect(body.code).toBe('TASK_CLAIMED_BY_OTHER')
    expect(update).not.toHaveBeenCalled()
  })

  it('终态任务 → 409', async () => {
    const taskDoc = {
      id: 1,
      taskType: 'review-pending',
      sourceId: 'rev-1',
      sourceVersion: 1,
      sourceType: 'listing-review',
      status: 'completed',
      priority: 'normal',
      dueAt: '2026-07-26T15:00:00.000Z',
      assignee: null,
      team: null,
      completedAt: '2026-07-25T10:00:00.000Z',
    }
    const { req, update } = makeReq({ taskDoc })
    const { status, body } = await run(createTaskClaimEndpoint, req)
    expect(status).toBe(409)
    expect(body.code).toBe('TASK_ALREADY_TERMINAL')
    expect(update).not.toHaveBeenCalled()
  })
})

// ── POST /:id/transfer ──────────────────────────────────────

describe('my-tasks-endpoint/POST /:id/transfer', () => {
  it('缺 toUserId → 400', async () => {
    const { req, update } = makeReq({ body: {} })
    const { status, body } = await run(createTaskTransferEndpoint, req)
    expect(status).toBe(400)
    expect(body.code).toBe('TASK_TRANSFER_TARGET_REQUIRED')
    expect(update).not.toHaveBeenCalled()
  })

  it('任务不存在 → 404', async () => {
    const { req, update } = makeReq({
      body: { toUserId: 20 },
      taskDoc: null,
      findByIDThrows: true,
    })
    const { status } = await run(createTaskTransferEndpoint, req)
    expect(status).toBe(404)
    expect(update).not.toHaveBeenCalled()
  })

  it('终态任务 → 409', async () => {
    const taskDoc = {
      id: 1,
      taskType: 'review-pending',
      sourceId: 'rev-1',
      sourceVersion: 1,
      sourceType: 'listing-review',
      status: 'cancelled',
      priority: 'normal',
      dueAt: '2026-07-26T15:00:00.000Z',
      assignee: 10,
      team: null,
      cancelledAt: '2026-07-25T10:00:00.000Z',
    }
    const { req, update } = makeReq({
      body: { toUserId: 20 },
      taskDoc,
    })
    const { status, body } = await run(createTaskTransferEndpoint, req)
    expect(status).toBe(409)
    expect(body.code).toBe('TASK_ALREADY_TERMINAL')
    expect(update).not.toHaveBeenCalled()
  })

  it('成功转派 → 200', async () => {
    const taskDoc = {
      id: 1,
      taskType: 'review-pending',
      sourceId: 'rev-1',
      sourceVersion: 1,
      sourceType: 'listing-review',
      status: 'pending',
      priority: 'normal',
      dueAt: '2026-07-26T15:00:00.000Z',
      assignee: 10,
      team: null,
    }
    const updateResult = { ...taskDoc, assignee: 20, team: 5 }
    const { req, update } = makeReq({
      body: { toUserId: 20, teamId: 5 },
      taskDoc,
      updateResult,
    })
    const { status, body } = await run(createTaskTransferEndpoint, req)
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(update).toHaveBeenCalled()
  })
})

// ── POST /batch-claim ────────────────────────────────────────

describe('my-tasks-endpoint/POST /batch-claim', () => {
  it('taskIds 非数组 → 400', async () => {
    const { req, update } = makeReq({ body: { taskIds: 'not-array' } })
    const { status, body } = await run(createBatchTaskClaimEndpoint, req)
    expect(status).toBe(400)
    expect(body.code).toBe('INVALID_INPUT')
    expect(update).not.toHaveBeenCalled()
  })

  it('taskIds 数量超限 → 400', async () => {
    const ids = Array.from({ length: 101 }, (_, i) => i + 1)
    const { req, update } = makeReq({ body: { taskIds: ids } })
    const { status, body } = await run(createBatchTaskClaimEndpoint, req)
    expect(status).toBe(400)
    expect(body.code).toBe('BATCH_LIMIT_EXCEEDED')
    expect(update).not.toHaveBeenCalled()
  })

  it('成功批量领取 → 200 + summary', async () => {
    const taskDoc = {
      id: 1,
      taskType: 'review-pending',
      sourceId: 'rev-1',
      sourceVersion: 1,
      sourceType: 'listing-review',
      status: 'pending',
      priority: 'normal',
      dueAt: '2026-07-26T15:00:00.000Z',
      assignee: null,
      team: null,
    }
    const updateResult = { ...taskDoc, status: 'in_progress', assignee: 10 }
    const { req, update } = makeReq({
      body: { taskIds: [1] },
      taskDoc,
      updateResult,
    })
    const { status, body } = await run(createBatchTaskClaimEndpoint, req)
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.summary.succeeded).toBe(1)
    expect(update).toHaveBeenCalled()
  })
})

// ── POST /batch-transfer ────────────────────────────────────

describe('my-tasks-endpoint/POST /batch-transfer', () => {
  it('items 非数组 → 400', async () => {
    const { req, update } = makeReq({ body: { items: 'no' } })
    const { status, body } = await run(createBatchTaskTransferEndpoint, req)
    expect(status).toBe(400)
    expect(body.code).toBe('INVALID_INPUT')
    expect(update).not.toHaveBeenCalled()
  })

  it('成功批量转派 → 200', async () => {
    const taskDoc = {
      id: 1,
      taskType: 'review-pending',
      sourceId: 'rev-1',
      sourceVersion: 1,
      sourceType: 'listing-review',
      status: 'pending',
      priority: 'normal',
      dueAt: '2026-07-26T15:00:00.000Z',
      assignee: 10,
      team: null,
    }
    const updateResult = { ...taskDoc, assignee: 20 }
    const { req, update } = makeReq({
      body: { items: [{ taskId: 1, toUserId: 20 }] },
      taskDoc,
      updateResult,
    })
    const { status, body } = await run(createBatchTaskTransferEndpoint, req)
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.summary.succeeded).toBe(1)
    expect(update).toHaveBeenCalled()
  })
})
