import { describe, expect, it, vi } from 'vitest'

import { protectBuilding } from '@/domain/supply/building-protect'

/**
 * M3.1 楼盘保护 hook 单测（design §3.4 / R3）
 * 内存节点图 + mock findByID(city 校验)。
 */
type Node = { id: number; type: string; status?: string }

/** 上海(1,city,active) 北京(2,city,active) 广州(3,city,disabled) 浦东(4,district,active) */
const GRAPH: Node[] = [
  { id: 1, type: 'city', status: 'active' },
  { id: 2, type: 'city', status: 'active' },
  { id: 3, type: 'city', status: 'disabled' },
  { id: 4, type: 'district', status: 'active' },
]

function makeReq(nodes: Node[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  return {
    payload: {
      findByID: async ({ id }: { id: number | string }) => {
        const n = byId.get(Number(id))
        if (!n) throw new Error('not found')
        return { id: n.id, type: n.type, status: n.status }
      },
    },
  } as never
}

const create = (data: Record<string, unknown>) =>
  protectBuilding({
    operation: 'create',
    originalDoc: undefined,
    req: makeReq(GRAPH),
    data,
  } as never) as Promise<Record<string, unknown>>

async function runBuildingProtect(data: Record<string, unknown>, now = new Date()) {
  vi.useFakeTimers()
  vi.setSystemTime(now)
  try {
    return await create(data)
  } finally {
    vi.useRealTimers()
  }
}

describe('building-protect/枚举双保险', () => {
  it('拒绝过期楼盘认证作为公开认证', async () => {
    await expect(
      runBuildingProtect(
        {
          certifications: [
            {
              name: 'LEED',
              validTo: '2026-01-01T00:00:00.000Z',
              publicVisible: true,
            },
          ],
        },
        new Date('2026-07-30T00:00:00.000Z'),
      ),
    ).rejects.toThrow('过期认证不可公开')
  })

  it('非法启停状态 → INVALID_OPERATIONAL_STATUS', async () => {
    await expect(create({ operationalStatus: 'published' })).rejects.toMatchObject({
      code: 'INVALID_OPERATIONAL_STATUS',
    })
  })

  it('非法物业类型 → INVALID_BUILDING_TYPE', async () => {
    await expect(create({ buildingType: 'castle' })).rejects.toMatchObject({
      code: 'INVALID_BUILDING_TYPE',
    })
  })

  it('非法认证状态 → INVALID_VERIFICATION_STATUS', async () => {
    await expect(create({ verificationStatus: 'maybe' })).rejects.toMatchObject({
      code: 'INVALID_VERIFICATION_STATUS',
    })
  })

  it('非法注册能力 → INVALID_REGISTRATION_CAPABILITY', async () => {
    await expect(create({ registrationCapability: 'sometimes' })).rejects.toMatchObject({
      code: 'INVALID_REGISTRATION_CAPABILITY',
    })
  })

  it('合法枚举组合 → 通过', async () => {
    const out = await create({
      operationalStatus: 'active',
      buildingType: 'office_building',
      verificationStatus: 'verified',
      registrationCapability: 'supported',
    })
    expect(out.version).toBe(1)
  })

  it('枚举字段为 null → 不校验（可选空值）', async () => {
    const out = await create({ buildingType: null, verificationStatus: null })
    expect(out.version).toBe(1)
  })
})

describe('building-protect/city 校验', () => {
  it('启用城市 → 通过', async () => {
    const out = await create({ city: 1 })
    expect(out.version).toBe(1)
  })

  it('非城市节点 → INVALID_BUILDING_CITY', async () => {
    await expect(create({ city: 4 })).rejects.toMatchObject({
      code: 'INVALID_BUILDING_CITY',
    })
  })

  it('停用城市 → INVALID_BUILDING_CITY', async () => {
    await expect(create({ city: 3 })).rejects.toMatchObject({
      code: 'INVALID_BUILDING_CITY',
    })
  })

  it('不存在城市 → INVALID_BUILDING_CITY', async () => {
    await expect(create({ city: 999 })).rejects.toMatchObject({
      code: 'INVALID_BUILDING_CITY',
    })
  })

  it('未填 city → 不校验', async () => {
    const out = await create({})
    expect(out.version).toBe(1)
  })
})

describe('building-protect/图集上限', () => {
  it('20 张 → 通过', async () => {
    const out = await create({ gallery: Array.from({ length: 20 }, (_, i) => ({ image: i })) })
    expect(out.version).toBe(1)
  })

  it('21 张 → GALLERY_LIMIT_EXCEEDED', async () => {
    await expect(
      create({ gallery: Array.from({ length: 21 }, (_, i) => ({ image: i })) }),
    ).rejects.toMatchObject({ code: 'GALLERY_LIMIT_EXCEEDED' })
  })
})

describe('building-protect/版本乐观锁', () => {
  it('create → version=1', async () => {
    const out = await create({ operationalStatus: 'active' })
    expect(out.version).toBe(1)
  })

  it('版本冲突 → VERSION_CONFLICT', async () => {
    await expect(
      protectBuilding({
        operation: 'update',
        originalDoc: { id: 10, version: 5 },
        req: makeReq(GRAPH),
        data: { version: 2 },
      } as never),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' })
  })

  it('update 版本一致 → 自增', async () => {
    const out = (await protectBuilding({
      operation: 'update',
      originalDoc: { id: 10, version: 5 },
      req: makeReq(GRAPH),
      data: { version: 5 },
    } as never)) as Record<string, unknown>
    expect(out.version).toBe(6)
  })

  it('停用不改写关联房源（仅置 operationalStatus，version 自增）', async () => {
    const out = (await protectBuilding({
      operation: 'update',
      originalDoc: { id: 10, version: 1, operationalStatus: 'active' },
      req: makeReq(GRAPH),
      data: { operationalStatus: 'disabled', version: 1 },
    } as never)) as Record<string, unknown>
    expect(out.operationalStatus).toBe('disabled')
    expect(out.version).toBe(2)
  })
})
