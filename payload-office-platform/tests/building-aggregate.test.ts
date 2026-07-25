import { describe, expect, it, vi } from 'vitest'

import { computeBuildingSupplyAggregate } from '@/domain/supply/building-aggregate'

/**
 * 楼盘有效房源聚合纯函数测试（M3.4 / design §5.5, R3）
 *
 * 口径（M3 过渡）：套数 = 有效供给谓词下的房源数，面积按 ㎡ 直接 SUM，
 * 租金按 rentUnit 分组求 min/max（三种单位不可合并，镜像 facade.ts buildPriceRangesByUnit）。
 * where 与 building-references / filters.ts 过渡口径一致：
 *   status='available' + building.operationalStatus='active' + deletedAt exists:false。
 */

function makePayload(overrides: {
  count?: number
  docs?: Array<Record<string, unknown>>
}) {
  return {
    count: vi.fn(async () => ({ totalDocs: overrides.count ?? 0 })),
    find: vi.fn(async () => ({ docs: overrides.docs ?? [] })),
  }
}

describe('building-aggregate/computeBuildingSupplyAggregate', () => {
  it('套数走 payload.count,where 为有效供给过渡谓词', async () => {
    const payload = makePayload({ count: 7 })
    const result = await computeBuildingSupplyAggregate(payload as never, 42)

    expect(payload.count).toHaveBeenCalledTimes(1)
    const arg = (payload.count as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]
    expect(arg).toMatchObject({
      collection: 'listings',
      where: {
        building: { equals: 42 },
        status: { equals: 'available' },
        'building.operationalStatus': { equals: 'active' },
        deletedAt: { exists: false },
      },
    })
    expect(result.buildingId).toBe(42)
    expect(result.count).toBe(7)
  })

  it('面积按 ㎡ 直接 SUM', async () => {
    const payload = makePayload({
      count: 3,
      docs: [
        { rent: 5, rentUnit: 'rmb-sqm-day', area: 100 },
        { rent: 6, rentUnit: 'rmb-sqm-day', area: 200.5 },
        { rent: 7, rentUnit: 'rmb-sqm-day', area: 50 },
      ],
    })
    const result = await computeBuildingSupplyAggregate(payload as never, 1)
    expect(result.totalArea).toBe(350.5)
  })

  it('租金按 rentUnit 分组求 min/max,跨单位不合并', async () => {
    const payload = makePayload({
      count: 4,
      docs: [
        { rent: 5, rentUnit: 'rmb-sqm-day', area: 100 },
        { rent: 9, rentUnit: 'rmb-sqm-day', area: 200 },
        { rent: 20000, rentUnit: 'rmb-month', area: 300 },
        { rent: 1500, rentUnit: 'rmb-seat-month', area: 40 },
      ],
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

  it('overrideAccess 透传给 count 与 find,默认 false', async () => {
    const payload = makePayload({ count: 0, docs: [] })
    await computeBuildingSupplyAggregate(payload as never, 1)
    expect((payload.count as unknown as { mock: { calls: Array<[Record<string, unknown>]> } }).mock.calls[0][0].overrideAccess).toBe(false)
    expect((payload.find as unknown as { mock: { calls: Array<[Record<string, unknown>]> } }).mock.calls[0][0].overrideAccess).toBe(false)

    const payload2 = makePayload({ count: 0, docs: [] })
    await computeBuildingSupplyAggregate(payload2 as never, 1, undefined, { overrideAccess: true })
    expect((payload2.count as unknown as { mock: { calls: Array<[Record<string, unknown>]> } }).mock.calls[0][0].overrideAccess).toBe(true)
    expect((payload2.find as unknown as { mock: { calls: Array<[Record<string, unknown>]> } }).mock.calls[0][0].overrideAccess).toBe(true)
  })

  it('空结果:count=0,totalArea=0,rentRanges 为空', async () => {
    const payload = makePayload({ count: 0, docs: [] })
    const result = await computeBuildingSupplyAggregate(payload as never, 99)
    expect(result.count).toBe(0)
    expect(result.totalArea).toBe(0)
    expect(result.rentRanges).toEqual([])
  })

  it('缺失/非法 rent 或 area 的文档被安全跳过,不污染聚合', async () => {
    const payload = makePayload({
      count: 3,
      docs: [
        { rent: 5, rentUnit: 'rmb-sqm-day', area: 100 },
        { rent: null, rentUnit: 'rmb-sqm-day', area: 'bad' },
        { rentUnit: 'rmb-sqm-day' },
      ],
    })
    const result = await computeBuildingSupplyAggregate(payload as never, 1)
    expect(result.totalArea).toBe(100)
    expect(result.rentRanges).toEqual([{ unit: 'rmb-sqm-day', min: 5, max: 5, count: 1 }])
  })
})
