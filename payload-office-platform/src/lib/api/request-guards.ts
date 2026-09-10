/**
 * 公开 API 的共享请求守卫（OPT-088 抽出）。
 *
 * 此前 `isSameOrigin` / `isStrictJsonContentType` / `extractPgPool` 在城市合伙人与
 * 投放房源两处各有一份，`clientIp` 在询盘路由里。会员路由是第三个消费方，
 * 再复制一份就是第三份事实源。三处原文件改为从这里引用。
 */
import { siteConfig } from '@/lib/frontend/site-config'
import type { PoolLike } from '@/lib/rate-limit-pg'

const TOKEN = "[!#$%&'*+.^_`|~0-9A-Za-z-]+"
const QUOTED_STRING = '"(?:[^"\\\\\r\n]|\\\\[\t -~])*"'
const JSON_MEDIA_TYPE = new RegExp(
  `^\\s*application\\/json\\s*(?:;\\s*${TOKEN}\\s*=\\s*(?:${TOKEN}|${QUOTED_STRING})\\s*)*$`,
  'i',
)

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function poolLike(value: unknown): value is PoolLike {
  const candidate = record(value)
  return candidate !== null && typeof candidate.query === 'function'
}

export function isStrictJsonContentType(contentType: string | null): boolean {
  return contentType !== null && JSON_MEDIA_TYPE.test(contentType)
}

/** origin 与 host 都要与配置的站点 origin 一致；缺任一头即拒绝（fail-closed）。 */
export function isSameOrigin(req: Request, expectedOrigin = siteConfig.siteOrigin): boolean {
  const origin = req.headers.get('origin')
  const host = req.headers.get('host')
  if (!origin || !host) return false
  try {
    const suppliedOrigin = new URL(origin)
    const expected = new URL(expectedOrigin)
    const suppliedHost = new URL(`${expected.protocol}//${host}`)
    return suppliedOrigin.origin === expected.origin && suppliedHost.host === expected.host
  } catch {
    return false
  }
}

/** Origin 的 host 必须等于 Host 头；缺任一头即拒绝。会员路由用它：本地 / CI 的 localhost 与生产域名都自然通过。 */
export function isSameOriginHost(req: Request): boolean {
  const origin = req.headers.get('origin')
  const host = req.headers.get('host')
  if (!origin || !host) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

export function extractPgPool(database: unknown): PoolLike | null {
  const candidate = record(database)
  return poolLike(candidate?.pool) ? candidate.pool : null
}

/** 提取客户端 IP（CloudRun / 反代场景取首跳）。 */
export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return req.headers.get('x-real-ip')?.trim() || 'unknown'
}
