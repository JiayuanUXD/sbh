/**
 * 列表页价格区间的「单位闸门」（priceMin/priceMax 必须配合 priceUnit）
 *
 * 被守护的缺陷：`?priceMax=6` 而没有 `priceUnit` 曾经是一个**看不见的生效条件**。
 * 它会在 where 上落成 `rent <= 6`，把 6 元/㎡/天、6 元/月、6 元/工位/月放进同一次
 * 比较——三个不可通约的量纲，比出来的结果集没有任何含义；而价格筛选行的档位来自
 * `PRICE_MAX_BUCKETS[priceUnit]`，没有单位就零候选、整行不渲染，用户既看不见它
 * 也点不掉它。楼盘详情供给区的同型缺口在 OPT-037 Task 7 已按同一裁定堵上
 * （`building-supply.ts#matchesInput`），本文件锁的是列表页这一条链路。
 *
 * 守护不变量（三层，缺一层都能让缺陷从别的入口回来）：
 *   1. 解析层：缺 priceUnit 的区间整段丢弃，canonical 不再把它带在链接上；
 *   2. 查询层：价格区间**不下推 where**（where 无法表达「同一单位内比大小」，
 *      且 `rent` 是过渡期旧列，结构化价格房源在该列上为空）；
 *   3. 失效点：`filterByPriceRange` 在内存里按 `PriceViewModel.displayUnit` 精筛，
 *      给绕过 URL 直接构造 input 的调用方（facet 剥离、内部编排）兜底。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const payloadState = vi.hoisted(() => ({
  find: vi.fn<(params: Record<string, unknown>) => Promise<Record<string, unknown>>>(),
  findByID: vi.fn<(params: Record<string, unknown>) => Promise<Record<string, unknown>>>(),
}))

vi.mock('payload', () => ({
  getPayload: async () => ({
    find: payloadState.find,
    findByID: payloadState.findByID,
  }),
}))

vi.mock('@/payload.config', () => ({ default: {} }))

import {
  buildCanonicalSearchParams,
  createPayloadSupplyAdapter,
  createSearchContext,
  parseListingSearchInput,
  type ListingSearchInput,
} from '@/domain/public-catalog'
import { countActivePicks } from '@/components/frontend/listing/FilterFormC'

const parse = (query: string) => parseListingSearchInput(new URLSearchParams(query))
const canonical = (query: string) => buildCanonicalSearchParams(parse(query)).toString()

// ---------------------------------------------------------------------------
// 1. 解析层：缺 priceUnit 的区间整段丢弃
// ---------------------------------------------------------------------------

describe('price-unit-gate/解析层', () => {
  it('缺 priceUnit 时 priceMin/priceMax 整段丢弃（新参数名）', () => {
    expect(parse('priceMax=6').priceMax).toBeUndefined()
    expect(parse('priceMin=100').priceMin).toBeUndefined()
    const both = parse('priceMin=100&priceMax=500')
    expect(both.priceMin).toBeUndefined()
    expect(both.priceMax).toBeUndefined()
  })

  it('缺 priceUnit 时旧参数名 rentMin/rentMax 同样丢弃', () => {
    const input = parse('rentMin=100&rentMax=500')
    expect(input.priceMin).toBeUndefined()
    expect(input.priceMax).toBeUndefined()
  })

  it('只丢价格区间，不牵连其它维度', () => {
    const input = parse('priceMax=6&areaMin=50&district=jingan&q=江景')
    expect(input.priceMax).toBeUndefined()
    expect(input.areaMin).toBe(50)
    expect(input.district).toEqual(['jingan'])
    expect(input.q).toBe('江景')
  })

  it('给了 priceUnit 时区间照常保留（新旧参数名皆然）', () => {
    const fromNew = parse('priceUnit=rmb-sqm-day&priceMin=3&priceMax=6')
    expect(fromNew.priceMin).toBe(3)
    expect(fromNew.priceMax).toBe(6)
    const fromLegacy = parse('rentUnit=rmb-sqm-day&rentMin=3&rentMax=6')
    expect(fromLegacy.priceMin).toBe(3)
    expect(fromLegacy.priceMax).toBe(6)
  })

  it('出售单位同样开闸（区间不是租赁专属）', () => {
    const input = parse('priceUnit=rmb-total&priceMax=30000000')
    expect(input.priceUnit).toBe('rmb-total')
    expect(input.priceMax).toBe(30_000_000)
  })

  it('非法 priceUnit 被丢弃后，区间跟着丢弃（闸门看的是解析结果，不是原始参数）', () => {
    const input = parse('priceUnit=usd-month&priceMax=6')
    expect(input.priceUnit).toBeUndefined()
    expect(input.priceMax).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// 2. canonical：不再把注定不生效的参数带在链接上
// ---------------------------------------------------------------------------

describe('price-unit-gate/canonical', () => {
  it('缺 priceUnit 的区间不进 canonical', () => {
    const query = canonical('priceMin=100&priceMax=500')
    expect(query).not.toContain('priceMin')
    expect(query).not.toContain('priceMax')
  })

  it('已收录的旧 URL 经一次解析即自愈（rentMax 不会换个名字长回来）', () => {
    expect(canonical('rentMin=100&rentMax=500')).toBe('')
  })

  it('直接构造的 input 也挡：没有 priceUnit 就不输出区间', () => {
    const input = { priceMin: 100, priceMax: 500, page: 1, pageSize: 24 } as unknown as ListingSearchInput
    expect(buildCanonicalSearchParams(input).toString()).not.toContain('price')
  })

  it('往返幂等：带单位的区间原样保留', () => {
    const once = canonical('priceUnit=rmb-sqm-day&priceMin=3&priceMax=6&areaMin=50')
    expect(once).toContain('priceMin=3')
    expect(once).toContain('priceMax=6')
    expect(canonical(once)).toBe(once)
  })
})

// ---------------------------------------------------------------------------
// 3+4. 查询层与失效点
// ---------------------------------------------------------------------------

/**
 * 一条候选房源。金额走**结构化价格**字段（`price.*`），旧列 `rent`/`rentUnit`
 * 一律留空——这正是现行数据的形态，也是「对 rent 做区间会把新数据整批筛掉」
 * 这条理由的具体样子。
 */
function listing(options: Readonly<{
  id: number
  amount?: number
  period?: 'day' | 'month' | 'year' | 'one-time'
  unit?: 'sqm' | 'seat' | 'suite'
}>): Record<string, unknown> {
  const { id, amount, period = 'month', unit = 'sqm' } = options
  return {
    id,
    slug: `listing-${id}`,
    title: `房源 ${id}`,
    listingType: 'traditional-office',
    businessType: 'lease',
    publicationStatus: 'published',
    reviewStatus: 'approved',
    supplyVisibilityHold: 'normal',
    gallery: [{ image: 1 }, { image: 2 }, { image: 3 }],
    ...(amount == null ? {} : { price: { amount, currency: 'CNY', period, unit } }),
    building: {
      id: 10,
      city: { id: 100, status: 'active' },
      district: { id: 101, status: 'active' },
    },
  }
}

function activeRelation(listingId: number): Record<string, unknown> {
  return {
    id: listingId + 10_000,
    listing: listingId,
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    effectiveTo: null,
    merchant: {
      id: 50,
      status: 'active',
      qualificationStatus: 'valid',
      qualificationExpiresAt: '2027-01-01T00:00:00.000Z',
      serviceCities: [{ id: 100 }],
    },
  }
}

function mockListings(docs: readonly Record<string, unknown>[]): void {
  payloadState.find.mockReset()
  payloadState.find.mockImplementation(async (params) => {
    if (params.collection === 'listing-reports') {
      return { docs: [], hasNextPage: false, nextPage: null }
    }
    if (params.collection === 'listings') {
      return { docs: [...docs], hasNextPage: false, nextPage: null }
    }
    if (params.collection === 'listing-merchant-relations') {
      return {
        docs: docs.map((doc) => activeRelation(doc.id as number)),
        hasNextPage: false,
        nextPage: null,
      }
    }
    throw new Error(`unexpected collection ${String(params.collection)}`)
  })
}

const CTX = createSearchContext('shanghai', new Date('2026-07-30T00:00:00.000Z'))

async function search(searchInput: ListingSearchInput): Promise<number[]> {
  const adapter = createPayloadSupplyAdapter()
  const docs = await adapter.findEffectiveListings(searchInput, CTX)
  return docs.map((doc) => doc.id)
}

/** listings 集合那次查询实际用的 where。 */
function listingsWhere(): Record<string, unknown> {
  const call = payloadState.find.mock.calls.find(([params]) => params.collection === 'listings')
  return (call?.[0].where ?? {}) as Record<string, unknown>
}

/** 直接构造 input：绕过解析层，专门验失效点上的那道守卫。 */
function input(overrides: Partial<ListingSearchInput>): ListingSearchInput {
  return { page: 1, pageSize: 24, sort: 'recommended', ...overrides } as ListingSearchInput
}

describe('price-unit-gate/查询层 where', () => {
  beforeEach(() => {
    payloadState.find.mockReset()
    payloadState.findByID.mockReset()
  })

  it('价格区间不下推 where（缺 priceUnit）', async () => {
    mockListings([listing({ id: 1, amount: 200 })])
    await search(input({ priceMin: 100, priceMax: 500 }))
    expect(listingsWhere()).not.toHaveProperty('rent')
  })

  it('价格区间不下推 where（给了 priceUnit 也不下推：rent 是过渡期旧列）', async () => {
    mockListings([listing({ id: 1, amount: 200 })])
    await search(input({ priceMin: 100, priceMax: 500, priceUnit: 'rmb-sqm-month' }))
    expect(listingsWhere()).not.toHaveProperty('rent')
  })

  it('面积区间仍然下推（对照组：不是所有区间都被搬进内存）', async () => {
    mockListings([listing({ id: 1, amount: 200 })])
    await search(input({ areaMin: 50, areaMax: 200 }))
    expect(listingsWhere().area).toEqual({ greater_than_equal: 50, less_than_equal: 200 })
  })
})

describe('price-unit-gate/失效点精筛', () => {
  beforeEach(() => {
    payloadState.find.mockReset()
    payloadState.findByID.mockReset()
  })

  it('缺 priceUnit 时价格区间整段不生效：一条都不该被它筛掉', async () => {
    mockListings([
      listing({ id: 1, amount: 5, unit: 'sqm', period: 'day' }),
      listing({ id: 2, amount: 30_000, unit: 'suite', period: 'month' }),
      listing({ id: 3, amount: 2_000, unit: 'seat', period: 'month' }),
    ])
    // 旧行为：`rent <= 6` 只留下 id=1，且这个「6」跨三个量纲，毫无意义。
    expect(await search(input({ priceMax: 6 }))).toEqual([1, 2, 3])
  })

  it('给了 priceUnit 时按同一单位比大小，区间之外的剔除', async () => {
    mockListings([
      listing({ id: 1, amount: 120, unit: 'sqm', period: 'month' }),
      listing({ id: 2, amount: 200, unit: 'sqm', period: 'month' }),
      listing({ id: 3, amount: 400, unit: 'sqm', period: 'month' }),
    ])
    expect(
      await search(input({ priceUnit: 'rmb-sqm-month', priceMin: 150, priceMax: 300 })),
    ).toEqual([2])
  })

  it('区间边界含端点', async () => {
    mockListings([
      listing({ id: 1, amount: 150, unit: 'sqm', period: 'month' }),
      listing({ id: 2, amount: 300, unit: 'sqm', period: 'month' }),
    ])
    expect(
      await search(input({ priceUnit: 'rmb-sqm-month', priceMin: 150, priceMax: 300 })),
    ).toEqual([1, 2])
  })

  it('单位不同的房源即使金额落在区间内也不入选（这正是缺陷本身）', async () => {
    mockListings([
      listing({ id: 1, amount: 200, unit: 'sqm', period: 'month' }),
      // 200 元/工位/月 与 200 元/㎡/月 数值相同、量纲不同
      listing({ id: 2, amount: 200, unit: 'seat', period: 'month' }),
      // 200 元/㎡/年 也一样：unit 相同但 period 不同，displayUnit 就不是一个东西
      listing({ id: 3, amount: 200, unit: 'sqm', period: 'year' }),
    ])
    expect(
      await search(input({ priceUnit: 'rmb-sqm-month', priceMin: 100, priceMax: 300 })),
    ).toEqual([1])
  })

  it('「面议」房源在给定区间时不入选：区间是数值断言，面议无法比较', async () => {
    mockListings([
      listing({ id: 1, amount: 200, unit: 'sqm', period: 'month' }),
      listing({ id: 2 }),
    ])
    expect(await search(input({ priceUnit: 'rmb-sqm-month', priceMax: 300 }))).toEqual([1])
    // 对照：不给区间时，面议房源照常可见（与楼盘详情供给区同一裁定）
    mockListings([
      listing({ id: 1, amount: 200, unit: 'sqm', period: 'month' }),
      listing({ id: 2 }),
    ])
    expect(await search(input({}))).toEqual([1, 2])
  })

  it('只给下限 / 只给上限都生效', async () => {
    const docs = [
      listing({ id: 1, amount: 100, unit: 'sqm', period: 'month' }),
      listing({ id: 2, amount: 300, unit: 'sqm', period: 'month' }),
    ]
    mockListings(docs)
    expect(await search(input({ priceUnit: 'rmb-sqm-month', priceMin: 200 }))).toEqual([2])
    mockListings(docs)
    expect(await search(input({ priceUnit: 'rmb-sqm-month', priceMax: 200 }))).toEqual([1])
  })

  it('结构化价格房源（rent 列为空）照样筛得出来', async () => {
    mockListings([listing({ id: 7, amount: 3_000_000, unit: 'suite', period: 'one-time' })])
    expect(await search(input({ priceUnit: 'rmb-total', priceMax: 5_000_000 }))).toEqual([7])
    // 前提核对：旧的 `where.rent` 口径会把这条房源整批筛掉（该列为空）
    expect(listingsWhere()).not.toHaveProperty('rent')
  })
})

// ---------------------------------------------------------------------------
// 5. 「已选 N 项」的零候选行守卫（原先靠 `?priceMax=6` 覆盖，现改为直接单测）
// ---------------------------------------------------------------------------

describe('price-unit-gate/countActivePicks 零候选行', () => {
  it('零候选的行即使带 activeValue 也不计数（与 visibleRows 同判据）', () => {
    expect(countActivePicks([{ key: 'priceMax', label: '租金上限', options: [], activeValue: '6' }])).toBe(0)
  })

  it('有候选且命中才计数', () => {
    expect(
      countActivePicks([
        { key: 'priceMax', label: '租金上限', options: [{ value: '6', label: '6 元以下' }], activeValue: '6' },
      ]),
    ).toBe(1)
  })
})
