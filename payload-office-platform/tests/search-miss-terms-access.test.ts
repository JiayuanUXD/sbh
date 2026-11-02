import { describe, expect, it, vi } from 'vitest'
import type { PayloadRequest } from 'payload'

import { SearchMissTerms } from '@/collections/SearchMissTerms'
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
  SearchMissTerms.access![op] as unknown as Access

describe('search-miss-terms 访问控制', () => {
  it.each(['read', 'update', 'delete'] as const)('%s：匿名 / 会员 / 无权角色拒绝，OPS 与 ADM 放行', async (op) => {
    const call = (req: PayloadRequest) => access(op)({ req })
    expect(await call(makeReq(null))).toBe(false)
    expect(await call(makeReq({ id: 9, collection: 'members', username: '13800001234', status: 'active' }))).toBe(false)
    for (const code of ['BRK', 'CSR', 'MGR'] as const) {
      expect(await call(makeReq(makeStaff(), [makeRole(code)]))).toBe(false)
    }
    expect(await call(makeReq(makeStaff(), [makeRole('OPS')]))).toBe(true)
    expect(await call(makeReq(makeStaff(), [makeRole('ADM')]))).toBe(true)
  })

  it('create 对任何人（含 ADM）关闭：写入只走 /api/search-misses 的原生 upsert', async () => {
    expect(await access('create')({ req: makeReq(makeStaff(), [makeRole('ADM')]) })).toBe(false)
    expect(await access('create')({ req: makeReq(null) })).toBe(false)
  })

  it('事实字段对 update 关闭，只有 status / resolution / note 可改', () => {
    const flat = SearchMissTerms.fields.flatMap((f) => ('fields' in f ? f.fields : [f]))
    const byName = new Map(flat.flatMap((f) => ('name' in f ? [[f.name, f] as const] : [])))
    for (const name of ['city', 'term', 'missKind', 'count', 'lastResultTotal', 'firstSeenAt', 'lastSeenAt']) {
      const field = byName.get(name)
      expect(field, name).toBeDefined()
      expect((field as { access?: { update?: () => boolean } }).access?.update?.()).toBe(false)
    }
    for (const name of ['status', 'resolution', 'note']) {
      expect((byName.get(name) as { access?: unknown }).access).toBeUndefined()
    }
  })

  it('唯一键 (city, term, missKind)', () => {
    expect(SearchMissTerms.indexes).toEqual([{ fields: ['city', 'term', 'missKind'], unique: true }])
  })
})

describe('search-miss-terms 权限码与导航', () => {
  it('已注册菜单码与操作码', () => {
    expect(MENU_CODES).toContain('search-miss-terms')
    expect(OPERATION_CODES).toContain('search_miss:manage')
  })

  it('内置角色夹具：ADM 通配，OPS 持有，其余没有', () => {
    expect(BUILTIN_ROLES.ADM.operationPermissions).toEqual(['*'])
    expect(BUILTIN_ROLES.OPS.menuPermissions).toContain('search-miss-terms')
    expect(BUILTIN_ROLES.OPS.operationPermissions).toContain('search_miss:manage')
    for (const code of ['MGR', 'BRK', 'CSR'] as const) {
      expect(BUILTIN_ROLES[code].menuPermissions).not.toContain('search-miss-terms')
      expect(BUILTIN_ROLES[code].operationPermissions).not.toContain('search_miss:manage')
    }
  })

  it('站点与内容组下有叶子，菜单码与操作码和 collection access 同一个', () => {
    const group = ADMIN_NAV_GROUPS.find((g) => g.id === 'content')
    const leaf = group?.children.find((l) => l.id === 'search-miss-terms')
    expect(leaf).toBeDefined()
    expect(leaf?.href).toBe('/admin/collections/search-miss-terms')
    expect(leaf?.menuCodes).toEqual(['search-miss-terms'])
    expect(leaf?.requiredOperationCode).toBe('search_miss:manage')
    expect(leaf?.collectionSlug).toBe('search-miss-terms')
  })
})
