/**
 * 投放房源隐私安全日志
 *
 * 设计依据：docs/superpowers/specs/2026-08-09-entrust-supply-pages-prd.md §5.5
 *
 * 守护不变量：
 *   - 日志不含手机号（原文或标准化）、楼盘名、详细地址；
 *   - 日志不含原始 IP（限流键与 submitterIpHash 都用哈希）；
 *   - 仅记 requestId、枚举、字段完整度布尔、错误码、耗时。
 *
 * 不依赖 payload / React，纯函数可独立单测。
 */

import { createHash } from 'node:crypto'
import type { SupplySubmissionRequest } from './schema'

export type SupplySubmissionLogEntry = Readonly<{
  requestId: string
  /** 面积区间桶（不记精确值也足以分析供给结构） */
  areaBucket: string
  /** 是否填了租金 */
  hasRent: boolean
  /** 租金单位枚举（无则 null） */
  rentUnit: string | null
  /** 佣金悬赏枚举 */
  commissionMonths: string
  /** 来源路径（同源 pathname，无 query） */
  sourcePath: string
  idempotent: boolean
  errorCode: string | null
  durationMs: number
}>

/** 面积分桶：避免精确面积间接定位具体物业。 */
function areaBucketOf(areaSqm: number): string {
  if (areaSqm < 100) return '<100'
  if (areaSqm < 300) return '100-300'
  if (areaSqm < 1000) return '300-1000'
  if (areaSqm < 3000) return '1000-3000'
  return '>=3000'
}

export function buildSupplyLogEntry(
  req: SupplySubmissionRequest,
  opts: Readonly<{ idempotent: boolean; errorCode: string | null; durationMs: number }>,
): SupplySubmissionLogEntry {
  return {
    requestId: req.requestId,
    areaBucket: areaBucketOf(req.areaSqm),
    hasRent: req.rentAmount !== null,
    rentUnit: req.rentUnit,
    commissionMonths: req.commissionMonths,
    sourcePath: req.source.path,
    idempotent: opts.idempotent,
    errorCode: opts.errorCode,
    durationMs: opts.durationMs,
  }
}

/**
 * 清洗 IP：返回带日级盐的哈希（不保存原始 IP）。
 * 算法与 domain/inquiry、domain/corrections 的同名函数一致（sha256(salt|ip).slice(0,32)）。
 */
export function hashIpForLog(ip: string, salt: string): string {
  return createHash('sha256').update(`${salt}|${ip}`, 'utf8').digest('hex').slice(0, 32)
}
