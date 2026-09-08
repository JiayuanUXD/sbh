import { randomUUID } from 'node:crypto'

import { sql } from 'drizzle-orm'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { getPayload, type Payload } from 'payload'

import config from '@/payload.config'
import {
  createPayloadMiniUserAssetStore,
  upsertFavorite,
} from '@/domain/mini-program/user-assets'

function assertAllowedPostgresTestDatabase(databaseUrl: string): void {
  const parsed = new URL(databaseUrl)
  const isLocalTaskDatabase = parsed.protocol === 'postgres:'
    && parsed.hostname === '127.0.0.1'
    && parsed.port === '5432'
    && parsed.username === 'liujiayuan'
    && parsed.password === ''
    && parsed.pathname === '/sbh_dev_mp108_fresh'
  const isCiDatabase = parsed.protocol === 'postgres:'
    && parsed.hostname === '127.0.0.1'
    && parsed.port === '5432'
    && parsed.username === 'payload'
    && parsed.password === 'payload'
    && parsed.pathname === '/payload_m0'

  if ((!isLocalTaskDatabase && !isCiDatabase) || parsed.search !== '' || parsed.hash !== '') {
    throw new Error('mini_user_assets_postgres_test_database_rejected')
  }
}

const databaseUrl = process.env.DATABASE_URL
const databaseAvailable = typeof databaseUrl === 'string' && databaseUrl.startsWith('postgres:')
if (databaseAvailable) assertAllowedPostgresTestDatabase(databaseUrl)

describe.skipIf(!databaseAvailable)('mini user assets PostgreSQL concurrency', () => {
  let payload: Payload
  let subject: string | null = null

  beforeAll(async () => {
    payload = await getPayload({ config })
  })

  async function cleanupSubject(): Promise<void> {
    if (subject === null) return
    await payload.db.pool.query('DELETE FROM mini_user_assets WHERE subject = $1', [subject])
    const residual = await payload.db.pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM mini_user_assets WHERE subject = $1',
      [subject],
    )
    expect(residual.rows).toEqual([{ count: '0' }])
    subject = null
  }

  afterEach(async () => {
    vi.restoreAllMocks()
    await cleanupSubject()
  })

  it('serializes two different targets at 199 so at most one succeeds and exactly 200 persist', async () => {
    const marker = randomUUID().replaceAll('-', '')
    subject = `mp108-favorite-race-${marker}`
    await payload.db.pool.query(
      `INSERT INTO mini_user_assets
        (asset_key, subject, kind, target_type, target_slug, updated_at, created_at)
       SELECT
         $1 || '-' || lpad(candidate::text, 3, '0'),
         $2,
         'favorite-listing',
         'listing',
         'seed-' || candidate::text,
         now(),
         now()
       FROM generate_series(1, 199) AS candidate`,
      [marker, subject],
    )
    const before = await payload.db.pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM mini_user_assets WHERE subject = $1',
      [subject],
    )
    expect(before.rows).toEqual([{ count: '199' }])

    const firstStore = createPayloadMiniUserAssetStore(payload)
    const secondStore = createPayloadMiniUserAssetStore(payload)
    const settled = await Promise.allSettled([
      upsertFavorite(firstStore, subject, {
        targetType: 'listing',
        targetSlug: `race-a-${marker}`,
      }),
      upsertFavorite(secondStore, subject, {
        targetType: 'building',
        targetSlug: `race-b-${marker}`,
      }),
    ])

    expect(settled.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(settled.filter((result) => result.status === 'rejected')).toHaveLength(1)
    const rejected = settled.find((result) => result.status === 'rejected')
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({ message: 'mini_user_asset_limit_reached' }),
    })

    const after = await payload.db.pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM mini_user_assets WHERE subject = $1',
      [subject],
    )
    expect(after.rows).toEqual([{ count: '200' }])
  })

  it('keeps the same target idempotent under real concurrent transactions', async () => {
    const marker = randomUUID().replaceAll('-', '')
    subject = `mp108-favorite-race-${marker}`
    const target = {
      targetType: 'listing' as const,
      targetSlug: `same-target-${marker}`,
    }

    const settled = await Promise.allSettled([
      upsertFavorite(createPayloadMiniUserAssetStore(payload), subject, target),
      upsertFavorite(createPayloadMiniUserAssetStore(payload), subject, target),
    ])

    expect(settled.every((result) => result.status === 'fulfilled')).toBe(true)
    const fulfilled = settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
    expect(fulfilled.map((result) => result.created).sort()).toEqual([false, true])
    expect(new Set(fulfilled.map((result) => result.assetKey)).size).toBe(1)
    const persisted = await payload.db.pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM mini_user_assets WHERE subject = $1',
      [subject],
    )
    expect(persisted.rows).toEqual([{ count: '1' }])
  })

  it('rejects an aborted commit despite adapter fulfillment, settles its sibling and leaves no marker after cleanup', async () => {
    const marker = randomUUID().replaceAll('-', '')
    subject = `mp108-favorite-race-${marker}`
    const target = { targetType: 'listing' as const, targetSlug: `failed-commit-${marker}` }
    const originalCommit = payload.db.commitTransaction.bind(payload.db)
    let transactionAborted = false
    let adapterFulfilled = false

    vi.spyOn(payload.db, 'commitTransaction').mockImplementationOnce(async (transactionID) => {
      const id = await transactionID
      const executor = payload.db.sessions?.[String(id)]?.db
      if (
        !executor
        || typeof executor !== 'object'
        || !('execute' in executor)
        || typeof executor.execute !== 'function'
      ) throw new Error('mini_user_assets_test_transaction_missing')
      // 只中止本测试事务；不改表、不改约束，使用真实 PG 错误触发 aborted 状态。
      try {
        await executor.execute(sql`SELECT 1 / 0`)
      } catch {
        transactionAborted = true
      }
      await originalCommit(transactionID)
      adapterFulfilled = true
    })

    // 即使第一个请求先失败，也必须等同 subject 的另一个事务完成再清理。
    const settled = await Promise.allSettled([
      upsertFavorite(createPayloadMiniUserAssetStore(payload), subject, target),
      upsertFavorite(createPayloadMiniUserAssetStore(payload), subject, target),
    ])
    try {
      expect(transactionAborted).toBe(true)
      expect(adapterFulfilled).toBe(true)
      expect(settled.filter((result) => result.status === 'rejected')).toEqual([
        { status: 'rejected', reason: expect.objectContaining({ message: 'mini_user_asset_transaction_unavailable' }) },
      ])
      expect(settled.filter((result) => result.status === 'fulfilled')).toEqual([
        { status: 'fulfilled', value: expect.objectContaining({ created: true }) },
      ])
    } finally {
      vi.restoreAllMocks()
      await cleanupSubject()
    }
    const residual = await payload.db.pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM mini_user_assets WHERE subject = $1',
      [`mp108-favorite-race-${marker}`],
    )
    expect(residual.rows).toEqual([{ count: '0' }])
  })
})
