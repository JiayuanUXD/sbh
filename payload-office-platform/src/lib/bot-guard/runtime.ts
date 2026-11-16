import { createHmac } from 'node:crypto'

import { NextResponse, type NextRequest } from 'next/server'

import { LIMITER_MAX_KEYS, readBotGuardConfig } from './config'
import { evaluateGuard, type GuardAction, type GuardDeps } from './guard'
import { createLimiter } from './limiter'
import { createGuardLogger } from './log'
import { readIsPrefetch } from './path-class'
import { createNodeDnsDeps, createSearchEngineVerifier } from './search-engine'

/**
 * 运行时接线：把纯逻辑（guard.ts）接上真实依赖与 NextRequest。
 * 约束：守卫绝不能让 proxy 抛出——单例构建失败、evaluateGuard 抛错一律放行（返回 null）。
 */

const SUMMARY_INTERVAL_MS = 5 * 60_000
const DNS_TIMEOUT_MS = 1000

const BLOCK_BODY_403 = '访问被拒绝。'
const BLOCK_BODY_429 = '请求过于频繁，请稍后再试。'

/** 处置 → 响应；allow 返回 null。正文刻意简短且不含规则名，避免给爬虫调参线索。 */
export function toBlockResponse(action: GuardAction): NextResponse | null {
  if (action.action === 'allow') return null
  const headers: Record<string, string> = {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  }
  if (action.action === 'limit') {
    headers['Retry-After'] = String(action.retryAfterSeconds)
    return new NextResponse(BLOCK_BODY_429, { status: 429, headers })
  }
  return new NextResponse(BLOCK_BODY_403, { status: 403, headers })
}

/** IP 的截断 HMAC：不可逆但同一 IP 可关联。logKey 为空仅出现在本地开发。 */
function makeHashIp(logKey: string): (ip: string) => string {
  const key = logKey || 'bot-guard'
  return (ip) => createHmac('sha256', key).update(ip).digest('hex').slice(0, 12)
}

let singleton: GuardDeps | null | undefined

/** 惰性构建一次；mode=off 时不建 DNS / 限速器。构建失败返回 null（放行）。 */
function getDeps(): GuardDeps | null {
  if (singleton !== undefined) return singleton
  try {
    const config = readBotGuardConfig(process.env)
    if (config.mode === 'off') return null // 不缓存：便于环境变量变更后的新实例生效，且代价几乎为零
    singleton = {
      config,
      limiter: createLimiter({ now: () => Date.now(), maxKeys: LIMITER_MAX_KEYS }),
      verifyEngine: createSearchEngineVerifier(createNodeDnsDeps(DNS_TIMEOUT_MS)),
      logger: createGuardLogger({
        write: (line) => console.info(line),
        now: () => Date.now(),
        hashIp: makeHashIp(config.logKey),
        summaryIntervalMs: SUMMARY_INTERVAL_MS,
      }),
    }
  } catch {
    singleton = null
  }
  return singleton
}

/** 返回 null 表示放行；否则返回要直接回给客户端的 403/429。 */
export async function runBotGuard(request: NextRequest): Promise<NextResponse | null> {
  try {
    const deps = getDeps()
    if (!deps) return null
    const headers = request.headers
    const action = await evaluateGuard(
      {
        method: request.method,
        pathname: request.nextUrl.pathname,
        headers: {
          userAgent: headers.get('user-agent'),
          xForwardedFor: headers.get('x-forwarded-for'),
          isPrefetch: readIsPrefetch((h) => headers.get(h)),
        },
      },
      deps,
    )
    return toBlockResponse(action)
  } catch {
    return null
  }
}
