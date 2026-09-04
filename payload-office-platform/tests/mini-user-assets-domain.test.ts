import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { MiniUserAssets, denyMiniUserAssetAccess } from '@/collections/MiniUserAssets'
import {
  computeMiniUserAssetKey,
  removeFavorite,
  upsertFavorite,
  verifyMiniBearer,
  type MiniUserAssetCreate,
  type MiniUserAssetRecord,
  type MiniUserAssetStore,
} from '@/domain/mini-program/user-assets'
import { issueAnonymousContextToken } from '@/domain/mini-program/session'

const SIGNING_SECRET = Uint8Array.from({ length: 32 }, (_, index) => index + 1)
const SIGNING_SECRET_ENV = Buffer.from(SIGNING_SECRET).toString('base64url')
const ORIGINAL_SIGNING_SECRET = process.env.MINI_SESSION_SIGNING_SECRET

class MemoryAssetStore implements MiniUserAssetStore {
  readonly records: MiniUserAssetRecord[] = []

  async findByAssetKey(assetKey: string): Promise<MiniUserAssetRecord | null> {
    return this.records.find((record) => record.assetKey === assetKey) ?? null
  }

  async create(data: MiniUserAssetCreate): Promise<MiniUserAssetRecord> {
    if (this.records.some((record) => record.assetKey === data.assetKey)) {
      throw new Error('duplicate asset key')
    }
    const record: MiniUserAssetRecord = {
      databaseId: this.records.length + 1,
      ...data,
      lead: null,
      createdAt: '2026-09-04T10:00:00.000Z',
    }
    this.records.push(record)
    return record
  }

  async deleteExact(
    assetKey: string,
    subject: string,
    kind: MiniUserAssetRecord['kind'],
    target: Readonly<{ targetType: 'listing' | 'building'; targetSlug: string }>,
  ): Promise<number> {
    const before = this.records.length
    const kept = this.records.filter(
      (record) => record.assetKey !== assetKey
        || record.subject !== subject
        || record.kind !== kind
        || record.targetType !== target.targetType
        || record.targetSlug !== target.targetSlug,
    )
    this.records.splice(0, this.records.length, ...kept)
    return before - kept.length
  }

  async findBySubject(subject: string): Promise<readonly MiniUserAssetRecord[]> {
    return this.records.filter((record) => record.subject === subject)
  }
}

function tokenFor(openId: string, now: number): string {
  return issueAnonymousContextToken(openId, {
    signingSecret: SIGNING_SECRET,
    now: () => now,
    randomBytes: (size) => Uint8Array.from({ length: size }, (_, index) => index + 1),
  }).token
}

beforeEach(() => {
  process.env.MINI_SESSION_SIGNING_SECRET = SIGNING_SECRET_ENV
})

afterEach(() => {
  if (ORIGINAL_SIGNING_SECRET === undefined) delete process.env.MINI_SESSION_SIGNING_SECRET
  else process.env.MINI_SESSION_SIGNING_SECRET = ORIGINAL_SIGNING_SECRET
})

describe('MiniUserAssets collection', () => {
  it('将四种 collection access 全部硬关闭', () => {
    expect(denyMiniUserAssetAccess()).toBe(false)
    expect(MiniUserAssets.access).toEqual({
      read: denyMiniUserAssetAccess,
      create: denyMiniUserAssetAccess,
      update: denyMiniUserAssetAccess,
      delete: denyMiniUserAssetAccess,
    })
  })
})

describe('Mini user asset domain', () => {
  it('为同一主体与目标生成稳定 SHA-256，并隔离不同 subject', () => {
    const first = computeMiniUserAssetKey(
      'subject-a',
      'favorite-listing',
      'listing',
      'jing-an-100',
    )
    const repeated = computeMiniUserAssetKey(
      'subject-a',
      'favorite-listing',
      'listing',
      'jing-an-100',
    )
    const otherSubject = computeMiniUserAssetKey(
      'subject-b',
      'favorite-listing',
      'listing',
      'jing-an-100',
    )

    expect(first).toMatch(/^[a-f0-9]{64}$/)
    expect(repeated).toBe(first)
    expect(otherSubject).not.toBe(first)
  })

  it('重复收藏幂等、取消只删除当前 subject 的精确资产', async () => {
    const store = new MemoryAssetStore()
    const target = { targetType: 'listing' as const, targetSlug: 'jing-an-100' }

    const first = await upsertFavorite(store, 'subject-a', target)
    const repeated = await upsertFavorite(store, 'subject-a', target)
    await upsertFavorite(store, 'subject-b', target)

    expect(first.created).toBe(true)
    expect(repeated).toEqual({ created: false, assetKey: first.assetKey })
    expect(store.records).toHaveLength(2)

    await expect(removeFavorite(store, 'subject-a', target)).resolves.toEqual({
      removed: true,
      assetKey: first.assetKey,
    })
    await expect(removeFavorite(store, 'subject-a', target)).resolves.toEqual({
      removed: false,
      assetKey: first.assetKey,
    })
    expect(store.records).toHaveLength(1)
    expect(store.records[0]?.subject).toBe('subject-b')
  })

  it('同 assetKey 若对应身份不一致则 fail-closed，不误判为幂等成功', async () => {
    const store = new MemoryAssetStore()
    const target = { targetType: 'listing' as const, targetSlug: 'jing-an-100' }
    const assetKey = computeMiniUserAssetKey(
      'subject-a',
      'favorite-listing',
      target.targetType,
      target.targetSlug,
    )
    store.records.push({
      databaseId: 1,
      assetKey,
      subject: 'subject-b',
      kind: 'favorite-listing',
      targetType: 'listing',
      targetSlug: target.targetSlug,
      lead: null,
      createdAt: '2026-09-04T10:00:00.000Z',
    })

    await expect(upsertFavorite(store, 'subject-a', target)).rejects.toThrow(
      'mini_user_asset_key_collision',
    )
  })
})

describe('verifyMiniBearer', () => {
  it('只从校验成功的 Bearer 返回稳定 subject', () => {
    const now = Date.now()
    const token = tokenFor('openid-never-exposed', now)
    const result = verifyMiniBearer(new Request('https://example.test', {
      headers: { authorization: `Bearer ${token}` },
    }))

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected verified bearer')
    expect(result.subject).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(result.subject).not.toContain('openid-never-exposed')
  })

  it('缺失或过期 Bearer 均返回 401，且不返回 subject', async () => {
    const missing = verifyMiniBearer(new Request('https://example.test'))
    expect(missing.ok).toBe(false)
    if (missing.ok) throw new Error('expected missing bearer rejection')
    expect(missing.response.status).toBe(401)
    await expect(missing.response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'session_invalid' },
    })

    const expiredToken = tokenFor('expired-openid', Date.now() - 16 * 60 * 1000)
    const expired = verifyMiniBearer(new Request('https://example.test', {
      headers: { authorization: `Bearer ${expiredToken}` },
    }))
    expect(expired.ok).toBe(false)
    if (expired.ok) throw new Error('expected expired bearer rejection')
    expect(expired.response.status).toBe(401)
  })
})
