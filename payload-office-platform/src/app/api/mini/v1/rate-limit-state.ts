import { createHash } from 'node:crypto'
import { isIP } from 'node:net'

import { hashIpForLog } from '@/domain/inquiry'
import {
  MINI_INQUIRY_RATE_LIMIT_CONFIG,
  MINI_FAVORITES_RATE_LIMIT_CONFIG,
  MINI_ME_RATE_LIMIT_CONFIG,
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
export type MiniSubjectRateLimitScope = 'mini-favorites-write' | 'mini-me-read'

export const miniSessionRatePruneRef: PruneTimestampRef = { value: 0 }
export const miniInquiryRatePruneRef: PruneTimestampRef = { value: 0 }
export const miniFavoritesRatePruneRef: PruneTimestampRef = { value: 0 }
export const miniMeRatePruneRef: PruneTimestampRef = { value: 0 }

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

export function miniSubjectRateLimitKey(
  clientIp: string,
  subject: string,
  scope: MiniSubjectRateLimitScope,
  now: number = Date.now(),
): string {
  const dailySalt = new Date(now).toISOString().slice(0, 10)
  const digest = createHash('sha256')
    .update(JSON.stringify([dailySalt, clientIp, subject]), 'utf8')
    .digest('hex')
    .slice(0, 32)
  return `${scope}:${digest}`
}

async function runConfiguredMiniRateLimit(
  key: string,
  config: typeof MINI_SESSION_RATE_LIMIT_CONFIG,
  pruneRef: PruneTimestampRef,
  pool: PoolLike,
): Promise<RateLimitDecision & { failedOpen: boolean; storeFailed: boolean }> {
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
  const decision = await runDistributedRateLimit(trackedStorage, config, key, pruneRef)
  return { ...decision, storeFailed }
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
  return runConfiguredMiniRateLimit(
    miniRateLimitKey(clientIp, scope),
    config,
    pruneRef,
    pool,
  )
}

export async function runMiniSubjectRateLimit(
  clientIp: string,
  subject: string,
  scope: MiniSubjectRateLimitScope,
  pool: PoolLike,
): Promise<RateLimitDecision & { failedOpen: boolean; storeFailed: boolean }> {
  const config = scope === 'mini-favorites-write'
    ? MINI_FAVORITES_RATE_LIMIT_CONFIG
    : MINI_ME_RATE_LIMIT_CONFIG
  const pruneRef = scope === 'mini-favorites-write'
    ? miniFavoritesRatePruneRef
    : miniMeRatePruneRef
  return runConfiguredMiniRateLimit(
    miniSubjectRateLimitKey(clientIp, subject, scope),
    config,
    pruneRef,
    pool,
  )
}

export function __resetMiniRateLimitStateForTests(): void {
  miniSessionRatePruneRef.value = 0
  miniInquiryRatePruneRef.value = 0
  miniFavoritesRatePruneRef.value = 0
  miniMeRatePruneRef.value = 0
}
