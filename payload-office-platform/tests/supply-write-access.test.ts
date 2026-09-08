import { describe, expect, it, vi } from 'vitest'

import { Buildings } from '@/collections/Buildings'
import { Listings } from '@/collections/Listings'
import type { RequestContext } from '@/domain/auth/access'
import { OPS_SUPPLY_WRITE_CODES } from '@/migrations/20260908_150000_grant_ops_supply_write_codes'
import { OPERATION_CODES } from '@/domain/auth/permission-codes'
import { BUILTIN_ROLES, type BuiltinRoleCode } from '@/test/factory/roles'
import type { Role, User } from '@/payload-types'

/**
 * 供给侧写权限（Buildings / Listings 的 create / update）
 *
 * 这两条此前缺省，落到 Payload 3.86 的 defaultAccess（判据仅 Boolean(req.user)）
 * ——任何登录账号都能新建和改写楼盘 / 房源。后台列表页的「首页推荐」开关走的
 * 正是客户端 PATCH /api/listings/:id，本身没有任何权限条件。
 *
 * 收口绑到 building:create/update 与 listing:create/update——与 OPT-051 把 delete
 * 绑到 building:delete/listing:delete 是同一手法，这几个码都早已注册却从没被消费。
 * 不用菜单码：listings 菜单码 MGR 与 BRK 也有，那是给他们浏览房源做推荐用的。
 *
 * 因为内置角色里只有 ADM 持有这四个码，同时补了迁移
 * 20260908_150000_grant_ops_supply_write_codes 授予 OPS，并同步 roles fixture
 * （不同步会被 seed 擦掉，OPT-045 §9）。本文件同时守卫这三者不脱节。
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
  return {
    user: params.user ?? null,
    payload: { find: vi.fn(async () => ({ docs: params.roles ?? [] })) },
  } as unknown as RequestContext
}

async function callAccess(fn: unknown, req: RequestContext): Promise<unknown> {
  if (typeof fn !== 'function') throw new Error('access 函数未定义（缺失即落回 defaultAccess）')
  return (fn as (a: unknown) => unknown)({ req })
}

function reqForRole(code: BuiltinRoleCode): RequestContext {
  return makeReq({ user: makeUser({ roles: [1] }), roles: [makeBuiltinRole(code)] })
}

const COLLECTIONS = [
  { label: 'Buildings', config: Buildings },
  { label: 'Listings', config: Listings },
] as const

const WRITE_OPERATIONS = ['create', 'update', 'delete'] as const

describe('Buildings / Listings 写侧准入', () => {
  it.each(COLLECTIONS)('$label 的 create / update / delete 都显式声明', ({ config }) => {
    for (const op of WRITE_OPERATIONS) {
      expect(typeof config.access?.[op], `access.${op} 必须显式声明`).toBe('function')
    }
  })

  it.each(COLLECTIONS)('$label：匿名三个写动作一律拒绝', async ({ config }) => {
    const req = makeReq({ user: null })
    for (const op of WRITE_OPERATIONS) {
      expect(await callAccess(config.access?.[op], req), `匿名不应通过 ${op}`).toBe(false)
    }
  })

  it.each(COLLECTIONS)('$label：ADM 全通', async ({ config }) => {
    const req = reqForRole('ADM')
    for (const op of WRITE_OPERATIONS) {
      expect(await callAccess(config.access?.[op], req), `ADM 应通过 ${op}`).toBe(true)
    }
  })

  it.each(COLLECTIONS)('$label：OPS 可建可改（迁移授权后），但仍不可删', async ({ config }) => {
    const req = reqForRole('OPS')
    expect(await callAccess(config.access?.create, req)).toBe(true)
    expect(await callAccess(config.access?.update, req)).toBe(true)
    // delete 仍是 OPT-051 的口径：只有 ADM。本次不放宽。
    expect(await callAccess(config.access?.delete, req)).toBe(false)
  })

  it.each(COLLECTIONS)('$label：MGR / BRK / CSR 三个写动作全部拒绝', async ({ config }) => {
    for (const code of ['MGR', 'BRK', 'CSR'] as const) {
      for (const op of WRITE_OPERATIONS) {
        expect(
          await callAccess(config.access?.[op], reqForRole(code)),
          `${code} 不应通过 ${op}`,
        ).toBe(false)
      }
    }
  })

  it('MGR / BRK 持有 listings 菜单码，但不因此获得写权限', async () => {
    // 守卫「为什么不用菜单码」这条选择：菜单码是给他们浏览房源做推荐用的。
    expect(BUILTIN_ROLES.MGR.menuPermissions).toContain('listings')
    expect(BUILTIN_ROLES.BRK.menuPermissions).toContain('listings')
    for (const code of ['MGR', 'BRK'] as const) {
      expect(await callAccess(Listings.access?.update, reqForRole(code))).toBe(false)
    }
  })

  it.each(COLLECTIONS)('$label：停用账号即便挂着 ADM 角色也拒绝写入', async ({ config }) => {
    const req = makeReq({
      user: makeUser({ status: 'disabled', roles: [1] }),
      roles: [makeBuiltinRole('ADM')],
    })
    for (const op of WRITE_OPERATIONS) {
      expect(await callAccess(config.access?.[op], req), `停用账号不应通过 ${op}`).toBe(false)
    }
  })
})

describe('迁移与 roles fixture 的同步守卫', () => {
  it('迁移授予的四个码都是已注册的操作码', () => {
    for (const code of OPS_SUPPLY_WRITE_CODES) {
      expect(OPERATION_CODES as readonly string[], `${code} 必须在注册表里`).toContain(code)
    }
  })

  it('roles fixture 的 OPS 必须含迁移授予的全部码', () => {
    // seed 的角色 update 分支无条件用 BUILTIN_ROLES 覆写：只改迁移不改夹具，
    // 「先跑迁移再跑 seed」会把刚授予的权限擦掉（OPT-045 §9 的实测教训）。
    for (const code of OPS_SUPPLY_WRITE_CODES) {
      expect(BUILTIN_ROLES.OPS.operationPermissions, `OPS 夹具缺 ${code}`).toContain(code)
    }
  })

  it('迁移只授供给侧写码，不夹带其它权限', () => {
    expect([...OPS_SUPPLY_WRITE_CODES].sort()).toEqual([
      'building:create',
      'building:update',
      'listing:create',
      'listing:update',
    ])
  })
})
