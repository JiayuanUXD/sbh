import { describe, expect, it, vi } from 'vitest'

import { Locations } from '@/collections/Locations'
import type { RequestContext } from '@/domain/auth/access'
import { BUILTIN_ROLES, type BuiltinRoleCode } from '@/test/factory/roles'
import type { Role, User } from '@/payload-types'

/**
 * 地理数据写侧准入
 *
 * 本集合此前只写了 `read`，create/update/delete 落到 Payload 3.86 的
 * `defaultAccess`（判据仅 `Boolean(req.user)`）——任何登录账号（经纪人、客服都算）
 * 都能通过 REST/GraphQL 增删改城市 / 行政区 / 商圈 / 地铁线路 / 站点。
 * 自定义视图的 requireGeographyAccess 只挡 /admin/geography/* 的页面路由，
 * 挡不住直接打 /api/locations。
 *
 * 口径分两档（理由见 Locations.ts 里两个谓词的注释）：
 *   - create / update：地理菜单码任一命中，或 location:manage。
 *     只认 location:manage 会把 OPS 打回 403（夹具里 OPS 没有该操作码），
 *     而 OPS 今天就在用 /admin/geography/* 维护地理数据，那些页面走的正是
 *     客户端 fetch('/api/locations') POST/PATCH。
 *   - delete：只认 location:manage。payload.delete 恒为硬删，protectLocationDelete
 *     只挡「有引用」的节点，无引用叶子仍会被真删；而四个地理模块页面本来就没有
 *     删除入口，故收紧不减少任何在用能力。
 */

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 1,
    name: 'test-user',
    email: 'test@example.com',
    status: 'active',
    sessionVersion: 1,
    roles: [1],
    updatedAt: '',
    createdAt: '',
    collection: 'users',
    ...overrides,
  } as unknown as User
}

/** 直接用内置角色 fixture，避免测试自造一套与生产不一致的权限集合。 */
function makeBuiltinRole(code: BuiltinRoleCode): Role {
  const fixture = BUILTIN_ROLES[code]
  return {
    id: 1,
    code: fixture.code,
    name: fixture.name,
    isBuiltin: true,
    status: 'active',
    dataScope: fixture.dataScope,
    menuPermissions: fixture.menuPermissions,
    operationPermissions: fixture.operationPermissions,
    fieldPermissions: fixture.fieldPermissions,
    updatedAt: '',
    createdAt: '',
  } as unknown as Role
}

function makeReq(params: { user?: User | null; roles?: Role[] }): RequestContext {
  const { user, roles = [] } = params
  return {
    user: user ?? null,
    payload: { find: vi.fn(async () => ({ docs: roles })) },
  } as unknown as RequestContext
}

async function callAccess(fn: unknown, req: RequestContext): Promise<boolean> {
  if (typeof fn !== 'function') throw new Error('access 函数未定义（缺失即落回 defaultAccess）')
  return (fn as (a: unknown) => boolean | Promise<boolean>)({ req })
}

const WRITE_OPERATIONS = ['create', 'update', 'delete'] as const
/** 日常维护动作：OPS 必须保留，否则 /admin/geography/* 的新建与编辑会被打回 403。 */
const EDIT_OPERATIONS = ['create', 'update'] as const

function writeAccess(op: (typeof WRITE_OPERATIONS)[number]): unknown {
  return Locations.access?.[op]
}

function reqForRole(code: BuiltinRoleCode): RequestContext {
  return makeReq({ user: makeUser({ roles: [1] }), roles: [makeBuiltinRole(code)] })
}

describe('Locations 写侧准入', () => {
  it('create / update / delete 都显式声明，不落回 defaultAccess', () => {
    for (const op of WRITE_OPERATIONS) {
      expect(typeof writeAccess(op), `access.${op} 必须显式声明`).toBe('function')
    }
  })

  it('匿名仍可读（C 端依赖），但三个写动作一律拒绝', async () => {
    const req = makeReq({ user: null })
    expect(await callAccess(Locations.access?.read, req)).toBe(true)
    for (const op of WRITE_OPERATIONS) {
      expect(await callAccess(writeAccess(op), req), `匿名不应通过 ${op}`).toBe(false)
    }
  })

  it('ADM 三个写动作全部保留', async () => {
    const req = reqForRole('ADM')
    for (const op of WRITE_OPERATIONS) {
      expect(await callAccess(writeAccess(op), req), `ADM 应通过 ${op}`).toBe(true)
    }
  })

  it('OPS 保留新建与编辑（地理模块日常维护不被打回 403）', async () => {
    const req = reqForRole('OPS')
    for (const op of EDIT_OPERATIONS) {
      expect(await callAccess(writeAccess(op), req), `OPS 应通过 ${op}`).toBe(true)
    }
  })

  it('OPS 不能删除：硬删收紧到 location:manage，而 OPS 没有该操作码', async () => {
    // 守卫「delete 比 create/update 严」这条刻意的差异——若哪天有人把 delete
    // 改回 canManageLocation，这条会红。
    expect(BUILTIN_ROLES.OPS.operationPermissions).not.toContain('location:manage')
    expect(await callAccess(writeAccess('delete'), reqForRole('OPS'))).toBe(false)
  })

  it.each(['MGR', 'BRK', 'CSR'] as const)('%s 无地理菜单权限，三个写动作全部 403', async (code) => {
    const req = reqForRole(code)
    for (const op of WRITE_OPERATIONS) {
      expect(await callAccess(writeAccess(op), req), `${code} 不应通过 ${op}`).toBe(false)
    }
  })

  it('只持 location:manage、没有地理菜单码的自定义角色三个动作全通', async () => {
    const role = {
      id: 1,
      code: 'GEO',
      name: '地理数据维护',
      isBuiltin: false,
      status: 'active',
      dataScope: 'global',
      menuPermissions: [],
      operationPermissions: ['location:manage'],
      fieldPermissions: [],
      updatedAt: '',
      createdAt: '',
    } as unknown as Role
    const req = makeReq({ user: makeUser({ roles: [1] }), roles: [role] })
    for (const op of WRITE_OPERATIONS) {
      expect(await callAccess(writeAccess(op), req), `location:manage 应通过 ${op}`).toBe(true)
    }
  })

  it('只持地理菜单码、没有 location:manage 的自定义角色可增改但不可删', async () => {
    const role = {
      id: 1,
      code: 'GEOVIEW',
      name: '地理模块运营',
      isBuiltin: false,
      status: 'active',
      dataScope: 'global',
      menuPermissions: ['locations'],
      operationPermissions: [],
      fieldPermissions: [],
      updatedAt: '',
      createdAt: '',
    } as unknown as Role
    const req = makeReq({ user: makeUser({ roles: [1] }), roles: [role] })
    for (const op of EDIT_OPERATIONS) {
      expect(await callAccess(writeAccess(op), req), `菜单码应通过 ${op}`).toBe(true)
    }
    expect(await callAccess(writeAccess('delete'), req)).toBe(false)
  })

  it('停用账号即便挂着 ADM 角色也拒绝写入', async () => {
    const req = makeReq({
      user: makeUser({ status: 'disabled', roles: [1] }),
      roles: [makeBuiltinRole('ADM')],
    })
    for (const op of WRITE_OPERATIONS) {
      expect(await callAccess(writeAccess(op), req), `停用账号不应通过 ${op}`).toBe(false)
    }
  })
})
