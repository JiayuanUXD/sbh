import { describe, it, expect } from 'vitest'
import { protectLocation } from '@/domain/geography/location-protect'
import { InvalidOperationError, VersionConflictError } from '@/domain/shared/errors'

/** 内存节点图：id → { type, parent, status } */
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

/** 节点图：上海(1)>浦东(2)>陆家嘴(3)；上海>1号线(4)>陆家嘴站(5)；北京(6)>朝阳(7) */
const GRAPH: Node[] = [
  { id: 1, type: 'city' },
  { id: 2, type: 'district', parent: 1 },
  { id: 3, type: 'business_area', parent: 2 },
  { id: 4, type: 'metro_line', parent: 1 },
  { id: 5, type: 'metro_station', parent: 4 },
  { id: 6, type: 'city' },
  { id: 7, type: 'district', parent: 6 },
]

const baseArgs = (over: Record<string, unknown>) => ({
  operation: 'create' as const,
  originalDoc: undefined,
  req: makeReq(GRAPH),
  ...over,
})

describe('location-protect/固定层级', () => {
  it('城市 create 无父级 → 通过并设 version=1', async () => {
    const data = { type: 'city', immutableCode: 'SH' }
    const out = (await protectLocation(baseArgs({ data }) as never)) as Record<string, unknown>
    expect(out.version).toBe(1)
  })

  it('城市带父级 → 抛 ROOT_HAS_PARENT', async () => {
    const data = { type: 'city', immutableCode: 'SH', parent: 1 }
    await expect(protectLocation(baseArgs({ data }) as never)).rejects.toMatchObject({
      code: 'ROOT_HAS_PARENT',
    })
  })

  it('商圈挂城市下 → 抛 INVALID_PARENT_TYPE', async () => {
    const data = { type: 'business_area', immutableCode: 'BA1', parent: 1 }
    await expect(protectLocation(baseArgs({ data }) as never)).rejects.toMatchObject({
      code: 'INVALID_PARENT_TYPE',
    })
  })

  it('商圈挂行政区下 → 通过', async () => {
    const data = { type: 'business_area', immutableCode: 'BA1', parent: 2 }
    await expect(protectLocation(baseArgs({ data }) as never)).resolves.toBeTruthy()
  })

  it('地铁站挂线路下 → 通过', async () => {
    const data = { type: 'metro_station', immutableCode: 'ST1', parent: 4 }
    await expect(protectLocation(baseArgs({ data }) as never)).resolves.toBeTruthy()
  })

  it('行政区缺父级 → 抛 PARENT_REQUIRED', async () => {
    const data = { type: 'district', immutableCode: 'D1' }
    await expect(protectLocation(baseArgs({ data }) as never)).rejects.toMatchObject({
      code: 'PARENT_REQUIRED',
    })
  })

  it('父级不存在 → 抛 PARENT_NOT_FOUND', async () => {
    const data = { type: 'district', immutableCode: 'D1', parent: 999 }
    await expect(protectLocation(baseArgs({ data }) as never)).rejects.toMatchObject({
      code: 'PARENT_NOT_FOUND',
    })
  })
})

describe('location-protect/不可变字段', () => {
  const orig = { id: 3, type: 'business_area', immutableCode: 'BA1', parent: 2, version: 1 }

  it('改 immutableCode → 抛 IMMUTABLE_CODE', async () => {
    const data = { type: 'business_area', immutableCode: 'BA2', parent: 2 }
    await expect(
      protectLocation(baseArgs({ operation: 'update', originalDoc: orig, data }) as never),
    ).rejects.toMatchObject({ code: 'IMMUTABLE_CODE' })
  })

  it('改 type → 抛 IMMUTABLE_TYPE', async () => {
    const data = { type: 'district', immutableCode: 'BA1', parent: 1 }
    await expect(
      protectLocation(baseArgs({ operation: 'update', originalDoc: orig, data }) as never),
    ).rejects.toMatchObject({ code: 'IMMUTABLE_TYPE' })
  })

  it('自引用为父 → 抛 SELF_PARENT', async () => {
    const data = { type: 'business_area', immutableCode: 'BA1', parent: 3, version: 1 }
    await expect(
      protectLocation(baseArgs({ operation: 'update', originalDoc: orig, data }) as never),
    ).rejects.toMatchObject({ code: 'SELF_PARENT' })
  })
})

describe('location-protect/跨城市移动', () => {
  it('陆家嘴商圈从浦东(上海)移到朝阳(北京)→ 抛 CROSS_CITY_MOVE', async () => {
    const orig = { id: 3, type: 'business_area', immutableCode: 'BA1', parent: 2, version: 1 }
    const data = { type: 'business_area', immutableCode: 'BA1', parent: 7, version: 1 }
    await expect(
      protectLocation(baseArgs({ operation: 'update', originalDoc: orig, data }) as never),
    ).rejects.toMatchObject({ code: 'CROSS_CITY_MOVE' })
  })

  it('同城市内移动（浦东→另一上海行政区）不报跨城市', async () => {
    const graph: Node[] = [...GRAPH, { id: 8, type: 'district', parent: 1 }]
    const orig = { id: 3, type: 'business_area', immutableCode: 'BA1', parent: 2, version: 1 }
    const data = { type: 'business_area', immutableCode: 'BA1', parent: 8, version: 1 }
    const out = await protectLocation({
      operation: 'update',
      originalDoc: orig,
      req: makeReq(graph),
      data,
    } as never)
    expect(out).toBeTruthy()
  })
})

describe('location-protect/版本乐观锁', () => {
  const orig = { id: 1, type: 'city', immutableCode: 'SH', version: 3 }

  it('提交版本一致 → 自增到 4', async () => {
    const data = { type: 'city', immutableCode: 'SH', version: 3 }
    const out = (await protectLocation(
      baseArgs({ operation: 'update', originalDoc: orig, data }) as never,
    )) as Record<string, unknown>
    expect(out.version).toBe(4)
  })

  it('提交旧版本 → 抛 VersionConflictError', async () => {
    const data = { type: 'city', immutableCode: 'SH', version: 2 }
    await expect(
      protectLocation(baseArgs({ operation: 'update', originalDoc: orig, data }) as never),
    ).rejects.toBeInstanceOf(VersionConflictError)
  })

  it('未提交版本 → 按库中自增', async () => {
    const data = { type: 'city', immutableCode: 'SH' }
    const out = (await protectLocation(
      baseArgs({ operation: 'update', originalDoc: orig, data }) as never,
    )) as Record<string, unknown>
    expect(out.version).toBe(4)
  })
})

describe('location-protect/启停联动', () => {
  it('新增下级但上级停用 → 抛 PARENT_DISABLED', async () => {
    const graph: Node[] = [{ id: 1, type: 'city', status: 'disabled' }]
    const data = { type: 'district', immutableCode: 'D1', parent: 1, status: 'active' }
    await expect(
      protectLocation({ operation: 'create', originalDoc: undefined, req: makeReq(graph), data } as never),
    ).rejects.toMatchObject({ code: 'PARENT_DISABLED' })
  })

  it('新增下级且上级启用 → 通过', async () => {
    const graph: Node[] = [{ id: 1, type: 'city', status: 'active' }]
    const data = { type: 'district', immutableCode: 'D1', parent: 1, status: 'active' }
    await expect(
      protectLocation({ operation: 'create', originalDoc: undefined, req: makeReq(graph), data } as never),
    ).resolves.toBeTruthy()
  })

  it('移动到停用的目标父级 → 抛 TARGET_PARENT_DISABLED', async () => {
    // 上海(1,启用)>浦东(2,启用); 黄浦(8,停用)。把陆家嘴商圈(3)从浦东移到黄浦
    const graph: Node[] = [
      { id: 1, type: 'city', status: 'active' },
      { id: 2, type: 'district', parent: 1, status: 'active' },
      { id: 8, type: 'district', parent: 1, status: 'disabled' },
    ]
    const orig = { id: 3, type: 'business_area', immutableCode: 'BA1', parent: 2, version: 1, status: 'active' }
    const data = { type: 'business_area', immutableCode: 'BA1', parent: 8, version: 1, status: 'active' }
    await expect(
      protectLocation({ operation: 'update', originalDoc: orig, req: makeReq(graph), data } as never),
    ).rejects.toMatchObject({ code: 'TARGET_PARENT_DISABLED' })
  })

  it('启用节点但存在停用祖先 → 抛 ANCESTOR_DISABLED', async () => {
    // 城市(1,停用)>行政区(2,启用)>商圈(3)。启用商圈 3 时应逐级上溯发现城市停用
    const graph: Node[] = [
      { id: 1, type: 'city', status: 'disabled' },
      { id: 2, type: 'district', parent: 1, status: 'active' },
    ]
    const orig = { id: 3, type: 'business_area', immutableCode: 'BA1', parent: 2, version: 1, status: 'disabled' }
    const data = { type: 'business_area', immutableCode: 'BA1', parent: 2, version: 1, status: 'active' }
    await expect(
      protectLocation({ operation: 'update', originalDoc: orig, req: makeReq(graph), data } as never),
    ).rejects.toMatchObject({ code: 'ANCESTOR_DISABLED' })
  })

  it('启用节点且所有祖先启用 → 通过', async () => {
    const graph: Node[] = [
      { id: 1, type: 'city', status: 'active' },
      { id: 2, type: 'district', parent: 1, status: 'active' },
    ]
    const orig = { id: 3, type: 'business_area', immutableCode: 'BA1', parent: 2, version: 1, status: 'disabled' }
    const data = { type: 'business_area', immutableCode: 'BA1', parent: 2, version: 1, status: 'active' }
    await expect(
      protectLocation({ operation: 'update', originalDoc: orig, req: makeReq(graph), data } as never),
    ).resolves.toBeTruthy()
  })
})

describe('location-protect/前台可见依赖启用', () => {
  it('停用节点设可见 → 强制 false', async () => {
    const orig = { id: 1, type: 'city', immutableCode: 'SH', version: 1, status: 'active' }
    const data = { type: 'city', immutableCode: 'SH', version: 1, status: 'disabled', frontendVisible: true }
    const out = (await protectLocation(
      baseArgs({ operation: 'update', originalDoc: orig, data }) as never,
    )) as Record<string, unknown>
    expect(out.frontendVisible).toBe(false)
  })

  it('启用节点设可见 → 保留 true', async () => {
    const data = { type: 'city', immutableCode: 'SH', status: 'active', frontendVisible: true }
    const out = (await protectLocation(baseArgs({ data }) as never)) as Record<string, unknown>
    expect(out.frontendVisible).toBe(true)
  })
})

describe('location-protect/坐标与代码', () => {
  it('create 缺 immutableCode → 抛 INVALID_REGION_CODE', async () => {
    const data = { type: 'city' }
    await expect(protectLocation(baseArgs({ data }) as never)).rejects.toMatchObject({
      code: 'INVALID_REGION_CODE',
    })
  })

  it('坐标超范围 → 抛 INVALID_LATITUDE', async () => {
    const data = { type: 'city', immutableCode: 'SH', centerLatitude: 200, centerLongitude: 121 }
    await expect(protectLocation(baseArgs({ data }) as never)).rejects.toMatchObject({
      code: 'INVALID_LATITUDE',
    })
  })
})
