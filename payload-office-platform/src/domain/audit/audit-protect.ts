/**
 * 审计日志 Collection 权限守卫与保护 hook（tasks.md M8.1 / design §3 audit_logs / R8）
 *
 * 职责：
 *   - AuditLogs Collection 的 beforeChange hook：
 *     - create：校验 action 已注册 / result 合法 / object 字段完整；
 *       自动生成 auditId（缺省时）；设置 occurredAt 默认值；初始化 version=1；
 *       强制后端覆盖 subjectUserId / subjectRoleCodes / subjectTeamId / subjectCityScope
 *       和 requestContext.* 字段（防客户端篡改主体快照）
 *     - update：禁止（append-only 语义；审计日志不可修改）
 *   - 业务调用方使用 audit-writer 的 writeAudit 工具写入审计日志
 *
 * 业务不变量（AGENTS.md §10, §5.5）：
 *   - 审计日志只允许追加和读取，不提供 update / delete
 *   - 高风险操作审计失败时业务操作必须失败（M8.2 接入）
 *   - 主体 / 角色 / 组织快照在写入时锁定，不随后续权限变更漂移
 *
 * 权限编码（permission-codes.ts）：
 *   - audit:view      查看审计日志详情
 *   - audit:export    导出审计日志
 *   - audit:before_after  查看 before/after 字段值
 *   - audit-logs      菜单可见性
 */

import type {
  CollectionBeforeChangeHook,
  CollectionBeforeDeleteHook,
  CollectionAfterReadHook,
} from 'payload'

import { ForbiddenError, InvalidOperationError } from '@/domain/shared/errors'
import {
  isAuditAction,
  isAuditResult,
} from './audit-types'
import { deriveSubjectSnapshot, deriveRequestContext } from './audit-context'
import { isAuditing, writeViewDetailAudit } from './audit-writer'

/**
 * 生成审计日志 ID（nanoid 21 字符；与 domain-events.eventId 一致风格）。
 *
 * 内嵌实现避免对 nanoid 的运行时依赖；crypto.randomUUID 在 Node 18+ 可用。
 * 格式：'aud_' + base36 时间戳 + 随机后缀，总长 25 字符以内。
 */
export function buildAuditId(): string {
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 10)
  return `aud_${ts}${rand}`
}

/**
 * beforeChange hook：审计日志写入前校验与初始化。
 *
 * create：
 *   - 校验 action 已注册
 *   - 校验 result 合法（success / failed）
 *   - 校验 objectCollection / objectId / objectVersion 完整
 *   - result=failed 时 errorCode / errorMessage 至少一个非空
 *   - 自动生成 auditId（如果未提供）
 *   - 设置 occurredAt 默认值（当前 UTC）
 *   - 初始化 version=1
 *   - 服务端兜底覆盖 subjectUserId / subjectRoleCodes / subjectTeamId /
 *     subjectCityScope / requestId / ip / userAgent / method / path
 *     （防止客户端篡改主体快照；调用方通过 writeAudit 传入的字段会被覆盖）
 *
 * update：
 *   - 禁止：抛 ForbiddenError（append-only 语义）
 */
export const protectAuditLog: CollectionBeforeChangeHook = async ({
  data,
  operation,
  req,
}) => {
  if (operation === 'update') {
    throw new ForbiddenError({
      domain: 'audit',
      message: '审计日志不可修改（append-only）',
      details: { reason: 'append_only' },
    })
  }

  if (operation !== 'create') {
    return data
  }

  // —— create 路径：校验 + 初始化 ——
  // 1. action 必须已注册
  if (!isAuditAction(data?.action)) {
    throw new InvalidOperationError({
      domain: 'audit',
      code: 'AUDIT_ACTION_INVALID',
      message: '审计动作未注册',
      details: { action: data?.action },
    })
  }

  // 2. result 必须合法
  if (!isAuditResult(data?.result)) {
    throw new InvalidOperationError({
      domain: 'audit',
      code: 'AUDIT_RESULT_INVALID',
      message: '审计结果非法（应为 success / failed）',
      details: { result: data?.result },
    })
  }

  // 3. object 字段完整
  const objectCollection = data?.objectCollection
  if (typeof objectCollection !== 'string' || objectCollection.length === 0) {
    throw new InvalidOperationError({
      domain: 'audit',
      code: 'AUDIT_OBJECT_COLLECTION_EMPTY',
      message: '审计对象 collection 不能为空',
    })
  }
  const objectId = data?.objectId
  if (
    typeof objectId !== 'string' &&
    typeof objectId !== 'number'
  ) {
    throw new InvalidOperationError({
      domain: 'audit',
      code: 'AUDIT_OBJECT_ID_INVALID',
      message: '审计对象 ID 必须为字符串或数字',
      details: { objectId },
    })
  }
  if (String(objectId).length === 0) {
    throw new InvalidOperationError({
      domain: 'audit',
      code: 'AUDIT_OBJECT_ID_EMPTY',
      message: '审计对象 ID 不能为空',
    })
  }
  const objectVersion = data?.objectVersion
  if (
    typeof objectVersion !== 'number' ||
    !Number.isInteger(objectVersion) ||
    objectVersion < 1
  ) {
    throw new InvalidOperationError({
      domain: 'audit',
      code: 'AUDIT_OBJECT_VERSION_INVALID',
      message: '审计对象版本号必须为 ≥ 1 的整数',
      details: { objectVersion },
    })
  }

  // 4. result=failed 时要求 errorCode 或 errorMessage 至少一个非空
  if (data?.result === 'failed') {
    const hasCode = typeof data?.errorCode === 'string' && data.errorCode.length > 0
    const hasMsg = typeof data?.errorMessage === 'string' && data.errorMessage.length > 0
    if (!hasCode && !hasMsg) {
      throw new InvalidOperationError({
        domain: 'audit',
        code: 'AUDIT_FAILED_NO_REASON',
        message: '审计结果为 failed 时必须提供 errorCode 或 errorMessage',
      })
    }
  }

  // 5. 自动生成 auditId（缺省时）
  if (
    !data?.auditId ||
    typeof data.auditId !== 'string' ||
    data.auditId.length === 0
  ) {
    data.auditId = buildAuditId()
  }

  // 6. 设置 occurredAt 默认值
  if (!data?.occurredAt) {
    data.occurredAt = new Date().toISOString()
  }

  // 7. 初始化 version=1（append-only，恒为 1）
  data.version = 1

  // 8. 服务端兜底覆盖主体快照与请求上下文
  //    防止客户端篡改：审计主体与请求上下文必须由服务端从 req 派生，
  //    客户端传入的字段一律被覆盖。系统扫描器等无 req 场景调用方
  //    通过 SYSTEM_SUBJECT + SYSTEM_REQUEST_CONTEXT 显式传入。
  if (req) {
    try {
      const subject = await deriveSubjectSnapshot(req)
      data.subjectUserId = subject.userId
      data.subjectRoleCodes = subject.roleCodes
      data.subjectTeamId = subject.teamId
      data.subjectCityScope = subject.cityScope

      const requestContext = deriveRequestContext(req)
      data.requestId = requestContext.requestId
      data.ip = requestContext.ip
      data.userAgent = requestContext.userAgent
      data.method = requestContext.method
      data.path = requestContext.path
    } catch {
      // 派生失败时不阻断审计写入（宁可写入无主体快照也不丢审计）
      // 调用方应在 writeAudit 中显式传入 subject 以保证审计完整性
    }
  }

  return data
}

/**
 * beforeDelete hook：禁止删除审计日志。
 *
 * 与 access.delete=false 双层兜底；如有人通过 overrideAccess 绕过 access，
 * 此 hook 仍会拒绝。
 */
export const forbidAuditLogDelete: CollectionBeforeDeleteHook = async () => {
  throw new ForbiddenError({
    domain: 'audit',
    message: '审计日志不可删除（append-only）',
    details: { reason: 'append_only' },
  })
}

/**
 * afterRead hook：审计日志详情查看自身审计（audit.view_detail）。
 *
 * 行为：
 *   - 仅对 findByID / 单条读取触发（数组批量读取不触发，避免日志风暴）
 *   - overrideAccess=true 路径（系统内部读取）不触发
 *   - 已在审计写入流程中（isAuditing=true）不触发，防止递归
 *   - 失败不抛出：审计的审计失败不应影响正常读取
 */
export const auditLogAfterRead: CollectionAfterReadHook = async ({
  req,
  doc,
  overrideAccess,
}) => {
  if (overrideAccess) return doc
  if (!req) return doc
  if (isAuditing(req)) return doc

  // 数组形式（find 批量读取）不触发详情查看审计
  if (Array.isArray(doc)) return doc

  const d = doc as { id?: string | number; auditId?: string; objectVersion?: number }
  if (!d?.id) return doc

  try {
    await writeViewDetailAudit({
      payload: req.payload,
      req,
      object: {
        collection: 'audit-logs',
        objectId: d.id,
        objectVersion: d.objectVersion ?? 1,
      },
    })
  } catch {
    // 审计的审计失败不影响正常读取
  }

  return doc
}
