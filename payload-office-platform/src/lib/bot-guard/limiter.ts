/**
 * 进程内限速器：令牌桶（应对突发）+ 固定 1 小时窗口计数（真正限制总量）。
 * 注入时钟以便单测；Map 有上限，命中即删后重插近似 LRU，超限从最旧开始淘汰，内存有界。
 */
export type ClassLimits = Readonly<{ burst: number; perMinute: number; perHour: number }>

export type LimitDecision =
  | Readonly<{ allowed: true }>
  | Readonly<{ allowed: false; retryAfterSeconds: number; window: 'burst' | 'hour' }>

const HOUR_MS = 3_600_000

type Entry = { tokens: number; refilledAt: number; windowStart: number; count: number }

export function createLimiter(
  opts: Readonly<{ now: () => number; maxKeys: number }>,
): Readonly<{ check(key: string, limits: ClassLimits): LimitDecision; size(): number }> {
  const entries = new Map<string, Entry>()

  return {
    check(key, limits) {
      const now = opts.now()
      let entry = entries.get(key)
      if (entry) {
        entries.delete(key) // 重插到队尾，近似 LRU
      } else {
        entry = { tokens: limits.burst, refilledAt: now, windowStart: now, count: 0 }
      }
      entries.set(key, entry)
      while (entries.size > opts.maxKeys) {
        const oldest = entries.keys().next().value
        if (oldest === undefined) break
        entries.delete(oldest)
      }

      // 小时窗口
      if (now - entry.windowStart >= HOUR_MS) {
        entry.windowStart = now
        entry.count = 0
      }
      if (entry.count >= limits.perHour) {
        const retry = Math.ceil((entry.windowStart + HOUR_MS - now) / 1000)
        return { allowed: false, retryAfterSeconds: Math.max(1, retry), window: 'hour' }
      }

      // 令牌桶补充
      const ratePerMs = limits.perMinute / 60_000
      entry.tokens = Math.min(limits.burst, entry.tokens + (now - entry.refilledAt) * ratePerMs)
      entry.refilledAt = now
      if (entry.tokens < 1) {
        const retry = Math.ceil((1 - entry.tokens) / ratePerMs / 1000)
        return { allowed: false, retryAfterSeconds: Math.max(1, retry), window: 'burst' }
      }

      entry.tokens -= 1
      entry.count += 1
      return { allowed: true }
    },
    size: () => entries.size,
  }
}
