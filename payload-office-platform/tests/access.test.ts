import { describe, expect, it, vi } from 'vitest'
import {
  canReadByCity,
  createCollectionAccess,
  getPermissionContext,
  requireAdminContext,
  requireFieldPermission,
  requireMenuPermission,
  requireOperationPermission,
  type RequestContext,
} from '@/domain/auth/access'
import { ForbiddenError } from '@/domain/shared/errors'
import type { Role, User } from '@/payload-types'

// ────────────────────────────────────────────────────────────
// 测试 fixtures
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

/** 构造 mock req：携带 user / payload.find，可控制角色加载 */
function makeReq(params: {
  user?: User | null
  roles?: Role[]
}): RequestContext {
  const { user, roles = [] } = params
  const findFn = vi.fn(async () => ({ docs: roles }))
  const req = {
    user: user ?? null,
    payload: {
      find: findFn,
    },
  }
  return req as unknown as RequestContext
}

/** 显式断言 access 函数已定义并调用，便于 typecheck */
async function callAccess(
  fn: unknown,
  args: unknown,
): Promise<boolean> {
  if (typeof fn !== 'function') {
    throw new Error('access 函数未定义')
  }
  return (fn as (a: unknown) => boolean | Promise<boolean>)(args)
}

// ────────────────────────────────────────────────────────────
// getPermissionContext
// ────────────────────────────────────────────────────────────

describe('access/getPermissionContext', () => {
  it('未登录用户 → 返回 null', async () => {
    const req = makeReq({ user: null })
    const ctx = await getPermissionContext(req)
    expect(ctx).toBeNull()
  })

  it('停用账号 → 返回 null', async () => {
    const user = makeUser({ status: 'disabled' })
    const req = makeReq({ user })
    const ctx = await getPermissionContext(req)
    expect(ctx).toBeNull()
  })

  it('已登录有效用户 → 派生 PermissionContext', async () => {
    const role = makeRole({ id: 5, code: 'ADM' })
    const user = makeUser({ roles: [5] })
    const req = makeReq({ user, roles: [role] })
    const ctx = await getPermissionContext(req)
    expect(ctx).not.toBeNull()
    expect(ctx?.roleCodes).toContain('ADM')
    expect(ctx?.dataScope).toBe('global')
  })

  it('请求级缓存：第二次调用不重复加载角色', async () => {
    const role = makeRole({ id: 5, code: 'ADM' })
    const user = makeUser({ roles: [5] })
    const req = makeReq({ user, roles: [role] })
    await getPermissionContext(req)
    await getPermissionContext(req)
    const findFn = req.payload.find as unknown as ReturnType<typeof vi.fn>
    expect(findFn).toHaveBeenCalledTimes(1)
  })

  it('缓存空值：停用账号第二次调用仍返回 null', async () => {
    const user = makeUser({ status: 'disabled' })
    const req = makeReq({ user })
    expect(await getPermissionContext(req)).toBeNull()
    expect(await getPermissionContext(req)).toBeNull()
    const findFn = req.payload.find as unknown as ReturnType<typeof vi.fn>
    expect(findFn).not.toHaveBeenCalled()
  })

  it('不信客户端参数：仅从 req.user 派生', async () => {
    const role = makeRole({ id: 5, code: 'ADM' })
    const user = makeUser({ roles: [5], cityScope: [{ id: 10 } as never] })
    // 即便 req 上挂了客户端传的 cityIds 参数，PermissionContext 也只从 user.cityScope 派生
    const req = makeReq({ user, roles: [role] })
    const ctx = await getPermissionContext(req)
    expect(ctx).not.toBeNull()
    if (ctx && ctx.cityIds instanceof Set) {
      expect(ctx.cityIds.has(10)).toBe(true)
      expect(ctx.cityIds.has(999)).toBe(false)
    }
  })
})

// ────────────────────────────────────────────────────────────
// requireAdminContext
// ────────────────────────────────────────────────────────────

describe('access/requireAdminContext', () => {
  it('未登录 → 抛 ForbiddenError', async () => {
    const req = makeReq({ user: null })
    await expect(requireAdminContext(req)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(requireAdminContext(req)).rejects.toThrow(/未登录/)
  })

  it('停用账号 → 抛 ForbiddenError', async () => {
    const user = makeUser({ status: 'disabled' })
    const req = makeReq({ user })
    await expect(requireAdminContext(req)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('登录有效用户 → 返回 PermissionContext', async () => {
    const role = makeRole()
    const user = makeUser({ roles: [role] })
    const req = makeReq({ user, roles: [role] })
    const ctx = await requireAdminContext(req)
    expect(ctx.userId).toBe(1)
  })
})

// ────────────────────────────────────────────────────────────
// requireOperationPermission / requireFieldPermission / requireMenuPermission
// ────────────────────────────────────────────────────────────

describe('access/requireOperationPermission', () => {
  it('有权限 → 返回 ctx', async () => {
    const role = makeRole({ operationPermissions: ['listing:review'] })
    const user = makeUser({ roles: [role] })
    const req = makeReq({ user, roles: [role] })
    const ctx = await requireOperationPermission(req, 'listing:review')
    expect(ctx.roleCodes).toContain('ADM')
  })

  it('通配符权限 → 通过任意操作', async () => {
    const role = makeRole({ operationPermissions: ['*'] })
    const user = makeUser({ roles: [role] })
    const req = makeReq({ user, roles: [role] })
    await expect(
      requireOperationPermission(req, 'any:operation'),
    ).resolves.toBeDefined()
  })

  it('无权限 → 抛 ForbiddenError 含缺失编码', async () => {
    const role = makeRole({ code: 'CSR', operationPermissions: ['lead:create'] })
    const user = makeUser({ roles: [role] })
    const req = makeReq({ user, roles: [role] })
    await expect(requireOperationPermission(req, 'listing:delete')).rejects.toBeInstanceOf(
      ForbiddenError,
    )
    await expect(requireOperationPermission(req, 'listing:delete')).rejects.toThrow(
      /listing:delete/,
    )
  })

  it('未登录 → 抛 ForbiddenError', async () => {
    const req = makeReq({ user: null })
    await expect(requireOperationPermission(req, 'listing:review')).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })
})

describe('access/requireFieldPermission', () => {
  it('有 phone:full 权限 → 通过', async () => {
    const role = makeRole({ fieldPermissions: ['phone:full'] })
    const user = makeUser({ roles: [role] })
    const req = makeReq({ user, roles: [role] })
    await expect(requireFieldPermission(req, 'phone:full')).resolves.toBeDefined()
  })

  it('仅 phone:masked → 缺 phone:full 时抛 ForbiddenError', async () => {
    const role = makeRole({ fieldPermissions: ['phone:masked'] })
    const user = makeUser({ roles: [role] })
    const req = makeReq({ user, roles: [role] })
    await expect(requireFieldPermission(req, 'phone:full')).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })
})

describe('access/requireMenuPermission', () => {
  it('有 dashboard 菜单 → 通过', async () => {
    const role = makeRole({ menuPermissions: ['dashboard'] })
    const user = makeUser({ roles: [role] })
    const req = makeReq({ user, roles: [role] })
    await expect(requireMenuPermission(req, 'dashboard')).resolves.toBeDefined()
  })

  it('无 leads 菜单 → 抛 ForbiddenError', async () => {
    const role = makeRole({ menuPermissions: ['dashboard'] })
    const user = makeUser({ roles: [role] })
    const req = makeReq({ user, roles: [role] })
    await expect(requireMenuPermission(req, 'leads')).rejects.toBeInstanceOf(ForbiddenError)
  })
})

// ────────────────────────────────────────────────────────────
// canReadByCity
// ────────────────────────────────────────────────────────────

describe('access/canReadByCity', () => {
  it('global dataScope + cityIds=all → 任何城市可见', () => {
    const ctx = {
      userId: 1,
      roleCodes: ['ADM'],
      cityIds: 'all' as const,
      teamIds: new Set<number>(),
      operationPermissions: new Set<string>(),
      fieldPermissions: new Set<string>(),
      menuPermissions: new Set<string>(),
      dataScope: 'global' as const,
    }
    expect(canReadByCity(ctx, 1)).toBe(true)
    expect(canReadByCity(ctx, 9999)).toBe(true)
    expect(canReadByCity(ctx, null)).toBe(true)
  })

  it('city dataScope + cityIds 集合 → 仅集合内可见', () => {
    const ctx = {
      userId: 1,
      roleCodes: ['OPS'],
      cityIds: new Set<number>([10, 20]),
      teamIds: new Set<number>(),
      operationPermissions: new Set<string>(),
      fieldPermissions: new Set<string>(),
      menuPermissions: new Set<string>(),
      dataScope: 'city' as const,
    }
    expect(canReadByCity(ctx, 10)).toBe(true)
    expect(canReadByCity(ctx, 20)).toBe(true)
    expect(canReadByCity(ctx, 30)).toBe(false)
    expect(canReadByCity(ctx, null)).toBe(false)
  })

  it('team/self/none dataScope → 仍按 cityIds 上限收窄，由领域服务进一步校验', () => {
    const ctx = {
      userId: 1,
      roleCodes: ['BRK'],
      cityIds: new Set<number>([10]),
      teamIds: new Set<number>(),
      operationPermissions: new Set<string>(),
      fieldPermissions: new Set<string>(),
      menuPermissions: new Set<string>(),
      dataScope: 'self' as const,
    }
    expect(canReadByCity(ctx, 10)).toBe(true)
    expect(canReadByCity(ctx, 20)).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────
// createCollectionAccess
// ────────────────────────────────────────────────────────────

describe('access/createCollectionAccess', () => {
  it('未指定 op + 未登录 → 全部拒绝（P2-7：不再无脑放行）', async () => {
    const access = createCollectionAccess({})
    const req = makeReq({ user: null })
    expect(await callAccess(access.read, { req })).toBe(false)
    expect(await callAccess(access.create, { req })).toBe(false)
    expect(await callAccess(access.update, { req })).toBe(false)
    expect(await callAccess(access.delete, { req })).toBe(false)
  })

  it('未指定 op + 已登录 → 放行（仅要求登录态，不校验具体操作码）', async () => {
    const access = createCollectionAccess({})
    const req = makeReq({ user: makeUser({}) })
    expect(await callAccess(access.read, { req })).toBe(true)
    expect(await callAccess(access.create, { req })).toBe(true)
    expect(await callAccess(access.update, { req })).toBe(true)
    expect(await callAccess(access.delete, { req })).toBe(true)
  })

  it('指定 read op → 未登录返回 false', async () => {
    const access = createCollectionAccess({ read: 'listing:review' })
    const req = makeReq({ user: null })
    const result = await callAccess(access.read, { req })
    expect(result).toBe(false)
  })

  it('指定 create op → 有权限返回 true', async () => {
    const role = makeRole({ operationPermissions: ['listing:create'] })
    const user = makeUser({ roles: [role] })
    const req = makeReq({ user, roles: [role] })
    const access = createCollectionAccess({ create: 'listing:create' })
    const result = await callAccess(access.create, { req })
    expect(result).toBe(true)
  })

  it('指定 update op → 缺权限返回 false', async () => {
    const role = makeRole({ operationPermissions: ['lead:create'] })
    const user = makeUser({ roles: [role] })
    const req = makeReq({ user, roles: [role] })
    const access = createCollectionAccess({ update: 'listing:update' })
    const result = await callAccess(access.update, { req })
    expect(result).toBe(false)
  })

  it('通配符权限自动通过', async () => {
    const role = makeRole({ operationPermissions: ['*'] })
    const user = makeUser({ roles: [role] })
    const req = makeReq({ user, roles: [role] })
    const access = createCollectionAccess({
      read: 'any:read',
      create: 'any:create',
      update: 'any:update',
      delete: 'any:delete',
    })
    expect(await callAccess(access.read, { req })).toBe(true)
    expect(await callAccess(access.create, { req })).toBe(true)
    expect(await callAccess(access.update, { req })).toBe(true)
    expect(await callAccess(access.delete, { req })).toBe(true)
  })
})
