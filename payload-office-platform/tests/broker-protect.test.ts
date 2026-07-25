import { describe, expect, it, vi } from 'vitest'

import { protectBroker } from '@/domain/auth/broker-protect'

/**
 * M2.5 经纪人保护 hook 单测（design §3.3 / R1,R2）
 * 内存节点图 + teams 表 + mock count（user 唯一）。
 */
type LocNode = { id: number; type: string; status?: string }
type Team = { id: number; status?: string }

/** 上海(1,city,active) 北京(2,city,active) 广州(3,city,disabled) 浦东(4,district,active)
 *  陆家嘴(5,business_area,active) 徐家汇(6,business_area,disabled) */
const LOCS: LocNode[] = [
  { id: 1, type: 'city', status: 'active' },
  { id: 2, type: 'city', status: 'active' },
  { id: 3, type: 'city', status: 'disabled' },
  { id: 4, type: 'district', status: 'active' },
  { id: 5, type: 'business_area', status: 'active' },
  { id: 6, type: 'business_area', status: 'disabled' },
]

const TEAMS: Team[] = [
  { id: 100, status: 'active' },
  { id: 200, status: 'disabled' },
]

function makeReq(opts?: { dupUsers?: number }) {
  const locById = new Map(LOCS.map((n) => [n.id, n]))
  const teamById = new Map(TEAMS.map((t) => [t.id, t]))
  const count = vi.fn(async (_args: unknown) => ({ totalDocs: opts?.dupUsers ?? 0 }))
  const req = {
    payload: {
      count,
      findByID: async ({ collection, id }: { collection: string; id: number | string }) => {
        if (collection === 'teams') {
          const t = teamById.get(Number(id))
          if (!t) throw new Error('not found')
          return { id: t.id, status: t.status }
        }
        const n = locById.get(Number(id))
        if (!n) throw new Error('not found')
        return { id: n.id, type: n.type, status: n.status }
      },
    },
  } as never
  return { req, count }
}

const create = (data: Record<string, unknown>, opts?: { dupUsers?: number }) => {
  const { req } = makeReq(opts)
  return protectBroker({
    operation: 'create',
    originalDoc: undefined,
    req,
    data,
  } as never) as Promise<Record<string, unknown>>
}

describe('broker-protect/user 唯一', () => {
  it('用户未被占用 → 通过', async () => {
    const out = await create({ displayName: 'A', user: 42 })
    expect(out.version).toBe(1)
  })

  it('用户已被其它档案占用 → BROKER_USER_TAKEN', async () => {
    await expect(create({ displayName: 'A', user: 42 }, { dupUsers: 1 })).rejects.toMatchObject({
      code: 'BROKER_USER_TAKEN',
    })
  })

  it('update 时排除自身档案（id not_equals）', async () => {
    const { req, count } = makeReq()
    await protectBroker({
      operation: 'update',
      originalDoc: { id: 9, version: 1, employmentStatus: 'active' },
      req,
      data: { displayName: 'A', user: 42, version: 1 },
    } as never)
    const where = (count.mock.calls[0][0] as { where: { and: unknown[] } }).where
    expect(where.and).toEqual([{ user: { equals: 42 } }, { id: { not_equals: 9 } }])
  })
})

describe('broker-protect/服务城市与商圈', () => {
  it('启用城市 + 启用商圈 → 通过', async () => {
    const out = await create({
      displayName: 'A',
      user: 1,
      serviceCities: [1, 2],
      serviceBusinessAreas: [5],
    })
    expect(out.version).toBe(1)
  })

  it('非城市节点 → INVALID_BROKER_CITY', async () => {
    await expect(
      create({ displayName: 'A', user: 1, serviceCities: [4] }),
    ).rejects.toMatchObject({ code: 'INVALID_BROKER_CITY' })
  })

  it('停用城市 → INVALID_BROKER_CITY', async () => {
    await expect(
      create({ displayName: 'A', user: 1, serviceCities: [3] }),
    ).rejects.toMatchObject({ code: 'INVALID_BROKER_CITY' })
  })

  it('非商圈节点 → INVALID_BROKER_BUSINESS_AREA', async () => {
    await expect(
      create({ displayName: 'A', user: 1, serviceBusinessAreas: [1] }),
    ).rejects.toMatchObject({ code: 'INVALID_BROKER_BUSINESS_AREA' })
  })

  it('停用商圈 → INVALID_BROKER_BUSINESS_AREA', async () => {
    await expect(
      create({ displayName: 'A', user: 1, serviceBusinessAreas: [6] }),
    ).rejects.toMatchObject({ code: 'INVALID_BROKER_BUSINESS_AREA' })
  })
})

describe('broker-protect/所属团队', () => {
  it('启用团队 → 通过', async () => {
    const out = await create({ displayName: 'A', user: 1, team: 100 })
    expect(out.version).toBe(1)
  })

  it('停用团队 → INVALID_BROKER_TEAM', async () => {
    await expect(
      create({ displayName: 'A', user: 1, team: 200 }),
    ).rejects.toMatchObject({ code: 'INVALID_BROKER_TEAM' })
  })

  it('不存在团队 → INVALID_BROKER_TEAM', async () => {
    await expect(
      create({ displayName: 'A', user: 1, team: 999 }),
    ).rejects.toMatchObject({ code: 'INVALID_BROKER_TEAM' })
  })
})

describe('broker-protect/版本乐观锁', () => {
  it('create → version=1', async () => {
    const out = await create({ displayName: 'A', user: 1 })
    expect(out.version).toBe(1)
  })

  it('版本冲突 → VERSION_CONFLICT', async () => {
    const { req } = makeReq()
    await expect(
      protectBroker({
        operation: 'update',
        originalDoc: { id: 10, version: 5, employmentStatus: 'active' },
        req,
        data: { displayName: 'A', user: 1, version: 2 },
      } as never),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' })
  })

  it('update 版本一致 → 自增', async () => {
    const { req } = makeReq()
    const out = (await protectBroker({
      operation: 'update',
      originalDoc: { id: 10, version: 5, employmentStatus: 'active' },
      req,
      data: { displayName: 'A', user: 1, version: 5 },
    } as never)) as Record<string, unknown>
    expect(out.version).toBe(6)
  })
})
