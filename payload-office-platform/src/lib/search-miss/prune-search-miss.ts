import { shouldPrune, type PruneTimestampRef } from '@/lib/rate-limit-distributed'
import type { PoolLike } from '@/lib/rate-limit-pg'

/** 规格 §9 / D4：只出现 1 次的词 30 天删，出现 ≥2 次的词 180 天删（以 last_seen_at 计）。 */
export const SEARCH_MISS_RETENTION_DAYS = { once: 30, repeated: 180 } as const

/** 同一实例内两次清理的最小间隔。 */
export const SEARCH_MISS_PRUNE_INTERVAL_MS = 60 * 60 * 1000

/**
 * 物理删除超期的未命中词，返回删除行数。
 *
 * 天数走参数，保留期常量只有 SEARCH_MISS_RETENTION_DAYS 一处。
 * 多实例同时执行也安全：DELETE 幂等，后到者删 0 行。
 */
export async function pruneSearchMissTerms(pool: PoolLike): Promise<number> {
  const result = await pool.query({
    text: `
      DELETE FROM search_miss_terms
      WHERE (count <= 1 AND last_seen_at < now() - make_interval(days => $1::int))
         OR (count >= 2 AND last_seen_at < now() - make_interval(days => $2::int))
    `,
    values: [SEARCH_MISS_RETENTION_DAYS.once, SEARCH_MISS_RETENTION_DAYS.repeated],
  })
  return result.rowCount ?? 0
}

/**
 * 请求顺带清理（仿限流表，OPT-126 §9 方案②）：每个实例每小时最多触发一次。
 *
 * 先占位再删：并发请求只有一个会执行；删除失败也不会在故障期被每个请求重试，
 * 错误向上抛，由调用方静默记日志。
 */
export async function maybePruneSearchMissTerms(
  pool: PoolLike,
  ref: PruneTimestampRef,
  now: number,
  intervalMs: number = SEARCH_MISS_PRUNE_INTERVAL_MS,
): Promise<{ ran: boolean; deleted: number }> {
  if (!shouldPrune(now, ref.value, intervalMs)) return { ran: false, deleted: 0 }
  ref.value = now
  const deleted = await pruneSearchMissTerms(pool)
  return { ran: true, deleted }
}
