/**
 * P1 Task 6 纠错隐私安全日志
 *
 * 设计依据：docs/superpowers/plans/2026-07-30-detail-pages-p1-enhancements.md Task 6
 *           specs/work-items/FPD-P1-detail-enhancements.md §7
 *
 * 守护不变量：
 *   - 服务日志不记录 description 正文（可能含用户输入的敏感信息）
 *   - 服务日志不记录原始 IP（限流键 + reporterIpHash 用哈希）
 *   - 仅记类别枚举、目标、字段完整度、错误码、耗时
 *
 * 不依赖 payload / React，纯函数可独立单测。
 */

import { createHash } from 'node:crypto'
import type { CorrectionRequest } from './schema'

/**
 * 纠错安全日志条目（可安全写入 payload.logger / 监控）。
 *
 * 不含：description 正文、原始 IP、提交人标识。
 */
export type CorrectionLogEntry = Readonly<{
  /** 前台生成的请求 ID，用于关联前端埋点 */
  requestId: string
  /** 目标类型 */
  targetType: string
  /** 目标 slug */
  targetSlug: string
  /** 类别枚举（不含说明正文） */
  category: string
  /** 是否命中幂等（重复请求） */
  idempotent: boolean
  /** 安全错误码（成功时为 null） */
  errorCode: string | null
  /** 处理耗时（毫秒） */
  durationMs: number
  /** 是否携带说明（不记正文，仅布尔） */
  hasDescription: boolean
}>

/**
 * 构造安全日志条目（不含 description 正文、不含原始 IP）。
 */
export function buildCorrectionLogEntry(
  req: CorrectionRequest,
  opts: Readonly<{
    idempotent: boolean
    errorCode: string | null
    durationMs: number
  }>,
): CorrectionLogEntry {
  return {
    requestId: req.requestId,
    targetType: req.targetType,
    targetSlug: req.targetSlug,
    category: req.category,
    idempotent: opts.idempotent,
    errorCode: opts.errorCode,
    durationMs: opts.durationMs,
    hasDescription: req.description.length > 0,
  }
}

/**
 * 清洗 IP：返回带日级盐的哈希（不保存原始 IP）。
 *
 * 限流键与 reporterIpHash 共用此函数，保证原始 IP 不进入存储或日志。
 * 算法与 @/domain/inquiry/privacy-log 的 hashIpForLog 一致（sha256(salt|ip).slice(0,32)），
 * 但纠错限流键加 'correction:' 前缀以与询盘配额隔离（共享 inquiry_rate_limit 表）。
 */
export function hashIpForLog(ip: string, salt: string): string {
  return createHash('sha256').update(`${salt}|${ip}`, 'utf8').digest('hex').slice(0, 32)
}
