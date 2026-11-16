import { isIP } from 'node:net'

import type { GuardClass } from './path-class'
import type { ClassLimits } from './limiter'

export type BotGuardMode = 'off' | 'observe' | 'enforce'

export type BotGuardConfig = Readonly<{
  mode: BotGuardMode
  trustedProxyHops: number | null
  allowIps: ReadonlySet<string>
  logKey: string
}>

/**
 * 每实例阈值（初值是判断而非实测，须靠 observe 日志校准后再 enforce）。
 * mini-read 一期只 observe，沿用 page 的数值。
 */
const PAGE_LIMITS: ClassLimits = { burst: 30, perMinute: 30, perHour: 600 }

export const CLASS_LIMITS: Readonly<
  Record<'page' | 'page-prefetch' | 'sitemap' | 'media' | 'mini-read', ClassLimits>
> = {
  page: PAGE_LIMITS,
  // 预取头可伪造，故不豁免而是单独给一档较宽的额度（一个列表页会预取多个详情链接）
  'page-prefetch': { burst: 60, perMinute: 120, perHour: 1200 },
  sitemap: { burst: 5, perMinute: 5, perHour: 12 },
  media: { burst: 100, perMinute: 300, perHour: 3000 },
  'mini-read': PAGE_LIMITS,
}

/** 真正会返回 403/429 的类别；mini-read 一期不在内。 */
export const ENFORCED_CLASSES: ReadonlySet<GuardClass> = new Set<GuardClass>([
  'page',
  'page-prefetch',
  'sitemap',
  'media',
])

export const LIMITER_MAX_KEYS = 50_000

/** 搜索引擎验真「未决」时的阈值放大倍数。 */
export const UNRESOLVED_ENGINE_LIMIT_FACTOR = 10

function parseMode(raw: string | undefined, fallback: BotGuardMode): BotGuardMode {
  return raw === 'off' || raw === 'observe' || raw === 'enforce' ? raw : fallback
}

function parseHops(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return null
  const n = Number(raw.trim())
  return n >= 1 && n <= 5 ? n : null
}

function parseIps(raw: string | undefined): ReadonlySet<string> {
  if (!raw) return new Set()
  return new Set(
    raw
      .split(',')
      .map((v) => v.trim())
      .filter((v) => v !== '' && isIP(v) !== 0),
  )
}

export function readBotGuardConfig(
  env: Readonly<Record<string, string | undefined>>,
): BotGuardConfig {
  const defaultMode: BotGuardMode = env.NODE_ENV === 'production' ? 'observe' : 'off'
  return {
    mode: parseMode(env.BOT_GUARD_MODE, defaultMode),
    trustedProxyHops: parseHops(env.BOT_GUARD_TRUSTED_PROXY_HOPS),
    allowIps: parseIps(env.BOT_GUARD_ALLOW_IPS),
    logKey: env.BOT_GUARD_LOG_KEY || env.PAYLOAD_SECRET || '',
  }
}
