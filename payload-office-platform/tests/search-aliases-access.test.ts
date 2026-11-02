import { describe, expect, it, vi } from 'vitest'
import type { PayloadRequest } from 'payload'

import { SearchAliases } from '@/collections/SearchAliases'
import { ADMIN_NAV_GROUPS } from '@/domain/admin-navigation/navigation-config'
import { MENU_CODES, OPERATION_CODES } from '@/domain/auth/permission-codes'
import type { Role, User } from '@/payload-types'
import { BUILTIN_ROLES, type BuiltinRoleCode } from '@/test/factory/roles'

function makeStaff(): User {
  return {
    id: 1, name: 'staff', email: 'staff@example.com', status: 'active', sessionVersion: 1,
    roles: [1], updatedAt: '', createdAt: '', collection: 'users',
  } as unknown as User
}

function makeRole(code: BuiltinRoleCode): Role {
  const f = BUILTIN_ROLES[code]
  return {
    id: 1, code: f.code, name: f.name, isBuiltin: true, status: 'active', dataScope: f.dataScope,
    menuPermissions: f.menuPermissions, operationPermissions: f.operationPermissions,
    fieldPermissions: f.fieldPermissions, updatedAt: '', createdAt: '',
  } as unknown as Role
}

function makeReq(user: unknown, roles: Role[] = []): PayloadRequest {
  return {
    user,
    context: {},
    payload: { find: vi.fn(async () => ({ docs: roles })) },
  } as unknown as PayloadRequest
}

type Access = (a: { req: PayloadRequest }) => Promise<boolean> | boolean
const access = (op: 'read' | 'create' | 'update' | 'delete'): Access =>
  SearchAliases.access![op] as unknown as Access

describe('search-aliases 访问控制', () => {
  it.each(['read', 'create', 'update', 'delete'] as const)('%s：匿名 / 会员 / 无权角色拒绝，OPS 与 ADM 放行', async (op) => {
    const call = (req: PayloadRequest) => access(op)({ req })
    expect(await call(makeReq(null))).toBe(false)
    expect(await call(makeReq({ id: 9, collection: 'members', username: '13800001234', status: 'active' }))).toBe(false)
    for (const code of ['BRK', 'CSR', 'MGR'] as const) {
      expect(await call(makeReq(makeStaff(), [makeRole(code)]))).toBe(false)
    }
    expect(await call(makeReq(makeStaff(), [makeRole('OPS')]))).toBe(true)
    expect(await call(makeReq(makeStaff(), [makeRole('ADM')]))).toBe(true)
  })

  it('唯一键 (canonicalName, alias)，且别名字段挂了录入规则', () => {
    expect(SearchAliases.indexes).toEqual([{ fields: ['canonicalName', 'alias'], unique: true }])
    const flat = SearchAliases.fields.flatMap((f) => ('fields' in f ? f.fields : [f]))
    const alias = flat.find((f) => 'name' in f && f.name === 'alias') as { validate?: unknown } | undefined
    expect(typeof alias?.validate).toBe('function')
  })

  it('录入规则经由字段 validate 生效：与规范名相同 / 单字被拒', () => {
    const flat = SearchAliases.fields.flatMap((f) => ('fields' in f ? f.fields : [f]))
    const alias = flat.find((f) => 'name' in f && f.name === 'alias') as unknown as {
      validate: (value: string, options: { siblingData: Record<string, unknown> }) => true | string
    }
    const sibling = { siblingData: { canonicalName: '上海国金中心' } }
    expect(alias.validate('国金', sibling)).toBe(true)
    expect(alias.validate('上海国金中心', sibling)).not.toBe(true)
    expect(alias.validate('国', sibling)).not.toBe(true)
  })

  it('beforeValidate 钩子会去掉规范名称与别名两端的空白', () => {
    const hook = SearchAliases.hooks!.beforeValidate![0] as unknown as (args: { data?: Record<string, unknown> }) => Record<string, unknown>
    expect(hook({ data: { canonicalName: '  陆家嘴 ', alias: ' 小陆 ', note: 'x' } })).toEqual({
      canonicalName: '陆家嘴',
      alias: '小陆',
      note: 'x',
    })
  })
})

describe('search-aliases 权限码与导航', () => {
  it('已注册菜单码与操作码', () => {
    expect(MENU_CODES).toContain('search-aliases')
    expect(OPERATION_CODES).toContain('search_alias:manage')
  })

  it('内置角色夹具：ADM 通配，OPS 持有，其余没有', () => {
    expect(BUILTIN_ROLES.ADM.operationPermissions).toEqual(['*'])
    expect(BUILTIN_ROLES.OPS.menuPermissions).toContain('search-aliases')
    expect(BUILTIN_ROLES.OPS.operationPermissions).toContain('search_alias:manage')
    for (const code of ['MGR', 'BRK', 'CSR'] as const) {
      expect(BUILTIN_ROLES[code].menuPermissions).not.toContain('search-aliases')
      expect(BUILTIN_ROLES[code].operationPermissions).not.toContain('search_alias:manage')
    }
  })

  it('站点与内容组下有叶子，菜单码与操作码和 collection access 同一个', () => {
    const group = ADMIN_NAV_GROUPS.find((g) => g.id === 'content')
    const leaf = group?.children.find((l) => l.id === 'search-aliases')
    expect(leaf).toBeDefined()
    expect(leaf?.href).toBe('/admin/collections/search-aliases')
    expect(leaf?.menuCodes).toEqual(['search-aliases'])
    expect(leaf?.requiredOperationCode).toBe('search_alias:manage')
    expect(leaf?.collectionSlug).toBe('search-aliases')
  })
})
