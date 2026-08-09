/**
 * 投放房源幂等键计算
 *
 * 设计依据：docs/superpowers/specs/2026-08-09-entrust-supply-pages-prd.md §5.5
 *
 * 守护不变量：
 *   - 幂等键 = sha256(requestId | phoneNormalized | buildingName)；
 *   - 同一人重复提交同一楼盘（双击 / 刷新 / 网络重试）→ 同键 → 只建一条；
 *   - 同一人提交不同楼盘 → 不同键 → 各建一条（业主可能有多处房源）。
 *
 * 不依赖 payload / React，纯函数可独立单测。
 */

import { createHash } from 'node:crypto'

/** 异步版本（Web Crypto），路由中使用。返回 64 字符 hex。 */
export async function computeSupplyIdempotencyKey(
  requestId: string,
  phoneNormalized: string,
  buildingName: string,
): Promise<string> {
  const raw = `${requestId}|${phoneNormalized}|${buildingName}`
  const buf = new TextEncoder().encode(raw)
  const hashBuf = await crypto.subtle.digest('SHA-256', buf)
  return bufferToHex(hashBuf)
}

/** 同步版本（node:crypto），测试与非异步上下文使用。 */
export function computeSupplyIdempotencyKeySync(
  requestId: string,
  phoneNormalized: string,
  buildingName: string,
): string {
  const raw = `${requestId}|${phoneNormalized}|${buildingName}`
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
