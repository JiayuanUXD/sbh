import { describe, expect, it, vi } from 'vitest'

import { BusinessAreaExtensions } from '@/collections/BusinessAreaExtensions'
import type { RequestContext } from '@/domain/auth/access'
import { BUILTIN_ROLES, type BuiltinRoleCode } from '@/test/factory/roles'
import type { Role, User } from '@/payload-types'

/**
 * 商圈扩展写侧准入
 *
 * 本集合此前只写了 `read`，create/update/delete 落到 Payload 3.86 的
 * `defaultAccess`（判据仅 `Boolean(req.user)`）——任何登录账号都能改商圈边界、
 * 别名与站点关联，delete 更是硬删（payload.delete 无软删）。
 * `admin.hidden` 只影响后台 UI，REST/GraphQL 端点照常开放，挡不住这条路径。
 *
 * 准入口径对齐**承载它的那个模块**，而不是「随便挑一个权限码」：
 *   - 日常入口是挂在 locations 编辑页的 BusinessAreaExtensionPanel，
 *     页面本身由 requireGeographyAccess(req, ['business-areas']) 把关；
 *   - 面板自己调用的 /api/locations/tree 与 /api/locations/search 用的是
 *     GEOGRAPHY_MENU_CODES = ['locations', 'business-areas']。
 * 故写侧 = 地理菜单权限任一命中，或显式持有 location:manage。
 * 只认 location:manage 会把 OPS 打回 403（fixture 里 OPS 没有该操作码），
 * 等于顺手砍掉运营现有的商圈配置能力。
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

function writeAccess(op: (typeof WRITE_OPERATIONS)[number]): unknown {
  return BusinessAreaExtensions.access?.[op]
}

async function reqForRole(code: BuiltinRoleCode): Promise<RequestContext> {
  return makeReq({ user: makeUser({ roles: [1] }), roles: [makeBuiltinRole(code)] })
}

describe('BusinessAreaExtensions 写侧准入', () => {
  it('create / update / delete 都显式声明，不落回 defaultAccess', () => {
    for (const op of WRITE_OPERATIONS) {
      expect(typeof writeAccess(op), `access.${op} 必须显式声明`).toBe('function')
    }
  })

  it('匿名仍可读，但三个写动作一律拒绝', async () => {
    const req = makeReq({ user: null })
    expect(await callAccess(BusinessAreaExtensions.access?.read, req)).toBe(true)
    for (const op of WRITE_OPERATIONS) {
      expect(await callAccess(writeAccess(op), req), `匿名不应通过 ${op}`).toBe(false)
    }
  })

  it.each(['ADM', 'OPS'] as const)('%s 保留写权限（内嵌面板不被打回 403）', async (code) => {
    const req = await reqForRole(code)
    for (const op of WRITE_OPERATIONS) {
      expect(await callAccess(writeAccess(op), req), `${code} 应通过 ${op}`).toBe(true)
    }
  })

  it.each(['MGR', 'BRK', 'CSR'] as const)('%s 无地理菜单权限，三个写动作全部 403', async (code) => {
    const req = await reqForRole(code)
    for (const op of WRITE_OPERATIONS) {
      expect(await callAccess(writeAccess(op), req), `${code} 不应通过 ${op}`).toBe(false)
    }
  })

  it('只持 location:manage、没有地理菜单码的自定义角色仍可写', async () => {
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
