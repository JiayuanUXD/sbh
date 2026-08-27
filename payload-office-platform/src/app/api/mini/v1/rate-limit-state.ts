import { isIP } from 'node:net'

import { hashIpForLog } from '@/domain/inquiry'
import {
  MINI_INQUIRY_RATE_LIMIT_CONFIG,
  MINI_SESSION_RATE_LIMIT_CONFIG,
} from '@/lib/rate-limit-config'
import {
  runDistributedRateLimit,
  type PruneTimestampRef,
  type RateLimitDecision,
  type RateLimitDeps,
} from '@/lib/rate-limit-distributed'
import { createPgRateLimitDeps, type PoolLike } from '@/lib/rate-limit-pg'

export type MiniRateLimitScope = 'mini-session' | 'mini-inquiry'

export const miniSessionRatePruneRef: PruneTimestampRef = { value: 0 }
export const miniInquiryRatePruneRef: PruneTimestampRef = { value: 0 }

export function resolveMiniTrustedClientIp(
  request: Request,
  trustedProxyHops: number,
): Readonly<{ ok: true; clientIp: string }> | Readonly<{ ok: false }> {
  if (!Number.isInteger(trustedProxyHops) || trustedProxyHops < 1 || trustedProxyHops > 5) {
    return { ok: false }
  }
  const forwarded = request.headers.get('x-forwarded-for')
  if (!forwarded) return { ok: false }
  const chain = forwarded.split(',').map((value) => value.trim())
  if (chain.length < trustedProxyHops || chain.some((value) => isIP(value) === 0)) {
    return { ok: false }
  }
  return { ok: true, clientIp: chain[chain.length - trustedProxyHops]! }
}

export function miniRateLimitKey(
  clientIp: string,
  scope: MiniRateLimitScope,
  now: number = Date.now(),
): string {
  const dailySalt = new Date(now).toISOString().slice(0, 10)
  return `${scope}:${hashIpForLog(clientIp, dailySalt)}`
}

export async function runMiniRateLimit(
  clientIp: string,
  scope: MiniRateLimitScope,
  pool: PoolLike,
): Promise<RateLimitDecision & { failedOpen: boolean; storeFailed: boolean }> {
  const config = scope === 'mini-session'
    ? MINI_SESSION_RATE_LIMIT_CONFIG
    : MINI_INQUIRY_RATE_LIMIT_CONFIG
  const pruneRef = scope === 'mini-session'
    ? miniSessionRatePruneRef
    : miniInquiryRatePruneRef
  const storage = createPgRateLimitDeps(pool)
  let storeFailed = false
  const protect = <Args extends readonly unknown[], Result>(
    operation: (...args: Args) => Promise<Result>,
  ) => async (...args: Args): Promise<Result> => {
    try {
      return await operation(...args)
    } catch (error) {
      storeFailed = true
      throw error
    }
  }
  const trackedStorage: RateLimitDeps = {
    acquire: protect(storage.acquire),
    pruneExpired: protect(storage.pruneExpired),
    countKeys: protect(storage.countKeys),
    keyExists: protect(storage.keyExists),
    now: storage.now,
  }
  const decision = await runDistributedRateLimit(
    trackedStorage,
    config,
    miniRateLimitKey(clientIp, scope),
    pruneRef,
  )
  return { ...decision, storeFailed }
}

export function __resetMiniRateLimitStateForTests(): void {
  miniSessionRatePruneRef.value = 0
  miniInquiryRatePruneRef.value = 0
}
