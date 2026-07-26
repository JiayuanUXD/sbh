import { describe, expect, it } from 'vitest'

import { protectBusinessAreaExtension } from '@/domain/geography/business-area-extension-protect'
import { DomainError } from '@/domain/shared/errors'

/**
 * M2.3 商圈扩展保护 hook 单测（PRD 02-02 §8-§11）
 *
 * 内存节点图 + mock findByID，断言：商圈类型/启用/祖先启用、同城站点、
 * businessArea 不可变、版本乐观锁。
 */
type Node = { id: number; type: string; parent?: number | null; status?: string }

function makeReq(nodes: Node[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  return {
    payload: {
      findByID: async ({ id }: { id: number | string }) => {
        const n = byId.get(Number(id))
        if (!n) throw new Error('not found')
        return { id: n.id, type: n.type, parent: n.parent ?? null, status: n.status }
      },
    },
  } as never
}

/**
 * 上海(1)>浦东(2,active)>陆家嘴(3,active,business_area)
 * 上海>1号线(4)>陆家嘴站(5,active,metro_station)
 * 北京(6)>朝阳(7)>三里屯(8,business_area)；北京>10号线(9)>团结湖(10,metro_station)
 * 停用商圈:静安(11,business_area,disabled) 挂 上海>黄浦(12,active)
 */
const GRAPH: Node[] = [
  { id: 1, type: 'city', status: 'active' },
  { id: 2, type: 'district', parent: 1, status: 'active' },
  { id: 3, type: 'business_area', parent: 2, status: 'active' },
  { id: 4, type: 'metro_line', parent: 1, status: 'active' },
  { id: 5, type: 'metro_station', parent: 4, status: 'active' },
  { id: 6, type: 'city', status: 'active' },
  { id: 7, type: 'district', parent: 6, status: 'active' },
  { id: 8, type: 'business_area', parent: 7, status: 'active' },
  { id: 9, type: 'metro_line', parent: 6, status: 'active' },
  { id: 10, type: 'metro_station', parent: 9, status: 'active' },
  { id: 12, type: 'district', parent: 1, status: 'active' },
  { id: 11, type: 'business_area', parent: 12, status: 'disabled' },
]

const create = (data: Record<string, unknown>) =>
  protectBusinessAreaExtension({
    operation: 'create',
    originalDoc: undefined,
    req: makeReq(GRAPH),
    data,
  } as never) as Promise<Record<string, unknown>>

describe('business-area-extension-protect/商圈校验', () => {
  it('未选商圈 → BUSINESS_AREA_REQUIRED', async () => {
    await expect(create({})).rejects.toMatchObject({ code: 'BUSINESS_AREA_REQUIRED' })
  })

  it('选中非商圈节点 → NOT_BUSINESS_AREA', async () => {
    await expect(create({ businessArea: 2 })).rejects.toMatchObject({ code: 'NOT_BUSINESS_AREA' })
  })

  it('商圈不存在 → BUSINESS_AREA_NOT_FOUND', async () => {
    await expect(create({ businessArea: 999 })).rejects.toMatchObject({
      code: 'BUSINESS_AREA_NOT_FOUND',
    })
  })

  it('停用商圈 → BUSINESS_AREA_INACTIVE', async () => {
    await expect(create({ businessArea: 11 })).rejects.toMatchObject({
      code: 'BUSINESS_AREA_INACTIVE',
    })
  })

  it('合法启用商圈 create → 通过并设 version=1', async () => {
    const out = await create({ businessArea: 3 })
    expect(out.version).toBe(1)
  })
})

describe('business-area-extension-protect/站点关联', () => {
  it('同城启用站点 → 通过', async () => {
    const out = await create({ businessArea: 3, metroStations: [5] })
    expect(out.version).toBe(1)
  })

  it('跨城市站点 → INVALID_STATION_RELATION', async () => {
    // 陆家嘴(上海)关联团结湖(北京)
    await expect(create({ businessArea: 3, metroStations: [10] })).rejects.toMatchObject({
      code: 'INVALID_STATION_RELATION',
    })
  })

  it('非站点节点 → INVALID_STATION_RELATION', async () => {
    await expect(create({ businessArea: 3, metroStations: [2] })).rejects.toMatchObject({
      code: 'INVALID_STATION_RELATION',
    })
  })

  it('details 列出非法站点 id', async () => {
    try {
      await create({ businessArea: 3, metroStations: [10] })
      expect.unreachable('应抛 INVALID_STATION_RELATION')
    } catch (err) {
      const e = err as DomainError
      expect((e.details as { invalidStations: number[] }).invalidStations).toContain(10)
    }
  })
})

describe('business-area-extension-protect/别名与版本', () => {
  it('别名规范化写回 data.aliases', async () => {
    const out = await create({ businessArea: 3, aliases: [{ alias: '  国贸 ' }, { alias: '国贸' }] })
    expect(out.aliases).toEqual([{ alias: '国贸' }])
  })

  it('businessArea 创建后不可改 → BUSINESS_AREA_IMMUTABLE', async () => {
    await expect(
      protectBusinessAreaExtension({
        operation: 'update',
        originalDoc: { businessArea: 3, version: 1 },
        req: makeReq(GRAPH),
        data: { businessArea: 8, version: 1 },
      } as never),
    ).rejects.toMatchObject({ code: 'BUSINESS_AREA_IMMUTABLE' })
  })

  it('版本冲突 → VERSION_CONFLICT', async () => {
    await expect(
      protectBusinessAreaExtension({
        operation: 'update',
        originalDoc: { businessArea: 3, version: 5 },
        req: makeReq(GRAPH),
        data: { businessArea: 3, version: 2 },
      } as never),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' })
  })

  it('update 版本一致 → 自增', async () => {
    const out = (await protectBusinessAreaExtension({
      operation: 'update',
      originalDoc: { businessArea: 3, version: 5 },
      req: makeReq(GRAPH),
      data: { businessArea: 3, version: 5 },
    } as never)) as Record<string, unknown>
    expect(out.version).toBe(6)
  })
})
