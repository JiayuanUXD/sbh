import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPayload, type Payload } from 'payload'

import config from '@/payload.config'
import type { PoolLike } from '@/lib/rate-limit-pg'
import { upsertSearchMiss } from '@/lib/search-miss/upsert-search-miss'

const databaseAvailable = typeof process.env.DATABASE_URL === 'string' &&
  process.env.DATABASE_URL.startsWith('postgres')

const CITY = 'zz-opt126-test'

describe.skipIf(!databaseAvailable)('search_miss_terms 原生 upsert（真实 PostgreSQL）', () => {
  let payload: Payload
  let pool: PoolLike

  const rows = async () => {
    const result = await pool.query({
      text: `SELECT term, miss_kind, count, last_result_total, status, resolution, note,
                    first_seen_at, last_seen_at, created_at, updated_at
             FROM search_miss_terms WHERE city = $1 ORDER BY term, miss_kind`,
      values: [CITY],
    })
    return result.rows
  }
  const cleanup = () => pool.query({ text: 'DELETE FROM search_miss_terms WHERE city = $1', values: [CITY] })

  beforeAll(async () => {
    payload = await getPayload({ config })
    pool = (payload.db as unknown as { pool: PoolLike }).pool
    await cleanup()
  })

  afterAll(async () => {
    await cleanup()
  })

  it('首次写入 count=1、status=new，created_at / updated_at / 首末次时间都有值', async () => {
    await upsertSearchMiss(pool, { city: CITY, term: '首次', missKind: 'zero', lastResultTotal: 0 })
    const [row] = (await rows()).filter((r) => r.term === '首次')
    expect(row).toMatchObject({ miss_kind: 'zero', status: 'new', resolution: null })
    expect(Number(row!.count)).toBe(1)
    for (const column of ['first_seen_at', 'last_seen_at', 'created_at', 'updated_at']) {
      expect(row![column]).toBeInstanceOf(Date)
    }
  })

  it('同一 (city, term, missKind) 再写一次 count=2，只更新末次时间与最近结果数', async () => {
    await upsertSearchMiss(pool, { city: CITY, term: '二次', missKind: 'relaxed', lastResultTotal: 3 })
    const [first] = (await rows()).filter((r) => r.term === '二次')
    await new Promise((resolve) => setTimeout(resolve, 15))
    await upsertSearchMiss(pool, { city: CITY, term: '二次', missKind: 'relaxed', lastResultTotal: 7 })
    const [second] = (await rows()).filter((r) => r.term === '二次')
    expect(Number(second!.count)).toBe(2)
    expect(Number(second!.last_result_total)).toBe(7)
    expect((second!.first_seen_at as Date).getTime()).toBe((first!.first_seen_at as Date).getTime())
    expect((second!.last_seen_at as Date).getTime()).toBeGreaterThan((first!.last_seen_at as Date).getTime())
  })

  it('missKind 不同是不同的行', async () => {
    await upsertSearchMiss(pool, { city: CITY, term: '分类', missKind: 'zero', lastResultTotal: 0 })
    await upsertSearchMiss(pool, { city: CITY, term: '分类', missKind: 'entity-no-supply', lastResultTotal: 1 })
    expect((await rows()).filter((r) => r.term === '分类')).toHaveLength(2)
  })

  it('运营已处置的词再次出现：计数累加，状态 / 处置 / 备注不被复位', async () => {
    await upsertSearchMiss(pool, { city: CITY, term: '已处置', missKind: 'zero', lastResultTotal: 0 })
    await pool.query({
      text: `UPDATE search_miss_terms SET status = 'handled', resolution = 'alias-added', note = '已补'
             WHERE city = $1 AND term = $2`,
      values: [CITY, '已处置'],
    })
    await upsertSearchMiss(pool, { city: CITY, term: '已处置', missKind: 'zero', lastResultTotal: 0 })
    const [row] = (await rows()).filter((r) => r.term === '已处置')
    expect(Number(row!.count)).toBe(2)
    expect(row).toMatchObject({ status: 'handled', resolution: 'alias-added', note: '已补' })
  })

  it('并发 50 次写同一个词不丢计数', async () => {
    await Promise.all(
      Array.from({ length: 50 }, () =>
        upsertSearchMiss(pool, { city: CITY, term: '并发', missKind: 'zero', lastResultTotal: 0 }),
      ),
    )
    const [row] = (await rows()).filter((r) => r.term === '并发')
    expect(Number(row!.count)).toBe(50)
  })

  it('Payload Local API 能读到原生写入的行（schema 与集合配置一致）', async () => {
    const found = await payload.find({
      collection: 'search-miss-terms',
      where: { city: { equals: CITY }, term: { equals: '并发' } },
      depth: 0,
      overrideAccess: true,
    })
    expect(found.docs).toHaveLength(1)
    expect(found.docs[0]).toMatchObject({ missKind: 'zero', count: 50, status: 'new' })
  })
})
