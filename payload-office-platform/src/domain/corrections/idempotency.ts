/**
 * P1 Task 6 纠错幂等键计算
 *
 * 设计依据：docs/superpowers/plans/2026-07-30-detail-pages-p1-enhancements.md Task 6
 *
 * 守护不变量：
 *   - 幂等键 = sha256(requestId | targetType | targetSlug | category)
 *   - 同 requestId + 同目标 + 同类别 -> 同键 -> 同纠错记录
 *   - 双击、刷新、网络重试 -> 同键 -> 返回首次成功语义，不重复建记录
 *   - 不含 PII（纠错不收手机号/姓名）
 *
 * 不依赖 payload / React，纯函数可独立单测。
 */

import { createHash } from 'node:crypto'
import type { CorrectionCategory, CorrectionTargetType } from './schema'

/**
 * 计算纠错幂等键（异步，Web Crypto API）。
 * @returns 64 字符 hex 字符串
 */
export async function computeCorrectionIdempotencyKey(
  requestId: string,
  targetType: CorrectionTargetType,
  targetSlug: string,
  category: CorrectionCategory,
): Promise<string> {
  const raw = `${requestId}|${targetType}|${targetSlug}|${category}`
  const buf = new TextEncoder().encode(raw)
  const hashBuf = await crypto.subtle.digest('SHA-256', buf)
  return bufferToHex(hashBuf)
}

/**
 * 同步版本（node:crypto createHash，用于测试或非异步上下文）。
 */
export function computeCorrectionIdempotencyKeySync(
  requestId: string,
  targetType: CorrectionTargetType,
  targetSlug: string,
  category: CorrectionCategory,
): string {
  const raw = `${requestId}|${targetType}|${targetSlug}|${category}`
  return createHash('sha256').update(raw, 'utf8').digest('hex')
}

function bufferToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let hex = ''
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, '0')
  }
  return hex
}
