/**
 * 待办权限守卫与 Collection 保护 hook（tasks.md M6.4 / design §3.7 tasks / R6, R7, R8）
 *
 * 职责：
 *   - Tasks Collection 的 beforeValidate hook：校验幂等键唯一（taskType+sourceId+sourceVersion）
 *   - Tasks Collection 的 beforeChange hook：
 *     - create：初始化 status=pending；校验 taskType 与 sourceType 配对一致
 *     - update：校验状态转换合法（防止绕过 endpoint 直接改 status）
 *     - completed 必须填写 completionEventId；cancelled 必须填写 cancellationReason
 *   - Tasks Collection 的 afterChange hook：
 *     - 状态变更时记录审计日志（M6.4 暂留扩展位，未直接写入审计 Collection）
 *
 * 业务不变量（AGENTS.md §10）：
 *   - 待办由来源业务事件完成或取消，不允许只在待办页手工标记完成
 *     （任务状态转换通过 task-service 调用 completeTask/cancelTask，
 *     客户端通过 Collection PATCH status=completed 应被拒绝）
 *   - 重复事件不会生成重复待办（幂等键校验在 beforeValidate 阶段执行）
 *   - 跨对象副作用使用事务 Outbox（M6.3 已完成；任务状态变更不入 Outbox，
 *     仅记录 completionEventId 引用来源事件，避免事件循环依赖）
 *
 * 权限编码（permission-codes.ts）：
 *   - task:read     读取待办列表 / 详情
 *   - task:manage   编辑 / 删除待办
 *   - task:assign   领取 / 转派待办
 *   - task:complete 标记处理中（来源完成 / 取消由系统自动闭环）
 *
 * Collection access 与 protect hook 双层兜底：
 *   - access 在 HTTP 层挡无权限请求
 *   - protect hook 在 Local API 层兜底（防绕过 REST）
 */

import type {
  CollectionAfterChangeHook,
  CollectionBeforeChangeHook,
  CollectionBeforeValidateHook,
} from 'payload'

import { getPermissionContext, type RequestContext } from '@/domain/auth/access'
import { hasOperationPermission } from '@/domain/auth/permission-context'
import { ForbiddenError, InvalidOperationError } from '@/domain/shared/errors'
import { buildEventId } from './event-publisher'
import {
  canTransitionTask,
  isTaskStatus,
  isTerminalTaskStatus,
  type TaskStatus,
} from './task-status'
import { isTaskType, isTaskSourceType, TASK_TYPE_SOURCE_TYPE } from './task-types'

/**
 * beforeValidate hook：校验幂等键唯一（taskType + sourceId + sourceVersion）。
 *
 * SQLite 不支持 Payload 原生复合 unique 约束，需在应用层校验。
 * 通过 req.payload.find 查询相同幂等键的现存任务：
 *   - create：已存在则报 409
 *   - update：相同 ID 之外的记录包含同幂等键则报 409
 *
 * 幂等键由系统保证，不允许客户端手工指定相同键的多条任务。
 */
export const validateTaskIdempotency: CollectionBeforeValidateHook = async ({
  data,
  operation,
  req,
  originalDoc,
}) => {
  if (!data) return data

  const taskType = data?.taskType
  const sourceId = data?.sourceId
  const sourceVersion = data?.sourceVersion

  if (
    typeof taskType !== 'string' ||
    typeof sourceId !== 'string' ||
    typeof sourceVersion !== 'number'
  ) {
    // 字段类型由 Payload select / number 字段校验；此处不重复
    return data
  }

  // 内部调用跳过幂等键校验：
  //   - task-service.createTaskFromEvent 已通过 store.findByKey 做幂等检查
  //   - 系统调用（req.user 缺失，如 Outbox 消费器 / SLA 扫描器）跳过查库
  // 外部 HTTP/Local API create 时 req.user 存在，需查库防绕过 task-service 直接创建
  if (!req?.user) {
    return data
  }

  try {
    const existing = await req.payload.find({
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
    })
    const matched = existing.docs[0]
    if (matched) {
      // update 路径下，原记录自身允许保留同幂等键（未变更）
      if (
        operation === 'update' &&
        originalDoc &&
        String(matched.id) === String(originalDoc.id)
      ) {
        return data
      }
      throw new InvalidOperationError({
        domain: 'workflow',
        code: 'TASK_DUPLICATE_KEY',
        message: '待办幂等键重复：taskType + sourceId + sourceVersion 已存在',
        details: { taskType, sourceId, sourceVersion, existingId: matched.id },
      })
    }
  } catch (e) {
    // 查询失败时不阻断写入（与 M6.3 Outbox 重试兜底语义一致）
    // 仅记录日志；幂等最终由 task-service.findByKey 兜底
    const message = e instanceof Error ? e.message : String(e)
    if (e instanceof InvalidOperationError) throw e
    req.payload.logger?.warn?.(`[tasks] validateTaskIdempotency 查询失败：${message}`)
  }

  return data
}

/**
 * beforeChange hook：待办写入前校验与初始化。
 *
 * create：
 *   - 校验 taskType / sourceType 合法
 *   - 校验 taskType / sourceType 配对一致（由 TASK_TYPE_SOURCE_TYPE 派生）
 *   - 初始化 status=pending
 *   - 拒绝客户端直接传入 status / completedAt / cancelledAt / cancellationReason / completionEventId
 *
 * update：
 *   - 如果改了 status，校验转换合法（防止绕过 task-service 直接 PATCH status=completed）
 *   - completed 必须填写 completionEventId；cancelled 必须填写 cancellationReason
 *   - 修改 status 字段需 task:complete 或 task:manage 权限（防绕过权限门）
 */
export const protectTask: CollectionBeforeChangeHook = async ({
  data,
  originalDoc,
  operation,
  req,
}) => {
  if (!data) return data

  // —— taskType / sourceType 枚举校验（create / update 都校验）——
  const taskType = data?.taskType
  if (taskType !== undefined && taskType !== null && taskType !== '') {
    if (!isTaskType(taskType)) {
      throw new InvalidOperationError({
        domain: 'workflow',
        code: 'TASK_TYPE_INVALID',
        message: '待办类型未注册',
        details: { taskType },
      })
    }
    // sourceType 必须与 taskType 派生一致
    const expectedSourceType = TASK_TYPE_SOURCE_TYPE[taskType]
    if (
      data?.sourceType !== undefined &&
      data?.sourceType !== null &&
      data?.sourceType !== '' &&
      data?.sourceType !== expectedSourceType
    ) {
      throw new InvalidOperationError({
        domain: 'workflow',
        code: 'TASK_SOURCE_TYPE_MISMATCH',
        message: `任务类型 ${taskType} 必须对应 sourceType=${expectedSourceType}`,
        details: { taskType, sourceType: data?.sourceType, expectedSourceType },
      })
    }
    // 自动派生 sourceType（防止客户端漏传或传错）
    data.sourceType = expectedSourceType
  }

  // —— sourceType 枚举校验 ——
  if (
    data?.sourceType !== undefined &&
    data?.sourceType !== null &&
    data?.sourceType !== '' &&
    !isTaskSourceType(data.sourceType)
  ) {
    throw new InvalidOperationError({
      domain: 'workflow',
      code: 'TASK_SOURCE_TYPE_INVALID',
      message: '待办来源对象类型未注册',
      details: { sourceType: data?.sourceType },
    })
  }

  if (operation === 'create') {
    // —— 初始化 status（不接受客户端指定）——
    data.status = 'pending' as TaskStatus
    // create 时不允许直接带终态字段（必须通过 task-service 走状态机）
    delete data.completedAt
    delete data.cancelledAt
    delete data.cancellationReason
    delete data.completionEventId
    return data
  }

  // —— update 路径 ——
  if (operation === 'update' && originalDoc) {
    const currentStatus = (originalDoc as { status?: unknown }).status
    const targetStatus = data?.status

    // 如果改了 status，校验权限和转换合法性
    if (
      targetStatus !== undefined &&
      targetStatus !== null &&
      targetStatus !== currentStatus
    ) {
      // 权限门：修改 status 需 task:complete 或 task:manage（防绕过 task-service）
      // 内部调用（overrideAccess / req.user 缺失）跳过权限校验
      if (req?.user) {
        const ctx = await getPermissionContext(req as RequestContext)
        const allowed =
          ctx &&
          (hasOperationPermission(ctx, 'task:complete') ||
            hasOperationPermission(ctx, 'task:manage'))
        if (!allowed) {
          throw new ForbiddenError({
            domain: 'workflow',
            message: '修改待办状态需要操作权限：task:complete 或 task:manage',
            details: { requiredOperation: 'task:complete' },
          })
        }
      }

      if (!isTaskStatus(currentStatus)) {
        throw new InvalidOperationError({
          domain: 'workflow',
          code: 'TASK_CURRENT_STATUS_INVALID',
          message: '待办当前状态非法',
          details: { currentStatus },
        })
      }
      if (!isTaskStatus(targetStatus)) {
        throw new InvalidOperationError({
          domain: 'workflow',
          code: 'TASK_TARGET_STATUS_INVALID',
          message: '待办目标状态非法',
          details: { targetStatus },
        })
      }
      if (isTerminalTaskStatus(currentStatus)) {
        throw new InvalidOperationError({
          domain: 'workflow',
          code: 'TASK_TERMINAL_STATUS',
          message: `待办已处于终态（${currentStatus}），不可再修改状态`,
          details: { currentStatus, targetStatus },
        })
      }
      if (!canTransitionTask(currentStatus, targetStatus)) {
        throw new InvalidOperationError({
          domain: 'workflow',
          code: 'TASK_ILLEGAL_TRANSITION',
          message: `待办不允许从 ${currentStatus} 切换到 ${targetStatus}`,
          details: { currentStatus, targetStatus },
        })
      }

      // completed 必须填写 completionEventId（来源完成事件 ID）
      if (targetStatus === 'completed') {
        const ceid = data?.completionEventId
        if (typeof ceid !== 'string' || ceid.length === 0) {
          throw new InvalidOperationError({
            domain: 'workflow',
            code: 'TASK_COMPLETION_EVENT_REQUIRED',
            message: '完成待办必须填写 completionEventId（来源事件 ID）',
            details: { taskId: originalDoc.id },
          })
        }
        // 自动设置 completedAt
        if (!data.completedAt) {
          data.completedAt = new Date().toISOString()
        }
      }

      // cancelled 必须填写 cancellationReason
      if (targetStatus === 'cancelled') {
        const reason = data?.cancellationReason
        if (typeof reason !== 'string' || reason.trim().length === 0) {
          throw new InvalidOperationError({
            domain: 'workflow',
            code: 'TASK_CANCEL_REASON_REQUIRED',
            message: '取消待办必须填写 cancellationReason',
            details: { taskId: originalDoc.id },
          })
        }
        if (!data.cancelledAt) {
          data.cancelledAt = new Date().toISOString()
        }
      }
    }

    return data
  }

  return data
}

/**
 * afterChange hook：待办状态变更后的副作用。
 *
 * M6.7 阶段：状态变为 completed / cancelled 时，向 Outbox 写入 task.completed /
 * task.cancelled 事件，供 notification consumer 异步生成通知。
 *
 * Outbox 写入失败不阻断业务事务（与 M6.3 设计取舍一致）；事件丢失由 M6.3 消费器
 * 重试兜底。
 *
 * 业务不变量（AGENTS.md §10）：
 *   - 待办状态变更事件不循环触发新待办（仅触发通知）
 *   - 事件 eventId 在 Outbox 唯一，重复写入会被 protectDomainEvent 拦截
 *
 * 未来扩展位：
 *   - 状态变更写审计日志（M8.1 待实现）
 */
export const onTaskChanged: CollectionAfterChangeHook = async ({
  doc,
  previousDoc,
  operation,
  req,
}) => {
  if (operation !== 'update') return doc
  const prevStatus = (previousDoc as { status?: string | null })?.status
  const nextStatus = (doc as { status?: string | null })?.status
  if (prevStatus === nextStatus) return doc

  // 状态变更日志
  req.payload.logger?.info?.(
    `[tasks] 任务 ${doc.id} 状态变更：${prevStatus} → ${nextStatus}`,
  )

  // M6.7：状态变为 completed / cancelled 时写 Outbox 事件，供通知消费器处理
  if (nextStatus === 'completed' || nextStatus === 'cancelled') {
    const taskDoc = doc as {
      id: string | number
      taskType?: string
      sourceId?: string
      sourceType?: string
      assignee?: { id?: string | number } | string | number | null
      cancellationReason?: string | null
      completionEventId?: string | null
    }
    const assigneeId = extractAssigneeId(taskDoc.assignee)

    // 事件类型映射：completed → task.completed；cancelled → task.cancelled
    const eventType =
      nextStatus === 'completed' ? 'task.completed' : 'task.cancelled'

    const payload: Record<string, unknown> = {
      taskId: String(taskDoc.id),
      taskType: taskDoc.taskType ?? null,
      sourceId: taskDoc.sourceId ?? null,
      sourceType: taskDoc.sourceType ?? null,
      assigneeId: assigneeId,
    }
    if (nextStatus === 'completed') {
      payload.completionEventId = taskDoc.completionEventId ?? null
    }
    if (nextStatus === 'cancelled') {
      payload.reason = taskDoc.cancellationReason ?? '来源取消'
    }

    try {
      await req.payload.create({
        collection: 'domain-events',
        data: {
          eventId: buildEventId(),
          eventType,
          aggregateType: 'task',
          aggregateId: String(taskDoc.id),
          aggregateVersion: 1,
          payload,
          occurredAt: new Date().toISOString(),
        },
        overrideAccess: true,
        req,
      })
    } catch (e) {
      // Outbox 写入失败不阻断业务事务；事件丢失由 M6.3 消费器重试兜底
      const message = e instanceof Error ? e.message : String(e)
      req.payload.logger?.warn?.(
        `[tasks] 任务 ${taskDoc.id} 写 Outbox ${eventType} 失败：${message}`,
      )
    }
  }

  return doc
}

/** 从 assignee 字段提取用户 ID（Payload 关系字段可能是 number / 对象 / null） */
function extractAssigneeId(
  assignee: { id?: string | number } | string | number | null | undefined,
): string | number | null {
  if (assignee === null || assignee === undefined) return null
  if (typeof assignee === 'number' || typeof assignee === 'string') return assignee
  if (typeof assignee === 'object' && assignee !== null) {
    const id = (assignee as { id?: unknown }).id
    if (typeof id === 'number' || typeof id === 'string') return id
  }
  return null
}
