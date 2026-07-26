import { describe, expect, it } from 'vitest'

import { protectTeam } from '@/domain/auth/team-protect'
import { DomainError } from '@/domain/shared/errors'

/**
 * M2.5 团队保护 hook 单测（design §3.3 / R1,R2）
 * 内存节点图 + mock findByID（城市范围校验）。
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
  protectTeam({
    operation: 'create',
    originalDoc: undefined,
    req: makeReq(GRAPH),
    data,
  } as never) as Promise<Record<string, unknown>>

describe('team-protect/城市范围', () => {
  it('空城市范围 → 通过', async () => {
    const out = await create({ name: 'A' })
    expect(out.version).toBe(1)
  })

  it('启用城市 → 通过', async () => {
    const out = await create({ name: 'A', cityScope: [1, 2] })
    expect(out.version).toBe(1)
  })

  it('非城市节点 → INVALID_TEAM_CITY', async () => {
    await expect(create({ name: 'A', cityScope: [4] })).rejects.toMatchObject({
      code: 'INVALID_TEAM_CITY',
    })
  })

  it('停用城市 → INVALID_TEAM_CITY', async () => {
    await expect(create({ name: 'A', cityScope: [3] })).rejects.toMatchObject({
      code: 'INVALID_TEAM_CITY',
    })
  })

  it('不存在城市 → details 列出 id', async () => {
    try {
      await create({ name: 'A', cityScope: [999] })
      expect.unreachable('应抛 INVALID_TEAM_CITY')
    } catch (err) {
      const e = err as DomainError
      expect((e.details as { invalidCities: number[] }).invalidCities).toContain(999)
    }
  })
})

describe('team-protect/版本乐观锁', () => {
  it('create → version=1', async () => {
    const out = await create({ name: 'A' })
    expect(out.version).toBe(1)
  })

  it('版本冲突 → VERSION_CONFLICT', async () => {
    await expect(
      protectTeam({
        operation: 'update',
        originalDoc: { id: 10, version: 5, status: 'active' },
        req: makeReq(GRAPH),
        data: { name: 'A', version: 2 },
      } as never),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' })
  })

  it('update 版本一致 → 自增', async () => {
    const out = (await protectTeam({
      operation: 'update',
      originalDoc: { id: 10, version: 5, status: 'active' },
      req: makeReq(GRAPH),
      data: { name: 'A', version: 5 },
    } as never)) as Record<string, unknown>
    expect(out.version).toBe(6)
  })
})
