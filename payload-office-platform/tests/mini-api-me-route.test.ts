import { createHmac } from 'node:crypto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { issueAnonymousContextToken } from '@/domain/mini-program/session'

const io = vi.hoisted(() => ({
  rateKeys: [] as string[],
  rateCounts: new Map<string, number>(),
  rateStoreFails: false,
  getPayload: vi.fn(),
  payloadFind: vi.fn(),
  assertListing: vi.fn(),
  assertBuilding: vi.fn(),
}))

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

import { GET, runtime } from '@/app/api/mini/v1/me/route'
import { __resetMiniRateLimitStateForTests } from '@/app/api/mini/v1/rate-limit-state'

const SIGNING_SECRET = Uint8Array.from({ length: 32 }, (_, index) => index + 1)
const SIGNING_SECRET_ENV = Buffer.from(SIGNING_SECRET).toString('base64url')
const ORIGINAL_SIGNING_SECRET = process.env.MINI_SESSION_SIGNING_SECRET
const ORIGINAL_TRUSTED_PROXY_HOPS = process.env.MINI_TRUSTED_PROXY_HOPS

function tokenFor(openId: string): string {
  return issueAnonymousContextToken(openId, {
    signingSecret: SIGNING_SECRET,
    now: () => Date.now(),
    randomBytes: (size) => Uint8Array.from({ length: size }, (_, index) => index + 1),
  }).token
}

function subjectFor(openId: string): string {
  return createHmac('sha256', Buffer.from(SIGNING_SECRET))
    .update(`mini-anonymous-sub-v1|${openId}`, 'utf8')
    .digest('base64url')
}

function authRequest(token: string | null, headers: Record<string, string> = {}): Request {
  return new Request('https://example.test/api/mini/v1/me', {
    headers: {
      'x-forwarded-for': '203.0.113.10',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  })
}

function forbiddenKeyPaths(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => forbiddenKeyPaths(entry, `${path}[${index}]`))
  }
  if (typeof value !== 'object' || value === null) return []
  const forbidden = /^(?:id|openid|openId|subject|assetKey|idempotencyKey|lead|phone|notes|owner|assignee)$/i
  return Object.entries(value).flatMap(([key, entry]) => [
    ...(forbidden.test(key) ? [`${path}.${key}`] : []),
    ...forbiddenKeyPaths(entry, `${path}.${key}`),
  ])
}

function requestedKinds(call: unknown): readonly string[] {
  if (typeof call !== 'object' || call === null || Array.isArray(call)) return []
  const where = Object.getOwnPropertyDescriptor(call, 'where')?.value
  if (typeof where !== 'object' || where === null || Array.isArray(where)) return []
  const and = Object.getOwnPropertyDescriptor(where, 'and')?.value
  if (!Array.isArray(and)) return []
  for (const condition of and) {
    if (typeof condition !== 'object' || condition === null || Array.isArray(condition)) continue
    const kind = Object.getOwnPropertyDescriptor(condition, 'kind')?.value
    if (typeof kind !== 'object' || kind === null || Array.isArray(kind)) continue
    const values = Object.getOwnPropertyDescriptor(kind, 'in')?.value
    if (Array.isArray(values) && values.every((value) => typeof value === 'string')) return values
  }
  return []
}

beforeEach(() => {
  process.env.MINI_SESSION_SIGNING_SECRET = SIGNING_SECRET_ENV
  process.env.MINI_TRUSTED_PROXY_HOPS = '1'
  io.rateKeys.length = 0
  io.rateCounts.clear()
  io.rateStoreFails = false
  io.getPayload.mockReset()
  io.payloadFind.mockReset()
  io.assertListing.mockReset()
  io.assertBuilding.mockReset()

  const docs = [
    {
      id: 901,
      assetKey: 'secret-favorite-key',
      subject: subjectFor('openid-a'),
      kind: 'favorite-listing',
      targetType: 'listing',
      targetSlug: 'jing-an-100',
      lead: null,
      createdAt: '2026-09-04T09:00:00.000Z',
    },
    {
      id: 902,
      assetKey: 'secret-withdrawn-key',
      subject: subjectFor('openid-a'),
      kind: 'favorite-building',
      targetType: 'building',
      targetSlug: 'withdrawn-building',
      lead: null,
      createdAt: '2026-09-04T09:05:00.000Z',
    },
    {
      id: 903,
      assetKey: 'secret-inquiry-key',
      subject: subjectFor('openid-a'),
      kind: 'inquiry',
      targetType: 'listing',
      targetSlug: 'jing-an-100',
      createdAt: '2026-09-04T09:10:00.000Z',
      lead: {
        id: 7001,
        stage: 'following',
        status: 'contacted',
        phone: '13800000000',
        notes: '内部备注',
        idempotencyKey: 'lead-secret-key',
        owner: { id: 42, phone: '13900000000', name: '内部顾问' },
      },
    },
    {
      id: 999,
      assetKey: 'other-subject-key',
      subject: subjectFor('openid-b'),
      kind: 'favorite-listing',
      targetType: 'listing',
      targetSlug: 'other-subject-listing',
      createdAt: '2026-09-04T09:15:00.000Z',
    },
  ]
  io.payloadFind.mockImplementation(async (call) => {
    const kinds = requestedKinds(call)
    const subject = subjectFor('openid-a')
    const matches = docs.filter((doc) => doc.subject === subject && kinds.includes(doc.kind))
    const limit = typeof call?.limit === 'number' ? call.limit : matches.length
    return {
      totalDocs: matches.length,
      docs: matches.slice(0, limit),
    }
  })
  io.getPayload.mockResolvedValue({ db: { pool: {} }, find: io.payloadFind })
  io.assertListing.mockImplementation(async (slug: string) => (
    slug === 'jing-an-100'
      ? {
          id: 71,
          slug,
          title: '静安中心 100㎡',
          citySlug: 'shanghai',
          cityName: '上海',
          price: null,
          area: 100,
          seats: null,
          listingType: 'traditional-office',
          availableFrom: null,
          building: {
            id: 8,
            slug: 'jing-an-center',
            name: '静安中心',
            address: '南京西路 1 号',
            district: { id: 9, slug: 'jing-an', name: '静安区' },
          },
          coverImage: { id: 88, src: '/cover.jpg', alt: '办公区', uploader: { phone: '13700000000' } },
          highlights: ['近地铁'],
          stableSortKey: '71',
        }
      : null
  ))
  io.assertBuilding.mockResolvedValue(null)
})

afterEach(() => {
  if (ORIGINAL_SIGNING_SECRET === undefined) delete process.env.MINI_SESSION_SIGNING_SECRET
  else process.env.MINI_SESSION_SIGNING_SECRET = ORIGINAL_SIGNING_SECRET
  if (ORIGINAL_TRUSTED_PROXY_HOPS === undefined) delete process.env.MINI_TRUSTED_PROXY_HOPS
  else process.env.MINI_TRUSTED_PROXY_HOPS = ORIGINAL_TRUSTED_PROXY_HOPS
})

describe('GET /api/mini/v1/me', () => {
  beforeEach(() => {
    __resetMiniRateLimitStateForTests()
  })

  it('同 subject 与可信 client IP 的第 31 次读取返回 429，且不同 subject 不共享配额', async () => {
    const tokenA = tokenFor('openid-a')
    for (let index = 0; index < 30; index += 1) {
      const allowed = await GET(authRequest(tokenA))
      expect(allowed.status).toBe(200)
    }

    const blocked = await GET(authRequest(tokenA))
    const otherSubject = await GET(authRequest(tokenFor('openid-b')))

    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('retry-after')).toMatch(/^\d+$/)
    await expect(blocked.json()).resolves.toMatchObject({ error: { code: 'rate_limited' } })
    expect(otherSubject.status).toBe(200)
    expect(new Set(io.rateKeys)).toHaveLength(2)
    expect(io.rateKeys.every((key) => /^mini-me-read:[a-f0-9]{32}$/.test(key))).toBe(true)
    expect(io.rateKeys.join('|')).not.toContain('openid')
    expect(io.rateKeys.join('|')).not.toContain('203.0.113.10')
  })

  it('限流存储失败时 fail-closed，且不读取用户资产或投影公开供给', async () => {
    io.rateStoreFails = true

    const response = await GET(authRequest(tokenFor('openid-a')))

    expect(response.status).toBe(503)
    expect(io.payloadFind).not.toHaveBeenCalled()
    expect(io.assertListing).not.toHaveBeenCalled()
    expect(io.assertBuilding).not.toHaveBeenCalled()
  })

  it('历史资产超过展示上限仍返回近期有界结果，并显式标记每类 hasMore', async () => {
    io.payloadFind.mockImplementation(async (call) => {
      const kinds = requestedKinds(call)
      if (kinds.includes('inquiry')) {
        const doc = {
          id: 903,
          assetKey: 'secret-inquiry-key',
          subject: subjectFor('openid-a'),
          kind: 'inquiry',
          targetType: 'listing',
          targetSlug: 'jing-an-100',
          createdAt: '2026-09-04T09:10:00.000Z',
          lead: { stage: 'following', status: 'contacted' },
        }
        return {
          totalDocs: 101,
          docs: Array.from({ length: 101 }, (_, index) => ({
            ...doc,
            id: 903 + index,
            assetKey: `secret-inquiry-key-${index}`,
          })),
        }
      }
      const doc = {
        id: 901,
        assetKey: 'secret-favorite-key',
        subject: subjectFor('openid-a'),
        kind: 'favorite-listing',
        targetType: 'listing',
        targetSlug: 'jing-an-100',
        lead: null,
        createdAt: '2026-09-04T09:00:00.000Z',
      }
      return {
        totalDocs: 201,
        docs: Array.from({ length: 201 }, (_, index) => ({
          ...doc,
          id: 901 + index,
          assetKey: `secret-favorite-key-${index}`,
        })),
      }
    })

    const response = await GET(authRequest(tokenFor('openid-a')))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(io.payloadFind).toHaveBeenCalledTimes(2)
    expect(io.payloadFind.mock.calls.map(([call]) => call.limit)).toEqual([201, 101])
    expect(io.payloadFind.mock.calls.every(([call]) => call.pagination === false)).toBe(true)
    expect(body).toMatchObject({
      ok: true,
      data: {
        counts: { favorites: 200, inquiries: 100 },
        pageInfo: {
          favorites: { limit: 200, hasMore: true },
          inquiries: { limit: 100, hasMore: true },
        },
      },
    })
    expect(io.assertListing).toHaveBeenCalled()
  })

  it('无 Bearer 或过期 Bearer 返回 401，且不读 Payload', async () => {
    const missing = await GET(authRequest(null))
    expect(missing.status).toBe(401)

    const expired = issueAnonymousContextToken('expired-openid', {
      signingSecret: SIGNING_SECRET,
      now: () => Date.now() - 16 * 60 * 1000,
      randomBytes: (size) => Uint8Array.from({ length: size }, (_, index) => index + 1),
    }).token
    const expiredResponse = await GET(authRequest(expired))
    expect(expiredResponse.status).toBe(401)
    expect(io.getPayload).not.toHaveBeenCalled()
  })

  it('只读当前 subject，隐藏失效收藏并递归投影严格白名单', async () => {
    const response = await GET(authRequest(tokenFor('openid-a')))
    const body: unknown = await response.json()

    expect(runtime).toBe('nodejs')
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(io.payloadFind).toHaveBeenCalledTimes(2)
    for (const [call] of io.payloadFind.mock.calls) {
      expect(call).toEqual(expect.objectContaining({
        collection: 'mini-user-assets',
        overrideAccess: true,
        depth: 1,
        limit: expect.any(Number),
        where: {
          and: [
            { subject: { equals: expect.stringMatching(/^[A-Za-z0-9_-]+$/) } },
            { kind: { in: expect.any(Array) } },
          ],
        },
        select: {
          assetKey: true,
          subject: true,
          kind: true,
          targetType: true,
          targetSlug: true,
          lead: true,
          createdAt: true,
        },
        populate: { leads: { stage: true, status: true } },
      }))
    }
    expect(io.payloadFind.mock.calls.map(([call]) => call.limit)).toEqual([201, 101])
    expect(io.payloadFind.mock.calls.every(([call]) => call.pagination === false)).toBe(true)
    expect(io.assertListing).not.toHaveBeenCalledWith('other-subject-listing', expect.anything())
    expect(body).toMatchObject({
      ok: true,
      data: {
        counts: { favorites: 1, inquiries: 1 },
        pageInfo: {
          favorites: { limit: 200, hasMore: false },
          inquiries: { limit: 100, hasMore: false },
        },
        favorites: {
          listings: [{ slug: 'jing-an-100', title: '静安中心 100㎡' }],
          buildings: [],
        },
        inquiries: [{
          targetType: 'listing',
          targetSlug: 'jing-an-100',
          targetTitle: '静安中心 100㎡',
          submittedAt: '2026-09-04T09:10:00.000Z',
          status: { value: 'following', label: '跟进中' },
        }],
      },
    })
    expect(forbiddenKeyPaths(body)).toEqual([])
    const serialized = JSON.stringify(body)
    for (const sensitive of [
      'secret-favorite-key',
      'secret-inquiry-key',
      'lead-secret-key',
      '13800000000',
      '13900000000',
      '内部备注',
      '内部顾问',
      'other-subject-listing',
    ]) {
      expect(serialized).not.toContain(sensitive)
    }
  })

  it('Payload 查询失败时 fail-closed 为 503，不返回部分资产', async () => {
    io.payloadFind.mockRejectedValueOnce(new Error('database unavailable'))
    const response = await GET(authRequest(tokenFor('openid-a')))

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'service_unavailable' },
    })
  })
})
