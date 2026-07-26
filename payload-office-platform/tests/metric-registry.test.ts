/**
 * 指标注册表测试（tasks.md M7.1 / R7）
 *
 * 覆盖：
 *   - 注册 / 重复注册 / 查找 / 列表
 *   - sanitizeFilters 安全过滤（URL 不扩大范围）
 *   - canViewMetric 权限校验
 *   - buildDrilldownUrl 占位符替换
 *   - assertCardEqualsSeriesSum / assertUrlNotExpandScope 业务不变量
 *   - 内置指标元数据完整性
 */

import { describe, expect, it, beforeEach } from 'vitest'

import type { PermissionContext } from '@/domain/auth/permission-context'

import {
  BUILTIN_METRICS,
  registerBuiltinMetrics,
  stubQuery,
  stubSeriesQuery,
} from '@/domain/analytics/metrics/builtin'
import {
  DuplicateMetricError,
  MetricNotFoundError,
  MetricPermissionError,
  MetricRegistry,
  metricRegistry,
} from '@/domain/analytics/metric-registry'
import {
  EMPTY_FILTERS,
  MAX_RANGE_DAYS,
  canViewMetric,
  sanitizeFilters,
} from '@/domain/analytics/metric-context'
import { buildDrilldownUrl } from '@/domain/analytics/metric-drilldown'
import {
  assertCardEqualsSeriesSum,
  assertResultsEqual,
  assertSeriesEqual,
  assertUrlNotExpandScope,
} from '@/domain/analytics/metric-consistency'
import type {
  MetricBucket,
  MetricDefinition,
  MetricPayloadPort,
  MetricQueryContext,
  MetricScalarResult,
  MetricSeriesResult,
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

function makeCtx(overrides: Partial<MetricQueryContext> = {}): MetricQueryContext {
  return {
    asOf: new Date('2026-07-26T02:00:00Z'), // 北京时间 10:00
    permission: makePermission(),
    filters: EMPTY_FILTERS,
    payload: makeStubPayload(),
    ...overrides,
  }
}

describe('MetricRegistry', () => {
  let registry: MetricRegistry

  beforeEach(() => {
    registry = new MetricRegistry()
  })

  describe('register / get / has', () => {
    it('注册合法指标后可通过 code 获取', () => {
      registry.register({
        code: 'test.simple',
        label: '测试指标',
        description: '测试',
        category: 'listing',
        unit: 'count',
        dedup: 'none',
        timeRange: 'snapshot',
        requiredPermissions: [],
        allowedScopeDims: ['none'],
        cacheTtlMs: 0,
        query: stubQuery,
      })

      expect(registry.has('test.simple')).toBe(true)
      const def = registry.get('test.simple')
      expect(def?.label).toBe('测试指标')
    })

    it('重复注册相同 code 抛 DuplicateMetricError', () => {
      const def: MetricDefinition = {
        code: 'test.dup',
        label: '重复',
        description: 'desc',
        category: 'listing',
        unit: 'count',
        dedup: 'none',
        timeRange: 'snapshot',
        requiredPermissions: [],
        allowedScopeDims: ['none'],
        cacheTtlMs: 0,
        query: stubQuery,
      }
      registry.register(def)
      expect(() => registry.register(def)).toThrow(DuplicateMetricError)
    })

    it('require 不存在的 code 抛 MetricNotFoundError', () => {
      expect(() => registry.require('not.exist')).toThrow(MetricNotFoundError)
    })

    it('listVisible 跳过 deprecated 与无权限指标', () => {
      registry.register({
        code: 'test.deprecated',
        label: '已废弃',
        description: 'desc',
        category: 'listing',
        unit: 'count',
        dedup: 'none',
        timeRange: 'snapshot',
        requiredPermissions: [],
        allowedScopeDims: ['none'],
        cacheTtlMs: 0,
        query: stubQuery,
        deprecated: true,
      })
      registry.register({
        code: 'test.visible',
        label: '可见',
        description: 'desc',
        category: 'listing',
        unit: 'count',
        dedup: 'none',
        timeRange: 'snapshot',
        requiredPermissions: [],
        allowedScopeDims: ['none'],
        cacheTtlMs: 0,
        query: stubQuery,
      })

      const visible = registry.listVisible(makePermission())
      expect(visible.find((m) => m.code === 'test.deprecated')).toBeUndefined()
      expect(visible.find((m) => m.code === 'test.visible')).toBeDefined()
    })

    it('listVisible 按 category 过滤', () => {
      registry.register({
        code: 'test.listing',
        label: '房源类',
        description: '',
        category: 'listing',
        unit: 'count',
        dedup: 'none',
        timeRange: 'snapshot',
        requiredPermissions: [],
        allowedScopeDims: ['none'],
        cacheTtlMs: 0,
        query: stubQuery,
      })
      registry.register({
        code: 'test.lead',
        label: '线索类',
        description: '',
        category: 'lead',
        unit: 'count',
        dedup: 'none',
        timeRange: 'snapshot',
        requiredPermissions: [],
        allowedScopeDims: ['none'],
        cacheTtlMs: 0,
        query: stubQuery,
      })

      const listingOnly = registry.listVisible(makePermission(), { category: 'listing' })
      expect(listingOnly).toHaveLength(1)
      expect(listingOnly[0].code).toBe('test.listing')
    })
  })

  describe('resolve 权限校验', () => {
    it('无权限时抛 MetricPermissionError', async () => {
      registry.register({
        code: 'test.perm',
        label: '需权限',
        description: '',
        category: 'listing',
        unit: 'count',
        dedup: 'none',
        timeRange: 'snapshot',
        requiredPermissions: ['listing:read'],
        allowedScopeDims: ['none'],
        cacheTtlMs: 0,
        query: stubQuery,
      })

      const ctx = makeCtx({
        permission: makePermission({
          operationPermissions: new Set<string>(), // 无任何权限
        }),
      })

      await expect(registry.resolve('test.perm', ctx)).rejects.toBeInstanceOf(
        MetricPermissionError,
      )
    })

    it('通配符 * 权限可访问任意指标', async () => {
      registry.register({
        code: 'test.wild',
        label: '通配符',
        description: '',
        category: 'listing',
        unit: 'count',
        dedup: 'none',
        timeRange: 'snapshot',
        requiredPermissions: ['any:permission'],
        allowedScopeDims: ['none'],
        cacheTtlMs: 0,
        query: stubQuery,
      })

      const ctx = makeCtx({
        permission: makePermission({
          operationPermissions: new Set(['*']),
        }),
      })

      const result = await registry.resolve('test.wild', ctx)
      expect(result.kind).toBe('scalar')
    })
  })
})

describe('sanitizeFilters', () => {
  it('客户端未传城市时使用 permission 上限', () => {
    const metric = BUILTIN_METRICS.find((m) => m.code === 'listings.total')!
    const perm = makePermission({
      cityIds: new Set([1, 2, 3]),
    })
    const filters = sanitizeFilters(null, perm, metric)
    expect(filters.cityIds).toEqual([1, 2, 3])
  })

  it('客户端传城市与 permission 求交集，丢弃越界 ID', () => {
    const metric = BUILTIN_METRICS.find((m) => m.code === 'listings.total')!
    const perm = makePermission({
      cityIds: new Set([1, 2, 3]),
    })
    const filters = sanitizeFilters(
      { cityIds: [1, 2, 999, 'invalid'] },
      perm,
      metric,
    )
    expect(filters.cityIds).toEqual([1, 2])
  })

  it('permission.cityIds=all 时不裁剪客户端输入', () => {
    const metric = BUILTIN_METRICS.find((m) => m.code === 'listings.total')!
    const perm = makePermission({ cityIds: 'all' })
    const filters = sanitizeFilters({ cityIds: [10, 20, 30] }, perm, metric)
    expect(filters.cityIds).toEqual([10, 20, 30])
  })

  it('不在 allowedScopeDims 中的维度被丢弃', () => {
    // buildings.total 只允许 city 维度
    const metric = BUILTIN_METRICS.find((m) => m.code === 'buildings.total')!
    const perm = makePermission({ cityIds: 'all', teamIds: 'all' })
    const filters = sanitizeFilters(
      {
        cityIds: [1, 2],
        teamIds: [10],
        merchantIds: [100],
        assigneeId: 5,
      },
      perm,
      metric,
    )
    expect(filters.cityIds).toEqual([1, 2])
    expect(filters.teamIds).toEqual([])
    expect(filters.merchantIds).toEqual([])
    expect(filters.assigneeId).toBeNull()
  })

  it('dataScope=self 时 assigneeId 强制 = userId', () => {
    const metric = BUILTIN_METRICS.find((m) => m.code === 'leads.new')!
    const perm = makePermission({
      dataScope: 'self',
      userId: 42,
    })
    const filters = sanitizeFilters(
      { assigneeId: 999 }, // 客户端尝试访问他人
      perm,
      metric,
    )
    expect(filters.assigneeId).toBe(42)
  })

  it('timeRange=range 时解析时间范围', () => {
    // 找一个 range 类指标（自定义） — 实际内置没有 range，这里构造一个
    const metric: MetricDefinition = {
      code: 'test.range',
      label: '范围',
      description: '',
      category: 'listing',
      unit: 'count',
      dedup: 'none',
      timeRange: 'range',
      requiredPermissions: [],
      allowedScopeDims: ['none'],
      cacheTtlMs: 0,
      query: stubQuery,
    }
    const perm = makePermission()
    const filters = sanitizeFilters(
      {
        rangeStart: '2026-07-01T00:00:00Z',
        rangeEnd: '2026-07-31T00:00:00Z',
      },
      perm,
      metric,
    )
    expect(filters.range).not.toBeNull()
    expect(filters.range!.start.toISOString()).toBe('2026-07-01T00:00:00.000Z')
    expect(filters.range!.end.toISOString()).toBe('2026-07-31T00:00:00.000Z')
  })

  it('timeRange=range 但跨度超过 MAX_RANGE_DAYS 时丢弃', () => {
    const metric: MetricDefinition = {
      code: 'test.range',
      label: '范围',
      description: '',
      category: 'listing',
      unit: 'count',
      dedup: 'none',
      timeRange: 'range',
      requiredPermissions: [],
      allowedScopeDims: ['none'],
      cacheTtlMs: 0,
      query: stubQuery,
    }
    const perm = makePermission()
    const tooLong = 366 * 24 * 60 * 60 * 1000
    const filters = sanitizeFilters(
      {
        rangeStart: new Date('2026-01-01T00:00:00Z'),
        rangeEnd: new Date(new Date('2026-01-01T00:00:00Z').getTime() + tooLong),
      },
      perm,
      metric,
    )
    expect(filters.range).toBeNull()
  })

  it('range end <= start 时丢弃', () => {
    const metric: MetricDefinition = {
      code: 'test.range',
      label: '范围',
      description: '',
      category: 'listing',
      unit: 'count',
      dedup: 'none',
      timeRange: 'range',
      requiredPermissions: [],
      allowedScopeDims: ['none'],
      cacheTtlMs: 0,
      query: stubQuery,
    }
    const perm = makePermission()
    const filters = sanitizeFilters(
      {
        rangeStart: '2026-07-31T00:00:00Z',
        rangeEnd: '2026-07-01T00:00:00Z', // 早于 start
      },
      perm,
      metric,
    )
    expect(filters.range).toBeNull()
  })

  it('MAX_RANGE_DAYS = 365', () => {
    expect(MAX_RANGE_DAYS).toBe(365)
  })

  it('EMPTY_FILTERS 为冻结对象', () => {
    expect(Object.isFrozen(EMPTY_FILTERS)).toBe(true)
  })
})

describe('canViewMetric', () => {
  it('requiredPermissions 为空时任意用户可查看', () => {
    const metric: MetricDefinition = {
      code: 'test.open',
      label: '开放',
      description: '',
      category: 'listing',
      unit: 'count',
      dedup: 'none',
      timeRange: 'snapshot',
      requiredPermissions: [],
      allowedScopeDims: ['none'],
      cacheTtlMs: 0,
      query: stubQuery,
    }
    const perm = makePermission({ operationPermissions: new Set<string>() })
    expect(canViewMetric(perm, metric)).toBe(true)
  })

  it('拥有任一 requiredPermissions 即可查看', () => {
    const metric: MetricDefinition = {
      code: 'test.perm',
      label: '需权限',
      description: '',
      category: 'listing',
      unit: 'count',
      dedup: 'none',
      timeRange: 'snapshot',
      requiredPermissions: ['listing:read', 'review:read'],
      allowedScopeDims: ['none'],
      cacheTtlMs: 0,
      query: stubQuery,
    }
    const perm = makePermission({
      operationPermissions: new Set(['listing:read']), // 只有其一
    })
    expect(canViewMetric(perm, metric)).toBe(true)
  })

  it('无任一 requiredPermissions 不可查看', () => {
    const metric: MetricDefinition = {
      code: 'test.perm',
      label: '需权限',
      description: '',
      category: 'listing',
      unit: 'count',
      dedup: 'none',
      timeRange: 'snapshot',
      requiredPermissions: ['listing:read'],
      allowedScopeDims: ['none'],
      cacheTtlMs: 0,
      query: stubQuery,
    }
    const perm = makePermission({
      operationPermissions: new Set<string>(['other:perm']),
    })
    expect(canViewMetric(perm, metric)).toBe(false)
  })

  it('通配符 * 通过所有权限检查', () => {
    const metric: MetricDefinition = {
      code: 'test.wild',
      label: '通配符',
      description: '',
      category: 'listing',
      unit: 'count',
      dedup: 'none',
      timeRange: 'snapshot',
      requiredPermissions: ['any:thing'],
      allowedScopeDims: ['none'],
      cacheTtlMs: 0,
      query: stubQuery,
    }
    const perm = makePermission({
      operationPermissions: new Set(['*']),
    })
    expect(canViewMetric(perm, metric)).toBe(true)
  })
})

describe('buildDrilldownUrl', () => {
  it('替换 filter_keys 占位符', () => {
    const metric = BUILTIN_METRICS.find((m) => m.code === 'listings.total')!
    const ctx = makeCtx({
      filters: Object.freeze({
        cityIds: Object.freeze([1, 2]),
        teamIds: Object.freeze([10]),
        merchantIds: Object.freeze([]),
        assigneeId: null,
        range: null,
      }) as any,
    })
    const result = buildDrilldownUrl(metric, ctx)
    expect(result).not.toBeNull()
    expect(result!.url).toContain('cityIds=1')
    expect(result!.url).toContain('cityIds=2')
    expect(result!.url).toContain('teamIds=10')
    expect(result!.collection).toBe('listings')
  })

  it('替换 bucket.label 占位符', () => {
    const metric: MetricDefinition = {
      code: 'test.bucket',
      label: '桶下钻',
      description: '',
      category: 'listing',
      unit: 'count',
      dedup: 'none',
      timeRange: 'snapshot',
      requiredPermissions: [],
      allowedScopeDims: ['none'],
      cacheTtlMs: 0,
      drilldown: {
        target: 'collection-list',
        collection: 'listings',
        pathTemplate: '/admin/collections/listings?label={{bucket.label}}&value={{bucket.value}}',
        filterKeys: [],
      },
      query: stubQuery,
    }
    const ctx = makeCtx()
    const bucket: MetricBucket = { label: 'shanghai', value: 42 }
    const result = buildDrilldownUrl(metric, ctx, bucket)
    expect(result!.url).toBe('/admin/collections/listings?label=shanghai&value=42')
  })

  it('无 drilldown 返回 null', () => {
    const metric: MetricDefinition = {
      code: 'test.no-drill',
      label: '无下钻',
      description: '',
      category: 'listing',
      unit: 'count',
      dedup: 'none',
      timeRange: 'snapshot',
      requiredPermissions: [],
      allowedScopeDims: ['none'],
      cacheTtlMs: 0,
      query: stubQuery,
    }
    const ctx = makeCtx()
    expect(buildDrilldownUrl(metric, ctx)).toBeNull()
  })

  it('未知占位符保留原样', () => {
    const metric: MetricDefinition = {
      code: 'test.unknown',
      label: '未知占位符',
      description: '',
      category: 'listing',
      unit: 'count',
      dedup: 'none',
      timeRange: 'snapshot',
      requiredPermissions: [],
      allowedScopeDims: ['none'],
      cacheTtlMs: 0,
      drilldown: {
        target: 'collection-list',
        collection: 'listings',
        pathTemplate: '/admin?unknown={{unknown_placeholder}}',
        filterKeys: [],
      },
      query: stubQuery,
    }
    const ctx = makeCtx()
    const result = buildDrilldownUrl(metric, ctx)
    expect(result!.url).toContain('{{unknown_placeholder}}')
  })

  it('filterKeys 中未声明的 key 不会被注入', () => {
    const metric: MetricDefinition = {
      code: 'test.no-inject',
      label: '防注入',
      description: '',
      category: 'listing',
      unit: 'count',
      dedup: 'none',
      timeRange: 'snapshot',
      requiredPermissions: [],
      allowedScopeDims: ['none'],
      cacheTtlMs: 0,
      drilldown: {
        target: 'collection-list',
        collection: 'listings',
        pathTemplate: '/admin?{{filter_keys}}',
        filterKeys: ['cityIds'], // 只允许 cityIds
      },
      query: stubQuery,
    }
    const ctx = makeCtx({
      filters: Object.freeze({
        cityIds: Object.freeze([1]),
        teamIds: Object.freeze([99]), // 不应被注入
        merchantIds: Object.freeze([100]), // 不应被注入
        assigneeId: 5, // 不应被注入
        range: null,
      }) as any,
    })
    const result = buildDrilldownUrl(metric, ctx)
    expect(result!.url).toBe('/admin?cityIds=1')
  })
})

describe('metric-consistency', () => {
  it('assertCardEqualsSeriesSum：单值 = 桶之和时 ok', () => {
    const scalar = { kind: 'scalar' as const, value: 6, asOf: '2026-07-26T00:00:00.000Z' }
    const series = {
      kind: 'series' as const,
      buckets: [
        { label: 'a', value: 1 },
        { label: 'b', value: 2 },
        { label: 'c', value: 3 },
      ],
      asOf: '2026-07-26T00:00:00.000Z',
    }
    const result = assertCardEqualsSeriesSum(scalar, series)
    expect(result.ok).toBe(true)
  })

  it('assertCardEqualsSeriesSum：单值 != 桶之和时不 ok', () => {
    const scalar = { kind: 'scalar' as const, value: 10, asOf: '2026-07-26T00:00:00.000Z' }
    const series = {
      kind: 'series' as const,
      buckets: [{ label: 'a', value: 1 }, { label: 'b', value: 2 }],
      asOf: '2026-07-26T00:00:00.000Z',
    }
    const result = assertCardEqualsSeriesSum(scalar, series)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('scalar_not_equal_to_series_sum')
  })

  it('assertCardEqualsSeriesSum：空序列 + 单值 0 ok', () => {
    const scalar = { kind: 'scalar' as const, value: 0, asOf: '2026-07-26T00:00:00.000Z' }
    const series = { kind: 'series' as const, buckets: [], asOf: '2026-07-26T00:00:00.000Z' }
    const result = assertCardEqualsSeriesSum(scalar, series)
    expect(result.ok).toBe(true)
  })

  it('assertResultsEqual：相同 scalar ok', () => {
    const a = { kind: 'scalar' as const, value: 5, asOf: '2026-07-26T00:00:00.000Z' }
    const b = { kind: 'scalar' as const, value: 5, asOf: '2026-07-26T00:00:00.000Z' }
    expect(assertResultsEqual(a, b).ok).toBe(true)
  })

  it('assertResultsEqual：不同 kind 不 ok', () => {
    const a = { kind: 'scalar' as const, value: 5, asOf: '2026-07-26T00:00:00.000Z' }
    const b = {
      kind: 'series' as const,
      buckets: [{ label: 'x', value: 5 }],
      asOf: '2026-07-26T00:00:00.000Z',
    }
    expect(assertResultsEqual(a, b).ok).toBe(false)
  })

  it('assertSeriesEqual：桶顺序不同但内容相同 ok', () => {
    const a = {
      kind: 'series' as const,
      buckets: [{ label: 'a', value: 1 }, { label: 'b', value: 2 }],
      asOf: '2026-07-26T00:00:00.000Z',
    }
    const b = {
      kind: 'series' as const,
      buckets: [{ label: 'b', value: 2 }, { label: 'a', value: 1 }],
      asOf: '2026-07-26T00:00:00.000Z',
    }
    expect(assertSeriesEqual(a, b).ok).toBe(true)
  })

  it('assertUrlNotExpandScope：客户端注入越界 ID 被 sanitize 拦截', () => {
    const input = { cityIds: [1, 999] }
    const sanitized = { cityIds: [1], teamIds: [] }
    const scope = {
      cityIds: new Set<number | string>([1, 2, 3]),
      teamIds: 'all' as const,
    }
    const result = assertUrlNotExpandScope(input, sanitized, scope)
    expect(result.ok).toBe(true)
  })

  it('assertUrlNotExpandScope：sanitize 未拦截越界 ID 时不 ok', () => {
    const input = { cityIds: [1, 999] }
    const sanitized = { cityIds: [1, 999], teamIds: [] } // 错误地保留了 999
    const scope = {
      cityIds: new Set<number | string>([1, 2, 3]),
      teamIds: 'all' as const,
    }
    const result = assertUrlNotExpandScope(input, sanitized, scope)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('city_id_out_of_scope')
  })
})

describe('registerBuiltinMetrics', () => {
  it('注册全部内置指标到指定 registry', () => {
    const registry = new MetricRegistry()
    registerBuiltinMetrics(registry)
    expect(registry.codes().length).toBe(BUILTIN_METRICS.length)
  })

  it('重复注册抛 DuplicateMetricError', () => {
    const registry = new MetricRegistry()
    registerBuiltinMetrics(registry)
    expect(() => registerBuiltinMetrics(registry)).toThrow(DuplicateMetricError)
  })

  it('单例 metricRegistry 也可注册（需先 clear）', () => {
    metricRegistry.clear()
    registerBuiltinMetrics(metricRegistry)
    expect(metricRegistry.has('listings.total')).toBe(true)
    expect(metricRegistry.has('leads.conversion_rate')).toBe(true)
    metricRegistry.clear()
  })
})

describe('BUILTIN_METRICS 完整性', () => {
  it('所有内置指标的 code 唯一', () => {
    const codes = BUILTIN_METRICS.map((m) => m.code)
    const unique = new Set(codes)
    expect(unique.size).toBe(codes.length)
  })

  it('所有内置指标的 query 适配器为函数', () => {
    for (const m of BUILTIN_METRICS) {
      expect(typeof m.query).toBe('function')
    }
  })

  it('所有内置指标包含 requiredPermissions', () => {
    for (const m of BUILTIN_METRICS) {
      expect(Array.isArray(m.requiredPermissions)).toBe(true)
      expect(m.requiredPermissions.length).toBeGreaterThan(0)
    }
  })

  it('所有内置指标包含 drilldown', () => {
    for (const m of BUILTIN_METRICS) {
      expect(m.drilldown).toBeDefined()
      expect(m.drilldown!.pathTemplate).toContain('{{filter_keys}}')
      expect(m.drilldown!.filterKeys.length).toBeGreaterThan(0)
    }
  })

  it('cacheTtlMs >= 0', () => {
    for (const m of BUILTIN_METRICS) {
      expect(m.cacheTtlMs).toBeGreaterThanOrEqual(0)
    }
  })

  it('时间范围 today / rolling_* 的指标使用对应时间口径', () => {
    const todayMetrics = BUILTIN_METRICS.filter((m) => m.timeRange === 'today')
    expect(todayMetrics.length).toBeGreaterThan(0)
    for (const m of todayMetrics) {
      expect(m.description).toMatch(/今日|today/i)
    }
  })

  it('stubQuery 返回 0 与 ctx.asOf 一致', async () => {
    const ctx = makeCtx()
    const result = await stubQuery(ctx)
    expect(result.kind).toBe('scalar')
    const scalar = result as MetricScalarResult
    expect(scalar.value).toBe(0)
    expect(scalar.asOf).toBe(ctx.asOf.toISOString())
  })

  it('stubSeriesQuery 返回空 buckets', async () => {
    const ctx = makeCtx()
    const result = await stubSeriesQuery(ctx)
    expect(result.kind).toBe('series')
    const series = result as MetricSeriesResult
    expect(series.buckets).toEqual([])
  })

  it('listings.* 指标覆盖总数 / 已发布 / 待审核 / 已驳回 / 已下架 / 已出租 / 完整度<80%', () => {
    const listingCodes = BUILTIN_METRICS.filter((m) => m.category === 'listing').map((m) => m.code)
    expect(listingCodes).toContain('listings.total')
    expect(listingCodes).toContain('listings.published')
    expect(listingCodes).toContain('listings.pending_review')
    expect(listingCodes).toContain('listings.rejected')
    expect(listingCodes).toContain('listings.offline')
    expect(listingCodes).toContain('listings.rented')
    expect(listingCodes).toContain('listings.completeness_below_80')
  })

  it('leads.* 指标覆盖新增 / 有效 / 无效 / 已分配 / 及时率 / 推荐率 / 转化率', () => {
    const leadCodes = BUILTIN_METRICS.filter((m) => m.category === 'lead').map((m) => m.code)
    expect(leadCodes).toContain('leads.new')
    expect(leadCodes).toContain('leads.valid')
    expect(leadCodes).toContain('leads.invalid')
    expect(leadCodes).toContain('leads.assigned')
    expect(leadCodes).toContain('leads.timely_rate')
    expect(leadCodes).toContain('leads.recommendation_rate')
    expect(leadCodes).toContain('leads.conversion_rate')
  })

  it('tasks.* 指标覆盖待领取 / 逾期 / 今日待跟进 / SLA 超时', () => {
    const taskCodes = BUILTIN_METRICS.filter((m) => m.category === 'task').map((m) => m.code)
    expect(taskCodes).toContain('tasks.pending_claim')
    expect(taskCodes).toContain('tasks.overdue')
    expect(taskCodes).toContain('tasks.today_followup')
    expect(taskCodes).toContain('tasks.sla_breached')
  })

  it('supply.effective_count 复用 listing:read 权限', () => {
    const supplyMetric = BUILTIN_METRICS.find((m) => m.code === 'supply.effective_count')
    expect(supplyMetric).toBeDefined()
    expect(supplyMetric!.requiredPermissions).toContain('listing:read')
  })

  it('所有 listing 类指标复用 listing:read 或 review:read 权限', () => {
    const listingMetrics = BUILTIN_METRICS.filter((m) => m.category === 'listing')
    for (const m of listingMetrics) {
      const hasValid = m.requiredPermissions.some((p) => p === 'listing:read' || p === 'review:read')
      expect(hasValid).toBe(true)
    }
  })
})
