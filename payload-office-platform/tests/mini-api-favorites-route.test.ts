import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { issueAnonymousContextToken } from '@/domain/mini-program/session'

type StoredAsset = {
  id: number
  assetKey: string
  subject: string
  kind: 'favorite-listing' | 'favorite-building' | 'inquiry'
  targetType: 'listing' | 'building' | 'general'
  targetSlug?: string | null
  lead?: number | null
  createdAt: string
  updatedAt: string
}

type LocalApiCall = Readonly<{
  collection: string
  overrideAccess?: boolean
  where?: unknown
  data?: unknown
}>

const io = vi.hoisted(() => {
  const assets: StoredAsset[] = []
  const calls: LocalApiCall[] = []
  return {
    assets,
    calls,
    rateKeys: [] as string[],
    rateCounts: new Map<string, number>(),
    rateStoreFails: false,
    getPayload: vi.fn(),
    payloadFind: vi.fn(),
    payloadCount: vi.fn(),
    payloadCreate: vi.fn(),
    payloadDelete: vi.fn(),
    assertListing: vi.fn(),
    assertBuilding: vi.fn(),
  }
})

vi.mock('payload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('payload')>()
  return { ...actual, getPayload: io.getPayload }
})

vi.mock('@/payload.config', () => ({ default: {} }))

vi.mock('@/lib/rate-limit-pg', () => ({
  createPgRateLimitDeps: () => ({
    acquire: async (key: string, windowStart: number) => {
      io.rateKeys.push(key)
      if (io.rateStoreFails) throw new Error('rate-store-sensitive')
      const count = (io.rateCounts.get(key) ?? 0) + 1
      io.rateCounts.set(key, count)
      return { count, windowStart }
    },
    pruneExpired: async () => 0,
    countKeys: async () => io.rateCounts.size,
    keyExists: async (key: string) => io.rateCounts.has(key),
    now: () => 1_800_000_000_000,
  }),
}))

vi.mock('@/domain/public-catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/domain/public-catalog')>()
  return {
    ...actual,
    assertEffectiveListing: io.assertListing,
    assertEffectiveBuilding: io.assertBuilding,
  }
})

import { DELETE, PUT, runtime } from '@/app/api/mini/v1/favorites/route'
import { __resetMiniRateLimitStateForTests } from '@/app/api/mini/v1/rate-limit-state'

const SIGNING_SECRET = Uint8Array.from({ length: 32 }, (_, index) => index + 1)
const SIGNING_SECRET_ENV = Buffer.from(SIGNING_SECRET).toString('base64url')
const ORIGINAL_SIGNING_SECRET = process.env.MINI_SESSION_SIGNING_SECRET
const ORIGINAL_TRUSTED_PROXY_HOPS = process.env.MINI_TRUSTED_PROXY_HOPS

function subjectToken(openId: string): string {
  return issueAnonymousContextToken(openId, {
    signingSecret: SIGNING_SECRET,
    now: () => Date.now(),
    randomBytes: (size) => Uint8Array.from({ length: size }, (_, index) => index + 1),
  }).token
}

function bodyRequest(
  method: 'PUT' | 'DELETE',
  token: string | null,
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request('https://example.test/api/mini/v1/favorites', {
    method,
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': '203.0.113.10',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

function equalsValue(where: unknown, field: string): unknown {
  if (typeof where !== 'object' || where === null || Array.isArray(where)) return undefined
  const value = Object.getOwnPropertyDescriptor(where, field)?.value
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return Object.getOwnPropertyDescriptor(value, 'equals')?.value
}

function matches(asset: StoredAsset, where: unknown): boolean {
  if (typeof where !== 'object' || where === null || Array.isArray(where)) return false
  const conjunction = Object.getOwnPropertyDescriptor(where, 'and')?.value
  if (Array.isArray(conjunction)) return conjunction.every((part) => matches(asset, part))
  const assetKey = equalsValue(where, 'assetKey')
  const subject = equalsValue(where, 'subject')
  return (assetKey === undefined || asset.assetKey === assetKey)
    && (subject === undefined || asset.subject === subject)
}

function requireCreateData(value: unknown): Omit<StoredAsset, 'id' | 'createdAt' | 'updatedAt'> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('invalid create data')
  }
  const assetKey = Object.getOwnPropertyDescriptor(value, 'assetKey')?.value
  const subject = Object.getOwnPropertyDescriptor(value, 'subject')?.value
  const kind = Object.getOwnPropertyDescriptor(value, 'kind')?.value
  const targetType = Object.getOwnPropertyDescriptor(value, 'targetType')?.value
  const targetSlug = Object.getOwnPropertyDescriptor(value, 'targetSlug')?.value
  const lead = Object.getOwnPropertyDescriptor(value, 'lead')?.value
  if (
    typeof assetKey !== 'string'
    || typeof subject !== 'string'
    || !['favorite-listing', 'favorite-building', 'inquiry'].includes(String(kind))
    || !['listing', 'building', 'general'].includes(String(targetType))
    || !(targetSlug === undefined || targetSlug === null || typeof targetSlug === 'string')
    || !(lead === undefined || lead === null || typeof lead === 'number')
  ) {
    throw new Error('invalid create data')
  }
  if (kind !== 'favorite-listing' && kind !== 'favorite-building' && kind !== 'inquiry') {
    throw new Error('invalid kind')
  }
  if (targetType !== 'listing' && targetType !== 'building' && targetType !== 'general') {
    throw new Error('invalid target type')
  }
  return { assetKey, subject, kind, targetType, targetSlug, lead }
}

beforeEach(() => {
  process.env.MINI_SESSION_SIGNING_SECRET = SIGNING_SECRET_ENV
  process.env.MINI_TRUSTED_PROXY_HOPS = '1'
  io.assets.length = 0
  io.calls.length = 0
  io.rateKeys.length = 0
  io.rateCounts.clear()
  io.rateStoreFails = false
  io.getPayload.mockReset()
  io.payloadFind.mockReset()
  io.payloadCount.mockReset()
  io.payloadCreate.mockReset()
  io.payloadDelete.mockReset()
  io.assertListing.mockReset()
  io.assertBuilding.mockReset()

  io.payloadFind.mockImplementation(async (call: LocalApiCall) => {
    io.calls.push(call)
    return { docs: io.assets.filter((asset) => matches(asset, call.where)) }
  })
  io.payloadCount.mockImplementation(async (call: LocalApiCall) => ({
    totalDocs: io.assets.filter((asset) => matches(asset, call.where)).length,
  }))
  io.payloadCreate.mockImplementation(async (call: LocalApiCall) => {
    io.calls.push(call)
    const data = requireCreateData(call.data)
    const now = '2026-09-04T10:00:00.000Z'
    const stored: StoredAsset = { id: io.assets.length + 1, ...data, createdAt: now, updatedAt: now }
    io.assets.push(stored)
    return stored
  })
  io.payloadDelete.mockImplementation(async (call: LocalApiCall) => {
    io.calls.push(call)
    const deleted = io.assets.filter((asset) => matches(asset, call.where))
    const kept = io.assets.filter((asset) => !matches(asset, call.where))
    io.assets.splice(0, io.assets.length, ...kept)
    return { docs: deleted }
  })
  io.getPayload.mockResolvedValue({
    db: { pool: {} },
    find: io.payloadFind,
    count: io.payloadCount,
    create: io.payloadCreate,
    delete: io.payloadDelete,
  })
  io.assertListing.mockImplementation(async (slug: string) => (
    slug === 'jing-an-100' ? { slug, title: '静安中心 100㎡' } : null
  ))
  io.assertBuilding.mockImplementation(async (slug: string) => (
    slug === 'jing-an-center' ? { slug, name: '静安中心' } : null
  ))
})

afterEach(() => {
  if (ORIGINAL_SIGNING_SECRET === undefined) delete process.env.MINI_SESSION_SIGNING_SECRET
  else process.env.MINI_SESSION_SIGNING_SECRET = ORIGINAL_SIGNING_SECRET
  if (ORIGINAL_TRUSTED_PROXY_HOPS === undefined) delete process.env.MINI_TRUSTED_PROXY_HOPS
  else process.env.MINI_TRUSTED_PROXY_HOPS = ORIGINAL_TRUSTED_PROXY_HOPS
})

describe('PUT/DELETE /api/mini/v1/favorites', () => {
  beforeEach(() => {
    __resetMiniRateLimitStateForTests()
  })

  it('同 subject 与可信 client IP 的第 31 次写请求返回 429，且不同 subject 不共享配额', async () => {
    const tokenA = subjectToken('openid-a')
    const tokenB = subjectToken('openid-b')
    const input = { targetType: 'listing' as const, targetSlug: 'jing-an-100' }

    for (let index = 0; index < 30; index += 1) {
      const allowed = await PUT(bodyRequest('PUT', tokenA, input))
      expect(allowed.status).toBe(200)
    }
    const blocked = await PUT(bodyRequest('PUT', tokenA, input))
    const otherSubject = await PUT(bodyRequest('PUT', tokenB, input))

    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('retry-after')).toMatch(/^\d+$/)
    await expect(blocked.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'rate_limited' },
    })
    expect(otherSubject.status).toBe(200)
    expect(new Set(io.rateKeys)).toHaveLength(2)
    expect(io.rateKeys.every((key) => /^mini-favorites-write:[a-f0-9]{32}$/.test(key))).toBe(true)
    expect(io.rateKeys.join('|')).not.toContain('openid')
    expect(io.rateKeys.join('|')).not.toContain('203.0.113.10')
  })

  it('限流存储失败时 fail-closed，且不查询公开供给或写用户资产', async () => {
    io.rateStoreFails = true

    const result = await PUT(bodyRequest('PUT', subjectToken('openid-a'), {
      targetType: 'listing',
      targetSlug: 'jing-an-100',
    }))

    expect(result.status).toBe(503)
    await expect(result.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'service_unavailable' },
    })
    expect(io.assertListing).not.toHaveBeenCalled()
    expect(io.payloadFind).not.toHaveBeenCalled()
    expect(io.payloadCreate).not.toHaveBeenCalled()
  })

  it('只信任 XFF 右侧代理链中的 client，伪造左侧与 x-real-ip 不能轮换配额', async () => {
    process.env.MINI_TRUSTED_PROXY_HOPS = '2'
    const token = subjectToken('openid-a')
    const input = { targetType: 'listing' as const, targetSlug: 'jing-an-100' }

    for (let index = 0; index < 31; index += 1) {
      const result = await PUT(bodyRequest('PUT', token, input, {
        'x-real-ip': `192.0.2.${index + 1}`,
        'x-forwarded-for': `198.51.100.${index + 1}, 203.0.113.10, 10.0.0.8`,
      }))
      expect(result.status).toBe(index < 30 ? 200 : 429)
    }
    expect(new Set(io.rateKeys)).toHaveLength(1)
  })

  it('无 Bearer 与过期 Bearer 均 401，且不初始化 Payload', async () => {
    const missing = await PUT(bodyRequest('PUT', null, {
      targetType: 'listing',
      targetSlug: 'jing-an-100',
    }))
    expect(missing.status).toBe(401)

    const expired = issueAnonymousContextToken('expired-openid', {
      signingSecret: SIGNING_SECRET,
      now: () => Date.now() - 16 * 60 * 1000,
      randomBytes: (size) => Uint8Array.from({ length: size }, (_, index) => index + 1),
    }).token
    const expiredResponse = await PUT(bodyRequest('PUT', expired, {
      targetType: 'listing',
      targetSlug: 'jing-an-100',
    }))
    expect(expiredResponse.status).toBe(401)
    expect(io.getPayload).not.toHaveBeenCalled()
  })

  it('先经 Public Catalog 验证，重复收藏幂等且不同 subject 完全隔离', async () => {
    const tokenA = subjectToken('openid-a')
    const tokenB = subjectToken('openid-b')
    const input = { targetType: 'listing' as const, targetSlug: 'jing-an-100' }

    const first = await PUT(bodyRequest('PUT', tokenA, input))
    const repeated = await PUT(bodyRequest('PUT', tokenA, input))
    const otherSubject = await PUT(bodyRequest('PUT', tokenB, input))

    expect(runtime).toBe('nodejs')
    expect([first.status, repeated.status, otherSubject.status]).toEqual([200, 200, 200])
    expect(io.assertListing).toHaveBeenCalledTimes(3)
    expect(io.assets).toHaveLength(2)
    expect(new Set(io.assets.map((asset) => asset.subject)).size).toBe(2)
    expect(new Set(io.assets.map((asset) => asset.assetKey)).size).toBe(2)
    expect(await repeated.json()).toMatchObject({
      ok: true,
      data: { favorite: true, created: false, targetType: 'listing', targetSlug: 'jing-an-100' },
    })
    expect(io.calls.every((call) => call.collection !== 'mini-user-assets' || call.overrideAccess === true)).toBe(true)
  })

  it('单 subject 已有 200 个收藏时 fail-closed 拒绝新增，且不执行 create', async () => {
    io.payloadCount.mockResolvedValueOnce({ totalDocs: 200 })

    const result = await PUT(bodyRequest('PUT', subjectToken('openid-a'), {
      targetType: 'listing',
      targetSlug: 'jing-an-100',
    }))

    expect(result.status).toBe(503)
    expect(io.payloadCount).toHaveBeenCalledWith(expect.objectContaining({
      collection: 'mini-user-assets',
      where: {
        and: [
          { subject: { equals: expect.stringMatching(/^[A-Za-z0-9_-]+$/) } },
          { kind: { in: ['favorite-listing', 'favorite-building'] } },
        ],
      },
      overrideAccess: true,
    }))
    expect(io.payloadCreate).not.toHaveBeenCalled()
  })

  it('创建竞态重查到错误 subject 时 fail-closed 为 503', async () => {
    io.payloadFind
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({
        docs: [{
          id: 99,
          assetKey: 'collision-key',
          subject: 'other-subject',
          kind: 'favorite-listing',
          targetType: 'listing',
          targetSlug: 'other-listing',
          lead: null,
          createdAt: '2026-09-04T10:00:00.000Z',
          updatedAt: '2026-09-04T10:00:00.000Z',
        }],
      })
    io.payloadCreate.mockRejectedValueOnce(new Error('unique constraint violation'))

    const result = await PUT(bodyRequest('PUT', subjectToken('openid-a'), {
      targetType: 'listing',
      targetSlug: 'jing-an-100',
    }))

    expect(result.status).toBe(503)
    await expect(result.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'service_unavailable' },
    })
    expect(io.payloadFind).toHaveBeenCalledTimes(2)
    expect(io.payloadCreate).toHaveBeenCalledTimes(1)
  })

  it('DELETE 精确取消当前 subject 且重复调用幂等，不删除另一 subject', async () => {
    const tokenA = subjectToken('openid-a')
    const tokenB = subjectToken('openid-b')
    const input = { targetType: 'building' as const, targetSlug: 'jing-an-center' }
    await PUT(bodyRequest('PUT', tokenA, input))
    await PUT(bodyRequest('PUT', tokenB, input))

    const first = await DELETE(bodyRequest('DELETE', tokenA, input))
    const repeated = await DELETE(bodyRequest('DELETE', tokenA, input))

    expect(first.status).toBe(200)
    expect(repeated.status).toBe(200)
    expect(await first.json()).toMatchObject({ ok: true, data: { favorite: false, removed: true } })
    expect(await repeated.json()).toMatchObject({ ok: true, data: { favorite: false, removed: false } })
    expect(io.assets).toHaveLength(1)
    expect(io.assets[0]?.assetKey).not.toBeNull()
    expect(io.payloadDelete).toHaveBeenCalledWith(expect.objectContaining({
      collection: 'mini-user-assets',
      overrideAccess: true,
      where: {
        and: [
          { assetKey: { equals: expect.stringMatching(/^[a-f0-9]{64}$/) } },
          { subject: { equals: expect.stringMatching(/^[A-Za-z0-9_-]+$/) } },
          { kind: { equals: 'favorite-building' } },
          { targetType: { equals: 'building' } },
          { targetSlug: { equals: 'jing-an-center' } },
        ],
      },
    }))
  })

  it('收藏目标失效后仍允许幂等 DELETE，避免用户资产超过上限时无法恢复', async () => {
    const token = subjectToken('openid-a')
    const input = { targetType: 'building' as const, targetSlug: 'jing-an-center' }
    const created = await PUT(bodyRequest('PUT', token, input))
    expect(created.status).toBe(200)
    io.assertBuilding.mockResolvedValue(null)

    const removed = await DELETE(bodyRequest('DELETE', token, input))
    const repeated = await DELETE(bodyRequest('DELETE', token, input))

    expect(removed.status).toBe(200)
    expect(repeated.status).toBe(200)
    await expect(removed.json()).resolves.toMatchObject({
      ok: true,
      data: { favorite: false, removed: true },
    })
    await expect(repeated.json()).resolves.toMatchObject({
      ok: true,
      data: { favorite: false, removed: false },
    })
  })

  it('拒绝额外字段、无效 slug 和失效公开供给，且不写 collection', async () => {
    const token = subjectToken('openid-a')
    const extraField = await PUT(bodyRequest('PUT', token, {
      targetType: 'listing', targetSlug: 'jing-an-100', subject: 'attacker',
    }))
    const badSlug = await PUT(bodyRequest('PUT', token, {
      targetType: 'listing', targetSlug: '../private',
    }))
    const unavailable = await PUT(bodyRequest('PUT', token, {
      targetType: 'listing', targetSlug: 'withdrawn-listing',
    }))

    expect([extraField.status, badSlug.status, unavailable.status]).toEqual([422, 422, 404])
    expect(io.assets).toHaveLength(0)
    expect(io.payloadCreate).not.toHaveBeenCalled()
  })
})
