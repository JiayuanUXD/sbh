import { isIP } from 'node:net'

/**
 * 按「可信代理跳数」从 x-forwarded-for 链中取客户端 IP 的共享纯函数。
 *
 * 取链中倒数第 N 个（N = 可信代理跳数）：前面的段可被客户端伪造，
 * 只有末尾 N 段由可信代理追加。全链必须都是合法 IP（`isIP`），
 * 带端口（`1.1.1.1:443`）、`::ffff:` 映射写法等一律视为非法，
 * 由调用方按「未解析」处理，而不是崩溃或归入同一个桶。
 *
 * 小程序限流（mini/v1/rate-limit-state）与 bot-guard 共用本函数，
 * 避免同一判断逻辑存在多份副本。
 */
export type TrustedIpResult =
  | Readonly<{ ok: true; ip: string }>
  | Readonly<{ ok: false; reason: 'bad_hops' | 'no_header' | 'bad_chain'; chainLength: number }>

/**
 * 严格 IP：`isIP` 合法，且不是带点的 IPv6 写法（`::ffff:1.2.3.4` 等 IPv4 映射地址）。
 * 同一个客户端可能以 IPv4 / 映射两种写法出现，会让限速键分裂，故默认按未解析处理；
 * 小程序侧历史上接受映射写法（失败即 503），传 allowIpv4Mapped 保持原行为。
 */
function isStrictIp(value: string, allowIpv4Mapped: boolean): boolean {
  const family = isIP(value)
  if (family === 0) return false
  return allowIpv4Mapped || !(family === 6 && value.includes('.'))
}

export function resolveTrustedClientIp(
  xForwardedFor: string | null,
  trustedProxyHops: number | null,
  options?: Readonly<{ allowIpv4Mapped?: boolean }>,
): TrustedIpResult {
  const allowIpv4Mapped = options?.allowIpv4Mapped === true
  if (
    trustedProxyHops === null ||
    !Number.isInteger(trustedProxyHops) ||
    trustedProxyHops < 1 ||
    trustedProxyHops > 5
  ) {
    return { ok: false, reason: 'bad_hops', chainLength: 0 }
  }
  if (!xForwardedFor) return { ok: false, reason: 'no_header', chainLength: 0 }
  const chain = xForwardedFor.split(',').map((value) => value.trim())
  if (chain.length < trustedProxyHops || chain.some((value) => !isStrictIp(value, allowIpv4Mapped))) {
    return { ok: false, reason: 'bad_chain', chainLength: chain.length }
  }
  return { ok: true, ip: chain[chain.length - trustedProxyHops]! }
}
