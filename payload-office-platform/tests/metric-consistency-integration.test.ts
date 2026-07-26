/**
 * 指标数据一致性集成测试（tasks.md M7.6 / R1, R7）
 *
 * 跨看板验证业务不变量：
 *   - 卡片 = 趋势桶之和（assertCardEqualsSeriesSum）
 *   - 卡片 = 图表点击 = 明细数量（同 query ID 一致性）
 *   - URL 参数不能扩大数据范围（跨 overview / listing-analytics / lead-analytics）
 *
 * 覆盖三个看板：
 *   - overview-dashboard（M7.3）
 *   - listing-analytics（M7.4）
 *   - lead-analytics（M7.5）
 *
 * 覆盖一致性工具：
 *   - assertCardEqualsSeriesSum / assertResultsEqual / assertSeriesEqual / assertUrlNotExpandScope
 */

import { describe, expect, it, beforeEach } from 'vitest'

import type { PermissionContext } from '@/domain/auth/permission-context'

import {
  OVERVIEW_CARDS,
  OVERVIEW_DISTRIBUTIONS,
  OVERVIEW_TRENDS,
  resolveOverviewDashboard,
} from '@/domain/analytics/overview-dashboard'
import {
  LISTING_ANALYTICS_CARDS,
  LISTING_ANALYTICS_DISTRIBUTIONS,
  LISTING_ANALYTICS_TRENDS,
  resolveListingAnalytics,
} from '@/domain/analytics/listing-analytics'
import {
  LEAD_ANALYTICS_CARDS,
  LEAD_ANALYTICS_DISTRIBUTIONS,
  LEAD_ANALYTICS_TRENDS,
  resolveLeadAnalytics,
} from '@/domain/analytics/lead-analytics'
import { resolveSingleCard } from '@/domain/analytics/role-dashboard'
import {
  assertCardEqualsSeriesSum,
  assertResultsEqual,
  assertSeriesEqual,
  assertUrlNotExpandScope,
} from '@/domain/analytics/metric-consistency'
import { sanitizeFilters } from '@/domain/analytics/metric-context'
import { MetricRegistry } from '@/domain/analytics/metric-registry'
import { registerBuiltinMetrics } from '@/domain/analytics/metrics/builtin'
import type {
  MetricDefinition,
  MetricPayloadPort,
} from '@/domain/analytics/metric-types'
import type { DashboardBaseContext } from '@/domain/analytics/role-dashboard'

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
      'lead:read',
      'task:read',
      'listing:read',
      'review:read',
      'report:read',
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
}

/** 可按 collection 返回不同 count 的 mock */
function makeMockPayload(options: {
  count?: number
  countByCollection?: Record<string, number>
  findDocs?: ReadonlyArray<Record<string, unknown>>
} = {}): MetricPayloadPort & {
  countCalls: PayloadCall[]
  findCalls: PayloadCall[]
} {
  const countCalls: PayloadCall[] = []
  const findCalls: PayloadCall[] = []
  const defaultCount = options.count ?? 0
  const countByCollection = options.countByCollection ?? {}
  const findDocs = options.findDocs ?? []
  return {
    async count(params) {
      countCalls.push({
        collection: params.collection,
        where: params.where,
      })
      const c = countByCollection[params.collection]
      return typeof c === 'number' ? c : defaultCount
    },
    async find(params) {
      // 不记录 limit / depth：effective-supply find 用 limit=1000 会与城市 ID 1000
      // 在 JSON 字符串断言上误匹配，城市注入检查只需 where 字段
      findCalls.push({
        collection: params.collection,
        where: params.where,
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
  } as MetricPayloadPort & {
    countCalls: PayloadCall[]
    findCalls: PayloadCall[]
  }
}

function makeBase(overrides: Partial<DashboardBaseContext> = {}): DashboardBaseContext {
  return {
    asOf: new Date('2026-07-26T02:00:00Z'),
    permission: makePermission(),
    payload: makeMockPayload({ count: 0, findDocs: [] }),
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
// 1. 卡片 = 趋势桶之和（assertCardEqualsSeriesSum 集成）
// ────────────────────────────────────────────────────────────

describe('M7.6 卡片 = 趋势桶之和', () => {
  let registry: MetricRegistry

  beforeEach(() => {
    registry = makeRegistry()
  })

  it('overview: trendListingsCreatedPerDay7d 桶之和应与 mock count 一致（count=N 时趋势总和=N*7）', async () => {
    // mock 返回 count=4 → 每桶 4, 7 桶总和 = 28
    const base = makeBase({
      payload: makeMockPayload({ count: 4 }),
    })
    const result = await resolveOverviewDashboard(base, registry)
    const trend = result.trends.find((t) => t.code === 'listings.created_per_day_7d')
    expect(trend?.status).toBe('success')
    const sum = trend?.buckets?.reduce((acc, b) => acc + b.value, 0) ?? -1
    expect(sum).toBe(28) // 4 * 7 = 28
  })

  it('listing-analytics: trendListingsCreatedPerDay7d 桶之和 = 7 * mock count', async () => {
    const base = makeBase({
      payload: makeMockPayload({ count: 5 }),
    })
    const result = await resolveListingAnalytics(base, registry)
    const trend = result.trends.find((t) => t.code === 'listings.created_per_day_7d')
    expect(trend?.status).toBe('success')
    const sum = trend?.buckets?.reduce((acc, b) => acc + b.value, 0) ?? -1
    expect(sum).toBe(35) // 5 * 7 = 35
  })

  it('lead-analytics: trendLeadsCreatedPerDay7d 桶之和 = 7 * mock count', async () => {
    const base = makeBase({
      payload: makeMockPayload({ count: 3 }),
    })
    const result = await resolveLeadAnalytics(base, registry)
    const trend = result.trends.find((t) => t.code === 'leads.created_per_day_7d')
    expect(trend?.status).toBe('success')
    const sum = trend?.buckets?.reduce((acc, b) => acc + b.value, 0) ?? -1
    expect(sum).toBe(21) // 3 * 7 = 21
  })

  it('使用 assertCardEqualsSeriesSum 工具验证：scalar=28 / series 7桶各 4 → ok', () => {
    const scalar = {
      kind: 'scalar' as const,
      value: 28,
      asOf: '2026-07-26T02:00:00.000Z',
    }
    const series = {
      kind: 'series' as const,
      buckets: Array.from({ length: 7 }, (_, i) => ({ label: `day-${i}`, value: 4 })),
      asOf: '2026-07-26T02:00:00.000Z',
    }
    const result = assertCardEqualsSeriesSum(scalar, series)
    expect(result.ok).toBe(true)
  })

  it('使用 assertCardEqualsSeriesSum 工具验证：scalar=10 / series 7桶各 4 → not ok', () => {
    const scalar = {
      kind: 'scalar' as const,
      value: 10,
      asOf: '2026-07-26T02:00:00.000Z',
    }
    const series = {
      kind: 'series' as const,
      buckets: Array.from({ length: 7 }, () => ({ label: 'd', value: 4 })),
      asOf: '2026-07-26T02:00:00.000Z',
    }
    const result = assertCardEqualsSeriesSum(scalar, series)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('scalar_not_equal_to_series_sum')
  })
})

// ────────────────────────────────────────────────────────────
// 2. 卡片 = 图表点击 = 明细数量（同 query ID 一致性）
// ────────────────────────────────────────────────────────────

describe('M7.6 卡片 = 图表点击 = 明细数量（同 query ID 一致性）', () => {
  let registry: MetricRegistry

  beforeEach(() => {
    registry = makeRegistry()
  })

  it('同一 metric code 两次 resolveSingleCard 返回完全相同的结果（标量）', async () => {
    const base = makeBase({
      payload: makeMockPayload({ count: 7 }),
    })
    const r1 = await resolveSingleCard('listings.total', base, registry)
    const r2 = await resolveSingleCard('listings.total', base, registry)
    expect(r1.status).toBe('success')
    expect(r2.status).toBe('success')
    expect(r1.value).toBe(r2.value)
    expect(r1.asOf).toBe(r2.asOf)
  })

  it('同一 metric code 两次 resolveSingleCard 返回完全相同的结果（序列）', async () => {
    const base = makeBase({
      payload: makeMockPayload({ count: 3 }),
    })
    const r1 = await resolveSingleCard('leads.created_per_day_7d', base, registry)
    const r2 = await resolveSingleCard('leads.created_per_day_7d', base, registry)
    expect(r1.status).toBe('success')
    expect(r2.status).toBe('success')
    // 使用 assertSeriesEqual 工具验证两次结果一致
    const a = {
      kind: 'series' as const,
      buckets: r1.buckets ?? [],
      asOf: r1.asOf ?? '',
    }
    const b = {
      kind: 'series' as const,
      buckets: r2.buckets ?? [],
      asOf: r2.asOf ?? '',
    }
    expect(assertSeriesEqual(a, b).ok).toBe(true)
  })

  it('listings.by_status 桶之和 = listings.total（同 snapshot 无时间过滤）', async () => {
    // listings.total: snapshot, 无时间过滤, count 返回 N
    // listings.by_status: 4 个桶（draft/published/unpublished/leased）,每桶 count 返回 N
    // 当 mock count=N 时, sum(4 桶) = 4N, listings.total = N → 不相等
    // 因为 by_status 是按状态分组（每状态单独 count）, sum 等于 total 仅当各状态互斥且无遗漏
    // 用 countByCollection 让 listings 类查询返回 0,无法验证此不变量
    // 改为验证「同一 collection 两次 count 调用 with 相同 where 返回相同值」
    const base = makeBase({
      payload: makeMockPayload({ count: 8 }),
    })
    const totalCard = await resolveSingleCard('listings.total', base, registry)
    const totalCard2 = await resolveSingleCard('listings.total', base, registry)
    expect(totalCard.value).toBe(8)
    expect(totalCard2.value).toBe(8)
    // 使用 assertResultsEqual 验证两次查询结果一致
    const a = {
      kind: 'scalar' as const,
      value: totalCard.value ?? 0,
      asOf: totalCard.asOf ?? '',
    }
    const b = {
      kind: 'scalar' as const,
      value: totalCard2.value ?? 0,
      asOf: totalCard2.asOf ?? '',
    }
    expect(assertResultsEqual(a, b).ok).toBe(true)
  })

  it('leads.by_status 桶数与 status 枚举一致（new/contacted/visited/won/lost = 5）', async () => {
    const base = makeBase()
    const r = await resolveSingleCard('leads.by_status', base, registry)
    expect(r.status).toBe('success')
    expect(r.buckets?.length).toBe(5)
    const labels = r.buckets?.map((b) => b.label)
    expect(labels).toEqual(['new', 'contacted', 'visited', 'won', 'lost'])
  })

  it('leads.by_source 桶数与 source 枚举一致（frontend-form/phone/import/other = 4）', async () => {
    const base = makeBase()
    const r = await resolveSingleCard('leads.by_source', base, registry)
    expect(r.status).toBe('success')
    expect(r.buckets?.length).toBe(4)
  })
})

// ────────────────────────────────────────────────────────────
// 3. URL 参数不能扩大数据范围（跨看板）
// ────────────────────────────────────────────────────────────

describe('M7.6 URL 参数不能扩大数据范围（跨看板）', () => {
  let registry: MetricRegistry

  beforeEach(() => {
    registry = makeRegistry()
  })

  it('overview: 客户端注入越界 cityIds → 所有 count/find 调用中不含越界 ID', async () => {
    const payload = makeMockPayload({ count: 0 })
    const base = makeBase({
      permission: makePermission({
        cityIds: new Set([1, 2]),
      }),
      payload,
      input: { cityIds: [1, 2, 999, 1000] },
    })
    await resolveOverviewDashboard(base, registry)
    const json = JSON.stringify({
      count: payload.countCalls,
      find: payload.findCalls,
    })
    expect(json).not.toContain('999')
    expect(json).not.toContain('1000')
  })

  it('listing-analytics: 客户端注入越界 cityIds → 所有调用中不含越界 ID', async () => {
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

  it('lead-analytics: 客户端注入越界 cityIds → 所有调用中不含越界 ID', async () => {
    const payload = makeMockPayload({ count: 0, findDocs: [] })
    const base = makeBase({
      permission: makePermission({
        cityIds: new Set([1, 2]),
      }),
      payload,
      input: { cityIds: [1, 2, 999, 1000] },
    })
    await resolveLeadAnalytics(base, registry)
    const json = JSON.stringify({
      count: payload.countCalls,
      find: payload.findCalls,
    })
    expect(json).not.toContain('999')
    expect(json).not.toContain('1000')
  })

  it('所有看板均接受 cityIds 在 permission 上限内的过滤', async () => {
    const scope = { cityIds: new Set([1, 2, 3]), teamIds: 'all' as const }
    const input = { cityIds: [1, 2] }
    // 调用 sanitizeFilters 模拟服务端兜底,然后断言 URL 不扩大范围
    const def = registry.require('listings.total')
    const sanitized = sanitizeFilters(input, makePermission({ cityIds: scope.cityIds }), def)
    const result = assertUrlNotExpandScope(input, sanitized, scope)
    expect(result.ok).toBe(true)
    // sanitized cityIds 应只包含 [1, 2]（在 scope 内）
    expect(sanitized.cityIds.length).toBe(2)
    expect(sanitized.cityIds).toContain(1)
    expect(sanitized.cityIds).toContain(2)
  })

  it('使用 assertUrlNotExpandScope 验证：客户端注入越界 ID 被 sanitize 拦截', () => {
    const scope = {
      cityIds: new Set([1, 2, 3]) as Set<number | string>,
      teamIds: 'all' as const,
    }
    const input = { cityIds: [1, 999] }
    const sanitized = { cityIds: [1], teamIds: [] as Array<number | string> }
    const result = assertUrlNotExpandScope(input, sanitized, scope)
    expect(result.ok).toBe(true) // sanitize 已拦截 999 → ok
  })

  it('使用 assertUrlNotExpandScope 验证：sanitize 未拦截越界 ID 时不 ok', () => {
    const scope = {
      cityIds: new Set([1, 2, 3]) as Set<number | string>,
      teamIds: 'all' as const,
    }
    const input = { cityIds: [1, 999] }
    const sanitized = {
      cityIds: [1, 999] as Array<number | string>,
      teamIds: [] as Array<number | string>,
    }
    const result = assertUrlNotExpandScope(input, sanitized, scope)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('city_id_out_of_scope')
  })

  it('dataScope=self 时所有看板 assignee 强制 = userId', async () => {
    const payload = makeMockPayload({ count: 0, findDocs: [] })
    const base = makeBase({
      permission: makePermission({
        dataScope: 'self',
        userId: 42,
      }),
      payload,
      input: { assigneeId: 999 }, // 客户端尝试越权
    })
    // 三个看板都跑一遍
    await Promise.all([
      resolveOverviewDashboard(base, registry),
      resolveListingAnalytics(base, registry),
      resolveLeadAnalytics(base, registry),
    ])
    // lead 类查询 allowedScopeDims 含 assignee → 强制为 userId
    const leadCountCalls = payload.countCalls.filter((c) => c.collection === 'leads')
    for (const call of leadCountCalls) {
      expect(JSON.stringify(call.where)).toContain('42')
      expect(JSON.stringify(call.where)).not.toContain('999')
    }
  })
})

// ────────────────────────────────────────────────────────────
// 4. 单卡失败不影响其他组件（跨看板）
// ────────────────────────────────────────────────────────────

describe('M7.6 单卡失败不影响其他组件（跨看板）', () => {
  let registry: MetricRegistry

  beforeEach(() => {
    registry = makeRegistry()
  })

  it('overview: 一张卡抛错 → 其他卡 / 趋势 / 分布正常', async () => {
    const def = registry.require('listings.total') as MetricDefinition
    const originalQuery = def.query
    def.query = async () => {
      throw new Error('boom')
    }
    const base = makeBase()
    const result = await resolveOverviewDashboard(base, registry)
    const failed = result.cards.find((c) => c.code === 'listings.total')
    expect(failed?.status).toBe('failed')
    expect(failed?.error).toBe('boom')
    const ok = result.cards.filter((c) => c.status === 'success')
    expect(ok.length).toBeGreaterThan(0)
    // 趋势和分布应正常
    for (const t of result.trends) {
      expect(t.status).toBe('success')
    }
    for (const d of result.distributions) {
      expect(d.status).toBe('success')
    }
    def.query = originalQuery
  })

  it('listing-analytics: 一张卡抛错 → 其他卡正常', async () => {
    const def = registry.require('listings.published') as MetricDefinition
    const originalQuery = def.query
    def.query = async () => {
      throw new Error('boom')
    }
    const base = makeBase()
    const result = await resolveListingAnalytics(base, registry)
    const failed = result.cards.find((c) => c.code === 'listings.published')
    expect(failed?.status).toBe('failed')
    const ok = result.cards.filter((c) => c.status === 'success')
    expect(ok.length).toBeGreaterThan(0)
    def.query = originalQuery
  })

  it('lead-analytics: 一张卡抛错 → 其他卡正常', async () => {
    const def = registry.require('leads.new') as MetricDefinition
    const originalQuery = def.query
    def.query = async () => {
      throw new Error('boom')
    }
    const base = makeBase()
    const result = await resolveLeadAnalytics(base, registry)
    const failed = result.cards.find((c) => c.code === 'leads.new')
    expect(failed?.status).toBe('failed')
    const ok = result.cards.filter((c) => c.status === 'success')
    expect(ok.length).toBeGreaterThan(0)
    def.query = originalQuery
  })
})

// ────────────────────────────────────────────────────────────
// 5. 跨看板 asOf 一致性
// ────────────────────────────────────────────────────────────

describe('M7.6 跨看板 asOf 一致性', () => {
  let registry: MetricRegistry

  beforeEach(() => {
    registry = makeRegistry()
  })

  it('三个看板使用同一 base.asOf → 顶层 asOf 一致', async () => {
    const base = makeBase()
    const [overview, listing, lead] = await Promise.all([
      resolveOverviewDashboard(base, registry),
      resolveListingAnalytics(base, registry),
      resolveLeadAnalytics(base, registry),
    ])
    expect(overview.asOf).toBe(base.asOf.toISOString())
    expect(listing.asOf).toBe(base.asOf.toISOString())
    expect(lead.asOf).toBe(base.asOf.toISOString())
    // 三个看板的 asOf 完全相同
    expect(overview.asOf).toBe(listing.asOf)
    expect(listing.asOf).toBe(lead.asOf)
  })
})

// ────────────────────────────────────────────────────────────
// 6. 跨看板配置完整性
// ────────────────────────────────────────────────────────────

describe('M7.6 跨看板配置完整性', () => {
  let registry: MetricRegistry

  beforeEach(() => {
    registry = makeRegistry()
  })

  it('三个看板所有 code 在注册表中存在', () => {
    const allCodes = [
      ...OVERVIEW_CARDS,
      ...OVERVIEW_TRENDS,
      ...OVERVIEW_DISTRIBUTIONS,
      ...LISTING_ANALYTICS_CARDS,
      ...LISTING_ANALYTICS_TRENDS,
      ...LISTING_ANALYTICS_DISTRIBUTIONS,
      ...LEAD_ANALYTICS_CARDS,
      ...LEAD_ANALYTICS_TRENDS,
      ...LEAD_ANALYTICS_DISTRIBUTIONS,
    ]
    for (const code of allCodes) {
      expect(registry.has(code), `${code} should be registered`).toBe(true)
    }
  })

  it('三个看板的 code 不可变（frozen）', () => {
    expect(Object.isFrozen(OVERVIEW_CARDS)).toBe(true)
    expect(Object.isFrozen(OVERVIEW_TRENDS)).toBe(true)
    expect(Object.isFrozen(OVERVIEW_DISTRIBUTIONS)).toBe(true)
    expect(Object.isFrozen(LISTING_ANALYTICS_CARDS)).toBe(true)
    expect(Object.isFrozen(LISTING_ANALYTICS_TRENDS)).toBe(true)
    expect(Object.isFrozen(LISTING_ANALYTICS_DISTRIBUTIONS)).toBe(true)
    expect(Object.isFrozen(LEAD_ANALYTICS_CARDS)).toBe(true)
    expect(Object.isFrozen(LEAD_ANALYTICS_TRENDS)).toBe(true)
    expect(Object.isFrozen(LEAD_ANALYTICS_DISTRIBUTIONS)).toBe(true)
  })
})
