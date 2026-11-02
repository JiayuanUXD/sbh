import type { PoolLike } from '@/lib/rate-limit-pg'

import type { SearchMissRow } from './record-search-miss'

/**
 * 原生 upsert：一条语句原子完成「新增 / 累加」，避免 Local API 读改写在并发下丢计数。
 *
 * - 唯一键 `(city, term, miss_kind)` 由迁移 20261102_090440 的唯一索引保证；
 * - 绕过了 Payload，所以 `created_at` / `updated_at` / `status` 要显式写；
 * - 冲突时只动计数、末次时间、最近结果数，**不碰 status / resolution / note**（运营已处置的词不被复位）。
 */
export async function upsertSearchMiss(pool: PoolLike, row: SearchMissRow): Promise<void> {
  await pool.query({
    text: `
      INSERT INTO search_miss_terms (
        city, term, miss_kind, count, last_result_total,
        first_seen_at, last_seen_at, status, created_at, updated_at
      ) VALUES ($1, $2, $3, 1, $4, now(), now(), 'new', now(), now())
      ON CONFLICT (city, term, miss_kind) DO UPDATE SET
        count = search_miss_terms.count + 1,
        last_seen_at = now(),
        last_result_total = EXCLUDED.last_result_total,
        updated_at = now()
    `,
    values: [row.city, row.term, row.missKind, row.lastResultTotal],
  })
}
