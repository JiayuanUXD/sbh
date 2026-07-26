import type { Endpoint, PayloadRequest } from 'payload'

import { requireOperationPermission, type RequestContext } from '@/domain/auth/access'
import { InvalidOperationError } from '@/domain/shared/errors'
import {
  batchClaimTasks,
  batchTransferTasks,
  buildSourceDeepLink,
  claimTask,
  MY_TASKS_BATCH_LIMIT,
  sortMyTasks,
  toMyTaskView,
  transferTask,
  type MyTasksActionContext,
  type MyTasksSortContext,
} from '@/domain/workflow/my-tasks'
import {
  createInMemoryTaskStore,
  type TaskRecord,
  type TaskStore,
} from '@/domain/workflow/task-service'
import { isTaskStatus, type TaskStatus } from '@/domain/workflow/task-status'
import type { Task } from '@/payload-types'

/**
 * 我的待办 endpoint（tasks.md M6.6 / design §7.2 Custom Views / R1, R7）
 *
 * 路由（注册在 Tasks collection endpoints 上，HTTP 前缀 /api/tasks）：
 *   - GET    /mine                列出当前用户的待办（按逾期 → 优先级 → 截止 → 创建 排序）
 *   - POST   /:id/claim           单条领取（pending → in_progress + 设置 assigneeId）
 *   - POST   /:id/transfer        单条转派（保留 status，更新 assigneeId / teamId）
 *   - POST   /batch-claim         批量领取（≤ 50 条，逐条返回结果）
 *   - POST   /batch-transfer      批量转派（≤ 50 条，逐条返回结果）
 *
 * 业务不变量（AGENTS.md §10 / R7）：
 *   - 待办由来源业务事件完成或取消，但允许在工作台「领取」转为 in_progress
 *     或「转派」给他人（task:assign 权限门）
 *   - 批量操作上限 50 条且逐条返回成功 / 失败原因（design §10 批量限制）
 *   - 重复领取 / 转派幂等：相同状态再次领取视为成功（不报错）
 *
 * 安全：
 *   - 所有动作要求 task:assign 操作权限（领取 / 转派同属「指派」语义）
 *   - 列表 /mine 要求 task:read（限制为当前用户为负责人的任务）
 *   - 透传 req 让 auditFieldsPlugin / protectTask hook 自动兜底
 */

// ────────────────────────────────────────────────────────────
// PayloadTaskStore：将 req.payload 包装为 TaskStore 接口
// ────────────────────────────────────────────────────────────

/** 将 Payload 文档字段归一为 TaskRecord。 */
function toTaskRecord(doc: unknown): TaskRecord {
  const d = doc as Record<string, unknown>
  return {
    id: (d.id as string | number) ?? 0,
    taskType: d.taskType as TaskRecord['taskType'],
    sourceId: String(d.sourceId ?? ''),
    sourceVersion: Number(d.sourceVersion ?? 1),
    sourceType: String(d.sourceType ?? ''),
    status: (d.status as TaskStatus) ?? 'pending',
    priority: String(d.priority ?? 'normal'),
    dueAt: String(d.dueAt ?? ''),
    assigneeId: toId(d.assignee),
    teamId: toId(d.team),
    completedAt: (d.completedAt as string | null) ?? null,
    cancelledAt: (d.cancelledAt as string | null) ?? null,
    cancellationReason: (d.cancellationReason as string | null) ?? null,
    completionEventId: (d.completionEventId as string | null) ?? null,
    metadata: (d.metadata as Record<string, unknown> | null) ?? null,
  }
}

/** 关系字段归一为 id。 */
function toId(value: unknown): string | number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number' || typeof value === 'string') return value
  if (typeof value === 'object') {
    const id = (value as { id?: unknown }).id
    if (typeof id === 'number' || typeof id === 'string') return id
  }
  return null
}

/**
 * 创建基于 Payload Local API 的 TaskStore 实现。
 *
 * 用于 endpoint handler 调用领域服务（claimTask / transferTask 等），
 * 将数据库读写抽象为 TaskStore 接口，使领域服务可独立于 Payload 测试。
 */
function createPayloadTaskStore(req: PayloadRequest): TaskStore {
  return {
    async findByKey({ taskType, sourceId, sourceVersion }) {
      const res = await req.payload.find({
        collection: 'tasks',
        where: {
          and: [
            { taskType: { equals: taskType } },
            { sourceId: { equals: sourceId } },
            { sourceVersion: { equals: sourceVersion } },
          ],
        },
        limit: 1,
        depth: 0,
        overrideAccess: true,
        req,
      })
      const doc = (res?.docs ?? [])[0]
      return doc ? toTaskRecord(doc) : null
    },

    async getById(id) {
      try {
        const doc = await req.payload.findByID({
          collection: 'tasks',
          id,
          depth: 0,
          overrideAccess: true,
          req,
        })
        return toTaskRecord(doc)
      } catch {
        return null
      }
    },

    async findActiveBySource({ sourceType, sourceId }) {
      const res = await req.payload.find({
        collection: 'tasks',
        where: {
          and: [
            { sourceType: { equals: sourceType } },
            { sourceId: { equals: sourceId } },
            { status: { in: ['pending', 'in_progress'] } },
          ],
        },
        limit: 100,
        depth: 0,
        overrideAccess: true,
        req,
      })
      return (res?.docs ?? []).map((d) => toTaskRecord(d))
    },

    async create(params) {
      const doc = await req.payload.create({
        collection: 'tasks',
        data: {
          taskType: params.taskType,
          sourceId: params.sourceId,
          sourceVersion: params.sourceVersion,
          sourceType: params.sourceType as Task['sourceType'],
          status: params.status,
          priority: params.priority as Task['priority'],
          dueAt: params.dueAt,
          assignee: (params.assigneeId ?? null) as Task['assignee'],
          team: (params.teamId ?? null) as Task['team'],
          metadata: params.metadata ?? null,
        },
        overrideAccess: true,
        req,
      })
      return toTaskRecord(doc)
    },

    async update(params) {
      const data: Record<string, unknown> = {}
      if (params.status !== undefined) data.status = params.status
      if (params.completedAt !== undefined) data.completedAt = params.completedAt
      if (params.cancelledAt !== undefined) data.cancelledAt = params.cancelledAt
      if (params.cancellationReason !== undefined)
        data.cancellationReason = params.cancellationReason
      if (params.completionEventId !== undefined)
        data.completionEventId = params.completionEventId
      if (params.assigneeId !== undefined)
        data.assignee = params.assigneeId as Task['assignee']
      if (params.teamId !== undefined) data.team = params.teamId as Task['team']

      const doc = await req.payload.update({
        collection: 'tasks',
        id: params.id,
        data: data as Partial<Omit<Task, 'id' | 'collection' | 'createdAt' | 'deletedAt' | 'updatedAt'>>,
        overrideAccess: true,
        req,
      })
      return toTaskRecord(doc)
    },
  }
}

// ────────────────────────────────────────────────────────────
// 鉴权辅助
// ────────────────────────────────────────────────────────────

/** 鉴权 + 错误转 HTTP 响应；通过返回 ctx 或 Response。 */
async function authorize(
  req: RequestContext,
  code: string,
): Promise<{ ok: true } | { ok: false; response: Response }> {
  try {
    await requireOperationPermission(req, code)
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : '权限不足'
    const status = message.includes('未登录') ? 401 : 403
    return { ok: false, response: Response.json({ ok: false, error: message }, { status }) }
  }
}

// ────────────────────────────────────────────────────────────
// 1. GET /mine — 列出我的待办
// ────────────────────────────────────────────────────────────

/**
 * 我的待办列表 endpoint。
 *
 * 查询：assignee = 当前用户 ID；status ∈ [pending, in_progress]（默认排除终态）。
 *
 * 响应：
 *   - 200: { ok: true, tasks: MyTaskView[] }
 *   - 401: 未登录  403: 无 task:read 权限
 */
export function createMyTasksListEndpoint(): Endpoint {
  return {
    path: '/mine',
    method: 'get',
    handler: async (req) => {
      const auth = await authorize(req as RequestContext, 'task:read')
      if (!auth.ok) return auth.response

      const userId = req.user?.id
      if (userId === undefined || userId === null) {
        return Response.json({ ok: false, error: '未登录' }, { status: 401 })
      }

      // 查询当前用户为负责人的非终态任务
      const res = await req.payload.find({
        collection: 'tasks',
        where: {
          and: [
            { assignee: { equals: userId } },
            { status: { in: ['pending', 'in_progress'] } },
          ],
        },
        limit: 200,
        depth: 0,
        req,
      })

      const records = (res?.docs ?? []).map((d) =>
        toTaskRecord(d as unknown as Record<string, unknown>),
      )

      const now = new Date().toISOString()
      const sortCtx: MyTasksSortContext = { now }
      const sorted = sortMyTasks(records, sortCtx)
      const views = sorted.map((t) => toMyTaskView(t, sortCtx))

      return Response.json({ ok: true, tasks: views })
    },
  }
}

// ────────────────────────────────────────────────────────────
// 2. POST /:id/claim — 单条领取
// ────────────────────────────────────────────────────────────

/**
 * 单条领取 endpoint。
 *
 * 请求体：空
 * 响应：
 *   - 200: { ok: true, task: MyTaskView }
 *   - 400: 缺任务 ID
 *   - 401: 未登录  403: 无 task:assign 权限
 *   - 404: 任务不存在
 *   - 409: 已被他人领取 / 终态 / 非法状态转换
 */
export function createTaskClaimEndpoint(): Endpoint {
  return {
    path: '/:id/claim',
    method: 'post',
    handler: async (req) => {
      const auth = await authorize(req as RequestContext, 'task:assign')
      if (!auth.ok) return auth.response

      const rawId = (req.routeParams as Record<string, unknown> | undefined)?.id
      const taskId =
        typeof rawId === 'string' || typeof rawId === 'number' ? rawId : undefined
      if (taskId === undefined || taskId === '') {
        return Response.json({ ok: false, error: '缺少任务 ID' }, { status: 400 })
      }

      const userId = req.user?.id
      if (userId === undefined || userId === null) {
        return Response.json({ ok: false, error: '未登录' }, { status: 401 })
      }

      const store = createPayloadTaskStore(req)
      const ctx: MyTasksActionContext = {
        userId,
        now: new Date().toISOString(),
        taskStore: store,
      }

      const result = await claimTask(taskId, ctx)
      if (!result.ok) {
        const code = result.error.code
        const isNotFound = code === 'TASK_NOT_FOUND'
        const isConflict = [
          'TASK_ALREADY_TERMINAL',
          'TASK_CLAIMED_BY_OTHER',
          'TASK_ILLEGAL_TRANSITION',
        ].includes(code)
        const status = isNotFound ? 404 : isConflict ? 409 : 400
        return Response.json(
          { ok: false, error: result.error.message, code },
          { status },
        )
      }

      const now = ctx.now
      const view = toMyTaskView(result.data, { now })
      return Response.json({ ok: true, task: view })
    },
  }
}

// ────────────────────────────────────────────────────────────
// 3. POST /:id/transfer — 单条转派
// ────────────────────────────────────────────────────────────

/**
 * 单条转派 endpoint。
 *
 * 请求体：{ toUserId: number|string, teamId?: number|string|null }
 * 响应：
 *   - 200: { ok: true, task: MyTaskView }
 *   - 400: 缺任务 ID / 缺 toUserId
 *   - 401: 未登录  403: 无 task:assign 权限
 *   - 404: 任务不存在
 *   - 409: 终态任务不可转派
 */
export function createTaskTransferEndpoint(): Endpoint {
  return {
    path: '/:id/transfer',
    method: 'post',
    handler: async (req) => {
      const auth = await authorize(req as RequestContext, 'task:assign')
      if (!auth.ok) return auth.response

      const rawId = (req.routeParams as Record<string, unknown> | undefined)?.id
      const taskId =
        typeof rawId === 'string' || typeof rawId === 'number' ? rawId : undefined
      if (taskId === undefined || taskId === '') {
        return Response.json({ ok: false, error: '缺少任务 ID' }, { status: 400 })
      }

      const body = (await parseBody(req)) as {
        toUserId?: unknown
        teamId?: unknown
      }
      const toUserId = toId(body.toUserId)
      if (toUserId === null) {
        return Response.json(
          { ok: false, error: '转派必须指定目标用户（toUserId）', code: 'TASK_TRANSFER_TARGET_REQUIRED' },
          { status: 400 },
        )
      }
      const teamId = body.teamId === null ? null : toId(body.teamId)

      const userId = req.user?.id
      if (userId === undefined || userId === null) {
        return Response.json({ ok: false, error: '未登录' }, { status: 401 })
      }

      const store = createPayloadTaskStore(req)
      const ctx: MyTasksActionContext = {
        userId,
        now: new Date().toISOString(),
        taskStore: store,
      }

      const result = await transferTask(taskId, { toUserId, teamId }, ctx)
      if (!result.ok) {
        const code = result.error.code
        const isNotFound = code === 'TASK_NOT_FOUND'
        const isConflict = ['TASK_ALREADY_TERMINAL'].includes(code)
        const status = isNotFound ? 404 : isConflict ? 409 : 400
        return Response.json(
          { ok: false, error: result.error.message, code },
          { status },
        )
      }

      const now = ctx.now
      const view = toMyTaskView(result.data, { now })
      return Response.json({ ok: true, task: view })
    },
  }
}

// ────────────────────────────────────────────────────────────
// 4. POST /batch-claim — 批量领取
// ────────────────────────────────────────────────────────────

/**
 * 批量领取 endpoint。
 *
 * 请求体：{ taskIds: Array<number|string> }
 * 响应：
 *   - 200: { ok: true, summary: BatchSummary }
 *   - 400: taskIds 非数组
 *   - 401: 未登录  403: 无 task:assign 权限
 */
export function createBatchTaskClaimEndpoint(): Endpoint {
  return {
    path: '/batch-claim',
    method: 'post',
    handler: async (req) => {
      const auth = await authorize(req as RequestContext, 'task:assign')
      if (!auth.ok) return auth.response

      const userId = req.user?.id
      if (userId === undefined || userId === null) {
        return Response.json({ ok: false, error: '未登录' }, { status: 401 })
      }

      const body = await parseBody(req)
      const taskIds = body.taskIds
      if (!Array.isArray(taskIds)) {
        return Response.json(
          { ok: false, error: 'taskIds 必须为数组', code: 'INVALID_INPUT' },
          { status: 400 },
        )
      }
      // 限制入参大小（防止恶意超大请求）
      if (taskIds.length > MY_TASKS_BATCH_LIMIT * 2) {
        return Response.json(
          {
            ok: false,
            error: `taskIds 数量超过限制（${MY_TASKS_BATCH_LIMIT * 2}）`,
            code: 'BATCH_LIMIT_EXCEEDED',
          },
          { status: 400 },
        )
      }

      const store = createPayloadTaskStore(req)
      const ctx: MyTasksActionContext = {
        userId,
        now: new Date().toISOString(),
        taskStore: store,
      }

      const summary = await batchClaimTasks(taskIds, ctx)
      return Response.json({ ok: true, summary })
    },
  }
}

// ────────────────────────────────────────────────────────────
// 5. POST /batch-transfer — 批量转派
// ────────────────────────────────────────────────────────────

/**
 * 批量转派 endpoint。
 *
 * 请求体：{ items: Array<{ taskId, toUserId, teamId? }> }
 * 响应：
 *   - 200: { ok: true, summary: BatchSummary }
 *   - 400: items 非数组
 *   - 401: 未登录  403: 无 task:assign 权限
 */
export function createBatchTaskTransferEndpoint(): Endpoint {
  return {
    path: '/batch-transfer',
    method: 'post',
    handler: async (req) => {
      const auth = await authorize(req as RequestContext, 'task:assign')
      if (!auth.ok) return auth.response

      const userId = req.user?.id
      if (userId === undefined || userId === null) {
        return Response.json({ ok: false, error: '未登录' }, { status: 401 })
      }

      const body = await parseBody(req)
      const items = body.items
      if (!Array.isArray(items)) {
        return Response.json(
          { ok: false, error: 'items 必须为数组', code: 'INVALID_INPUT' },
          { status: 400 },
        )
      }
      if (items.length > MY_TASKS_BATCH_LIMIT * 2) {
        return Response.json(
          {
            ok: false,
            error: `items 数量超过限制（${MY_TASKS_BATCH_LIMIT * 2}）`,
            code: 'BATCH_LIMIT_EXCEEDED',
          },
          { status: 400 },
        )
      }

      // 归一化每条入参（toUserId 必填、teamId 可选）
      const normalized = items.map((item: Record<string, unknown>) => {
        const toUserId = toId(item.toUserId)
        if (toUserId === null) {
          throw new InvalidOperationError({
            domain: 'workflow',
            code: 'TASK_TRANSFER_TARGET_REQUIRED',
            message: '转派必须指定目标用户（toUserId）',
            details: { item },
          })
        }
        const teamId =
          item.teamId === null ? null : toId(item.teamId)
        return {
          taskId: item.taskId as string | number,
          toUserId,
          teamId,
        }
      }).map((it) => it)

      const store = createPayloadTaskStore(req)
      const ctx: MyTasksActionContext = {
        userId,
        now: new Date().toISOString(),
        taskStore: store,
      }

      const summary = await batchTransferTasks(normalized, ctx)
      return Response.json({ ok: true, summary })
    },
  }
}

// ────────────────────────────────────────────────────────────
// 内部辅助：解析请求体
// ────────────────────────────────────────────────────────────

async function parseBody(req: PayloadRequest): Promise<Record<string, unknown>> {
  try {
    if (typeof req.json === 'function') {
      return (await req.json()) as Record<string, unknown>
    }
  } catch {
    // 忽略解析失败
  }
  if ((req as unknown as { data?: unknown }).data) {
    return (req as unknown as { data: Record<string, unknown> }).data
  }
  return {}
}

// 导出内部辅助供测试使用（保持模块封装性，仅暴露必要的工厂）
export { createPayloadTaskStore, toTaskRecord, toId }

// 用于 typecheck 防止未使用导入告警
void createInMemoryTaskStore
void buildSourceDeepLink
void isTaskStatus
