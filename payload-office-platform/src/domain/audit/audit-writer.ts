/**
 * 审计写入助手（tasks.md M8.1 / design §3 audit_logs / R8）
 *
 * 职责：
 *   - 提供 writeAudit 工具：业务侧调用，在业务事务内同事务写入审计日志
 *   - 提供 writeViewDetailAudit / writeExportAudit：审计自身再次审计专用
 *   - writeAuditFailed：业务失败时记录 failed 审计（不抛错，避免污染异常流）
 *
 * 设计原则：
 *   - 调用方传入 WriteAuditParams（含 action / result / object / before/after）
 *   - subject / requestContext 由本助手从 req 自动派生（防客户端篡改）
 *   - overrideAccess: true 写入（业务调用方已有 requireAdminContext 鉴权）
 *   - 写入失败时抛错（M8.2 接入后由调用方决定是否回滚业务事务）
 *
 * 业务不变量：
 *   - 高风险操作审计失败时业务操作必须失败（M8.2 接入）
 *   - 审计日志不可修改、不可删除（access + protect hook 双层兜底）
 *   - 系统扫描器等无 req 场景显式传入 SYSTEM_SUBJECT + SYSTEM_REQUEST_CONTEXT
 */

import type { PayloadRequest, Payload } from 'payload'

import { deriveSubjectSnapshot, deriveRequestContext, SYSTEM_SUBJECT, SYSTEM_REQUEST_CONTEXT } from './audit-context'
import type { WriteAuditParams, AuditAction, AuditResult, ObjectRef, SubjectSnapshot, RequestContextSnapshot } from './audit-types'

/**
 * 用于在 req 对象上挂载"已触发审计自身审计"标记，避免递归：
 *   - afterRead 触发 audit.view_detail 写入
 *   - audit.view_detail 写入本身不应再触发 afterRead（否则递归）
 *
 * 通过 req.__auditing 标记跳过；写入完成后清除。
 */
const AUDITING_FLAG = '__auditing'

type AuditingRequest = PayloadRequest & {
  [AUDITING_FLAG]?: boolean
}

/**
 * 标记当前请求正在进行审计写入，防止 afterRead 再次触发审计。
 */
export function markAuditing(req: PayloadRequest | undefined): void {
  if (!req) return
  ;(req as AuditingRequest)[AUDITING_FLAG] = true
}

/**
 * 清除审计写入标记。
 */
export function unmarkAuditing(req: PayloadRequest | undefined): void {
  if (!req) return
  delete (req as AuditingRequest)[AUDITING_FLAG]
}

/**
 * 当前请求是否正在审计写入（用于 afterRead 跳过递归）。
 */
export function isAuditing(req: PayloadRequest | undefined): boolean {
  if (!req) return false
  return Boolean((req as AuditingRequest)[AUDITING_FLAG])
}

/**
 * 把 WriteAuditParams 转换为 Payload create 调用的 data 载荷。
 *
 * 注意：subjectUserId / subjectRoleCodes / subjectTeamId / subjectCityScope
 * 和 requestContext.* 字段会被 protectAuditLog 服务端兜底覆盖，
 * 这里仍然传入以保证系统扫描器（无 req）场景的完整性。
 */
export function buildAuditCreateData(params: WriteAuditParams): Record<string, unknown> {
  return {
    action: params.action,
    result: params.result,
    subjectUserId: params.subject.userId,
    subjectRoleCodes: params.subject.roleCodes,
    subjectTeamId: params.subject.teamId,
    subjectCityScope: params.subject.cityScope,
    objectCollection: params.object.collection,
    objectId: String(params.object.objectId),
    objectVersion: params.object.objectVersion,
    before: params.before ?? null,
    after: params.after ?? null,
    changedFields: params.changedFields ?? [],
    requestId: params.requestContext.requestId,
    ip: params.requestContext.ip,
    userAgent: params.requestContext.userAgent,
    method: params.requestContext.method,
    path: params.requestContext.path,
    errorCode: params.errorCode ?? null,
    errorMessage: params.errorMessage ?? null,
    eventId: params.eventId ?? null,
  }
}

/**
 * 写入审计日志：业务侧调用工具。
 *
 * 参数：
 *   - payload：Payload 实例（req.payload 或全局 payload）
 *   - req：当前请求（用于派生 subject + requestContext；系统扫描器可传 undefined）
 *   - params：业务侧组装的最小审计参数（subject/requestContext 可省略，由 req 派生）
 *
 * 行为：
 *   - 调用方未传 subject 时：从 req 派生（req 缺失则用 SYSTEM_SUBJECT）
 *   - 调用方未传 requestContext 时：从 req 派生（req 缺失则用 SYSTEM_REQUEST_CONTEXT）
 *   - overrideAccess: true 写入审计日志
 *   - 写入失败抛错（M8.2 接入后由调用方决定是否回滚业务事务）
 *
 * 返回：创建的审计日志文档
 */
export async function writeAudit(params: {
  payload: Payload
  req?: PayloadRequest | undefined
  data: Omit<WriteAuditParams, 'subject' | 'requestContext'> & {
    subject?: SubjectSnapshot
    requestContext?: RequestContextSnapshot
  }
  /** 是否禁用 overrideAccess（默认 false，即启用 override） */
  overrideAccess?: boolean
}): Promise<{ id: string | number; auditId: string }> {
  const { payload, req, data, overrideAccess = true } = params

  // 派生 subject（req 优先；缺失时回退 SYSTEM_SUBJECT）
  const subject: SubjectSnapshot =
    data.subject ?? (req ? await deriveSubjectSnapshot(req) : SYSTEM_SUBJECT)

  // 派生 requestContext（req 优先；缺失时回退 SYSTEM_REQUEST_CONTEXT）
  const requestContext: RequestContextSnapshot =
    data.requestContext ?? (req ? deriveRequestContext(req) : SYSTEM_REQUEST_CONTEXT)

  // 组装 create data
  const createData = buildAuditCreateData({
    ...data,
    subject,
    requestContext,
  })

  // 写入审计日志
  const created = (await payload.create({
    collection: 'audit-logs' as never,
    data: createData as never,
    overrideAccess,
    req,
  })) as { id: string | number; auditId?: string }

  return {
    id: created.id,
    auditId: created.auditId ?? String(created.id),
  }
}

/**
 * 写入审计日志（成功结果）：writeAudit 的语法糖。
 *
 * 调用方在业务操作成功后调用，省略 result 字段（默认 success）。
 */
export async function writeAuditSuccess(params: {
  payload: Payload
  req?: PayloadRequest | undefined
  data: Omit<WriteAuditParams, 'result' | 'subject' | 'requestContext'> & {
    subject?: SubjectSnapshot
    requestContext?: RequestContextSnapshot
  }
  overrideAccess?: boolean
}): Promise<{ id: string | number; auditId: string }> {
  return writeAudit({
    payload: params.payload,
    req: params.req,
    data: { ...params.data, result: 'success' },
    overrideAccess: params.overrideAccess,
  })
}

/**
 * 写入审计日志（失败结果）：业务失败时调用。
 *
 * 不抛错：业务流程已抛错,审计写入失败不应再次污染异常流。
 * 内部捕获错误并 console.warn,业务调用方应继续抛原业务异常。
 *
 * 参数：
 *   - errorCode / errorMessage 必填（result=failed 时 protectAuditLog 强制）
 */
export async function writeAuditFailed(params: {
  payload: Payload
  req?: PayloadRequest | undefined
  data: Omit<WriteAuditParams, 'result' | 'subject' | 'requestContext'> & {
    subject?: SubjectSnapshot
    requestContext?: RequestContextSnapshot
  }
  overrideAccess?: boolean
}): Promise<{ id: string | number; auditId: string } | null> {
  try {
    return await writeAudit({
      payload: params.payload,
      req: params.req,
      data: { ...params.data, result: 'failed' },
      overrideAccess: params.overrideAccess,
    })
  } catch (err) {
    // 审计写入失败：不抛错,只记录
    console.warn('[audit] writeAuditFailed failed:', err)
    return null
  }
}

/**
 * 写入"查看审计日志详情"的审计（audit.view_detail）。
 *
 * 用于 AuditLogs Collection afterRead hook：当用户查看单条审计详情时,
 * 对该次查看本身再次审计（R8 / design §3.6）。
 *
 *   - 通过 req.__auditing 标记跳过递归（writeAudit 内部派生不触发 afterRead）
 *   - 调用方应在 afterRead hook 调用此函数前先检查 isAuditing(req)
 */
export async function writeViewDetailAudit(params: {
  payload: Payload
  req?: PayloadRequest | undefined
  object: ObjectRef
}): Promise<void> {
  try {
    markAuditing(params.req)
    await writeAuditSuccess({
      payload: params.payload,
      req: params.req,
      data: {
        action: 'audit.view_detail',
        object: params.object,
        // before/after 不传:查看本身不修改对象,但 audit:before_after 权限
        // 在 AuditLogs afterRead 字段脱敏层处理
      },
    })
  } finally {
    unmarkAuditing(params.req)
  }
}

/**
 * 写入"导出审计日志"的审计（audit.export）。
 *
 * 用于审计导出 endpoint：对导出操作本身再次审计（R8）。
 */
export async function writeExportAudit(params: {
  payload: Payload
  req?: PayloadRequest | undefined
  object: ObjectRef
  /** 导出的范围（如时间窗口、筛选条件） */
  exportScope?: Record<string, unknown>
}): Promise<void> {
  await writeAuditSuccess({
    payload: params.payload,
    req: params.req,
    data: {
      action: 'audit.export',
      object: params.object,
      after: params.exportScope ?? null,
    },
  })
}
