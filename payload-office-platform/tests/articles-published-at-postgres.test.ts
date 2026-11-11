import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPayload, type Payload } from 'payload'

import config from '@/payload.config'

const databaseAvailable = typeof process.env.DATABASE_URL === 'string' &&
  process.env.DATABASE_URL.startsWith('postgres')

/** 本测试写入的资讯 slug 前缀：收尾按它精确清理，不碰其它行。 */
const PREFIX = 'zz-published-at-pg-'

/**
 * 真实 Payload + PostgreSQL 上的「已发布资讯必有发布时间」。
 *
 * 失效点在 Payload 的写入链路（collection hook → 落库），不在页面：纯规则测试证明不了
 * hook 被 Payload 以什么形态调用（`data` 是否整表、`originalDoc` 是否带出旧值）。
 * 这里走 Local API 把线上真实发生过的三条路径各跑一遍，再从库里读回。
 */
describe.skipIf(!databaseAvailable)('Articles 发布时间（真实 PostgreSQL）', () => {
  let payload: Payload
  const base = { title: '发布时间测试（可删）', category: 'guide' as const, excerpt: '测试数据，运行后会被清理。' }
  const read = async (id: number | string) =>
    (await payload.findByID({ collection: 'articles', id, depth: 0, overrideAccess: true })).publishedAt ?? null

  const cleanup = async () => {
    const pool = (payload.db as unknown as { pool: { query(text: string, values?: unknown[]): Promise<unknown> } }).pool
    await pool.query('DELETE FROM articles WHERE slug LIKE $1', [`${PREFIX}%`])
  }

  beforeAll(async () => {
    payload = await getPayload({ config })
    await cleanup()
  })

  afterAll(async () => {
    await cleanup()
  })

  it('规范路径：先草稿、再把状态改成已发布（不带日期）→ 库里有发布时间，且是发布那一刻', async () => {
    const draft = await payload.create({ collection: 'articles', data: { ...base, slug: `${PREFIX}a`, status: 'draft' } })
    expect(draft.publishedAt ?? null).toBeNull()

    const before = Date.now()
    await payload.update({ collection: 'articles', id: draft.id, data: { status: 'published' } })
    const after = Date.now()

    const stored = await read(draft.id)
    expect(stored).not.toBeNull()
    const ts = Date.parse(stored as string)
    expect(ts).toBeGreaterThanOrEqual(before - 1000)
    expect(ts).toBeLessThanOrEqual(after + 1000)
  })

  it('直接以已发布创建、不带日期 → 库里有发布时间', async () => {
    const doc = await payload.create({ collection: 'articles', data: { ...base, slug: `${PREFIX}b`, status: 'published' } })
    expect(await read(doc.id)).not.toBeNull()
  })

  it('运营指定了发布日期 → 原样保存，不被盖章覆盖', async () => {
    const doc = await payload.create({
      collection: 'articles',
      data: { ...base, slug: `${PREFIX}c`, status: 'published', publishedAt: '2026-09-01T09:00:00+08:00' },
    })
    expect(await read(doc.id)).toBe('2026-09-01T01:00:00.000Z')
  })

  it('已发布文章被清空发布日期 → 恢复原值，日期不会丢', async () => {
    const doc = await payload.create({
      collection: 'articles',
      data: { ...base, slug: `${PREFIX}d`, status: 'published', publishedAt: '2026-09-02T09:00:00+08:00' },
    })
    await payload.update({ collection: 'articles', id: doc.id, data: { publishedAt: null } })
    expect(await read(doc.id)).toBe('2026-09-02T01:00:00.000Z')
  })

  it('★ 历史上已发布却没日期的老文章：无关编辑不会被盖成「编辑时刻」（补历史数据走单独回填）', async () => {
    const doc = await payload.create({
      collection: 'articles',
      data: { ...base, slug: `${PREFIX}f`, status: 'published', publishedAt: '2026-09-03T09:00:00+08:00' },
    })
    // 造出线上那种状态：已发布、publishedAt 为 NULL（hook 之后只能靠裸 SQL 造）
    const pool = (payload.db as unknown as { pool: { query(text: string, values?: unknown[]): Promise<unknown> } }).pool
    await pool.query('UPDATE articles SET published_at = NULL WHERE id = $1', [doc.id])
    expect(await read(doc.id)).toBeNull()

    await payload.update({ collection: 'articles', id: doc.id, data: { excerpt: '只改摘要' } })
    expect(await read(doc.id)).toBeNull()
  })

  it('草稿不会被提前盖章', async () => {
    const doc = await payload.create({ collection: 'articles', data: { ...base, slug: `${PREFIX}e`, status: 'draft' } })
    await payload.update({ collection: 'articles', id: doc.id, data: { excerpt: '改一句摘要' } })
    expect(await read(doc.id)).toBeNull()
  })
})
