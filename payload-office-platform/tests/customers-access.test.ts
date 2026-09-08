import { describe, expect, it, vi } from 'vitest'

import { Customers } from '@/collections/Customers'
import type { RequestContext } from '@/domain/auth/access'
import { CUSTOMER_MENU_CODES } from '@/domain/crm/customer-menu-codes'
import { ADMIN_NAV_GROUPS } from '@/domain/admin-navigation/navigation-config'
import type { AdminNavLeaf } from '@/domain/admin-navigation/navigation-types'
import { BUILTIN_ROLES, type BuiltinRoleCode } from '@/test/factory/roles'
import type { Role, User } from '@/payload-types'

/**
 * 客户档案读写准入
 *
 * 本集合此前整个 access 块都没写，四个动作全落 Payload 3.86 的 defaultAccess
 * （判据仅 Boolean(req.user)）——任何登录账号都能读到全部客户档案（含
 * phoneNormalized，那是完整手机号而非脱敏快照），也都能改、能删。
 *
 * 口径 = 客户档案叶子的菜单码（customers | my-customers），与承载它的
 * Payload 原生集合视图对齐；原生路由不认自定义导航的 menuCodes，
 * 所以准入只能落在 collection access 上。
 *
 * delete 一律 false：leads.customer_id 的外键是 ON DELETE SET NULL 且没有引用
 * 保护 hook，删一个客户会静默清空所有关联线索的客户链接；而 customers 没有
 * 任何唯一/不可变字段，不存在 Locations 那种「录错只能删掉重建」的补救需求。
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

const ALL_OPERATIONS = ['read', 'create', 'update', 'delete'] as const
/** 客户档案模块的日常动作；delete 单独处理（一律禁止）。 */
const ALLOWED_OPERATIONS = ['read', 'create', 'update'] as const

function access(op: (typeof ALL_OPERATIONS)[number]): unknown {
  return Customers.access?.[op]
}

function reqForRole(code: BuiltinRoleCode): RequestContext {
  return makeReq({ user: makeUser({ roles: [1] }), roles: [makeBuiltinRole(code)] })
}

/**
 * 把导航树摊平成叶子，供同步守卫比对。
 *
 * 用 `child.children` 真值判定而不是 `'children' in child`：AdminNavLeaf 上声明了
 * `children?: never`，`in` 判定不会把叶子排除掉，narrowing 后仍可能是 undefined。
 */
function flattenNavLeaves(): AdminNavLeaf[] {
  const out: AdminNavLeaf[] = []
  for (const group of ADMIN_NAV_GROUPS) {
    for (const child of group.children) {
      if (child.children) {
        out.push(...child.children)
      } else {
        out.push(child)
      }
    }
  }
  return out
}

describe('Customers 读写准入', () => {
  it('read / create / update / delete 都显式声明，不落回 defaultAccess', () => {
    for (const op of ALL_OPERATIONS) {
      expect(typeof access(op), `access.${op} 必须显式声明`).toBe('function')
    }
  })

  it('匿名四个动作全部拒绝（phoneNormalized 是完整手机号，读侧不能公开）', async () => {
    const req = makeReq({ user: null })
    for (const op of ALL_OPERATIONS) {
      expect(await callAccess(access(op), req), `匿名不应通过 ${op}`).toBe(false)
    }
  })

  it.each(['ADM', 'MGR', 'CSR', 'BRK'] as const)(
    '%s 持有客户档案菜单码，可读可增可改',
    async (code) => {
      const req = reqForRole(code)
      for (const op of ALLOWED_OPERATIONS) {
        expect(await callAccess(access(op), req), `${code} 应通过 ${op}`).toBe(true)
      }
    },
  )

  it('OPS 两个菜单码都没有，四个动作全部拒绝', async () => {
    // 守卫这条刻意的差异：OPS 是供给侧运营，导航里本就没有「客户档案」入口。
    for (const code of CUSTOMER_MENU_CODES) {
      expect(BUILTIN_ROLES.OPS.menuPermissions).not.toContain(code)
    }
    const req = reqForRole('OPS')
    for (const op of ALL_OPERATIONS) {
      expect(await callAccess(access(op), req), `OPS 不应通过 ${op}`).toBe(false)
    }
  })

  it('任何角色都删不掉：外键 ON DELETE SET NULL 会静默清空线索的客户链接', async () => {
    for (const code of ['ADM', 'MGR', 'CSR', 'BRK', 'OPS'] as const) {
      expect(await callAccess(access('delete'), reqForRole(code)), `${code} 不应通过 delete`).toBe(
        false,
      )
    }
  })

  it('停用账号即便挂着 ADM 角色也一律拒绝', async () => {
    const req = makeReq({
      user: makeUser({ status: 'disabled', roles: [1] }),
      roles: [makeBuiltinRole('ADM')],
    })
    for (const op of ALL_OPERATIONS) {
      expect(await callAccess(access(op), req), `停用账号不应通过 ${op}`).toBe(false)
    }
  })

  it('CUSTOMER_MENU_CODES 与导航里客户档案叶子的 menuCodes 保持一致', async () => {
    // 判据来自「承载这张表的模块」，两边分头改必然漂移，故直接比对。
    const leaf = flattenNavLeaves().find((l) => l.collectionSlug === 'customers')
    expect(leaf, '导航里应存在 collectionSlug=customers 的叶子').toBeDefined()
    expect([...leaf!.menuCodes]).toEqual([...CUSTOMER_MENU_CODES])
  })
})
