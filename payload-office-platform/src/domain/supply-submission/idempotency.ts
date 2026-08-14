/**
 * 投放房源幂等键计算
 *
 * 设计依据：.agent/supply.md「房源投放申请（SupplySubmissions）」——幂等键构成
 *
 * 守护不变量：
 *   - 幂等键 = sha256(requestId | phoneNormalized | buildingName | address)；
 *   - 同一人重复提交同一房源（双击 / 刷新 / 网络重试）→ 同键 → 只建一条；
 *   - 同一人在同一楼盘提交不同房源（不同楼号/单元/房间）→ 不同键 → 各建一条。
 *     地址必须参与计算：商办里"同一业主同一楼盘多套在租"是常态，若身份只取
 *     手机号 + 楼盘名，第二套会被判为重放而静默丢弃（审查发现的静默数据丢失）。
 *
 * 不依赖 payload / React，纯函数可独立单测。
 */

import { createHash } from 'node:crypto'

/** 幂等身份串：四段以 | 连接，顺序固定。 */
function identityString(
  requestId: string,
  phoneNormalized: string,
  buildingName: string,
  address: string,
): string {
  return `${requestId}|${phoneNormalized}|${buildingName}|${address}`
}

/** 异步版本（Web Crypto），路由中使用。返回 64 字符 hex。 */
export async function computeSupplyIdempotencyKey(
  requestId: string,
  phoneNormalized: string,
  buildingName: string,
  address: string,
): Promise<string> {
  const buf = new TextEncoder().encode(
    identityString(requestId, phoneNormalized, buildingName, address),
  )
  const hashBuf = await crypto.subtle.digest('SHA-256', buf)
  return bufferToHex(hashBuf)
}

/** 同步版本（node:crypto），测试与非异步上下文使用。 */
export function computeSupplyIdempotencyKeySync(
  requestId: string,
  phoneNormalized: string,
  buildingName: string,
  address: string,
): string {
  return createHash('sha256')
    .update(identityString(requestId, phoneNormalized, buildingName, address), 'utf8')
    .digest('hex')
}

function bufferToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let hex = ''
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, '0')
  }
  return hex
}
