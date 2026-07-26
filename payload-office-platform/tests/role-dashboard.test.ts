/**
 * 角色化工作台测试（tasks.md M7.2 / R1, R7）
 *
 * 覆盖：
 *   - deriveRoleDashboardType 角色派生（ADM/OPS/MGR/BRK/CSR + 多角色优先级）
 *   - ROLE_DASHBOARD_CONFIG 三角色配置完整性
 *   - resolveRoleDashboard 单卡成功 / 失败 / 无权限 / not-found 局部标记
 *   - 所有卡片共用同一 asOf
 *   - type=null 返回空 cards
 *   - 单卡按 metric.allowedScopeDims 重新 sanitize → URL 不扩大范围
 *   - 下钻 URL 派生（仅 metric.drilldown.filterKeys 字段）
 */

import { describe, expect, it, beforeEach } from 'vitest'

import type { PermissionContext } from '@/domain/auth/permission-context'

import {
  ROLE_DASHBOARD_CONFIG,
  ROLE_DASHBOARD_TYPES,
  deriveRoleDashboardType,
  isRoleDashboardType,
  resolveRoleDashboard,
  type DashboardBaseContext,
  type RoleDashboardType,
} from '@/domain/analytics/role-dashboard'
import { MetricRegistry } from '@/domain/analytics/metric-registry'
import {
  registerBuiltinMetrics,
  stubQuery,
  stubSeriesQuery,
} from '@/domain/analytics/metrics/builtin'
import {
  EMPTY_FILTERS,
  sanitizeFilters,
} from '@/domain/analytics/metric-context'
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

function makeStubPayload(): MetricPayloadPort {
  return {
    count: async () => 0,
    find: async () => ({ docs: [], totalDocs: 0, totalPages: 0, page: 1 }),
  }
}

function makeBase(overrides: Partial<DashboardBaseContext> = {}): DashboardBaseContext {
  return {
    asOf: new Date('2026-07-26T02:00:00Z'), // 北京时间 10:00
    permission: makePermission(),
    payload: makeStubPayload(),
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
// 1. deriveRoleDashboardType
// ────────────────────────────────────────────────────────────

describe('deriveRoleDashboardType', () => {
  it('ADM 派生 admin-ops', () => {
    expect(deriveRoleDashboardType(makePermission({ roleCodes: ['ADM'] }))).toBe('admin-ops')
  })

  it('OPS 派生 admin-ops', () => {
    expect(deriveRoleDashboardType(makePermission({ roleCodes: ['OPS'] }))).toBe('admin-ops')
  })

  it('MGR 派生 sales-manager', () => {
    expect(deriveRoleDashboardType(makePermission({ roleCodes: ['MGR'] }))).toBe('sales-manager')
  })

  it('BRK 派生 broker', () => {
    expect(deriveRoleDashboardType(makePermission({ roleCodes: ['BRK'] }))).toBe('broker')
  })

  it('CSR 无对应工作台返回 null', () => {
    expect(deriveRoleDashboardType(makePermission({ roleCodes: ['CSR'] }))).toBe(null)
  })

  it('无角色返回 null', () => {
    expect(deriveRoleDashboardType(makePermission({ roleCodes: [] }))).toBe(null)
  })

  it('多角色优先级 admin-ops > sales-manager > broker', () => {
    // ADM + MGR + BRK → admin-ops
    expect(
      deriveRoleDashboardType(makePermission({ roleCodes: ['ADM', 'MGR', 'BRK'] })),
    ).toBe('admin-ops')
    // OPS + MGR + BRK → admin-ops
    expect(
      deriveRoleDashboardType(makePermission({ roleCodes: ['OPS', 'MGR', 'BRK'] })),
    ).toBe('admin-ops')
    // MGR + BRK → sales-manager
    expect(
      deriveRoleDashboardType(makePermission({ roleCodes: ['MGR', 'BRK'] })),
    ).toBe('sales-manager')
    // 仅 BRK → broker
    expect(deriveRoleDashboardType(makePermission({ roleCodes: ['BRK'] }))).toBe('broker')
  })
})

// ────────────────────────────────────────────────────────────
// 2. isRoleDashboardType
// ────────────────────────────────────────────────────────────

describe('isRoleDashboardType', () => {
  it('合法值返回 true', () => {
    for (const v of ROLE_DASHBOARD_TYPES) {
      expect(isRoleDashboardType(v)).toBe(true)
    }
  })

  it('非法值返回 false', () => {
    expect(isRoleDashboardType('admin')).toBe(false)
    expect(isRoleDashboardType('')).toBe(false)
    expect(isRoleDashboardType(null)).toBe(false)
    expect(isRoleDashboardType(undefined)).toBe(false)
    expect(isRoleDashboardType(123)).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────
// 3. ROLE_DASHBOARD_CONFIG 完整性
// ────────────────────────────────────────────────────────────

describe('ROLE_DASHBOARD_CONFIG', () => {
  it('三种角色工作台均有配置', () => {
    expect(ROLE_DASHBOARD_CONFIG['admin-ops'].length).toBeGreaterThan(0)
    expect(ROLE_DASHBOARD_CONFIG['sales-manager'].length).toBeGreaterThan(0)
    expect(ROLE_DASHBOARD_CONFIG['broker'].length).toBeGreaterThan(0)
  })

  it('配置为只读（frozen）', () => {
    expect(Object.isFrozen(ROLE_DASHBOARD_CONFIG)).toBe(true)
    for (const type of ROLE_DASHBOARD_TYPES) {
      expect(Object.isFrozen(ROLE_DASHBOARD_CONFIG[type])).toBe(true)
    }
  })

  it('所有 code 在内置注册表中存在', () => {
    const registry = makeRegistry()
    for (const type of ROLE_DASHBOARD_TYPES) {
      for (const code of ROLE_DASHBOARD_CONFIG[type]) {
        expect(registry.has(code)).toBe(true)
      }
    }
  })

  it('admin-ops 含待审核 / 今日供给 / 今日新增线索 / 今日跟进 / 超时', () => {
    const codes = ROLE_DASHBOARD_CONFIG['admin-ops']
    expect(codes).toContain('reviews.pending')
    expect(codes).toContain('supply.effective_count')
    expect(codes).toContain('leads.new')
    expect(codes).toContain('tasks.today_followup')
    expect(codes).toContain('tasks.overdue')
  })

  it('sales-manager 含团队线索 / 待分配 / 跟进 / 有效商机', () => {
    const codes = ROLE_DASHBOARD_CONFIG['sales-manager']
    expect(codes).toContain('leads.assigned')
    expect(codes).toContain('tasks.pending_claim')
    expect(codes).toContain('tasks.today_followup')
    expect(codes).toContain('leads.valid')
  })

  it('broker 含我的新线索 / 今日待跟进 / 超时 / 推荐率', () => {
    const codes = ROLE_DASHBOARD_CONFIG['broker']
    expect(codes).toContain('leads.new')
    expect(codes).toContain('tasks.today_followup')
    expect(codes).toContain('tasks.overdue')
    expect(codes).toContain('leads.recommendation_rate')
  })
})

// ────────────────────────────────────────────────────────────
// 4. resolveRoleDashboard 基础行为
// ────────────────────────────────────────────────────────────

describe('resolveRoleDashboard', () => {
  let registry: MetricRegistry

  beforeEach(() => {
    registry = makeRegistry()
  })

  it('type=null 返回空 cards + asOf', async () => {
    const base = makeBase()
    const result = await resolveRoleDashboard(null, base, registry)

    expect(result.type).toBe(null)
    expect(result.cards).toEqual([])
    expect(result.asOf).toBe(base.asOf.toISOString())
  })

  it('admin-ops 返回配置中所有卡片（顺序保留）', async () => {
    const base = makeBase()
    const result = await resolveRoleDashboard('admin-ops', base, registry)

    expect(result.type).toBe('admin-ops')
    expect(result.cards.length).toBe(ROLE_DASHBOARD_CONFIG['admin-ops'].length)
    // 顺序与配置一致
    expect(result.cards.map((c) => c.code)).toEqual([...ROLE_DASHBOARD_CONFIG['admin-ops']])
  })

  it('所有卡片共用同一 asOf', async () => {
    const base = makeBase()
    const result = await resolveRoleDashboard('admin-ops', base, registry)

    expect(result.asOf).toBe(base.asOf.toISOString())
    for (const card of result.cards) {
      if (card.status === 'success') {
        expect(card.asOf).toBe(result.asOf)
      }
    }
  })

  it('broker 角色返回 5 张卡', async () => {
    const base = makeBase({ permission: makePermission({ roleCodes: ['BRK'] }) })
    const result = await resolveRoleDashboard('broker', base, registry)

    expect(result.cards.length).toBe(5)
    // 所有卡片都成功（stub query 返回 0）
    for (const card of result.cards) {
      expect(card.status).toBe('success')
    }
  })

  it('scalar 卡片返回 value', async () => {
    const base = makeBase()
    const result = await resolveRoleDashboard('admin-ops', base, registry)

    const pending = result.cards.find((c) => c.code === 'reviews.pending')
    expect(pending).toBeDefined()
    expect(pending?.status).toBe('success')
    expect(pending?.value).toBe(0) // stubQuery 返回 0
    expect(pending?.buckets).toBeUndefined()
  })

  it('series 卡片返回 buckets', async () => {
    // 临时替换某指标 query 为 series stub
    const def = registry.require('reviews.pending') as MetricDefinition
    const original = def.query
    def.query = stubSeriesQuery

    const base = makeBase()
    const result = await resolveRoleDashboard('admin-ops', base, registry)
    const card = result.cards.find((c) => c.code === 'reviews.pending')

    expect(card?.status).toBe('success')
    expect(card?.buckets).toEqual([])
    expect(card?.value).toBeUndefined()

    // 恢复
    def.query = original
  })
})

// ────────────────────────────────────────────────────────────
// 5. 单卡失败局部标记
// ────────────────────────────────────────────────────────────

describe('单卡失败局部标记', () => {
  let registry: MetricRegistry

  beforeEach(() => {
    registry = makeRegistry()
  })

  it('单卡 query 抛错 → status=failed，其他卡正常', async () => {
    // 替换 reviews.pending 的 query 为抛错版本
    const def = registry.require('reviews.pending') as MetricDefinition
    const original = def.query
    def.query = async () => {
      throw new Error('DB connection failed')
    }

    const base = makeBase()
    const result = await resolveRoleDashboard('admin-ops', base, registry)

    const failedCard = result.cards.find((c) => c.code === 'reviews.pending')
    expect(failedCard?.status).toBe('failed')
    expect(failedCard?.error).toContain('DB connection failed')
    expect(failedCard?.value).toBeUndefined()

    // 其他卡片不受影响
    const otherCards = result.cards.filter((c) => c.code !== 'reviews.pending')
    expect(otherCards.length).toBeGreaterThan(0)
    for (const card of otherCards) {
      expect(card.status).toBe('success')
    }

    def.query = original
  })

  it('无权限指标 → status=no-permission', async () => {
    // 缺少 listing:read 权限的上下文
    const limitedPerm = makePermission({
      roleCodes: ['ADM'],
      operationPermissions: new Set(['review:read']), // 只有 review:read
    })
    const base = makeBase({ permission: limitedPerm })

    const result = await resolveRoleDashboard('admin-ops', base, registry)

    // reviews.pending 需要 review:read → success
    const reviewCard = result.cards.find((c) => c.code === 'reviews.pending')
    expect(reviewCard?.status).toBe('success')

    // listings.pending_review 需要 review:read → success（同权限）
    const listingReviewCard = result.cards.find((c) => c.code === 'listings.pending_review')
    expect(listingReviewCard?.status).toBe('success')

    // supply.effective_count 需要 listing:read → no-permission
    const supplyCard = result.cards.find((c) => c.code === 'supply.effective_count')
    expect(supplyCard?.status).toBe('no-permission')
    expect(supplyCard?.error).toContain('no permission')

    // leads.new 需要 lead:read → no-permission
    const leadCard = result.cards.find((c) => c.code === 'leads.new')
    expect(leadCard?.status).toBe('no-permission')
  })

  it('注册表中不存在的 code → status=not-found', async () => {
    // 临时注册一个不存在的 code 到 ROLE_DASHBOARD_CONFIG
    // 不能修改 frozen 配置，改用直接调用 resolveSingleCard 验证
    // 此处通过让 registry.require 抛错验证：先全部 clear 再 resolve
    const emptyRegistry = new MetricRegistry()
    const base = makeBase()
    const result = await resolveRoleDashboard('admin-ops', base, emptyRegistry)

    // 所有卡片都应 not-found
    for (const card of result.cards) {
      expect(card.status).toBe('not-found')
      expect(card.error).toContain('Metric not found')
    }
  })

  it('单卡失败不阻断后续卡片', async () => {
    // 替换多张卡的 query 抛错
    const d1 = registry.require('reviews.pending') as MetricDefinition
    const d2 = registry.require('leads.new') as MetricDefinition
    const o1 = d1.query
    const o2 = d2.query
    d1.query = async () => {
      throw new Error('fail-1')
    }
    d2.query = async () => {
      throw new Error('fail-2')
    }

    const base = makeBase()
    const result = await resolveRoleDashboard('admin-ops', base, registry)

    const c1 = result.cards.find((c) => c.code === 'reviews.pending')
    const c2 = result.cards.find((c) => c.code === 'leads.new')
    expect(c1?.status).toBe('failed')
    expect(c2?.status).toBe('failed')

    // 其他卡片仍成功
    const ok = result.cards.filter(
      (c) => c.code !== 'reviews.pending' && c.code !== 'leads.new',
    )
    expect(ok.length).toBeGreaterThan(0)
    for (const card of ok) {
      expect(card.status).toBe('success')
    }

    d1.query = o1
    d2.query = o2
  })
})

// ────────────────────────────────────────────────────────────
// 6. URL 参数不扩大数据范围（按 metric 重新 sanitize）
// ────────────────────────────────────────────────────────────

describe('URL 参数不扩大数据范围', () => {
  let registry: MetricRegistry

  beforeEach(() => {
    registry = makeRegistry()
  })

  it('broker 卡片按 metric.allowedScopeDims 重新 sanitize', async () => {
    // 限定城市范围 + 提交越界 cityId
    const perm = makePermission({
      roleCodes: ['BRK'],
      cityIds: new Set([10, 20]),
    })
    const base = makeBase({
      permission: perm,
      input: { cityIds: [10, 999, 'invalid'] }, // 999 越界
    })

    const result = await resolveRoleDashboard('broker', base, registry)

    // 所有卡片成功
    for (const card of result.cards) {
      expect(card.status).toBe('success')
    }

    // 下钻 URL 中只包含合法 cityIds=10（999 被丢弃）
    for (const card of result.cards) {
      if (card.drilldownUrl && card.drilldownUrl.includes('cityIds')) {
        expect(card.drilldownUrl).toContain('cityIds=10')
        expect(card.drilldownUrl).not.toContain('cityIds=999')
      }
    }
  })

  it('merchant 维度仅对允许 merchant 的 metric 出现', async () => {
    // admin-ops 中 supply.effective_count 允许 merchant
    // leads.new 不允许 merchant（allowedScopeDims: city/team/assignee）
    const perm = makePermission({
      roleCodes: ['ADM'],
    })
    const base = makeBase({
      permission: perm,
      input: { merchantIds: ['m1', 'm2'] },
    })

    const result = await resolveRoleDashboard('admin-ops', base, registry)

    const supplyCard = result.cards.find((c) => c.code === 'supply.effective_count')
    expect(supplyCard?.status).toBe('success')
    if (supplyCard?.drilldownUrl) {
      expect(supplyCard.drilldownUrl).toContain('merchantIds=m1')
      expect(supplyCard.drilldownUrl).toContain('merchantIds=m2')
    }

    const leadCard = result.cards.find((c) => c.code === 'leads.new')
    expect(leadCard?.status).toBe('success')
    // leads.new 不允许 merchant 维度，下钻 URL 不应包含 merchantIds
    if (leadCard?.drilldownUrl) {
      expect(leadCard.drilldownUrl).not.toContain('merchantIds')
    }
  })

  it('cityIds 越界 ID 被丢弃', async () => {
    const perm = makePermission({
      roleCodes: ['ADM'],
      cityIds: new Set([1, 2, 3]),
    })
    const base = makeBase({
      permission: perm,
      input: { cityIds: [1, 2, 999, 'evil'] },
    })

    const result = await resolveRoleDashboard('admin-ops', base, registry)

    // 任意含 cityIds 的卡片下钻 URL 都不应包含 999
    for (const card of result.cards) {
      if (card.drilldownUrl && card.drilldownUrl.includes('cityIds')) {
        expect(card.drilldownUrl).not.toContain('cityIds=999')
        expect(card.drilldownUrl).not.toContain('cityIds=evil')
      }
    }
  })

  it('未传 cityIds 时使用 permission 上限', async () => {
    const perm = makePermission({
      roleCodes: ['ADM'],
      cityIds: new Set([1, 2, 3]),
    })
    const base = makeBase({
      permission: perm,
      input: null,
    })

    const result = await resolveRoleDashboard('admin-ops', base, registry)

    // 含 cityIds 维度的卡片下钻 URL 应包含 1/2/3
    for (const card of result.cards) {
      if (card.drilldownUrl && card.drilldownUrl.includes('cityIds')) {
        expect(card.drilldownUrl).toContain('cityIds=1')
        expect(card.drilldownUrl).toContain('cityIds=2')
        expect(card.drilldownUrl).toContain('cityIds=3')
      }
    }
  })

  it('dataScope=self 强制 assigneeId = userId', async () => {
    const perm = makePermission({
      roleCodes: ['BRK'],
      dataScope: 'self',
      userId: 42,
    })
    const base = makeBase({
      permission: perm,
      input: { assigneeId: 999 }, // 客户端试图越权
    })

    const result = await resolveRoleDashboard('broker', base, registry)

    // 含 assigneeId 的卡片下钻 URL 应为 userId=42，不是 999
    for (const card of result.cards) {
      if (card.drilldownUrl && card.drilldownUrl.includes('assigneeId')) {
        expect(card.drilldownUrl).toContain('assigneeId=42')
        expect(card.drilldownUrl).not.toContain('assigneeId=999')
      }
    }
  })
})

// ────────────────────────────────────────────────────────────
// 7. 下钻 URL 派生
// ────────────────────────────────────────────────────────────

describe('下钻 URL 派生', () => {
  let registry: MetricRegistry

  beforeEach(() => {
    registry = makeRegistry()
  })

  it('success 卡片含 drilldownUrl（如 metric 有 drilldown）', async () => {
    const base = makeBase()
    const result = await resolveRoleDashboard('admin-ops', base, registry)

    // reviews.pending 有 drilldown
    const card = result.cards.find((c) => c.code === 'reviews.pending')
    expect(card?.status).toBe('success')
    expect(card?.drilldownUrl).toBeDefined()
    expect(card?.drilldownUrl).toContain('/admin/collections/listing-reviews')
    expect(card?.drilldownUrl).toContain('status=pending')
  })

  it('failed 卡片无 drilldownUrl', async () => {
    const def = registry.require('reviews.pending') as MetricDefinition
    const original = def.query
    def.query = async () => {
      throw new Error('boom')
    }

    const base = makeBase()
    const result = await resolveRoleDashboard('admin-ops', base, registry)

    const card = result.cards.find((c) => c.code === 'reviews.pending')
    expect(card?.status).toBe('failed')
    expect(card?.drilldownUrl).toBeUndefined()

    def.query = original
  })

  it('下钻 URL 仅含 metric.drilldown.filterKeys 字段', async () => {
    // 提交所有维度，但 metric 只允许 city → URL 仅含 cityIds
    const perm = makePermission({ roleCodes: ['ADM'] })
    const base = makeBase({
      permission: perm,
      input: {
        cityIds: [1, 2],
        teamIds: [10, 20],
        merchantIds: ['m1'],
        assigneeId: 999,
      },
    })

    const result = await resolveRoleDashboard('admin-ops', base, registry)

    // buildings.total（如有）只允许 city
    // 但 admin-ops 配置中不含 buildings.total，改查 listings.pending_review
    // listings.pending_review allowedScopeDims = city/team/merchant
    const card = result.cards.find((c) => c.code === 'listings.pending_review')
    expect(card).toBeDefined()
    if (card?.drilldownUrl) {
      expect(card.drilldownUrl).toContain('cityIds=1')
      expect(card.drilldownUrl).toContain('cityIds=2')
      expect(card.drilldownUrl).toContain('teamIds=10')
      expect(card.drilldownUrl).toContain('teamIds=20')
      expect(card.drilldownUrl).toContain('merchantIds=m1')
      // assigneeId 不在 listings.pending_review 的 filterKeys 中
      expect(card.drilldownUrl).not.toContain('assigneeId')
    }
  })
})
