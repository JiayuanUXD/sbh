import { describe, expect, it, vi } from 'vitest'

import { protectLocationDelete } from '@/domain/geography/location-delete-guard'
import { DomainError } from '@/domain/shared/errors'

/**
 * M2.2 被引用节点保护单测（PRD 03_城市区域 L114/L125）
 *
 * mock payload.count：按 collection.field 命中预设数量。
 * 断言 beforeDelete：有引用 → 抛 LOCATION_REFERENCED；无引用 → 放行。
 */
function makeReq(counts: Record<string, number>) {
  const count = vi.fn(
    async ({ collection, where }: { collection: string; where: Record<string, unknown> }) => {
      const field = Object.keys(where)[0]
      return { totalDocs: counts[`${collection}.${field}`] ?? 0 }
    },
  )
  const payload = { count } as never
  return { payload, count }
}

// beforeDelete hook 的最小参数;protectLocationDelete 只用 id 与 req
function invoke(id: number | string, req: unknown) {
  return protectLocationDelete({ id, req } as never)
}

describe('location-delete-guard/protectLocationDelete', () => {
  it('无任何引用 → 放行（不抛错）', async () => {
    const { payload } = makeReq({})
    await expect(invoke(1, { payload })).resolves.toBeUndefined()
  })

  it('被业务对象引用 → 抛 LOCATION_REFERENCED', async () => {
    const { payload } = makeReq({ 'buildings.district': 2 })
    await expect(invoke(1, { payload })).rejects.toMatchObject({
      code: 'LOCATION_REFERENCED',
      domain: 'geography',
    })
  })

  it('仅被下级节点引用 → 同样禁止删除', async () => {
    const { payload } = makeReq({ 'locations.parent': 1 })
    await expect(invoke(9, { payload })).rejects.toBeInstanceOf(DomainError)
  })

  it('被城市站点配置引用 → 同样禁止删除', async () => {
    const { payload } = makeReq({ 'city-site-profiles.city': 1 })

    await expect(invoke(100, { payload })).rejects.toMatchObject({
      code: 'LOCATION_REFERENCED',
      domain: 'geography',
    })
  })

  it('错误 details 含 total 与分来源明细', async () => {
    const { payload } = makeReq({ 'buildings.district': 2, 'leads.district': 1 })
    try {
      await invoke(1, { payload })
      expect.unreachable('应抛出 LOCATION_REFERENCED')
    } catch (err) {
      const e = err as DomainError
      expect(e.details).toMatchObject({ total: 3 })
      const sources = (e.details as { sources: { label: string; count: number }[] }).sources
      expect(sources).toHaveLength(2)
      expect(sources.map((s) => s.label)).toContain('楼盘（行政区）')
    }
  })

  it('删除保护用 overrideAccess:true 全量统计（不随数据权限脱敏）', async () => {
    const { payload, count } = makeReq({})
    await invoke(1, { payload })
    const calls = count.mock.calls as unknown as [{ overrideAccess: boolean }][]
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.every(([arg]) => arg.overrideAccess === true)).toBe(true)
  })
})
