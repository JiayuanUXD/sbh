import { describe, expect, it, vi } from 'vitest'

import { computeBuildingSupplyAggregate } from '@/domain/supply/building-aggregate'

/**
 * 楼盘有效房源聚合纯函数测试（M3.4 → M4.7 / design §5.5, R3）
 *
 * M4.7 口径：套数 = 统一有效供给谓词粗筛 + 逐条精筛后的有效房源数（不再走 payload.count），
 * 与前台 / 详情 / 楼盘页完全一致；面积按 ㎡ 直接 SUM，租金按 rentUnit 分组求 min/max
 * （三种单位不可合并，镜像 facade.ts buildPriceRangesByUnit）。
 *
 * where 走 getEffectiveSupplyWhere（§1-4、§7）+ building 约束 + 举报暂停 not_in（§5），
 * 精筛（媒体 §6 / 关系 §8 / 商户 §9-10）经 resolveEffectiveSupply 逐条判定。
 */

/** 有效供给齐全的候选房源文档（depth≥1 已展开）。 */
function eligibleListing(
  id: number,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    gallery: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    building: { id: 5, city: { id: 100 } },
    merchant: {
      status: 'active',
      qualificationStatus: 'valid',
      qualificationExpiresAt: '2999-01-01T00:00:00.000Z',
      serviceCities: [{ id: 100 }],
    },
    ...extra,
  }
}

/** 生效中的房源-商户关系（effectiveFrom 早、无 effectiveTo → 恒有效）。 */
const EFFECTIVE_RELATION = {
  effectiveFrom: '2000-01-01T00:00:00.000Z',
  effectiveTo: null,
  merchant: {
    status: 'active',
    qualificationStatus: 'valid',
    qualificationExpiresAt: '2999-01-01T00:00:00.000Z',
    serviceCities: [{ id: 100 }],
  },
}

function makePayload(opts: {
  listings?: Array<Record<string, unknown>>
  pausedReports?: Array<{ targetListing: unknown }>
  /** 按 listing id（字符串）映射生效关系；缺省视为该房源无有效关系。 */
  relationsByListing?: Record<string, Array<Record<string, unknown>>>
}) {
  const find = vi.fn(async (params: Record<string, unknown>) => {
    const collection = params.collection
    if (collection === 'listing-reports') {
      return { docs: opts.pausedReports ?? [] }
    }
    if (collection === 'listings') {
      return { docs: opts.listings ?? [] }
    }
    if (collection === 'listing-merchant-relations') {
      const where = params.where as
        | { listing?: { equals?: unknown }; and?: Array<{ listing?: { equals?: unknown } }> }
        | undefined
      const lid = String(where?.listing?.equals ?? where?.and?.[0]?.listing?.equals)
      return { docs: opts.relationsByListing?.[lid] ?? [] }
    }
    return { docs: [] }
  })
  return { find }
}

/** 为一组 listing id 生成"全部生效"的关系映射。 */
function relationsFor(...ids: number[]): Record<string, Array<Record<string, unknown>>> {
  const map: Record<string, Array<Record<string, unknown>>> = {}
  for (const id of ids) map[String(id)] = [{ ...EFFECTIVE_RELATION }]
  return map
}

describe('building-aggregate/computeBuildingSupplyAggregate', () => {
  it('套数 = 精筛后有效房源数,where 为有效供给谓词 + building', async () => {
    const payload = makePayload({
      listings: [
        eligibleListing(10, { area: 100, rent: 5, rentUnit: 'rmb-sqm-day' }),
        eligibleListing(11, { area: 200, rent: 6, rentUnit: 'rmb-sqm-day' }),
        // 媒体不足 → 精筛淘汰,不计入
        eligibleListing(12, { area: 50, rent: 7, rentUnit: 'rmb-sqm-day', gallery: [{ id: 'x' }] }),
      ],
      relationsByListing: relationsFor(10, 11, 12),
    })
    const result = await computeBuildingSupplyAggregate(payload as never, 42)

    // 不再调用 payload.count
    expect('count' in payload).toBe(false)
    // listings 查询 where 携带有效供给谓词 + building
    const calls = (payload.find as unknown as { mock: { calls: Array<[Record<string, unknown>]> } })
      .mock.calls
    const listingCall = calls.find((c) => c[0].collection === 'listings')![0]
    expect(listingCall.where).toMatchObject({
      building: { equals: 42 },
      publicationStatus: { equals: 'published' },
      reviewStatus: { equals: 'approved' },
      supplyVisibilityHold: { equals: 'normal' },
      deletedAt: { exists: false },
    })
    expect(result.buildingId).toBe(42)
    expect(result.count).toBe(2)
  })

  it('面积按 ㎡ 直接 SUM(仅精筛通过的房源)', async () => {
    const payload = makePayload({
      listings: [
        eligibleListing(1, { area: 100, rent: 5, rentUnit: 'rmb-sqm-day' }),
        eligibleListing(2, { area: 200.5, rent: 6, rentUnit: 'rmb-sqm-day' }),
        // 无有效关系 → 淘汰,其面积不计入
        eligibleListing(3, { area: 999, rent: 7, rentUnit: 'rmb-sqm-day' }),
      ],
      relationsByListing: relationsFor(1, 2), // 3 无关系
    })
    const result = await computeBuildingSupplyAggregate(payload as never, 1)
    expect(result.count).toBe(2)
    expect(result.totalArea).toBe(300.5)
  })

  it('租金按 rentUnit 分组求 min/max,跨单位不合并', async () => {
    const payload = makePayload({
      listings: [
        eligibleListing(1, { rent: 5, rentUnit: 'rmb-sqm-day', area: 100 }),
        eligibleListing(2, { rent: 9, rentUnit: 'rmb-sqm-day', area: 200 }),
        eligibleListing(3, { rent: 20000, rentUnit: 'rmb-month', area: 300 }),
        eligibleListing(4, { rent: 1500, rentUnit: 'rmb-seat-month', area: 40 }),
      ],
      relationsByListing: relationsFor(1, 2, 3, 4),
    })
    const result = await computeBuildingSupplyAggregate(payload as never, 1)

    const byUnit = Object.fromEntries(result.rentRanges.map((r) => [r.unit, r]))
    expect(byUnit['rmb-sqm-day']).toEqual({ unit: 'rmb-sqm-day', min: 5, max: 9, count: 2 })
    expect(byUnit['rmb-month']).toEqual({ unit: 'rmb-month', min: 20000, max: 20000, count: 1 })
    expect(byUnit['rmb-seat-month']).toEqual({
      unit: 'rmb-seat-month',
      min: 1500,
      max: 1500,
      count: 1,
    })
    expect(result.rentRanges).toHaveLength(3)
  })

  it('举报暂停房源经 id not_in 排除', async () => {
    const payload = makePayload({
      listings: [eligibleListing(1, { area: 100, rent: 5, rentUnit: 'rmb-sqm-day' })],
      pausedReports: [{ targetListing: 77 }, { targetListing: { id: 88 } }],
      relationsByListing: relationsFor(1),
    })
    await computeBuildingSupplyAggregate(payload as never, 1)

    const calls = (payload.find as unknown as { mock: { calls: Array<[Record<string, unknown>]> } })
      .mock.calls
    const listingCall = calls.find((c) => c[0].collection === 'listings')![0]
    expect(listingCall.where).toMatchObject({ id: { not_in: [77, 88] } })
  })

  it('overrideAccess 透传给 listings find,默认 false', async () => {
    const payload = makePayload({ listings: [], relationsByListing: {} })
    await computeBuildingSupplyAggregate(payload as never, 1)
    let calls = (payload.find as unknown as { mock: { calls: Array<[Record<string, unknown>]> } })
      .mock.calls
    expect(calls.find((c) => c[0].collection === 'listings')![0].overrideAccess).toBe(false)

    const payload2 = makePayload({ listings: [], relationsByListing: {} })
    await computeBuildingSupplyAggregate(payload2 as never, 1, undefined, { overrideAccess: true })
    calls = (payload2.find as unknown as { mock: { calls: Array<[Record<string, unknown>]> } }).mock
      .calls
    expect(calls.find((c) => c[0].collection === 'listings')![0].overrideAccess).toBe(true)
  })

  it('空结果:count=0,totalArea=0,rentRanges 为空', async () => {
    const payload = makePayload({ listings: [], relationsByListing: {} })
    const result = await computeBuildingSupplyAggregate(payload as never, 99)
    expect(result.count).toBe(0)
    expect(result.totalArea).toBe(0)
    expect(result.rentRanges).toEqual([])
  })

  it('缺失/非法 rent 或 area 的有效房源被安全跳过,不污染聚合', async () => {
    const payload = makePayload({
      listings: [
        eligibleListing(1, { rent: 5, rentUnit: 'rmb-sqm-day', area: 100 }),
        eligibleListing(2, { rent: null, rentUnit: 'rmb-sqm-day', area: 'bad' }),
        eligibleListing(3, { rentUnit: 'rmb-sqm-day' }),
      ],
      relationsByListing: relationsFor(1, 2, 3),
    })
    const result = await computeBuildingSupplyAggregate(payload as never, 1)
    // 三条都精筛通过（媒体/关系/商户齐全）→ count=3；但 area/rent 非法项不进聚合
    expect(result.count).toBe(3)
    expect(result.totalArea).toBe(100)
    expect(result.rentRanges).toEqual([{ unit: 'rmb-sqm-day', min: 5, max: 5, count: 1 }])
  })
})
