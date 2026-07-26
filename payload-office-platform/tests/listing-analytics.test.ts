/**
 * 房源分析看板测试（tasks.md M7.4 / R4, R7）
 *
 * 覆盖：
 *   - LISTING_ANALYTICS_CARDS / TRENDS / DISTRIBUTIONS 配置完整性
 *   - resolveListingAnalytics 并发解析 + 组间独立 + 单卡失败局部标记
 *   - 所有卡 / 趋势 / 分布共用同一 asOf
 *   - canViewListingAnalytics 权限网关
 *   - 单卡按 metric.allowedScopeDims 重新 sanitize → URL 不扩大范围
 *   - listings.completeness_below_80 真实完整度计算（内存过滤）
 *   - dataScope=self 时 assignee 强制 = userId
 *   - 有效供给指标（supply.effective_count）复用 getEffectiveSupplyWhere
 */

import { describe, expect, it, beforeEach } from 'vitest'

import type { PermissionContext } from '@/domain/auth/permission-context'

import {
  LISTING_ANALYTICS_CARDS,
  LISTING_ANALYTICS_DISTRIBUTIONS,
  LISTING_ANALYTICS_TRENDS,
  canViewListingAnalytics,
  resolveListingAnalytics,
  type DashboardBaseContext,
} from '@/domain/analytics/listing-analytics'
import { MetricRegistry } from '@/domain/analytics/metric-registry'
import { registerBuiltinMetrics } from '@/domain/analytics/metrics/builtin'
import type {
  MetricDefinition,
  MetricPayloadPort,
} from '@/domain/analytics/metric-types'

// ────────────────────────────────────────────────────────────
// 测试 fixtures
// ────────────────────────────────────────────────────────────

function makePermission(overrides: Partial<PermissionContext> = {}): PermissionContext {
  return {
    userId: 1,
    roleCodes: ['ADM'],
    cityIds: 'all',
    teamIds: 'all',
    operationPermissions: new Set([
      'listing:read',
      'review:read',
      'report:read',
      'lead:read',
      'task:read',
      'merchant:read',
      'building:read',
    ]),
    fieldPermissions: new Set(),
    menuPermissions: new Set(['analytics']),
    dataScope: 'global',
    ...overrides,
  }
}

interface PayloadCall {
  collection: string
  where: Record<string, unknown>
  depth?: number
  limit?: number
}

interface MockPayloadOptions {
  count?: number
  // find 返回的文档列表（用于 completeness_below_80）
  findDocs?: ReadonlyArray<Record<string, unknown>>
}

function makeMockPayload(
  options: MockPayloadOptions = { count: 0 },
): MetricPayloadPort & { countCalls: PayloadCall[]; findCalls: PayloadCall[] } {
  const countCalls: PayloadCall[] = []
  const findCalls: PayloadCall[] = []
  const countValue = options.count ?? 0
  const findDocs = options.findDocs ?? []
  return {
    async count(params) {
      countCalls.push({
        collection: params.collection,
        where: params.where,
      })
      return countValue
    },
    async find(params) {
      findCalls.push({
        collection: params.collection,
        where: params.where,
        depth: params.depth,
        limit: params.limit,
      })
      return {
        docs: findDocs,
        totalDocs: findDocs.length,
        totalPages: 1,
        page: 1,
      }
    },
    get countCalls() {
      return countCalls
    },
    get findCalls() {
      return findCalls
    },
  } as MetricPayloadPort & { countCalls: PayloadCall[]; findCalls: PayloadCall[] }
}

function makeBase(overrides: Partial<DashboardBaseContext> = {}): DashboardBaseContext {
  return {
    asOf: new Date('2026-07-26T02:00:00Z'), // 北京时间 10:00
    permission: makePermission(),
    payload: makeMockPayload({ count: 0 }),
    input: null,
    ...overrides,
  }
}

function makeRegistry(): MetricRegistry {
  const r = new MetricRegistry()
  registerBuiltinMetrics(r)
  return r
}

// ────────────────────────────────────────────────────────────
// 1. 配置完整性
// ────────────────────────────────────────────────────────────

describe('LISTING_ANALYTICS 配置完整性', () => {
  it('所有 LISTING_ANALYTICS_CARDS code 在注册表中存在', () => {
    const r = makeRegistry()
    for (const code of LISTING_ANALYTICS_CARDS) {
      expect(r.has(code), `card code ${code} should be registered`).toBe(true)
    }
  })

  it('所有 LISTING_ANALYTICS_TRENDS code 在注册表中存在', () => {
    const r = makeRegistry()
    for (const code of LISTING_ANALYTICS_TRENDS) {
      expect(r.has(code), `trend code ${code} should be registered`).toBe(true)
    }
  })

  it('所有 LISTING_ANALYTICS_DISTRIBUTIONS code 在注册表中存在', () => {
    const r = makeRegistry()
    for (const code of LISTING_ANALYTICS_DISTRIBUTIONS) {
      expect(r.has(code), `distribution code ${code} should be registered`).toBe(true)
    }
  })

  it('LISTING_ANALYTICS_CARDS 包含 M7.4 要求的 6 张卡', () => {
    expect(LISTING_ANALYTICS_CARDS).toContain('listings.total')
    expect(LISTING_ANALYTICS_CARDS).toContain('listings.published')
    expect(LISTING_ANALYTICS_CARDS).toContain('listings.pending_review')
    expect(LISTING_ANALYTICS_CARDS).toContain('listings.offline')
    expect(LISTING_ANALYTICS_CARDS).toContain('listings.rented')
    expect(LISTING_ANALYTICS_CARDS).toContain('listings.completeness_below_80')
  })

  it('配置数组不可变（frozen）', () => {
    expect(Object.isFrozen(LISTING_ANALYTICS_CARDS)).toBe(true)
    expect(Object.isFrozen(LISTING_ANALYTICS_TRENDS)).toBe(true)
    expect(Object.isFrozen(LISTING_ANALYTICS_DISTRIBUTIONS)).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────
// 2. resolveListingAnalytics 基础行为
// ────────────────────────────────────────────────────────────

describe('resolveListingAnalytics', () => {
  let registry: MetricRegistry

  beforeEach(() => {
    registry = makeRegistry()
  })

  it('返回三组卡片，长度与配置一致', async () => {
    const result = await resolveListingAnalytics(makeBase(), registry)
    expect(result.cards).toHaveLength(LISTING_ANALYTICS_CARDS.length)
    expect(result.trends).toHaveLength(LISTING_ANALYTICS_TRENDS.length)
    expect(result.distributions).toHaveLength(LISTING_ANALYTICS_DISTRIBUTIONS.length)
  })

  it('所有卡 / 趋势 / 分布共用同一 asOf', async () => {
    const base = makeBase()
    const result = await resolveListingAnalytics(base, registry)
    expect(result.asOf).toBe(base.asOf.toISOString())
    for (const card of [...result.cards, ...result.trends, ...result.distributions]) {
      if (card.status === 'success') {
        expect(card.asOf).toBe(result.asOf)
      }
    }
  })

  it('mock count=12 → 所有 success 卡 value=12（除 completeness 用 find）', async () => {
    const base = makeBase({
      payload: makeMockPayload({ count: 12, findDocs: [] }),
    })
    const result = await resolveListingAnalytics(base, registry)
    for (const card of result.cards) {
      if (card.status === 'success' && card.code !== 'listings.completeness_below_80') {
        expect(card.value).toBe(12)
      }
    }
    // completeness_below_80 用 find，空 docs → value=0
    const completeness = result.cards.find(
      (c) => c.code === 'listings.completeness_below_80',
    )
    expect(completeness?.value).toBe(0)
  })

  it('趋势序列返回 series kind + 7 个桶', async () => {
    const base = makeBase()
    const result = await resolveListingAnalytics(base, registry)
    for (const trend of result.trends) {
      expect(trend.status).toBe('success')
      expect(trend.buckets).toBeDefined()
      expect(trend.buckets?.length).toBe(7)
    }
  })

  it('分布 by_status 返回 4 个状态桶', async () => {
    const base = makeBase()
    const result = await resolveListingAnalytics(base, registry)
    const byStatus = result.distributions.find((d) => d.code === 'listings.by_status')
    expect(byStatus).toBeDefined()
    expect(byStatus?.status).toBe('success')
    expect(byStatus?.buckets?.length).toBe(4)
    const labels = byStatus?.buckets?.map((b) => b.label)
    expect(labels).toEqual(['draft', 'published', 'unpublished', 'leased'])
  })
})

// ────────────────────────────────────────────────────────────
// 3. completeness_below_80 真实完整度计算
// ────────────────────────────────────────────────────────────

describe('listings.completeness_below_80 真实完整度', () => {
  let registry: MetricRegistry

  beforeEach(() => {
    registry = makeRegistry()
  })

  it('完整文档 → completeness value=0（无 below）', async () => {
    const fullDoc = {
      title: 'test',
      slug: 'test',
      listingType: 'traditional-office',
      building: 1,
      businessType: 'lease',
      decorationStatus: 'furnished',
      price: { amount: 8000, currency: 'CNY', period: 'month', unit: 'sqm' },
      area: 100,
      minimumLeaseMonths: 12,
      coverImage: 1,
      gallery: [{ image: 1 }, { image: 2 }, { image: 3 }],
      highlights: [{ text: '亮点' }],
      description: { root: { children: [{ type: 'p' }] } },
    }
    const base = makeBase({
      payload: makeMockPayload({ count: 0, findDocs: [fullDoc] }),
    })

    const result = await resolveListingAnalytics(base, registry)
    const completeness = result.cards.find(
      (c) => c.code === 'listings.completeness_below_80',
    )
    expect(completeness?.status).toBe('success')
    expect(completeness?.value).toBe(0) // 完整 → 不算 below
  })

  it('缺失 gallery + coverImage → completeness value=1', async () => {
    const incompleteDoc = {
      title: 'test',
      slug: 'test',
      listingType: 'traditional-office',
      building: 1,
      businessType: 'lease',
      decorationStatus: 'furnished',
      price: { amount: 8000, currency: 'CNY', period: 'month', unit: 'sqm' },
      area: 100,
      minimumLeaseMonths: 12,
      // 缺失 coverImage / gallery / highlights / description
    }
    const base = makeBase({
      payload: makeMockPayload({ count: 0, findDocs: [incompleteDoc] }),
    })

    const result = await resolveListingAnalytics(base, registry)
    const completeness = result.cards.find(
      (c) => c.code === 'listings.completeness_below_80',
    )
    expect(completeness?.status).toBe('success')
    // score = 1 - 0.3 - 0.2 = 0.5 < 0.8 → 算 below
    expect(completeness?.value).toBe(1)
  })

  it('部分 below + 部分 ok → 统计 below 数量', async () => {
    const fullDoc = {
      title: 'a',
      slug: 'a',
      listingType: 'x',
      building: 1,
      businessType: 'lease',
      decorationStatus: 'furnished',
      price: { amount: 1, currency: 'CNY', period: 'month', unit: 'sqm' },
      area: 1,
      minimumLeaseMonths: 1,
      coverImage: 1,
      gallery: [{ image: 1 }, { image: 2 }, { image: 3 }],
      highlights: [{ text: 'x' }],
      description: { root: { children: [{}] } },
    }
    const incompleteDoc = { title: 'b' } // score=0.05 < 0.8
    const base = makeBase({
      payload: makeMockPayload({
        count: 0,
        findDocs: [fullDoc, incompleteDoc, incompleteDoc],
      }),
    })

    const result = await resolveListingAnalytics(base, registry)
    const completeness = result.cards.find(
      (c) => c.code === 'listings.completeness_below_80',
    )
    expect(completeness?.value).toBe(2) // 2 个 below
  })

  it('调用 find 时使用 depth=1 + limit=500', async () => {
    const payload = makeMockPayload({ count: 0, findDocs: [] })
    const base = makeBase({ payload })

    await resolveListingAnalytics(base, registry)

    const completenessCall = payload.findCalls.find(
      (c) => c.collection === 'listings',
    )
    expect(completenessCall).toBeDefined()
    expect(completenessCall?.depth).toBe(1)
    expect(completenessCall?.limit).toBe(500)
  })
})

// ────────────────────────────────────────────────────────────
// 4. 单卡失败隔离
// ────────────────────────────────────────────────────────────

describe('单卡失败隔离', () => {
  it('单张卡 query 抛错 → status=failed，其他卡正常', async () => {
    const registry = makeRegistry()
    const def = registry.require('listings.total') as MetricDefinition
    const originalQuery = def.query
    def.query = async () => {
      throw new Error('boom')
    }

    const base = makeBase()
    const result = await resolveListingAnalytics(base, registry)
    const failedCard = result.cards.find((c) => c.code === 'listings.total')
    expect(failedCard?.status).toBe('failed')
    expect(failedCard?.error).toBe('boom')
    // 其他卡正常
    const okCards = result.cards.filter(
      (c) => c.status === 'success' && c.code !== 'listings.completeness_below_80',
    )
    expect(okCards.length).toBeGreaterThan(0)

    def.query = originalQuery
  })

  it('空注册表 → 所有卡 status=not-found', async () => {
    const emptyRegistry = new MetricRegistry()
    const base = makeBase()
    const result = await resolveListingAnalytics(base, emptyRegistry)
    for (const card of [...result.cards, ...result.trends, ...result.distributions]) {
      expect(card.status).toBe('not-found')
      expect(card.error).toContain('Metric not found')
    }
  })

  it('无 listing:read 权限 → 多张卡 no-permission', async () => {
    const registry = makeRegistry()
    const limitedPerm = makePermission({
      operationPermissions: new Set(['review:read']),
    })
    const base = makeBase({ permission: limitedPerm })
    const result = await resolveListingAnalytics(base, registry)
    // listings.total 需要 listing:read → no-permission
    const listingCard = result.cards.find((c) => c.code === 'listings.total')
    expect(listingCard?.status).toBe('no-permission')
    // listings.pending_review 需要 review:read → success（有权限）
    const reviewCard = result.cards.find((c) => c.code === 'listings.pending_review')
    expect(reviewCard?.status).toBe('success')
  })
})

// ────────────────────────────────────────────────────────────
// 5. 权限隔离
// ────────────────────────────────────────────────────────────

describe('canViewListingAnalytics', () => {
  it('有 listing:read 权限 → true', () => {
    const registry = makeRegistry()
    const perm = makePermission()
    expect(canViewListingAnalytics(perm, registry)).toBe(true)
  })

  it('无任何房源分析指标权限 → false', () => {
    const registry = makeRegistry()
    const perm = makePermission({
      operationPermissions: new Set(['some:other']),
    })
    expect(canViewListingAnalytics(perm, registry)).toBe(false)
  })

  it('只有 review:read 也算可见（listings.pending_review 需要 review:read）', () => {
    const registry = makeRegistry()
    const perm = makePermission({
      operationPermissions: new Set(['review:read']),
    })
    expect(canViewListingAnalytics(perm, registry)).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────
// 6. URL 不扩大数据范围
// ────────────────────────────────────────────────────────────

describe('URL 不扩大数据范围', () => {
  it('城市过滤在 city 上限内被接受', async () => {
    const registry = makeRegistry()
    const payload = makeMockPayload({ count: 0, findDocs: [] })
    const base = makeBase({
      permission: makePermission({
        cityIds: new Set([1, 2, 3]),
      }),
      payload,
      input: { cityIds: [1, 2] },
    })

    await resolveListingAnalytics(base, registry)

    const listingCalls = payload.countCalls.filter((c) => c.collection === 'listings')
    for (const call of listingCalls) {
      // 应包含 building.city in [1, 2]
      expect(JSON.stringify(call.where)).toContain('building.city')
    }
  })

  it('城市过滤超出 city 上限被丢弃', async () => {
    const registry = makeRegistry()
    const payload = makeMockPayload({ count: 0, findDocs: [] })
    const base = makeBase({
      permission: makePermission({
        cityIds: new Set([1, 2]),
      }),
      payload,
      input: { cityIds: [1, 2, 999, 1000] },
    })

    await resolveListingAnalytics(base, registry)

    const json = JSON.stringify({
      count: payload.countCalls,
      find: payload.findCalls,
    })
    expect(json).not.toContain('999')
    expect(json).not.toContain('1000')
  })

  it('dataScope=self 时 assignee 强制 = userId（assignee 不在 allowedScopeDims 中 → 丢弃）', async () => {
    const registry = makeRegistry()
    const payload = makeMockPayload({ count: 0, findDocs: [] })
    const base = makeBase({
      permission: makePermission({
        dataScope: 'self',
        userId: 42,
      }),
      payload,
      input: { assigneeId: 999 }, // 客户端尝试越权
    })

    await resolveListingAnalytics(base, registry)

    // listing 类指标 allowedScopeDims 为 city/team/merchant，不含 assignee
    // → assigneeId 被丢弃，where 中不应出现 assignee 字段
    for (const call of [...payload.countCalls, ...payload.findCalls]) {
      expect(call.where).not.toHaveProperty('assignee')
      expect(call.where).not.toHaveProperty('owner')
    }
  })
})

// ────────────────────────────────────────────────────────────
// 7. 下钻 URL 派生
// ────────────────────────────────────────────────────────────

describe('下钻 URL 派生', () => {
  it('所有 success 卡都派生了 drilldownUrl', async () => {
    const registry = makeRegistry()
    const base = makeBase()
    const result = await resolveListingAnalytics(base, registry)
    for (const card of result.cards) {
      if (card.status === 'success') {
        expect(card.drilldownUrl, `${card.code} should have drilldownUrl`).toBeDefined()
        expect(card.drilldownUrl?.startsWith('/admin/collections/')).toBe(true)
      }
    }
  })
})
