/**
 * 审计日志类型枚举（tasks.md M8.1 / design §3 audit_logs / R8）
 *
 * 单一真源：覆盖审核 / 发布 / 下架 / 商户冻结 / 举报 / 分配 / 认领 / 转派 /
 * 权限和账号停用等高风险业务动作的审计类型。
 *
 * 命名约定：
 *   - 通用动作：create / update / delete
 *   - 业务动作：{domain}.{action} 小写 kebab-case（如 listing.review_approve / lead.assign）
 *   - 审计自身：audit.view_detail / audit.export（用于"对日志详情、敏感值查看和导出本身再次审计"）
 *
 * 业务不变量（AGENTS.md §10 / design §3.6 / R8）：
 *   - 审计日志只允许追加和读取，不提供 update / delete
 *   - 高风险操作审计失败时业务操作必须失败（M8.2）
 *   - 主体 / 角色 / 组织快照在写入时锁定，不随后续权限变更漂移
 */

/** 房源审核与发布动作 */
export const LISTING_AUDIT_ACTIONS = [
  'listing.create',
  'listing.update',
  'listing.delete',
  'listing.review_submit',
  'listing.review_approve',
  'listing.review_reject',
  // OPT-033：平台管理员保存房源时自动上架。与 review_approve 分开记，
  // 否则审计流里「有人审过」和「管理员直发、没人审」长得一模一样。
  'listing.review_fast_track',
  'listing.publish',
  'listing.unpublish',
] as const

/** 楼盘动作 */
export const BUILDING_AUDIT_ACTIONS = [
  'building.create',
  'building.update',
  'building.delete',
  'building.freeze',
  'building.restore',
] as const

/** 商户动作 */
export const MERCHANT_AUDIT_ACTIONS = [
  'merchant.create',
  'merchant.update',
  'merchant.freeze',
  'merchant.restore',
] as const

/** 举报动作 */
export const REPORT_AUDIT_ACTIONS = [
  'report.triage',
  'report.sustain',
  'report.dismiss',
  'report.pause_supply',
  'report.resume_supply',
  'report.close',
] as const

/** 线索与客户动作 */
export const LEAD_AUDIT_ACTIONS = [
  'lead.create',
  'lead.update',
  'lead.assign',
  'lead.claim',
  'lead.transfer',
  'lead.to_public_pool',
  'lead.reclaim',
  'lead.lose',
  'lead.stage_transition',
  'customer.create',
  'customer.update',
] as const

/** 跟进记录动作 */
export const FOLLOWUP_AUDIT_ACTIONS = ['followup.create', 'followup.correct'] as const

/** 权限与账号动作 */
export const AUTH_AUDIT_ACTIONS = [
  'user.create',
  'user.disable',
  'user.enable',
  'user.reset_password',
  'role.create',
  'role.update',
  'role.delete',
  'role.assign',
  'role.revoke',
] as const

/** 数据导入导出动作 */
export const DATA_AUDIT_ACTIONS = ['data.import', 'data.export'] as const

/** 审计自身动作（对审计日志的查看 / 导出本身再次审计） */
export const AUDIT_AUDIT_ACTIONS = ['audit.view_detail', 'audit.export'] as const

/** 全部审计动作类型 */
export const AUDIT_ACTIONS = [
  ...LISTING_AUDIT_ACTIONS,
  ...BUILDING_AUDIT_ACTIONS,
  ...MERCHANT_AUDIT_ACTIONS,
  ...REPORT_AUDIT_ACTIONS,
  ...LEAD_AUDIT_ACTIONS,
  ...FOLLOWUP_AUDIT_ACTIONS,
  ...AUTH_AUDIT_ACTIONS,
  ...DATA_AUDIT_ACTIONS,
  ...AUDIT_AUDIT_ACTIONS,
] as const

export type AuditAction = (typeof AUDIT_ACTIONS)[number]

/** 审计动作中文标签（用于后台展示和审计） */
export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  'listing.create': '房源已创建',
  'listing.update': '房源已修改',
  'listing.delete': '房源已删除',
  'listing.review_submit': '房源审核已提交',
  'listing.review_approve': '房源审核已通过',
  'listing.review_reject': '房源审核已驳回',
  'listing.review_fast_track': '房源由管理员直发上架',
  'listing.publish': '房源已发布',
  'listing.unpublish': '房源已下架',
  'building.create': '楼盘已创建',
  'building.update': '楼盘已修改',
  'building.delete': '楼盘已删除',
  'building.freeze': '楼盘已停用',
  'building.restore': '楼盘已恢复',
  'merchant.create': '商户已创建',
  'merchant.update': '商户已修改',
  'merchant.freeze': '商户已冻结',
  'merchant.restore': '商户已恢复',
  'report.triage': '举报已分诊',
  'report.sustain': '举报已成立',
  'report.dismiss': '举报不成立',
  'report.pause_supply': '举报已暂停供给',
  'report.resume_supply': '举报已恢复供给',
  'report.close': '举报已关闭',
  'lead.create': '线索已创建',
  'lead.update': '线索已修改',
  'lead.assign': '线索已分配',
  'lead.claim': '线索已认领',
  'lead.transfer': '线索已转派',
  'lead.to_public_pool': '线索已进入公海',
  'lead.reclaim': '线索已回收',
  'lead.lose': '线索已流失',
  'lead.stage_transition': '线索阶段已切换',
  'customer.create': '客户已创建',
  'customer.update': '客户已修改',
  'followup.create': '跟进已记录',
  'followup.correct': '跟进已纠错',
  'user.create': '账号已创建',
  'user.disable': '账号已停用',
  'user.enable': '账号已启用',
  'user.reset_password': '账号已重置密码',
  'role.create': '角色已创建',
  'role.update': '角色已修改',
  'role.delete': '角色已删除',
  'role.assign': '角色已分配',
  'role.revoke': '角色已撤销',
  'data.import': '数据已导入',
  'data.export': '数据已导出',
  'audit.view_detail': '审计日志详情已查看',
  'audit.export': '审计日志已导出',
}

/** 是否为已注册的审计动作 */
export function isAuditAction(value: unknown): value is AuditAction {
  return typeof value === 'string' && (AUDIT_ACTIONS as readonly string[]).includes(value)
}

/** 审计结果 */
export const AUDIT_RESULTS = ['success', 'failed'] as const
export type AuditResult = (typeof AUDIT_RESULTS)[number]

export const AUDIT_RESULT_LABELS: Record<AuditResult, string> = {
  success: '成功',
  failed: '失败',
}

/** 是否为已注册的审计结果 */
export function isAuditResult(value: unknown): value is AuditResult {
  return value === 'success' || value === 'failed'
}

/**
 * 从审计动作推导业务域。
 *
 * 用于审计 beforeChange hook 兜底校验：
 *   - listing.*  → supply
 *   - building.* → supply
 *   - merchant.* → supply
 *   - report.*   → report
 *   - lead.*     → crm
 *   - customer.* → crm
 *   - followup.* → crm
 *   - user.*     → auth
 *   - role.*     → auth
 *   - data.*     → audit（数据流转由审计域统管）
 *   - audit.*    → audit
 */
export function auditDomainFromAction(action: string): string {
  const idx = action.indexOf('.')
  if (idx <= 0) return 'unknown'
  const prefix = action.slice(0, idx)
  switch (prefix) {
    case 'listing':
    case 'building':
    case 'merchant':
      return 'supply'
    case 'report':
      return 'report'
    case 'lead':
    case 'customer':
    case 'followup':
      return 'crm'
    case 'user':
    case 'role':
      return 'auth'
    case 'data':
    case 'audit':
      return 'audit'
    default:
      return 'unknown'
  }
}

/**
 * 审计主体快照：写入时锁定，不随后续权限变更漂移。
 *
 * 字段含义：
 *   - userId：操作人账号 ID（必填，匿名系统动作留空）
 *   - roleCodes：操作时的角色编码列表（允许并集快照）
 *   - teamId：操作时的所属团队（如有；用于团队数据范围审计）
 *   - cityScope：操作时的城市范围快照（['all'] 或城市 ID 列表；json 字段不接受裸字符串）
 */
export interface SubjectSnapshot {
  userId: string | number | null
  roleCodes: string[]
  teamId: string | number | null
  cityScope: Array<number | string>
}

/**
 * 审计对象引用：被操作的业务对象。
 *
 *   - collection：对象所属 Collection slug（如 listings / leads）
 *   - objectId：对象 ID（字符串形式，兼容 number / uuid）
 *   - objectVersion：对象版本（乐观锁，用于关联事件流）
 */
export interface ObjectRef {
  collection: string
  objectId: string | number
  objectVersion: number
}

// 审计请求上下文：操作发起的请求级元数据。
//   - requestId：请求追踪 ID（用于跨日志关联一个请求内的多次操作）
//   - ip：客户端 IP（取 x-forwarded-for 第一跳；用于溯源）
//   - userAgent：客户端 UA
//   - method：HTTP 方法（GET / POST / PUT / DELETE）
//   - path：请求路径
export interface RequestContextSnapshot {
  requestId: string | null
  ip: string | null
  userAgent: string | null
  method: string | null
  path: string | null
}

/** 审计写入参数：业务侧调用 writeAudit 时组装的最小集合 */
export interface WriteAuditParams {
  action: AuditAction
  result: AuditResult
  subject: SubjectSnapshot
  object: ObjectRef
  /** 变更前快照（update / delete 时由调用方提供） */
  before?: Record<string, unknown> | null
  /** 变更后快照（create / update 时由调用方提供） */
  after?: Record<string, unknown> | null
  /** 变更字段路径列表（如 ['stage', 'assigneeId']） */
  changedFields?: string[]
  requestContext: RequestContextSnapshot
  /** 失败时的错误码（result=failed 时必填） */
  errorCode?: string | null
  /** 失败时的错误信息（result=failed 时必填） */
  errorMessage?: string | null
  /** 关联事件 ID（如已写入 Outbox，可关联追溯） */
  eventId?: string | null
}
