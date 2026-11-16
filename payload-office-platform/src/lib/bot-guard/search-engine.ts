/**
 * 搜索引擎验真（注入 DNS 依赖，纯逻辑可单测）。
 *
 * 流程：UA 声称某引擎 -> 对客户端 IP 反向 DNS -> 主机名后缀属于该引擎 -> 再正向解析
 * 该主机名，结果须包含该 IP -> verified。永远不得仅凭 UA 放行。
 *
 * 三态：
 * - verified：豁免限速。
 * - spoofed：rDNS 明确不属于该引擎（或严格引擎正向不含该 IP）= 伪造 UA，当普通客户端。
 * - unresolved：超时 / DNS 不可用 / 官方无 rDNS 方法 / 百度宽松正向失败，阈值放大、不做 UA 拦截。
 *   容器内 DNS 是否可用是未验证假设，宁可放宽也不能把真搜索引擎误判成 spoofed 而伤 SEO。
 *
 * 引擎表依据 artifacts/verification/OPT-128/preflight.md（核对日期 2026-11-16）：
 * - Google  https://developers.google.com/search/docs/crawling-indexing/verifying-googlebot
 *   后缀 .googlebot.com / .google.com / .googleusercontent.com，严格正向确认。
 * - Bing    https://blogs.bing.com/webmaster/2012/08/31/how-to-verify-that-bingbot-is-bingbot
 *   后缀 .search.msn.com，严格正向确认。
 * - 百度    https://help.baidu.com/question?prod_id=99&class=0&id=3001
 *   官方只写反查后缀（.baidu.com / .baidu.jp），没写正向确认；第三方称正查可能 NXDOMAIN
 *   （https://skywt.cn/blog/nginx-rdns-judge-spiders ，非官方，未独立验证）。所以
 *   forwardLenient：后缀合格但正查失败 / 不含该 IP 判 unresolved 而非 spoofed。
 * - 搜狗    https://www.sogou.com/docs/help/webmasters.htm ：官方无 rDNS 验真方法 -> 恒 unresolved。
 * - 360     https://www.so.com/help/spider_ip.html ：官方明确不支持 nslookup，只公布 IP 段 -> 恒 unresolved。
 *
 * 缓存（取舍）：verified 24h、spoofed 10min、unresolved 60s（防 DNS 风暴，我的取舍），LRU 上限 5000。
 */
import dns from 'node:dns/promises'

export type EngineId = 'baidu' | 'google' | 'bing' | 'sogou' | 'so360'

export type SearchEngineVerdict =
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: 'verified' | 'spoofed' | 'unresolved'; engine: EngineId }>

export type DnsDeps = Readonly<{
  /** 反向解析；无 PTR 返回 []（明确答案），超时 / DNS 不可用应 reject */
  reverse(ip: string): Promise<readonly string[]>
  /** 正向解析主机名为 IP 列表（A + AAAA） */
  resolve(host: string): Promise<readonly string[]>
  now(): number
}>

type EngineSpec = Readonly<{
  uaPattern: RegExp
  /** null = 官方没有 rDNS 验真方法 */
  hostSuffixes: readonly string[] | null
  forwardLenient: boolean
}>

const ENGINES: Readonly<Record<EngineId, EngineSpec>> = {
  baidu: {
    uaPattern: /baiduspider/i,
    hostSuffixes: ['.baidu.com', '.baidu.jp'],
    forwardLenient: true,
  },
  google: {
    uaPattern: /googlebot/i,
    hostSuffixes: ['.googlebot.com', '.google.com', '.googleusercontent.com'],
    forwardLenient: false,
  },
  bing: {
    uaPattern: /bingbot/i,
    hostSuffixes: ['.search.msn.com'],
    forwardLenient: false,
  },
  sogou: { uaPattern: /sogou/i, hostSuffixes: null, forwardLenient: false },
  so360: { uaPattern: /360spider|haosouspider/i, hostSuffixes: null, forwardLenient: false },
}

const ENGINE_ORDER: readonly EngineId[] = ['baidu', 'google', 'bing', 'sogou', 'so360']

const TTL_VERIFIED_MS = 24 * 60 * 60 * 1000
const TTL_SPOOFED_MS = 10 * 60 * 1000
const TTL_UNRESOLVED_MS = 60 * 1000
const CACHE_MAX = 5000

export function claimedEngine(ua: string | null): EngineId | null {
  if (ua === null || ua === '') return null
  for (const id of ENGINE_ORDER) {
    if (ENGINES[id].uaPattern.test(ua)) return id
  }
  return null
}

/** 点边界后缀匹配：'.baidu.com' 匹配 'a.baidu.com'，不匹配 'evilbaidu.com' 与 'baidu.com' 本身。 */
export function hostMatchesSuffix(host: string, suffixes: readonly string[]): boolean {
  const h = host.trim().toLowerCase().replace(/\.$/, '')
  return suffixes.some((s) => h.length > s.length && h.endsWith(s))
}

function normalizeIp(ip: string): string {
  const lower = ip.trim().toLowerCase()
  return lower.startsWith('::ffff:') && lower.includes('.') ? lower.slice(7) : lower
}

type Kind = 'verified' | 'spoofed' | 'unresolved'

async function verifyViaDns(deps: DnsDeps, spec: EngineSpec, suffixes: readonly string[], ip: string): Promise<Kind> {
  let hosts: readonly string[]
  try {
    hosts = await deps.reverse(ip)
  } catch {
    return 'unresolved'
  }
  const candidates = hosts.filter((h) => hostMatchesSuffix(h, suffixes))
  if (candidates.length === 0) return 'spoofed'

  const target = normalizeIp(ip)
  let forwardFailed = false
  for (const host of candidates) {
    try {
      const addrs = await deps.resolve(host)
      if (addrs.some((a) => normalizeIp(a) === target)) return 'verified'
    } catch {
      forwardFailed = true
    }
  }
  if (spec.forwardLenient) return 'unresolved'
  // 严格引擎：正查网络失败是 DNS 不可用（unresolved），正查成功但不含该 IP 才是伪造
  return forwardFailed ? 'unresolved' : 'spoofed'
}

export function createSearchEngineVerifier(
  deps: DnsDeps,
): (ip: string, ua: string | null) => Promise<SearchEngineVerdict> {
  const cache = new Map<string, { kind: Kind; expiresAt: number }>()
  const inflight = new Map<string, Promise<Kind>>()

  const store = (key: string, kind: Kind): void => {
    const ttl = kind === 'verified' ? TTL_VERIFIED_MS : kind === 'spoofed' ? TTL_SPOOFED_MS : TTL_UNRESOLVED_MS
    cache.delete(key)
    cache.set(key, { kind, expiresAt: deps.now() + ttl })
    while (cache.size > CACHE_MAX) {
      const oldest = cache.keys().next().value
      if (oldest === undefined) break
      cache.delete(oldest)
    }
  }

  return async (ip, ua) => {
    const engine = claimedEngine(ua)
    if (engine === null) return { kind: 'none' }
    const spec = ENGINES[engine]
    if (spec.hostSuffixes === null) return { kind: 'unresolved', engine }

    const key = `${engine}|${ip}`
    const hit = cache.get(key)
    if (hit !== undefined) {
      if (hit.expiresAt > deps.now()) {
        // LRU：命中则刷新到队尾
        cache.delete(key)
        cache.set(key, hit)
        return { kind: hit.kind, engine }
      }
      cache.delete(key)
    }

    let pending = inflight.get(key)
    if (pending === undefined) {
      const suffixes = spec.hostSuffixes
      pending = verifyViaDns(deps, spec, suffixes, ip)
        .catch((): Kind => 'unresolved')
        .then((kind) => {
          store(key, kind)
          return kind
        })
        .finally(() => {
          inflight.delete(key)
        })
      inflight.set(key, pending)
    }
    return { kind: await pending, engine }
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('dns timeout')), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e: unknown) => {
        clearTimeout(timer)
        reject(e instanceof Error ? e : new Error(String(e)))
      },
    )
  })
}

function isNoRecord(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code
  return code === 'ENOTFOUND' || code === 'ENODATA'
}

/** 真实 DNS 依赖：每次调用 timeoutMs 超时；无 PTR / 无记录视为明确答案（[]），其余错误 reject。 */
export function createNodeDnsDeps(timeoutMs: number): DnsDeps {
  return {
    async reverse(ip) {
      try {
        return await withTimeout(dns.reverse(ip), timeoutMs)
      } catch (e) {
        if (isNoRecord(e)) return []
        throw e
      }
    },
    async resolve(host) {
      const settle = async (p: Promise<string[]>): Promise<string[]> => {
        try {
          return await p
        } catch (e) {
          if (isNoRecord(e)) return []
          throw e
        }
      }
      const [a, aaaa] = await withTimeout(
        Promise.all([settle(dns.resolve4(host)), settle(dns.resolve6(host))]),
        timeoutMs,
      )
      return [...a, ...aaaa]
    },
    now: () => Date.now(),
  }
}
