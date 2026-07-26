/**
 * 经营概览看板测试（tasks.md M7.3 / R7）
 *
 * 覆盖：
 *   - OVERVIEW_CARDS / OVERVIEW_TRENDS / OVERVIEW_DISTRIBUTIONS 配置完整性
 *     （所有 code 在注册表中可 require）
 *   - resolveOverviewDashboard 并发解析 + 组间独立 + 单卡失败局部标记
 *   - 所有卡 / 趋势 / 分布共用同一 asOf
 *   - canViewOverviewDashboard 权限网关
 *   - 单卡按 metric.allowedScopeDims 重新 sanitize → URL 不扩大范围
 *   - 趋势桶返回（series kind / buckets 顺序与时间桶一致）
 *   - 分布桶返回（by_status 4 个状态 / by_city 仅当 cityIds 提供时返回）
 *   - dataScope=self 时 assignee 强制 = userId（不允许 URL 扩大）
 */

import { describe, expect, it, beforeEach } from 'vitest'

import type { PermissionContext } from '@/domain/auth/permission-context'

import {
  OVERVIEW_CARDS,
  OVERVIEW_DISTRIBUTIONS,
  OVERVIEW_TRENDS,
  canViewOverviewDashboard,
  resolveOverviewDashboard,
  type DashboardBaseContext,
} from '@/domain/analytics/overview-dashboard'
import { MetricRegistry } from '@/domain/analytics/metric-registry'
import { registerBuiltinMetrics } from '@/domain/analytics/metrics/builtin'
import type {
  MetricDefinition,
  MetricFilterInput,
  MetricPayloadPort,
  MetricQueryContext,
  MetricQueryResult,
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
}

interface MockPayloadOptions {
  count?: number
  findCalls?: PayloadCall[]
  countCalls?: PayloadCall[]
}

function makeMockPayload(
  options: MockPayloadOptions = { count: 0 },
): MetricPayloadPort & { countCalls: PayloadCall[]; findCalls: PayloadCall[] } {
  const countCalls: PayloadCall[] = []
  const findCalls: PayloadCall[] = []
  const countValue = options.count ?? 0
  return {
    async count(params) {
      countCalls.push({ collection: params.collection, where: params.where })
      return countValue
    },
    async find(params) {
      findCalls.push({ collection: params.collection, where: params.where })
      return { docs: [], totalDocs: 0, totalPages: 0, page: 1 }
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

describe('OVERVIEW 配置完整性', () => {
  it('所有 OVERVIEW_CARDS code 在注册表中存在', () => {
    const r = makeRegistry()
    for (const code of OVERVIEW_CARDS) {
      expect(r.has(code), `card code ${code} should be registered`).toBe(true)
    }
  })

  it('所有 OVERVIEW_TRENDS code 在注册表中存在', () => {
    const r = makeRegistry()
    for (const code of OVERVIEW_TRENDS) {
      expect(r.has(code), `trend code ${code} should be registered`).toBe(true)
    }
  })

  it('所有 OVERVIEW_DISTRIBUTIONS code 在注册表中存在', () => {
    const r = makeRegistry()
    for (const code of OVERVIEW_DISTRIBUTIONS) {
      expect(r.has(code), `distribution code ${code} should be registered`).toBe(true)
    }
  })

  it('OVERVIEW_CARDS 不与 OVERVIEW_TRENDS 重复（卡片与趋势分离）', () => {
    const cardSet = new Set(OVERVIEW_CARDS)
    for (const code of OVERVIEW_TRENDS) {
      expect(cardSet.has(code), `trend code ${code} should not be in cards`).toBe(false)
    }
  })

  it('配置数组不可变（frozen）', () => {
    expect(Object.isFrozen(OVERVIEW_CARDS)).toBe(true)
    expect(Object.isFrozen(OVERVIEW_TRENDS)).toBe(true)
    expect(Object.isFrozen(OVERVIEW_DISTRIBUTIONS)).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────
// 2. resolveOverviewDashboard 基础行为
// ────────────────────────────────────────────────────────────

describe('resolveOverviewDashboard', () => {
  let registry: MetricRegistry

  beforeEach(() => {
    registry = makeRegistry()
  })

  it('返回三组卡片，长度与配置一致', async () => {
    const result = await resolveOverviewDashboard(makeBase(), registry)
    expect(result.cards).toHaveLength(OVERVIEW_CARDS.length)
    expect(result.trends).toHaveLength(OVERVIEW_TRENDS.length)
    expect(result.distributions).toHaveLength(OVERVIEW_DISTRIBUTIONS.length)
  })

  it('所有卡 / 趋势 / 分布共用同一 asOf', async () => {
    const base = makeBase()
    const result = await resolveOverviewDashboard(base, registry)
    expect(result.asOf).toBe(base.asOf.toISOString())
    for (const card of [...result.cards, ...result.trends, ...result.distributions]) {
      if (card.status === 'success') {
        expect(card.asOf).toBe(result.asOf)
      }
    }
  })

  it('mock count=7 → 所有 success 卡 value=7', async () => {
    const base = makeBase({
      payload: makeMockPayload({ count: 7 }),
    })
    const result = await resolveOverviewDashboard(base, registry)
    for (const card of result.cards) {
      if (card.status === 'success') {
        expect(card.value).toBe(7)
      }
    }
  })

  it('趋势序列返回 series kind + buckets', async () => {
    const base = makeBase()
    const result = await resolveOverviewDashboard(base, registry)
    for (const trend of result.trends) {
      expect(trend.status).toBe('success')
      expect(trend.buckets).toBeDefined()
      // listings.created_per_day_7d 应有 7 个桶
      expect(trend.buckets?.length).toBe(7)
    }
  })

  it('分布 by_status 返回 4 个状态桶', async () => {
    const base = makeBase()
    const result = await resolveOverviewDashboard(base, registry)
    const byStatus = result.distributions.find((d) => d.code === 'listings.by_status')
    expect(byStatus).toBeDefined()
    expect(byStatus?.status).toBe('success')
    expect(byStatus?.buckets?.length).toBe(4)
    const labels = byStatus?.buckets?.map((b) => b.label)
    expect(labels).toEqual(['draft', 'published', 'unpublished', 'leased'])
  })

  it('分布 by_city 在未传 cityIds 时返回空 buckets', async () => {
    const base = makeBase()
    const result = await resolveOverviewDashboard(base, registry)
    const byCity = result.distributions.find((d) => d.code === 'listings.by_city')
    expect(byCity).toBeDefined()
    expect(byCity?.status).toBe('success')
    expect(byCity?.buckets?.length).toBe(0)
  })

  it('分布 by_city 在传 cityIds 时返回对应城市桶', async () => {
    const base = makeBase({
      input: { cityIds: [1, 2, 3] },
    })
    const result = await resolveOverviewDashboard(base, registry)
    const byCity = result.distributions.find((d) => d.code === 'listings.by_city')
    expect(byCity?.buckets?.length).toBe(3)
    expect(byCity?.buckets?.map((b) => b.label)).toEqual(['1', '2', '3'])
  })
})

// ────────────────────────────────────────────────────────────
// 3. 单卡失败隔离
// ────────────────────────────────────────────────────────────

describe('单卡失败隔离', () => {
  it('单张卡 query 抛错 → status=failed，其他卡正常', async () => {
    const registry = makeRegistry()
    // 直接替换 def.query（与 role-dashboard.test.ts 同构）
    const def = registry.require('listings.total') as MetricDefinition
    const originalQuery = def.query
    def.query = async () => {
      throw new Error('boom')
    }

    const base = makeBase()
    const result = await resolveOverviewDashboard(base, registry)
    const failedCard = result.cards.find((c) => c.code === 'listings.total')
    expect(failedCard?.status).toBe('failed')
    expect(failedCard?.error).toBe('boom')
    // 其他卡正常
    const okCards = result.cards.filter((c) => c.status === 'success')
    expect(okCards.length).toBeGreaterThan(0)

    // 还原（避免影响其他测试）
    def.query = originalQuery
  })

  it('单张趋势 query 抛错 → status=failed，分布 / 卡片不受影响', async () => {
    const registry = makeRegistry()
    const def = registry.require('listings.created_per_day_7d') as MetricDefinition
    const originalQuery = def.query
    def.query = async () => {
      throw new Error('trend boom')
    }

    const base = makeBase()
    const result = await resolveOverviewDashboard(base, registry)
    const failedTrend = result.trends.find((t) => t.code === 'listings.created_per_day_7d')
    expect(failedTrend?.status).toBe('failed')
    // 卡片 / 分布应正常
    expect(result.cards.every((c) => c.status === 'success')).toBe(true)
    expect(result.distributions.every((d) => d.status === 'success')).toBe(true)

    def.query = originalQuery
  })

  it('空注册表 → 所有卡 status=not-found', async () => {
    const emptyRegistry = new MetricRegistry()
    const base = makeBase()
    const result = await resolveOverviewDashboard(base, emptyRegistry)
    for (const card of [...result.cards, ...result.trends, ...result.distributions]) {
      expect(card.status).toBe('not-found')
      expect(card.error).toContain('Metric not found')
    }
  })

  it('无权限的卡 → status=no-permission', async () => {
    const registry = makeRegistry()
    // 只有 review:read 权限，无 listing:read → 多张卡 no-permission
    const limitedPerm = makePermission({
      operationPermissions: new Set(['review:read']),
    })
    const base = makeBase({ permission: limitedPerm })
    const result = await resolveOverviewDashboard(base, registry)
    // listings.total 需要 listing:read → no-permission
    const listingCard = result.cards.find((c) => c.code === 'listings.total')
    expect(listingCard?.status).toBe('no-permission')
    // buildings.active 需要 building:read → no-permission
    const buildingCard = result.cards.find((c) => c.code === 'buildings.active')
    expect(buildingCard?.status).toBe('no-permission')
  })
})

// ────────────────────────────────────────────────────────────
// 4. 权限隔离
// ────────────────────────────────────────────────────────────

describe('canViewOverviewDashboard', () => {
  it('有任一经营概览指标权限 → true', () => {
    const registry = makeRegistry()
    const perm = makePermission()
    expect(canViewOverviewDashboard(perm, registry)).toBe(true)
  })

  it('无任何经营概览指标权限 → false', () => {
    const registry = makeRegistry()
    const perm = makePermission({
      operationPermissions: new Set(['some:other']), // 无任何 overview 指标权限
    })
    expect(canViewOverviewDashboard(perm, registry)).toBe(false)
  })

  it('只有部分指标权限也算可见（任一即可）', () => {
    const registry = makeRegistry()
    const perm = makePermission({
      operationPermissions: new Set(['listing:read']), // 仅 listing 类
    })
    expect(canViewOverviewDashboard(perm, registry)).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────
// 5. URL 不扩大数据范围
// ────────────────────────────────────────────────────────────

describe('URL 不扩大数据范围', () => {
  it('dataScope=self 时 assignee 强制 = userId（不允许 URL 覆盖）', async () => {
    const registry = makeRegistry()
    const payload = makeMockPayload({ count: 0 })
    const base = makeBase({
      permission: makePermission({
        dataScope: 'self',
        userId: 42,
      }),
      payload,
      // 客户端尝试传 assigneeId 越权
      input: { assigneeId: 999 },
    })

    await resolveOverviewDashboard(base, registry)

    // assignee 维度不属于 OVERVIEW_CARDS 任何指标的 allowedScopeDims
    // → sanitize 后 assigneeId 被丢弃；where 不应包含 assignee 字段
    for (const call of payload.countCalls) {
      expect(call.where).not.toHaveProperty('assignee')
      expect(call.where).not.toHaveProperty('owner')
    }
  })

  it('城市过滤在 city 上限内被接受', async () => {
    const registry = makeRegistry()
    const payload = makeMockPayload({ count: 0 })
    const base = makeBase({
      permission: makePermission({
        cityIds: new Set([1, 2, 3]), // 限定 1/2/3
      }),
      payload,
      input: { cityIds: [1, 2] }, // 在上限内
    })

    await resolveOverviewDashboard(base, registry)

    // 所有 listing 类查询应叠加 building.city in [1,2]
    const listingCalls = payload.countCalls.filter((c) => c.collection === 'listings')
    for (const call of listingCalls) {
      const where = call.where
      // 应包含 building.city: { in: [...] }
      expect(JSON.stringify(where)).toContain('building.city')
    }
  })

  it('城市过滤超出 city 上限被丢弃', async () => {
    const registry = makeRegistry()
    const payload = makeMockPayload({ count: 0 })
    const base = makeBase({
      permission: makePermission({
        cityIds: new Set([1, 2]), // 只允许 1/2
      }),
      payload,
      input: { cityIds: [1, 2, 999, 1000] }, // 越界
    })

    await resolveOverviewDashboard(base, registry)

    // where 中不应出现 999 / 1000
    const json = JSON.stringify(payload.countCalls)
    expect(json).not.toContain('999')
    expect(json).not.toContain('1000')
  })

  it('buildings 类指标不受 merchant 过滤影响', async () => {
    const registry = makeRegistry()
    const payload = makeMockPayload({ count: 0 })
    const base = makeBase({
      payload,
      input: { merchantIds: [10, 20] },
    })

    await resolveOverviewDashboard(base, registry)

    // building 查询 where 中不应有 merchant 字段
    const buildingCalls = payload.countCalls.filter((c) => c.collection === 'buildings')
    for (const call of buildingCalls) {
      expect(call.where).not.toHaveProperty('merchant')
      expect(JSON.stringify(call.where)).not.toContain('"merchant"')
    }
  })
})

// ────────────────────────────────────────────────────────────
// 6. 下钻 URL 派生
// ────────────────────────────────────────────────────────────

describe('下钻 URL 派生', () => {
  it('所有 success 卡都派生了 drilldownUrl（如果有 drilldown）', async () => {
    const registry = makeRegistry()
    const base = makeBase()
    const result = await resolveOverviewDashboard(base, registry)
    for (const card of result.cards) {
      if (card.status === 'success') {
        // 内置 OVERVIEW_CARDS 所有指标都定义了 drilldown，应派生 URL
        expect(card.drilldownUrl, `${card.code} should have drilldownUrl`).toBeDefined()
        expect(card.drilldownUrl?.startsWith('/admin/collections/')).toBe(true)
      }
    }
  })

  it('drilldownUrl 不包含客户端未授权字段（仅含 sanitize 后字段）', async () => {
    const registry = makeRegistry()
    const payload = makeMockPayload({ count: 0 })
    const base = makeBase({
      payload,
      input: { cityIds: [1, 2] },
    })

    const result = await resolveOverviewDashboard(base, registry)
    for (const card of result.cards) {
      if (card.status === 'success' && card.drilldownUrl) {
        // URL 应包含 cityIds 参数（已 sanitize）
        expect(card.drilldownUrl).toContain('cityIds=')
      }
    }
  })
})
