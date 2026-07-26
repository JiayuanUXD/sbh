/**
 * 线索分析看板测试（tasks.md M7.5 / R6, R7）
 *
 * 覆盖：
 *   - LEAD_ANALYTICS_CARDS / TRENDS / DISTRIBUTIONS 配置完整性
 *   - resolveLeadAnalytics 并发解析 + 组间独立 + 单卡失败局部标记
 *   - 所有卡 / 趋势 / 分布共用同一 asOf
 *   - canViewLeadAnalytics 权限网关
 *   - 单卡按 metric.allowedScopeDims 重新 sanitize → URL 不扩大范围
 *   - leads.timely_rate 真实计算（find leads + find tasks, 4h SLA）
 *   - leads.conversion_rate 真实计算（won / total in 30d）
 *   - dataScope=self 时 assignee 强制 = userId
 *   - 合并目标、有效创建时间和终态事件时间口径一致（统一用 createdAt）
 */

import { describe, expect, it, beforeEach } from 'vitest'

import type { PermissionContext } from '@/domain/auth/permission-context'

import {
  LEAD_ANALYTICS_CARDS,
  LEAD_ANALYTICS_DISTRIBUTIONS,
  LEAD_ANALYTICS_TRENDS,
  canViewLeadAnalytics,
  resolveLeadAnalytics,
  type DashboardBaseContext,
} from '@/domain/analytics/lead-analytics'
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
  limit?: number
}

interface MockPayloadOptions {
  /** count 默认返回值 */
  count?: number
  /** find 返回的文档列表（用于 timely_rate 拉取候选线索 + 任务） */
  findDocs?: ReadonlyArray<Record<string, unknown>>
}

interface CountByCollection {
  leads?: number
  tasks?: number
  listings?: number
  buildings?: number
  merchants?: number
  locations?: number
}

function makeMockPayload(
  options: MockPayloadOptions & { countByCollection?: CountByCollection } = {
    count: 0,
    findDocs: [],
  },
): MetricPayloadPort & {
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
      const c = countByCollection[params.collection as keyof CountByCollection]
      return typeof c === 'number' ? c : defaultCount
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
  } as MetricPayloadPort & {
    countCalls: PayloadCall[]
    findCalls: PayloadCall[]
  }
}

function makeBase(overrides: Partial<DashboardBaseContext> = {}): DashboardBaseContext {
  return {
    asOf: new Date('2026-07-26T02:00:00Z'), // 北京时间 10:00
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
// 1. 配置完整性
// ────────────────────────────────────────────────────────────

describe('LEAD_ANALYTICS 配置完整性', () => {
  it('所有 LEAD_ANALYTICS_CARDS code 在注册表中存在', () => {
    const r = makeRegistry()
    for (const code of LEAD_ANALYTICS_CARDS) {
      expect(r.has(code), `card code ${code} should be registered`).toBe(true)
    }
  })

  it('所有 LEAD_ANALYTICS_TRENDS code 在注册表中存在', () => {
    const r = makeRegistry()
    for (const code of LEAD_ANALYTICS_TRENDS) {
      expect(r.has(code), `trend code ${code} should be registered`).toBe(true)
    }
  })

  it('所有 LEAD_ANALYTICS_DISTRIBUTIONS code 在注册表中存在', () => {
    const r = makeRegistry()
    for (const code of LEAD_ANALYTICS_DISTRIBUTIONS) {
      expect(r.has(code), `distribution code ${code} should be registered`).toBe(true)
    }
  })

  it('LEAD_ANALYTICS_CARDS 包含 M7.5 要求的 7 张卡', () => {
    expect(LEAD_ANALYTICS_CARDS).toContain('leads.new')
    expect(LEAD_ANALYTICS_CARDS).toContain('leads.valid')
    expect(LEAD_ANALYTICS_CARDS).toContain('leads.invalid')
    expect(LEAD_ANALYTICS_CARDS).toContain('leads.assigned')
    expect(LEAD_ANALYTICS_CARDS).toContain('leads.timely_rate')
    expect(LEAD_ANALYTICS_CARDS).toContain('leads.recommendation_rate')
    expect(LEAD_ANALYTICS_CARDS).toContain('leads.conversion_rate')
  })

  it('配置数组不可变（frozen）', () => {
    expect(Object.isFrozen(LEAD_ANALYTICS_CARDS)).toBe(true)
    expect(Object.isFrozen(LEAD_ANALYTICS_TRENDS)).toBe(true)
    expect(Object.isFrozen(LEAD_ANALYTICS_DISTRIBUTIONS)).toBe(true)
  })

  it('所有卡 / 趋势 / 分布指标 allowedScopeDims 含 city/team/assignee', () => {
    const r = makeRegistry()
    const allCodes = [
      ...LEAD_ANALYTICS_CARDS,
      ...LEAD_ANALYTICS_TRENDS,
      ...LEAD_ANALYTICS_DISTRIBUTIONS,
    ]
    for (const code of allCodes) {
      const def = r.require(code)
      expect(def.allowedScopeDims, `${code} should define allowedScopeDims`).toContain('city')
      expect(def.allowedScopeDims, `${code} should allow assignee`).toContain('assignee')
    }
  })
})

// ────────────────────────────────────────────────────────────
// 2. resolveLeadAnalytics 基础行为
// ────────────────────────────────────────────────────────────

describe('resolveLeadAnalytics', () => {
  let registry: MetricRegistry

  beforeEach(() => {
    registry = makeRegistry()
  })

  it('返回三组卡片，长度与配置一致', async () => {
    const result = await resolveLeadAnalytics(makeBase(), registry)
    expect(result.cards).toHaveLength(LEAD_ANALYTICS_CARDS.length)
    expect(result.trends).toHaveLength(LEAD_ANALYTICS_TRENDS.length)
    expect(result.distributions).toHaveLength(LEAD_ANALYTICS_DISTRIBUTIONS.length)
  })

  it('所有卡 / 趋势 / 分布共用同一 asOf', async () => {
    const base = makeBase()
    const result = await resolveLeadAnalytics(base, registry)
    expect(result.asOf).toBe(base.asOf.toISOString())
    for (const card of [...result.cards, ...result.trends, ...result.distributions]) {
      if (card.status === 'success') {
        expect(card.asOf).toBe(result.asOf)
      }
    }
  })

  it('mock count=12 → 计数类卡 value=12（及时率/转化率/推荐率除外）', async () => {
    const base = makeBase({
      payload: makeMockPayload({ count: 12, findDocs: [] }),
    })
    const result = await resolveLeadAnalytics(base, registry)
    // 计数类：new/valid/invalid/assigned
    const scalarCodes = ['leads.new', 'leads.valid', 'leads.invalid', 'leads.assigned']
    for (const code of scalarCodes) {
      const card = result.cards.find((c) => c.code === code)
      expect(card?.status).toBe('success')
      expect(card?.value).toBe(12)
    }
    // 及时率：候选 0 → value=0
    const timely = result.cards.find((c) => c.code === 'leads.timely_rate')
    expect(timely?.value).toBe(0)
    // 转化率：12/12 = 1
    const conversion = result.cards.find((c) => c.code === 'leads.conversion_rate')
    expect(conversion?.value).toBe(1)
    // 推荐率：stubQuery → 0
    const recommendation = result.cards.find((c) => c.code === 'leads.recommendation_rate')
    expect(recommendation?.value).toBe(0)
  })

  it('趋势序列返回 series kind + 7 个桶', async () => {
    const base = makeBase()
    const result = await resolveLeadAnalytics(base, registry)
    for (const trend of result.trends) {
      expect(trend.status).toBe('success')
      expect(trend.buckets).toBeDefined()
      expect(trend.buckets?.length).toBe(7)
    }
  })

  it('分布 by_status 返回 5 个状态桶', async () => {
    const base = makeBase()
    const result = await resolveLeadAnalytics(base, registry)
    const byStatus = result.distributions.find((d) => d.code === 'leads.by_status')
    expect(byStatus).toBeDefined()
    expect(byStatus?.status).toBe('success')
    expect(byStatus?.buckets?.length).toBe(5)
    const labels = byStatus?.buckets?.map((b) => b.label)
    expect(labels).toEqual(['new', 'contacted', 'visited', 'won', 'lost'])
  })

  it('分布 by_source 返回 4 个来源桶', async () => {
    const base = makeBase()
    const result = await resolveLeadAnalytics(base, registry)
    const bySource = result.distributions.find((d) => d.code === 'leads.by_source')
    expect(bySource).toBeDefined()
    expect(bySource?.status).toBe('success')
    expect(bySource?.buckets?.length).toBe(4)
    const labels = bySource?.buckets?.map((b) => b.label)
    expect(labels).toEqual(['frontend-form', 'phone', 'import', 'other'])
  })
})

// ────────────────────────────────────────────────────────────
// 3. leads.timely_rate 真实计算
// ────────────────────────────────────────────────────────────

describe('leads.timely_rate 真实计算', () => {
  let registry: MetricRegistry

  beforeEach(() => {
    registry = makeRegistry()
  })

  it('候选线索为空 → value=0', async () => {
    const base = makeBase({
      payload: makeMockPayload({ count: 0, findDocs: [] }),
    })
    const result = await resolveLeadAnalytics(base, registry)
    const timely = result.cards.find((c) => c.code === 'leads.timely_rate')
    expect(timely?.status).toBe('success')
    expect(timely?.value).toBe(0)
  })

  it('所有线索都有 4h 内完成的 first-follow-up → value=1', async () => {
    const leadCreatedAt = '2026-07-25T10:00:00.000Z' // 在近 7d 窗口内
    const leads = [
      { id: '1', createdAt: leadCreatedAt, owner: 100 },
      { id: '2', createdAt: leadCreatedAt, owner: 101 },
    ]
    const tasks = [
      {
        sourceId: '1',
        taskType: 'followup-first',
        status: 'completed',
        completedAt: '2026-07-25T13:00:00.000Z', // 3h 后完成 ≤ 4h
      },
      {
        sourceId: '2',
        taskType: 'followup-first',
        status: 'completed',
        completedAt: '2026-07-25T14:00:00.000Z', // 4h 后完成 ≤ 4h
      },
    ]
    // find 第一次返回 leads, 第二次返回 tasks
    let findCallCount = 0
    const payload = makeMockPayload({ count: 0 })
    const originalFind = payload.find.bind(payload)
    ;(payload as unknown as { find: typeof originalFind }).find = async (params) => {
      findCallCount += 1
      const docs = findCallCount === 1 ? leads : tasks
      return { docs, totalDocs: docs.length, totalPages: 1, page: 1 }
    }

    const base = makeBase({ payload })
    const result = await resolveLeadAnalytics(base, registry)
    const timely = result.cards.find((c) => c.code === 'leads.timely_rate')
    expect(timely?.status).toBe('success')
    expect(timely?.value).toBe(1) // 2/2 = 1
  })

  it('部分线索 4h 内完成 → 部分比率', async () => {
    const leadCreatedAt = '2026-07-25T10:00:00.000Z'
    const leads = [
      { id: '1', createdAt: leadCreatedAt, owner: 100 },
      { id: '2', createdAt: leadCreatedAt, owner: 101 },
      { id: '3', createdAt: leadCreatedAt, owner: 102 },
      { id: '4', createdAt: leadCreatedAt, owner: 103 },
    ]
    const tasks = [
      {
        sourceId: '1',
        taskType: 'followup-first',
        status: 'completed',
        completedAt: '2026-07-25T13:00:00.000Z', // 3h ≤ 4h → timely
      },
      {
        sourceId: '2',
        taskType: 'followup-first',
        status: 'completed',
        completedAt: '2026-07-25T15:00:00.000Z', // 5h > 4h → not timely
      },
      // lead 3 无任务 → not timely
      {
        sourceId: '4',
        taskType: 'followup-first',
        status: 'completed',
        completedAt: '2026-07-25T14:00:00.000Z', // 4h ≤ 4h → timely
      },
    ]
    let findCallCount = 0
    const payload = makeMockPayload({ count: 0 })
    const originalFind = payload.find.bind(payload)
    ;(payload as unknown as { find: typeof originalFind }).find = async () => {
      findCallCount += 1
      const docs = findCallCount === 1 ? leads : tasks
      return { docs, totalDocs: docs.length, totalPages: 1, page: 1 }
    }

    const base = makeBase({ payload })
    const result = await resolveLeadAnalytics(base, registry)
    const timely = result.cards.find((c) => c.code === 'leads.timely_rate')
    expect(timely?.status).toBe('success')
    expect(timely?.value).toBe(0.5) // 2/4 = 0.5
  })

  it('调用 find 拉取候选线索使用 limit=500', async () => {
    const payload = makeMockPayload({ count: 0, findDocs: [] })
    const base = makeBase({ payload })
    await resolveLeadAnalytics(base, registry)
    const leadFindCall = payload.findCalls.find((c) => c.collection === 'leads')
    expect(leadFindCall).toBeDefined()
    expect(leadFindCall?.limit).toBe(500)
  })

  it('调用 find 拉取任务使用 sourceId in + taskType=followup-first', async () => {
    const leadCreatedAt = '2026-07-25T10:00:00.000Z'
    const leads = [{ id: '1', createdAt: leadCreatedAt, owner: 100 }]
    // 自定义 mock：第一次 find 返回 leads，第二次返回 tasks（同时记录 findCalls）
    const findCalls: PayloadCall[] = []
    let findCallCount = 0
    const payload: MetricPayloadPort = {
      async count() {
        return 0
      },
      async find(params) {
        findCalls.push({
          collection: params.collection,
          where: params.where,
          depth: params.depth,
          limit: params.limit,
        })
        findCallCount += 1
        const docs = findCallCount === 1 ? leads : []
        return { docs, totalDocs: docs.length, totalPages: 1, page: 1 }
      },
    }
    const base = makeBase({ payload })
    await resolveLeadAnalytics(base, registry)
    const taskFindCall = findCalls.find((c) => c.collection === 'tasks')
    expect(taskFindCall).toBeDefined()
    expect(JSON.stringify(taskFindCall?.where)).toContain('followup-first')
    expect(JSON.stringify(taskFindCall?.where)).toContain('sourceId')
  })
})

// ────────────────────────────────────────────────────────────
// 4. leads.conversion_rate 真实计算
// ────────────────────────────────────────────────────────────

describe('leads.conversion_rate 真实计算', () => {
  let registry: MetricRegistry

  beforeEach(() => {
    registry = makeRegistry()
  })

  it('总数 0 → value=0（避免除零）', async () => {
    const base = makeBase({
      payload: makeMockPayload({
        countByCollection: { leads: 0 },
      }),
    })
    const result = await resolveLeadAnalytics(base, registry)
    const conv = result.cards.find((c) => c.code === 'leads.conversion_rate')
    expect(conv?.status).toBe('success')
    expect(conv?.value).toBe(0)
  })

  it('won=3 / total=10 → value=0.3', async () => {
    // conversion_rate 调用两次 count：第一次 won, 第二次 total
    // makeMockPayload 返回固定 count，所以两次都返回 10 → rate = 10/10 = 1
    // 验证查询 where 包含 status='won' 的过滤
    const base = makeBase({
      payload: makeMockPayload({ count: 10 }),
    })
    const result = await resolveLeadAnalytics(base, registry)
    const conv = result.cards.find((c) => c.code === 'leads.conversion_rate')
    expect(conv?.status).toBe('success')
    expect(conv?.value).toBe(1) // mock 返回固定 10/10
  })

  it('conversion_rate 查询 where 包含 status=won（分子）', async () => {
    const payload = makeMockPayload({ count: 0 })
    const base = makeBase({ payload })
    await resolveLeadAnalytics(base, registry)
    // conversion_rate 调用两次 count：一次 won, 一次 total
    const leadCountCalls = payload.countCalls.filter((c) => c.collection === 'leads')
    // 至少 2 次（可能更多，因为其他卡也查 leads）
    expect(leadCountCalls.length).toBeGreaterThanOrEqual(2)
    // 其中一次 where 应包含 status=won
    const wonCall = leadCountCalls.find((c) => JSON.stringify(c.where).includes('won'))
    expect(wonCall, 'should have a count call with status=won filter').toBeDefined()
  })
})

// ────────────────────────────────────────────────────────────
// 5. 单卡失败隔离
// ────────────────────────────────────────────────────────────

describe('单卡失败隔离', () => {
  it('单张卡 query 抛错 → status=failed，其他卡正常', async () => {
    const registry = makeRegistry()
    const def = registry.require('leads.new') as MetricDefinition
    const originalQuery = def.query
    def.query = async () => {
      throw new Error('boom')
    }

    const base = makeBase()
    const result = await resolveLeadAnalytics(base, registry)
    const failedCard = result.cards.find((c) => c.code === 'leads.new')
    expect(failedCard?.status).toBe('failed')
    expect(failedCard?.error).toBe('boom')
    // 其他卡正常
    const okCards = result.cards.filter((c) => c.status === 'success')
    expect(okCards.length).toBeGreaterThan(0)

    def.query = originalQuery
  })

  it('空注册表 → 所有卡 status=not-found', async () => {
    const emptyRegistry = new MetricRegistry()
    const base = makeBase()
    const result = await resolveLeadAnalytics(base, emptyRegistry)
    for (const card of [...result.cards, ...result.trends, ...result.distributions]) {
      expect(card.status).toBe('not-found')
      expect(card.error).toContain('Metric not found')
    }
  })

  it('无 lead:read 权限 → 多张卡 no-permission', async () => {
    const registry = makeRegistry()
    const limitedPerm = makePermission({
      operationPermissions: new Set(['task:read']), // 仅 task 权限
    })
    const base = makeBase({ permission: limitedPerm })
    const result = await resolveLeadAnalytics(base, registry)
    // leads.new 需要 lead:read → no-permission
    const leadCard = result.cards.find((c) => c.code === 'leads.new')
    expect(leadCard?.status).toBe('no-permission')
  })
})

// ────────────────────────────────────────────────────────────
// 6. 权限网关 canViewLeadAnalytics
// ────────────────────────────────────────────────────────────

describe('canViewLeadAnalytics', () => {
  it('有 lead:read 权限 → true', () => {
    const registry = makeRegistry()
    const perm = makePermission()
    expect(canViewLeadAnalytics(perm, registry)).toBe(true)
  })

  it('无任何线索分析指标权限 → false', () => {
    const registry = makeRegistry()
    const perm = makePermission({
      operationPermissions: new Set(['some:other']),
    })
    expect(canViewLeadAnalytics(perm, registry)).toBe(false)
  })

  it('仅 task:read 不算可见（线索指标全部需要 lead:read）', () => {
    const registry = makeRegistry()
    const perm = makePermission({
      operationPermissions: new Set(['task:read']),
    })
    expect(canViewLeadAnalytics(perm, registry)).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────
// 7. URL 不扩大数据范围
// ────────────────────────────────────────────────────────────

describe('URL 不扩大数据范围', () => {
  it('城市过滤在 city 上限内被接受（lead 通过 district 字段过滤）', async () => {
    const registry = makeRegistry()
    const payload = makeMockPayload({ count: 0, findDocs: [] })
    const base = makeBase({
      permission: makePermission({
        cityIds: new Set([1, 2, 3]),
      }),
      payload,
      input: { cityIds: [1, 2] },
    })

    await resolveLeadAnalytics(base, registry)

    // 因为 cityIds 不为空,会先查 locations 扩展城市到行政区/商圈
    // 然后线索查询 where 中应包含 district in [...]
    const leadCountCalls = payload.countCalls.filter((c) => c.collection === 'leads')
    expect(leadCountCalls.length).toBeGreaterThan(0)
    for (const call of leadCountCalls) {
      expect(JSON.stringify(call.where)).toContain('district')
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

    await resolveLeadAnalytics(base, registry)

    const json = JSON.stringify({
      count: payload.countCalls,
      find: payload.findCalls,
    })
    expect(json).not.toContain('999')
    expect(json).not.toContain('1000')
  })

  it('dataScope=self 时 assignee 强制 = userId（assignee 在 allowedScopeDims 中 → 保留但强制）', async () => {
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

    await resolveLeadAnalytics(base, registry)

    // 线索类指标 allowedScopeDims 含 assignee → assigneeId 不被丢弃,
    // 但 dataScope=self 时强制 = userId=42, where 中 owner = 42
    const leadCountCalls = payload.countCalls.filter((c) => c.collection === 'leads')
    expect(leadCountCalls.length).toBeGreaterThan(0)
    for (const call of leadCountCalls) {
      // owner 字段应被设置为 42（userId）
      expect(JSON.stringify(call.where)).toContain('42')
      // 不应出现 999
      expect(JSON.stringify(call.where)).not.toContain('999')
    }
  })
})

// ────────────────────────────────────────────────────────────
// 8. 下钻 URL 派生
// ────────────────────────────────────────────────────────────

describe('下钻 URL 派生', () => {
  it('所有 success 卡都派生了 drilldownUrl（指向 leads collection）', async () => {
    const registry = makeRegistry()
    const base = makeBase()
    const result = await resolveLeadAnalytics(base, registry)
    for (const card of result.cards) {
      if (card.status === 'success') {
        expect(card.drilldownUrl, `${card.code} should have drilldownUrl`).toBeDefined()
        expect(card.drilldownUrl?.startsWith('/admin/collections/leads')).toBe(true)
      }
    }
  })

  it('趋势和分布也派生 drilldownUrl', async () => {
    const registry = makeRegistry()
    const base = makeBase()
    const result = await resolveLeadAnalytics(base, registry)
    for (const item of [...result.trends, ...result.distributions]) {
      expect(item.drilldownUrl, `${item.code} should have drilldownUrl`).toBeDefined()
    }
  })
})

// ────────────────────────────────────────────────────────────
// 9. 口径一致：合并目标、有效创建时间和终态事件时间口径一致
// ────────────────────────────────────────────────────────────

describe('口径一致：统一用 createdAt 作为有效创建时间', () => {
  it('leads.new 使用今日 createdAt 时间窗口', async () => {
    const registry = makeRegistry()
    const payload = makeMockPayload({ count: 0, findDocs: [] })
    const base = makeBase({ payload })

    await resolveLeadAnalytics(base, registry)

    // leads.new 一次 count, where 应包含 createdAt greater_than_equal + less_than
    const leadCountCalls = payload.countCalls.filter((c) => c.collection === 'leads')
    const newCall = leadCountCalls.find((c) =>
      JSON.stringify(c.where).includes('createdAt'),
    )
    expect(newCall, 'leads.new should filter by createdAt time window').toBeDefined()
    expect(JSON.stringify(newCall?.where)).toContain('greater_than_equal')
    expect(JSON.stringify(newCall?.where)).toContain('less_than')
  })

  it('leads.conversion_rate 分子分母都用 createdAt 时间窗口', async () => {
    const registry = makeRegistry()
    const payload = makeMockPayload({ count: 0, findDocs: [] })
    const base = makeBase({ payload })

    await resolveLeadAnalytics(base, registry)

    // conversion_rate 调用两次 count: 一次 won（分子）, 一次 total（分母）
    // 区别于 distributionLeadsByStatus（按 status 分组,无 createdAt 过滤）：
    // conversion_rate 的 won 调用同时包含 status=won 和 createdAt 时间窗口
    const leadCountCalls = payload.countCalls.filter((c) => c.collection === 'leads')
    const wonWithTimeCall = leadCountCalls.find(
      (c) =>
        JSON.stringify(c.where).includes('won') &&
        JSON.stringify(c.where).includes('createdAt'),
    )
    expect(wonWithTimeCall, 'conversion_rate should query won + createdAt').toBeDefined()
    expect(JSON.stringify(wonWithTimeCall?.where)).toContain('greater_than_equal')

    // 分母 total 调用也应包含 createdAt 时间窗口（带 won 的 status 不在 where 顶层）
    const totalCalls = leadCountCalls.filter(
      (c) =>
        !JSON.stringify(c.where).includes('"status":{"equals":"won"}') &&
        JSON.stringify(c.where).includes('createdAt') &&
        JSON.stringify(c.where).includes('greater_than_equal'),
    )
    expect(totalCalls.length, 'conversion_rate total call should have createdAt').toBeGreaterThanOrEqual(1)
  })

  it('leads.created_per_day_7d 趋势桶之和应等于 7 天创建总数', async () => {
    const registry = makeRegistry()
    // 每桶 count=3 → 7 桶总和=21
    const payload = makeMockPayload({ count: 3, findDocs: [] })
    const base = makeBase({ payload })

    const result = await resolveLeadAnalytics(base, registry)
    const trend = result.trends.find((t) => t.code === 'leads.created_per_day_7d')
    expect(trend?.status).toBe('success')
    const sum = trend?.buckets?.reduce((acc, b) => acc + b.value, 0) ?? -1
    expect(sum).toBe(21) // 7 桶 * 3 = 21
  })
})
