import { describe, expect, it } from 'vitest'
import {
  BUILTIN_ROLE_CODES,
  WILDCARD_PERMISSION,
  buildPermissionContext,
  hasFieldPermission,
  hasMenuPermission,
  hasOperationPermission,
  isCityInScope,
  mergeDataScope,
  type DataScope,
  type PermissionContext,
} from '@/domain/auth/permission-context'
import type { Role, User } from '@/payload-types'

// ────────────────────────────────────────────────────────────
// 测试 fixtures：构造 User / Role 文档
// ────────────────────────────────────────────────────────────

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 1,
    name: 'test-user',
    email: 'test@example.com',
    status: 'active',
    sessionVersion: 1,
    updatedAt: '',
    createdAt: '',
    collection: 'users',
    ...overrides,
  } as unknown as User
}

function makeRole(overrides: Partial<Role> = {}): Role {
  return {
    id: 1,
    code: 'ADM',
    name: '平台管理员',
    isBuiltin: true,
    status: 'active',
    dataScope: 'global',
    menuPermissions: ['*'],
    operationPermissions: ['*'],
    fieldPermissions: ['*'],
    updatedAt: '',
    createdAt: '',
    ...overrides,
  } as unknown as Role
}

describe('permission-context/builtin-codes', () => {
  it('5 个内置角色编码齐备且不可改', () => {
    expect(BUILTIN_ROLE_CODES).toEqual(['ADM', 'OPS', 'MGR', 'BRK', 'CSR'])
  })
})

describe('permission-context/mergeDataScope', () => {
  it('none < self < team < city < global', () => {
    expect(mergeDataScope('none', 'self')).toBe('self')
    expect(mergeDataScope('self', 'team')).toBe('team')
    expect(mergeDataScope('team', 'city')).toBe('city')
    expect(mergeDataScope('city', 'global')).toBe('global')
    expect(mergeDataScope('global', 'none')).toBe('global')
  })

  it('同级别合并返回同值', () => {
    expect(mergeDataScope('city' as DataScope, 'city')).toBe('city')
  })
})

describe('permission-context/buildPermissionContext', () => {
  it('停用账号 → 返回 null（无法登录）', async () => {
    const user = makeUser({ status: 'disabled' })
    const ctx = await buildPermissionContext({ user })
    expect(ctx).toBeNull()
  })

  it('锁定账号 → 返回 null', async () => {
    const user = makeUser({ status: 'locked' })
    const ctx = await buildPermissionContext({ user })
    expect(ctx).toBeNull()
  })

  it('无角色用户 → 仅得到空权限上下文', async () => {
    const user = makeUser({ roles: [] })
    const ctx = await buildPermissionContext({ user })
    expect(ctx).not.toBeNull()
    expect(ctx?.roleCodes).toEqual([])
    expect(ctx?.dataScope).toBe('none')
    expect(ctx?.operationPermissions.size).toBe(0)
  })

  it('ADM 角色 → 通配符权限 + global 数据范围', async () => {
    const role = makeRole({
      code: 'ADM',
      dataScope: 'global',
      menuPermissions: ['*'],
      operationPermissions: ['*'],
      fieldPermissions: ['*'],
    })
    const user = makeUser({ roles: [role] })
    const ctx = await buildPermissionContext({ user, loadedRoles: [role] })
    expect(ctx).not.toBeNull()
    expect(ctx?.roleCodes).toContain('ADM')
    expect(ctx?.dataScope).toBe('global')
    expect(ctx?.operationPermissions.has(WILDCARD_PERMISSION)).toBe(true)
    expect(ctx?.fieldPermissions.has(WILDCARD_PERMISSION)).toBe(true)
    expect(ctx?.menuPermissions.has(WILDCARD_PERMISSION)).toBe(true)
  })

  it('多角色权限允许并集', async () => {
    const ops = makeRole({
      id: 1,
      code: 'OPS',
      dataScope: 'global',
      operationPermissions: ['listing:review', 'listing:publish'],
      fieldPermissions: ['phone:full'],
    })
    const mgr = makeRole({
      id: 2,
      code: 'MGR',
      dataScope: 'team',
      operationPermissions: ['lead:assign', 'lead:transfer'],
      fieldPermissions: ['phone:full', 'phone:masked'],
    })
    const user = makeUser({ roles: [ops, mgr] })
    const ctx = await buildPermissionContext({ user, loadedRoles: [ops, mgr] })
    expect(ctx?.roleCodes).toEqual(['OPS', 'MGR'])
    expect(ctx?.operationPermissions.has('listing:review')).toBe(true)
    expect(ctx?.operationPermissions.has('listing:publish')).toBe(true)
    expect(ctx?.operationPermissions.has('lead:assign')).toBe(true)
    expect(ctx?.operationPermissions.has('lead:transfer')).toBe(true)
    expect(ctx?.operationPermissions.has('lead:claim')).toBe(false)
    // dataScope 取最宽：global > team
    expect(ctx?.dataScope).toBe('global')
  })

  it('账号 cityScope 作为城市上限', async () => {
    const role = makeRole({
      code: 'OPS',
      dataScope: 'global',
      operationPermissions: ['*'],
    })
    const user = makeUser({
      roles: [role.id],
      cityScope: [
        { id: 10 } as unknown as User['cityScope'] extends (infer U)[] | null | undefined ? U : never,
        { id: 20 } as unknown as User['cityScope'] extends (infer U)[] | null | undefined ? U : never,
      ],
    })
    const ctx = await buildPermissionContext({
      user,
      loadedRoles: [role],
    })
    expect(ctx?.cityIds).not.toBe('all')
    expect(ctx?.cityIds).toBeInstanceOf(Set)
    if (ctx && ctx.cityIds instanceof Set) {
      expect(ctx.cityIds.size).toBe(2)
      expect(ctx.cityIds.has(10)).toBe(true)
      expect(ctx.cityIds.has(20)).toBe(true)
      expect(ctx.cityIds.has(30)).toBe(false)
    }
  })

  it('cityScope 留空 → 表示无城市上限（all）', async () => {
    const role = makeRole()
    const user = makeUser({ roles: [role] })
    const ctx = await buildPermissionContext({ user, loadedRoles: [role] })
    expect(ctx?.cityIds).toBe('all')
  })

  it('停用角色不计入权限并集', async () => {
    const activeRole = makeRole({
      id: 1,
      code: 'OPS',
      status: 'active',
      operationPermissions: ['listing:review'],
    })
    const inactiveRole = makeRole({
      id: 2,
      code: 'OLD_OPS',
      status: 'inactive',
      operationPermissions: ['listing:delete'], // 不应进入并集
    })
    const user = makeUser({ roles: [activeRole, inactiveRole] })
    const ctx = await buildPermissionContext({
      user,
      loadedRoles: [activeRole, inactiveRole],
    })
    expect(ctx?.operationPermissions.has('listing:review')).toBe(true)
    expect(ctx?.operationPermissions.has('listing:delete')).toBe(false)
    expect(ctx?.roleCodes).toEqual(['OPS']) // OLD_OPS 被过滤
  })

  it('loadRoles 回调用于按需加载角色文档', async () => {
    const role = makeRole({
      id: 5,
      code: 'ADM',
      dataScope: 'global',
      operationPermissions: ['*'],
    })
    const user = makeUser({ roles: [5] })
    const ctx = await buildPermissionContext({
      user,
      loadRoles: async (ids) => {
        expect(ids).toEqual([5])
        return [role]
      },
    })
    expect(ctx?.roleCodes).toContain('ADM')
    expect(ctx?.operationPermissions.has(WILDCARD_PERMISSION)).toBe(true)
  })
})

describe('permission-context/permission-checks', () => {
  function makeCtx(overrides: Partial<PermissionContext> = {}): PermissionContext {
    return {
      userId: 1,
      roleCodes: ['ADM'],
      cityIds: 'all',
      teamIds: new Set(),
      operationPermissions: new Set(['listing:review', 'listing:publish']),
      fieldPermissions: new Set(['phone:full', 'phone:masked']),
      menuPermissions: new Set(['dashboard', 'listings']),
      dataScope: 'global',
      ...overrides,
    }
  }

  it('hasOperationPermission：精确匹配', () => {
    const ctx = makeCtx()
    expect(hasOperationPermission(ctx, 'listing:review')).toBe(true)
    expect(hasOperationPermission(ctx, 'listing:delete')).toBe(false)
  })

  it('hasOperationPermission：通配符 * 通过', () => {
    const ctx = makeCtx({
      operationPermissions: new Set(['*']),
      roleCodes: ['ADM'],
    })
    expect(hasOperationPermission(ctx, 'any:operation')).toBe(true)
  })

  it('hasFieldPermission：精确匹配', () => {
    const ctx = makeCtx()
    expect(hasFieldPermission(ctx, 'phone:full')).toBe(true)
    expect(hasFieldPermission(ctx, 'audit:before_after')).toBe(false)
  })

  it('hasFieldPermission：通配符 * 通过', () => {
    const ctx = makeCtx({
      fieldPermissions: new Set(['*']),
      roleCodes: ['ADM'],
    })
    expect(hasFieldPermission(ctx, 'phone:full')).toBe(true)
    expect(hasFieldPermission(ctx, 'audit:before_after')).toBe(true)
  })

  it('hasMenuPermission：精确匹配', () => {
    const ctx = makeCtx()
    expect(hasMenuPermission(ctx, 'dashboard')).toBe(true)
    expect(hasMenuPermission(ctx, 'leads')).toBe(false)
  })

  it('hasMenuPermission：通配符 * 通过', () => {
    const ctx = makeCtx({
      menuPermissions: new Set(['*']),
      roleCodes: ['ADM'],
    })
    expect(hasMenuPermission(ctx, 'any-menu')).toBe(true)
  })
})

describe('permission-context/isCityInScope', () => {
  it('cityIds=all → 任何城市都通过', () => {
    const ctx: PermissionContext = {
      userId: 1,
      roleCodes: ['ADM'],
      cityIds: 'all',
      teamIds: new Set(),
      operationPermissions: new Set(),
      fieldPermissions: new Set(),
      menuPermissions: new Set(),
      dataScope: 'global',
    }
    expect(isCityInScope(ctx, 1)).toBe(true)
    expect(isCityInScope(ctx, 9999)).toBe(true)
  })

  it('cityIds 为集合 → 仅在集合内的城市通过', () => {
    const ctx: PermissionContext = {
      userId: 1,
      roleCodes: ['OPS'],
      cityIds: new Set([10, 20]),
      teamIds: new Set(),
      operationPermissions: new Set(),
      fieldPermissions: new Set(),
      menuPermissions: new Set(),
      dataScope: 'city',
    }
    expect(isCityInScope(ctx, 10)).toBe(true)
    expect(isCityInScope(ctx, 20)).toBe(true)
    expect(isCityInScope(ctx, 30)).toBe(false)
    expect(isCityInScope(ctx, null)).toBe(false)
    expect(isCityInScope(ctx, undefined)).toBe(false)
  })
})
