/**
 * F5 询盘幂等键计算
 *
 * 设计依据：specs/frontend-mvp/design.md §10.2 / §13、FP-05 §5 / §9
 *
 * 守护不变量：
 *   - 幂等键 = sha256(requestId + '|' + normalizedPhone + '|' + targetType + '|' + targetSlug)
 *   - 同 requestId + 同手机号 + 同目标 → 同键 → 同 Lead
 *   - 双击、刷新、网络重试 → 同键 → 返回首次成功语义
 *   - 不同目标（listing vs building vs none） → 不同键 → 不同 Lead
 *
 * 实现说明：
 *   - 使用 Web Crypto API（Node.js ≥ 18 内置 crypto.subtle）
 *   - 输出 hex 字符串（64 字符）
 *   - 不含个人信息明文（requestId 是前台生成的 UUID，手机号已规范化但仍是敏感字段，
 *     hash 后不可逆推）
 *
 * 不依赖 payload / React，纯函数可独立单测。
 */

import { createHash } from 'node:crypto'
import type { TargetType } from './schema'

/**
 * 计算询盘幂等键。
 *
 * @param requestId 前台生成的请求 ID
 * @param phoneNormalized 规范化后的手机号（11 位）
 * @param targetType 目标类型 listing / building / none
 * @param targetSlug 目标 slug（listing/building slug；none 时为空字符串）
 * @returns 64 字符 hex 字符串
 */
export async function computeIdempotencyKey(
  requestId: string,
  phoneNormalized: string,
  targetType: TargetType,
  targetSlug: string,
): Promise<string> {
  const raw = `${requestId}|${phoneNormalized}|${targetType}|${targetSlug}`
  const buf = new TextEncoder().encode(raw)
  const hashBuf = await crypto.subtle.digest('SHA-256', buf)
  return bufferToHex(hashBuf)
}

/**
 * 同步版本（用于测试或非异步上下文）。
 *
 * 注意：在 Node.js 中使用 `node:crypto` 的 `createHash` 同步计算。
 * 在浏览器环境（前台客户端）请使用 `computeIdempotencyKey` 异步版本。
 */
export function computeIdempotencyKeySync(
  requestId: string,
  phoneNormalized: string,
  targetType: TargetType,
  targetSlug: string,
): string {
  const raw = `${requestId}|${phoneNormalized}|${targetType}|${targetSlug}`
  return createHash('sha256').update(raw, 'utf8').digest('hex')
}

/**
 * 从询盘请求派生目标 slug（用于幂等键计算）
 *
 * - targetType=listing → listingSlug
 * - targetType=building → buildingSlug
 * - targetType=none → 空字符串
 */
export function deriveTargetSlug(
  targetType: TargetType,
  listingSlug: string | null,
  buildingSlug: string | null,
): string {
  if (targetType === 'listing') return listingSlug ?? ''
  if (targetType === 'building') return buildingSlug ?? ''
  return ''
}

function bufferToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let hex = ''
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, '0')
  }
  return hex
}
