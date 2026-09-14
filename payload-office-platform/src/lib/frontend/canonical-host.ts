/**
 * OPT-098：主域名归一——www 与 CloudRun 默认域名 301 到 shangban.cc。
 *
 * 设计要点：
 *   - **只对显式列出的旧主机名做 301**，名单外一律放行（localhost、CI、未知反代）。
 *     主域名自己永远不在名单里，因此不可能把自己重定向成环。
 *   - 「有效主机」先看 x-forwarded-host 再看 host，与 Next.js Server Actions 的
 *     同源判定一致。线上实测 Origin=https://shangban.cc 能通过该判定，说明网关给
 *     容器的有效主机就是 shangban.cc（见 specs/work-items/OPT-098）。
 *   - /api 与 /_next 不跳：CI 冒烟只打旧域名的 /api/health，必须仍是 200；静态资源
 *     跨域跳一次纯属浪费。proxy.ts 的 matcher 已排除，这里再判一遍是防 matcher 漂移。
 *   - http → https 不在这里做：网关的 x-forwarded-proto 语义未验证，误判会成环；
 *     生产已发 HSTS（preload），浏览器二次访问不会再走 http。
 */
import { getSiteConfig } from './site-config'

/** 要归一到主域名的旧主机名。改名单要同步 tests/canonical-host.test.ts。 */
export const LEGACY_HOSTS: ReadonlySet<string> = new Set([
  'www.shangban.cc',
  // CloudRun 服务 sbh 的两个平台默认域名（网关 listCustomDomains 里 IsDefault=true 的那两条）
  'sbh-286300-10-1253925058.sh.run.tcloudbase.com',
  'sbh-sbh-d9gnr8h5ef7e22e30-1253925058.ap-shanghai.run.wxcloudrun.com',
])

/** 取主机名：多跳 x-forwarded-host 只认第一跳，去端口，统一小写。 */
export function normalizeHost(raw: string | null | undefined): string {
  if (!raw) return ''
  const first = raw.split(',')[0]?.trim() ?? ''
  return first.split(':')[0]?.toLowerCase() ?? ''
}

function isPassthroughPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/') || pathname.startsWith('/_next/')
}

export type CanonicalRedirectInput = {
  host: string | null | undefined
  forwardedHost: string | null | undefined
  pathname: string
  search?: string
  /** 默认取 site-config 的 siteOrigin；测试注入用。 */
  canonicalOrigin?: string
}

/**
 * 命中旧主机名时返回 301 目标（绝对 URL，保留 path + query），否则 null。
 */
export function resolveCanonicalRedirect(input: CanonicalRedirectInput): string | null {
  const effective = normalizeHost(input.forwardedHost) || normalizeHost(input.host)
  if (!effective) return null
  const canonicalOrigin = input.canonicalOrigin ?? getSiteConfig().siteOrigin
  if (effective === new URL(canonicalOrigin).hostname.toLowerCase()) return null
  if (!LEGACY_HOSTS.has(effective)) return null
  if (isPassthroughPath(input.pathname)) return null
  return `${canonicalOrigin}${input.pathname}${input.search ?? ''}`
}
