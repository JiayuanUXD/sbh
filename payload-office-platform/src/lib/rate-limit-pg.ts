// PG 适配器：为 runDistributedRateLimit 提供原子递增 + TTL 清理 + 容量统计。
//
// 依赖 payload.db.pool（pg Pool）。用 INSERT ... ON CONFLICT 实现原子递增：
// - key 不存在 -> 插入 count=1；
// - key 存在且窗口匹配 -> count+1；
// - key 存在但窗口过期 -> 重置 count=1 + 新 windowStart。
// 单条语句原子完成，多实例并发安全。

import type { RateLimitDeps } from './rate-limit-distributed'

/** pg Pool 的最小子集（对象参数形式 query） */
export interface PoolLike {
  query: (params: { text: string; values: unknown[] }) => Promise<{
    rows: Record<string, unknown>[]
    rowCount: number | null
  }>
}

/**
 * 用 pg Pool 构造分布式限流存储依赖。
 * 表结构由迁移 20260726_150000_opt017_inquiry_rate_limit 创建。
 */
export function createPgRateLimitDeps(pool: PoolLike): RateLimitDeps {
  return {
    async acquire(key, windowStart) {
      const result = await pool.query({
        text: `
          INSERT INTO inquiry_rate_limit (key, window_start, count, updated_at)
          VALUES ($1, $2, 1, NOW())
          ON CONFLICT (key) DO UPDATE
            SET count = CASE
                  WHEN inquiry_rate_limit.window_start = $2 THEN inquiry_rate_limit.count + 1
                  ELSE 1
                END,
                window_start = CASE
                  WHEN inquiry_rate_limit.window_start = $2 THEN inquiry_rate_limit.window_start
                  ELSE $2
                END,
                updated_at = NOW()
          RETURNING count, window_start
        `,
        values: [key, windowStart],
      })
      const row = result.rows[0]
      return {
        count: Number(row.count),
        windowStart: Number(row.window_start),
      }
    },

    async pruneExpired(cutoff) {
      const result = await pool.query({
        text: 'DELETE FROM inquiry_rate_limit WHERE window_start < $1',
        values: [cutoff],
      })
      return result.rowCount ?? 0
    },

    async countKeys() {
      const result = await pool.query({
        text: 'SELECT COUNT(*)::int AS count FROM inquiry_rate_limit',
        values: [],
      })
      return Number(result.rows[0].count)
    },

    async keyExists(key) {
      const result = await pool.query({
        text: 'SELECT 1 FROM inquiry_rate_limit WHERE key = $1 LIMIT 1',
        values: [key],
      })
      return result.rows.length > 0
    },

    now: () => Date.now(),
  }
}
