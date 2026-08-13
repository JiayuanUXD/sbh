import { describe, it, expect, vi } from 'vitest'
import { countLocationReferences } from '@/domain/geography/location-references'

/**
 * mock payload.count：按 (collection, where 的字段) 返回预设数量。
 * 通过检查 where 的顶层字段名区分 buildings 的三个字段。
 */
function makePayload(counts: Record<string, number>) {
  return {
    count: vi.fn(async ({ collection, where }: { collection: string; where: Record<string, unknown> }) => {
      const field = Object.keys(where)[0]
      const key = `${collection}.${field}`
      return { totalDocs: counts[key] ?? 0 }
    }),
  } as never
}

describe('location-references/countLocationReferences', () => {
  it('无任何引用 → total 0, referenced false, sources 空', async () => {
    const payload = makePayload({})
    const report = await countLocationReferences(payload, 42)
    expect(report.total).toBe(0)
    expect(report.referenced).toBe(false)
    expect(report.sources).toEqual([])
    expect(report.locationId).toBe(42)
  })

  it('多来源聚合 total 正确,仅保留有引用来源', async () => {
    const payload = makePayload({
      'buildings.district': 3,
      'buildings.businessDistrict': 0,
      'buildings.nearestMetro': 1,
      'leads.district': 2,
      'users.cityScope': 0,
      'locations.parent': 5,
      'city-site-profiles.city': 1,
      'city-site-profiles.featuredRegions': 2,
    })
    const report = await countLocationReferences(payload, 7)
    expect(report.total).toBe(3 + 1 + 2 + 5 + 1 + 2)
    expect(report.referenced).toBe(true)
    // 6 个非零来源
    expect(report.sources).toHaveLength(6)
    const labels = report.sources.map((s) => s.label)
    expect(labels).toContain('楼盘（行政区）')
    expect(labels).toContain('下级节点')
    expect(labels).toContain('城市站点配置（城市）')
    expect(labels).toContain('城市站点配置（精选区域）')
    expect(labels).not.toContain('楼盘（商圈）') // 0 被过滤
  })

  it('仅下级节点引用 → referenced true', async () => {
    const payload = makePayload({ 'locations.parent': 1 })
    const report = await countLocationReferences(payload, 99)
    expect(report.total).toBe(1)
    expect(report.referenced).toBe(true)
    expect(report.sources).toHaveLength(1)
    expect(report.sources[0].collection).toBe('locations')
  })

  it('城市站点配置引用会阻止位置被视为未引用', async () => {
    const payload = makePayload({ 'city-site-profiles.city': 1 })
    const report = await countLocationReferences(payload, 100)

    expect(report).toMatchObject({ total: 1, referenced: true })
    expect(report.sources).toEqual([
      expect.objectContaining({ collection: 'city-site-profiles', count: 1 }),
    ])
  })

  it('对每个来源规格各调用一次 count', async () => {
    const payload = makePayload({})
    await countLocationReferences(payload, 1)
    // 8 条规格：buildings×3 + leads + users + locations + city-site-profiles×2
    expect((payload as { count: { mock: { calls: unknown[] } } }).count.mock.calls).toHaveLength(8)
  })

  it('默认 overrideAccess:false（随权限脱敏,用于「查看引用」）', async () => {
    const payload = makePayload({})
    await countLocationReferences(payload, 1)
    const calls = (payload as { count: { mock: { calls: [{ overrideAccess: boolean }][] } } }).count
      .mock.calls
    expect(calls.every(([arg]) => arg.overrideAccess === false)).toBe(true)
  })

  it('overrideAccess:true 透传给每次 count（删除/停用保护全量统计）', async () => {
    const payload = makePayload({})
    await countLocationReferences(payload, 1, undefined, { overrideAccess: true })
    const calls = (payload as { count: { mock: { calls: [{ overrideAccess: boolean }][] } } }).count
      .mock.calls
    expect(calls.every(([arg]) => arg.overrideAccess === true)).toBe(true)
  })
})
