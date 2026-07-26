/**
 * 审计上下文派生（tasks.md M8.1 / design §3 audit_logs / R8）
 *
 * 职责：
 *   - 从 Payload 请求派生审计主体快照（userId / roleCodes / teamId / cityScope）
 *   - 从 Payload 请求派生请求上下文（requestId / ip / userAgent / method / path）
 *   - 提供 CityScope → 快照数组化的纯函数（避免在审计写入处重复 if/else）
 *
 * 设计原则：
 *   - 不信任客户端参数：subject 只从 req.user + PermissionContext 派生
 *   - cityScope 快照为 'all' 或数字数组（避免 Set 在 JSON 中序列化为 {} ）
 *   - IP 取 x-forwarded-for 第一跳（CloudRun / 代理场景），fallback socket.remoteAddress
 *
 * 业务不变量：
 *   - subject 写入后不可变（protectAuditLog 强制）
 *   - 主体 / 角色 / 组织快照在写入时锁定，不随后续权限变更漂移
 */

import type { PayloadRequest } from 'payload'

import { getPermissionContext, type RequestContext } from '@/domain/auth/access'
import type { CityScope } from '@/domain/auth/permission-context'
import type { SubjectSnapshot, RequestContextSnapshot } from './audit-types'

/**
 * 把 PermissionContext 的 CityScope 转为审计快照可序列化形态。
 *
 *   - 'all' → 'all'
 *   - Set → 升序数字数组（保留原顺序在 JSON 中可能不稳定，故显式排序）
 */
export function snapshotCityScope(scope: CityScope): 'all' | Array<number | string> {
  if (scope === 'all') return 'all'
  return Array.from(scope).sort((a, b) => {
    const an = typeof a === 'number' ? a : Number(a)
    const bn = typeof b === 'number' ? b : Number(b)
    return an - bn
  })
}

/**
 * 从 Payload 请求派生审计主体快照。
 *
 * 步骤：
 *   1. 调用 getPermissionContext 派生 PermissionContext（请求级缓存）
 *   2. 提取 userId / roleCodes / cityScope
 *   3. teamId 暂留 null（M2.5 引入 teams 后由 user.teams 派生）
 *
 * 未登录请求（如系统扫描器）返回 userId=null + 空数组（用于审计系统动作）。
 */
export async function deriveSubjectSnapshot(
  req: RequestContext,
): Promise<SubjectSnapshot> {
  const ctx = await getPermissionContext(req)
  if (!ctx) {
    return {
      userId: null,
      roleCodes: [],
      teamId: null,
      cityScope: 'all',
    }
  }
  return {
    userId: ctx.userId,
    roleCodes: ctx.roleCodes.slice(),
    teamId: null,
    cityScope: snapshotCityScope(ctx.cityIds),
  }
}

/**
 * 从 Payload 请求头派生客户端 IP。
 *
 * 顺序：
 *   1. x-forwarded-for 第一跳（CloudRun / Nginx / CDN 场景）
 *   2. x-real-ip（部分代理设置）
 *   3. req.socket.remoteAddress（直连兜底）
 */
export function deriveClientIp(req: PayloadRequest): string | null {
  const headers = (req?.headers as unknown as Record<string, unknown>) ?? {}
  const xff = headers['x-forwarded-for']
  if (typeof xff === 'string' && xff.length > 0) {
    const first = xff.split(',')[0]?.trim()
    if (first) return first
  }
  const xri = headers['x-real-ip']
  if (typeof xri === 'string' && xri.length > 0) {
    return xri.trim()
  }
  // 兜底：socket.remoteAddress 可能是 IPv6 ::ffff:1.2.3.4 形式
  const socketAddr = (req as { socket?: { remoteAddress?: string } }).socket?.remoteAddress
  return socketAddr ?? null
}

/**
 * 从 Payload 请求派生请求上下文快照。
 *
 *   - requestId：headers['x-request-id']（如 CloudBase 注入）；缺省 null
 *   - ip：x-forwarded-for 第一跳 / x-real-ip / socket.remoteAddress
 *   - userAgent：headers['user-agent']
 *   - method：HTTP 方法
 *   - path：URL 路径
 */
export function deriveRequestContext(req: PayloadRequest): RequestContextSnapshot {
  const headers = (req?.headers as unknown as Record<string, unknown>) ?? {}
  const requestId =
    typeof headers['x-request-id'] === 'string'
      ? (headers['x-request-id'] as string)
      : null
  const userAgent =
    typeof headers['user-agent'] === 'string' ? (headers['user-agent'] as string) : null
  const method = req.method ?? null
  const url = (req as { url?: string }).url
  // 显式只取 path 部分，剥离 query 防止审计日志膨胀
  const path = url ? url.split('?')[0] : null
  return {
    requestId,
    ip: deriveClientIp(req),
    userAgent,
    method,
    path,
  }
}

/**
 * 默认请求上下文（用于系统扫描器 / 后台任务等无 HTTP 请求场景）。
 *
 *   - requestId / ip / userAgent / method / path 全部为 null
 *
 * 用于 SLA 扫描器、Outbox 消费器等系统动作的审计写入。
 */
export const SYSTEM_REQUEST_CONTEXT: RequestContextSnapshot = {
  requestId: null,
  ip: null,
  userAgent: null,
  method: null,
  path: null,
}

/**
 * 系统主体快照（用于扫描器 / 消费器等无登录态动作）。
 *
 *   - userId=null
 *   - roleCodes=['SYSTEM']
 *   - teamId=null
 *   - cityScope='all'
 */
export const SYSTEM_SUBJECT: SubjectSnapshot = {
  userId: null,
  roleCodes: ['SYSTEM'],
  teamId: null,
  cityScope: 'all',
}
