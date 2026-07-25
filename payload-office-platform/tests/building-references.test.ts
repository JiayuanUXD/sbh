import { describe, it, expect, vi } from 'vitest'
import { countBuildingDeactivationImpact } from '@/domain/supply/building-references'

/**
 * mock payload.count：按 (collection, where 顶层字段) 返回预设数量。
 * 楼盘停用影响的口径是「该楼盘下当前对外可见（available）的房源数」。
 */
function makePayload(counts: Record<string, number>) {
  return {
    count: vi.fn(
      async ({ collection, where }: { collection: string; where: Record<string, unknown> }) => {
        const field = Object.keys(where)[0]
        const key = `${collection}.${field}`
        return { totalDocs: counts[key] ?? 0 }
      },
    ),
  } as never
}

describe('building-references/countBuildingDeactivationImpact', () => {
  it('无受影响房源 → total 0, referenced false, sources 空', async () => {
    const payload = makePayload({})
    const report = await countBuildingDeactivationImpact(payload, 42)
    expect(report.total).toBe(0)
    expect(report.referenced).toBe(false)
    expect(report.sources).toEqual([])
    expect(report.buildingId).toBe(42)
  })

  it('统计该楼盘下 available 房源数', async () => {
    const payload = makePayload({ 'listings.building': 5 })
    const report = await countBuildingDeactivationImpact(payload, 7)
    expect(report.total).toBe(5)
    expect(report.referenced).toBe(true)
    expect(report.sources).toHaveLength(1)
    expect(report.sources[0].collection).toBe('listings')
    expect(report.sources[0].label).toContain('房源')
  })

  it('对每个来源规格各调用一次 count', async () => {
    const payload = makePayload({})
    await countBuildingDeactivationImpact(payload, 1)
    // 当前来源规格：listings（该楼盘下 available 房源）
    expect((payload as { count: { mock: { calls: unknown[] } } }).count.mock.calls).toHaveLength(1)
  })

  it('传入的楼盘 ID 用于 where 过滤', async () => {
    const payload = makePayload({ 'listings.building': 3 })
    await countBuildingDeactivationImpact(payload, 99)
    const calls = (
      payload as {
        count: { mock: { calls: [{ where: { building: { equals: unknown } } }][] } }
      }
    ).count.mock.calls
    expect(calls[0][0].where.building).toEqual({ equals: 99 })
  })

  it('默认 overrideAccess:false（随权限脱敏,用于「停用影响」展示）', async () => {
    const payload = makePayload({})
    await countBuildingDeactivationImpact(payload, 1)
    const calls = (payload as { count: { mock: { calls: [{ overrideAccess: boolean }][] } } }).count
      .mock.calls
    expect(calls.every(([arg]) => arg.overrideAccess === false)).toBe(true)
  })

  it('overrideAccess:true 透传给每次 count（全量统计）', async () => {
    const payload = makePayload({})
    await countBuildingDeactivationImpact(payload, 1, undefined, { overrideAccess: true })
    const calls = (payload as { count: { mock: { calls: [{ overrideAccess: boolean }][] } } }).count
      .mock.calls
    expect(calls.every(([arg]) => arg.overrideAccess === true)).toBe(true)
  })
})
