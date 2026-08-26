import payload, { createLocalReq, type PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'

import { SupplyImportBatches } from '@/collections/SupplyImportBatches'
import { LocationAliases } from '@/collections/LocationAliases'
import { Buildings } from '@/collections/Buildings'
import { Listings } from '@/collections/Listings'
import type { Role, User } from '@/payload-types'

const { default: configPromise } = await import('@/payload.config')
const payloadConfig = await configPromise
payload.config = payloadConfig

function makeRole(overrides: Partial<Role> = {}): Role {
  return {
    id: 1,
    code: 'OPS',
    name: '运营',
    isBuiltin: true,
    status: 'active',
    dataScope: 'city',
    menuPermissions: [],
    operationPermissions: ['data:import'],
    fieldPermissions: [],
    updatedAt: '',
    createdAt: '',
    ...overrides,
  } as unknown as Role
}

function makeUser(params: { id: number; roles: Role[]; cityScope?: number[] }): User {
  return {
    id: params.id,
    name: '测试用户',
    email: `user-${params.id}@example.com`,
    status: 'active',
    roles: params.roles,
    cityScope: params.cityScope ?? [],
    sessionVersion: 1,
    updatedAt: '',
    createdAt: '',
    collection: 'users',
  } as unknown as User
}

async function makeReq(user: User | null): Promise<PayloadRequest> {
  return user ? createLocalReq({ user }, payload) : createLocalReq({}, payload)
}

/** 从 collection 配置里按 name 深度查找字段（跨 tabs / row / group）。 */
function findField(fields: unknown, name: string): Record<string, unknown> | null {
  if (!Array.isArray(fields)) return null
  for (const raw of fields) {
    if (!raw || typeof raw !== 'object') continue
    const field = raw as Record<string, unknown>
    if (field.name === name) return field
    for (const key of ['fields', 'tabs']) {
      const nested = findField(field[key], name)
      if (nested) return nested
    }
  }
  return null
}

describe('OPT-041 导入相关集合契约', () => {
  it('supply-import-batches 的 status 覆盖全部五个状态', () => {
    expect(SupplyImportBatches.slug).toBe('supply-import-batches')
    const status = findField(SupplyImportBatches.fields, 'status')
    const values = (status?.options as Array<{ value: string }>).map((o) => o.value)
    expect(values).toEqual(['preflight', 'queued', 'running', 'completed', 'failed'])
  })

  it('location-aliases 的 kind 与 LOCATION_TYPES 对齐（不含 metro_line）', () => {
    const kind = findField(LocationAliases.fields, 'kind')
    const values = (kind?.options as Array<{ value: string }>).map((o) => o.value)
    expect(values).toEqual(['city', 'district', 'business_area', 'metro_station'])
  })

  it('Listings.dataSource.source 增加 manual-import', () => {
    const source = findField(Listings.fields, 'source')
    const values = (source?.options as Array<{ value: string }>).map((o) => o.value)
    expect(values).toContain('manual-import')
    expect(values).toContain('huizuxuanzhi')
  })

  it('Buildings 拥有与 Listings 同构的 dataSource 组', () => {
    for (const name of ['source', 'externalId', 'syncedAt', 'sourceUrl']) {
      expect(findField(Buildings.fields, name), `Buildings 缺 ${name}`).not.toBeNull()
    }
  })

  // ────────────────────────────────────────────────────────────
  // 最终评审 Critical 1：REST 门绕开所有守卫——create/update 必须是字面量
  // () => false，read 必须返回按 operator 收窄的 where，不能只是布尔判定。
  // ────────────────────────────────────────────────────────────
  describe('SupplyImportBatches.access（最终评审 Critical 1）', () => {
    it('create/update 恒为 false——REST 写入完全关闭，endpoint/Job 走 overrideAccess:true 不受影响', async () => {
      const req = await makeReq(makeUser({ id: 1, roles: [makeRole()] }))
      expect(await SupplyImportBatches.access?.create?.({ req })).toBe(false)
      expect(await SupplyImportBatches.access?.update?.({ req })).toBe(false)
    })

    it('delete 恒为 false（业务历史不可物理删除）', async () => {
      const req = await makeReq(makeUser({ id: 1, roles: [makeRole()] }))
      expect(await SupplyImportBatches.access?.delete?.({ req })).toBe(false)
    })

    it('未登录 → read 为 false', async () => {
      const req = await makeReq(null)
      expect(await SupplyImportBatches.access?.read?.({ req })).toBe(false)
    })

    it('无 data:import 权限 → read 为 false', async () => {
      const req = await makeReq(
        makeUser({ id: 2, roles: [makeRole({ operationPermissions: [] })] }),
      )
      expect(await SupplyImportBatches.access?.read?.({ req })).toBe(false)
    })

    it('全局范围（ADM，cityScope 留空 → ctx.cityIds === "all"）→ read 放行一切（true）', async () => {
      const req = await makeReq(
        makeUser({ id: 3, roles: [makeRole({ code: 'ADM', dataScope: 'global' })], cityScope: [] }),
      )
      expect(await SupplyImportBatches.access?.read?.({ req })).toBe(true)
    })

    it('非全局范围（OPS 绑定城市）→ read 返回按本人 operator 收窄的 where，不是布尔 true', async () => {
      const req = await makeReq(makeUser({ id: 4, roles: [makeRole()], cityScope: [10] }))
      const result = await SupplyImportBatches.access?.read?.({ req })
      // 核心断言：不是 true/undefined（布尔放行），是一个只认自己 operator 的 where——
      // 这正是修复前 createCollectionAccess 做不到的部分。
      expect(result).toEqual({ operator: { equals: 4 } })
    })
  })
})
