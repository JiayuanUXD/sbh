/**
 * OPT-126 §9 保留期清理（请求顺带清理，仿限流表）。
 *
 * 守护不变量：
 *   - 保留期口径写死：只出现 1 次的词 30 天、出现 ≥2 次的词 180 天（以 last_seen_at 计）；
 *   - 节流：同一实例内每小时最多触发一次 DELETE，间隔内的请求不碰库；
 *   - 失败也占用本窗口（不在故障期每个请求都重试），错误向上抛由调用方静默处理。
 */

import { describe, expect, it, vi } from 'vitest'

import {
  maybePruneSearchMissTerms,
  pruneSearchMissTerms,
  SEARCH_MISS_PRUNE_INTERVAL_MS,
  SEARCH_MISS_RETENTION_DAYS,
} from '@/lib/search-miss/prune-search-miss'

function makePool(rowCount: number | null = 3) {
  const query = vi.fn(async (_params: { text: string; values: unknown[] }) => ({ rows: [], rowCount }))
  return { query }
}

describe('保留期口径', () => {
  it('单次词 30 天、重复词 180 天', () => {
    expect(SEARCH_MISS_RETENTION_DAYS).toEqual({ once: 30, repeated: 180 })
  })

  it('清理间隔 1 小时', () => {
    expect(SEARCH_MISS_PRUNE_INTERVAL_MS).toBe(60 * 60 * 1000)
  })
})

describe('pruneSearchMissTerms', () => {
  it('一条参数化 DELETE，天数走参数而不是拼进 SQL，返回删除行数', async () => {
    const pool = makePool(4)
    const deleted = await pruneSearchMissTerms(pool)
    expect(deleted).toBe(4)
    expect(pool.query).toHaveBeenCalledTimes(1)
    const { text, values } = pool.query.mock.calls[0]![0]
    expect(text).toMatch(/^\s*DELETE FROM search_miss_terms/)
    expect(text).toContain('count <= 1')
    expect(text).toContain('count >= 2')
    expect(text).toContain('last_seen_at')
    expect(values).toEqual([30, 180])
  })

  it('rowCount 为 null 时按 0 计', async () => {
    expect(await pruneSearchMissTerms(makePool(null))).toBe(0)
  })
})

describe('maybePruneSearchMissTerms（节流）', () => {
  const T0 = 10_000_000_000

  it('首次（ref=0）执行并记录时间', async () => {
    const pool = makePool(2)
    const ref = { value: 0 }
    expect(await maybePruneSearchMissTerms(pool, ref, T0)).toEqual({ ran: true, deleted: 2 })
    expect(ref.value).toBe(T0)
    expect(pool.query).toHaveBeenCalledTimes(1)
  })

  it('间隔内不再执行，也不碰库', async () => {
    const pool = makePool()
    const ref = { value: T0 }
    const result = await maybePruneSearchMissTerms(pool, ref, T0 + SEARCH_MISS_PRUNE_INTERVAL_MS - 1)
    expect(result).toEqual({ ran: false, deleted: 0 })
    expect(pool.query).not.toHaveBeenCalled()
    expect(ref.value).toBe(T0)
  })

  it('到点再次执行', async () => {
    const pool = makePool(1)
    const ref = { value: T0 }
    const result = await maybePruneSearchMissTerms(pool, ref, T0 + SEARCH_MISS_PRUNE_INTERVAL_MS)
    expect(result).toEqual({ ran: true, deleted: 1 })
    expect(ref.value).toBe(T0 + SEARCH_MISS_PRUNE_INTERVAL_MS)
  })

  it('并发的两个请求只有一个会执行（先占位再删）', async () => {
    const pool = makePool()
    const ref = { value: 0 }
    const [a, b] = await Promise.all([
      maybePruneSearchMissTerms(pool, ref, T0),
      maybePruneSearchMissTerms(pool, ref, T0),
    ])
    expect([a.ran, b.ran].filter(Boolean)).toHaveLength(1)
    expect(pool.query).toHaveBeenCalledTimes(1)
  })

  it('DELETE 失败：错误上抛，但本窗口已被占用，不会下个请求就重试', async () => {
    const pool = { query: vi.fn(async () => { throw new Error('db down') }) }
    const ref = { value: 0 }
    await expect(maybePruneSearchMissTerms(pool, ref, T0)).rejects.toThrow('db down')
    expect(ref.value).toBe(T0)
    expect(await maybePruneSearchMissTerms(pool, ref, T0 + 1000)).toEqual({ ran: false, deleted: 0 })
    expect(pool.query).toHaveBeenCalledTimes(1)
  })
})
