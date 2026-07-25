import { describe, expect, it, vi } from 'vitest'
import {
  protectLastAdminBeforeChange,
  protectLastAdminBeforeDelete,
  protectSelfPrivilegeEscalation,
} from '@/domain/auth/user-protect'
import type { Role, User } from '@/payload-types'

// ────────────────────────────────────────────────────────────
// Mock fixtures
// ────────────────────────────────────────────────────────────

function makeRole(overrides: Partial<Role> = {}): Role {
  return {
    id: 1,
    code: 'ADM',
    name: '平台管理员',
    isBuiltin: true,
    status: 'active',
    dataScope: 'global',
    updatedAt: '',
    createdAt: '',
    ...overrides,
  } as unknown as Role
}

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 1,
    name: 'admin',
    email: 'admin@example.com',
    status: 'active',
    sessionVersion: 1,
    updatedAt: '',
    createdAt: '',
    collection: 'users',
    ...overrides,
  } as unknown as User
}

type MockPayload = {
  find: ReturnType<typeof vi.fn>
  findByID: ReturnType<typeof vi.fn>
}

function makeMockPayload(params: {
  admRole?: Role | null
  activeAdminUsers?: User[]
  userById?: User | null
}): { payload: MockPayload; req: { payload: MockPayload } } {
  const { admRole = makeRole(), activeAdminUsers = [], userById = null } = params
  const payload: MockPayload = {
    find: vi.fn(async (opts: { collection: string; where?: unknown }) => {
      const where = opts.where as { code?: { equals?: string } } | undefined
      if (opts.collection === 'roles' && where?.code?.equals === 'ADM') {
        return { docs: admRole ? [admRole] : [] }
      }
      // users query
      return { docs: activeAdminUsers }
    }),
    findByID: vi.fn(async () => userById),
  }
  return { payload, req: { payload } }
}

// ────────────────────────────────────────────────────────────
// protectLastAdminBeforeChange
// ────────────────────────────────────────────────────────────

describe('user-protect/beforeChange', () => {
  it('非 update 操作 → 放行', async () => {
    const { req } = makeMockPayload({})
    const user = makeUser({ status: 'active', roles: [1] })
    const data = await protectLastAdminBeforeChange({
      operation: 'create',
      originalDoc: undefined,
      data: { status: 'disabled' },
      req: req as never,
    } as never)
    expect(data).toEqual({ status: 'disabled' })
  })

  it('状态未变化 → 放行', async () => {
    const { req } = makeMockPayload({})
    const user = makeUser({ status: 'active', roles: [1] })
    const data = await protectLastAdminBeforeChange({
      operation: 'update',
      originalDoc: user,
      data: { status: 'active' }, // 仍 active
      req: req as never,
    } as never)
    expect(data).toEqual({ status: 'active' })
  })

  it('非 ADM 用户停用 → 放行', async () => {
    const { req } = makeMockPayload({ admRole: null })
    const user = makeUser({ status: 'active', roles: [] })
    const data = await protectLastAdminBeforeChange({
      operation: 'update',
      originalDoc: user,
      data: { status: 'disabled' },
      req: req as never,
    } as never)
    expect(data).toEqual({ status: 'disabled' })
  })

  it('最后一个 ADM 用户停用 → 抛错', async () => {
    const admRole = makeRole({ id: 1, code: 'ADM' })
    const { req } = makeMockPayload({
      admRole,
      activeAdminUsers: [], // 无其他 active ADM
    })
    const user = makeUser({ id: 100, status: 'active', roles: [admRole] })
    await expect(
      protectLastAdminBeforeChange({
        operation: 'update',
        originalDoc: user,
        data: { status: 'disabled' },
        req: req as never,
      } as never),
    ).rejects.toThrow(/最后一个全局管理员/)
  })

  it('最后一个 ADM 用户锁定 → 抛错', async () => {
    const admRole = makeRole({ id: 1, code: 'ADM' })
    const { req } = makeMockPayload({
      admRole,
      activeAdminUsers: [],
    })
    const user = makeUser({ id: 100, status: 'active', roles: [admRole] })
    await expect(
      protectLastAdminBeforeChange({
        operation: 'update',
        originalDoc: user,
        data: { status: 'locked' },
        req: req as never,
      } as never),
    ).rejects.toThrow(/最后一个全局管理员/)
  })

  it('有其他 active ADM 用户 → 放行', async () => {
    const admRole = makeRole({ id: 1, code: 'ADM' })
    const otherAdmin = makeUser({ id: 200, status: 'active', roles: [admRole] })
    const { req } = makeMockPayload({
      admRole,
      activeAdminUsers: [otherAdmin],
    })
    const user = makeUser({ id: 100, status: 'active', roles: [admRole] })
    const data = await protectLastAdminBeforeChange({
      operation: 'update',
      originalDoc: user,
      data: { status: 'disabled' },
      req: req as never,
    } as never)
    expect(data).toEqual({ status: 'disabled' })
  })

  it('已停用账号再次编辑 → 放行（oldStatus !== active）', async () => {
    const admRole = makeRole({ id: 1, code: 'ADM' })
    const { req } = makeMockPayload({ admRole })
    const user = makeUser({ status: 'disabled', roles: [admRole] })
    const data = await protectLastAdminBeforeChange({
      operation: 'update',
      originalDoc: user,
      data: { status: 'locked' }, // disabled → locked，不触发
      req: req as never,
    } as never)
    expect(data).toEqual({ status: 'locked' })
  })

  it('roles 为 ID 数组时按 ID 查询 ADM', async () => {
    const admRole = makeRole({ id: 5, code: 'ADM' })
    const payload: MockPayload = {
      find: vi.fn(async (opts: { collection: string; where?: unknown }) => {
        const where = opts.where as
          | { code?: { equals?: string }; and?: Array<{ code?: { equals?: string } }> }
          | undefined
        // 第 1 次：查 ADM 角色
        if (opts.collection === 'roles' && where?.code?.equals === 'ADM') {
          return { docs: [admRole] }
        }
        // 第 2 次：按 ID 查 ADM 角色（user.roles=[5]）
        if (opts.collection === 'roles' && where?.and) {
          return { docs: [admRole] }
        }
        return { docs: [] }
      }),
      findByID: vi.fn(async () => null),
    }
    const user = makeUser({ id: 100, status: 'active', roles: [5] })
    await expect(
      protectLastAdminBeforeChange({
        operation: 'update',
        originalDoc: user,
        data: { status: 'disabled' },
        req: { payload } as never,
      } as never),
    ).rejects.toThrow(/最后一个全局管理员/)
  })
})

// ────────────────────────────────────────────────────────────
// protectLastAdminBeforeDelete
// ────────────────────────────────────────────────────────────

describe('user-protect/beforeDelete', () => {
  it('无 id → 放行', async () => {
    const { req } = makeMockPayload({})
    await expect(
      protectLastAdminBeforeDelete({
        id: undefined,
        req: req as never,
      } as never),
    ).resolves.toBeUndefined()
  })

  it('用户不存在 → 放行', async () => {
    const { req } = makeMockPayload({ userById: null })
    await expect(
      protectLastAdminBeforeDelete({
        id: 999,
        req: req as never,
      } as never),
    ).resolves.toBeUndefined()
  })

  it('已停用用户删除 → 放行', async () => {
    const admRole = makeRole({ id: 1, code: 'ADM' })
    const user = makeUser({ id: 100, status: 'disabled', roles: [admRole] })
    const { req } = makeMockPayload({ userById: user })
    await expect(
      protectLastAdminBeforeDelete({
        id: 100,
        req: req as never,
      } as never),
    ).resolves.toBeUndefined()
  })

  it('非 ADM 用户删除 → 放行', async () => {
    const user = makeUser({ id: 100, status: 'active', roles: [] })
    const { req } = makeMockPayload({
      admRole: null,
      userById: user,
    })
    await expect(
      protectLastAdminBeforeDelete({
        id: 100,
        req: req as never,
      } as never),
    ).resolves.toBeUndefined()
  })

  it('最后一个 active ADM 用户删除 → 抛错', async () => {
    const admRole = makeRole({ id: 1, code: 'ADM' })
    const user = makeUser({ id: 100, status: 'active', roles: [admRole] })
    const { req } = makeMockPayload({
      admRole,
      activeAdminUsers: [],
      userById: user,
    })
    await expect(
      protectLastAdminBeforeDelete({
        id: 100,
        req: req as never,
      } as never),
    ).rejects.toThrow(/最后一个全局管理员/)
  })

  it('有其他 active ADM 用户 → 放行', async () => {
    const admRole = makeRole({ id: 1, code: 'ADM' })
    const otherAdmin = makeUser({ id: 200, status: 'active', roles: [admRole] })
    const user = makeUser({ id: 100, status: 'active', roles: [admRole] })
    const { req } = makeMockPayload({
      admRole,
      activeAdminUsers: [otherAdmin],
      userById: user,
    })
    await expect(
      protectLastAdminBeforeDelete({
        id: 100,
        req: req as never,
      } as never),
    ).resolves.toBeUndefined()
  })
})

// ────────────────────────────────────────────────────────────
// protectSelfPrivilegeEscalation（P0 自我提权防护）
// ────────────────────────────────────────────────────────────

/**
 * 构造带 user + payload.find 的 req：
 *   - actor：req.user（操作者）
 *   - actorRoles：actor 绑定的角色文档（供 getPermissionContext 加载）
 */
function makeSelfReq(params: {
  actor: User
  actorRoles?: Role[]
}): { payload: MockPayload; user: User } {
  const { actor, actorRoles = [] } = params
  const payload: MockPayload = {
    find: vi.fn(async () => ({ docs: actorRoles })),
    findByID: vi.fn(async () => null),
  }
  return { payload, user: actor }
}

/** 低权角色：无 user:manage、无通配符 */
function makeLowPrivRole(): Role {
  return makeRole({
    id: 9,
    code: 'BRK',
    isBuiltin: true,
    operationPermissions: ['listing:view'],
    menuPermissions: [],
    fieldPermissions: [],
    dataScope: 'self',
  })
}

describe('user-protect/selfPrivilegeEscalation', () => {
  it('低权账号自改 roles/cityScope/status → 敏感字段被剥离', async () => {
    const lowRole = makeLowPrivRole()
    const actor = makeUser({ id: 100, roles: [9] })
    const { payload, user } = makeSelfReq({ actor, actorRoles: [lowRole] })
    const originalDoc = makeUser({ id: 100, roles: [9], status: 'active' })

    const data = await protectSelfPrivilegeEscalation({
      operation: 'update',
      originalDoc,
      data: {
        name: '改个名字',
        roles: [1], // 试图给自己加 ADM
        cityScope: [5],
        status: 'active',
      },
      req: { user, payload } as never,
    } as never)

    // 非敏感字段保留
    expect(data.name).toBe('改个名字')
    // 敏感字段被剥离（保留 originalDoc 原值）
    expect('roles' in data).toBe(false)
    expect('cityScope' in data).toBe(false)
    expect('status' in data).toBe(false)
  })

  it('低权账号自改仅非敏感字段（密码/姓名）→ 原样放行', async () => {
    const lowRole = makeLowPrivRole()
    const actor = makeUser({ id: 100, roles: [9] })
    const { payload, user } = makeSelfReq({ actor, actorRoles: [lowRole] })
    const originalDoc = makeUser({ id: 100, roles: [9] })

    const data = await protectSelfPrivilegeEscalation({
      operation: 'update',
      originalDoc,
      data: { name: '新名字', password: 'NewPass123!' },
      req: { user, payload } as never,
    } as never)

    expect(data).toEqual({ name: '新名字', password: 'NewPass123!' })
  })

  it('具备 user:manage 的 ADM 自改 roles → 放行（正常管理操作）', async () => {
    const admRole = makeRole({
      id: 1,
      code: 'ADM',
      operationPermissions: ['*'], // 通配符含 user:manage
    })
    const actor = makeUser({ id: 100, roles: [1] })
    const { payload, user } = makeSelfReq({ actor, actorRoles: [admRole] })
    const originalDoc = makeUser({ id: 100, roles: [1] })

    const data = await protectSelfPrivilegeEscalation({
      operation: 'update',
      originalDoc,
      data: { roles: [1, 2], status: 'active' },
      req: { user, payload } as never,
    } as never)

    // ADM 具备 user:manage → 不剥离
    expect(data.roles).toEqual([1, 2])
    expect(data.status).toBe('active')
  })

  it('管理员改他人（actor.id !== originalDoc.id）→ 不进剥离分支', async () => {
    const lowRole = makeLowPrivRole()
    const actor = makeUser({ id: 100, roles: [9] })
    const { payload, user } = makeSelfReq({ actor, actorRoles: [lowRole] })
    // 被改的是另一个人（id=200）
    const originalDoc = makeUser({ id: 200, roles: [9] })

    const data = await protectSelfPrivilegeEscalation({
      operation: 'update',
      originalDoc,
      data: { roles: [1], status: 'disabled' },
      req: { user, payload } as never,
    } as never)

    // 改他人由 Collection access.update 的 user:manage 把关，此守卫不介入
    expect(data.roles).toEqual([1])
    expect(data.status).toBe('disabled')
  })

  it('overrideAccess / 无 req.user（seed、首次建管理员）→ 放行', async () => {
    const originalDoc = makeUser({ id: 100, roles: [9] })
    const payload: MockPayload = {
      find: vi.fn(async () => ({ docs: [] })),
      findByID: vi.fn(async () => null),
    }

    const data = await protectSelfPrivilegeEscalation({
      operation: 'update',
      originalDoc,
      data: { roles: [1], status: 'active' },
      req: { user: null, payload } as never,
    } as never)

    expect(data.roles).toEqual([1])
    expect(data.status).toBe('active')
  })

  it('create 操作 → 直接放行（不适用自我提权判定）', async () => {
    const actor = makeUser({ id: 100 })
    const { payload, user } = makeSelfReq({ actor })

    const data = await protectSelfPrivilegeEscalation({
      operation: 'create',
      originalDoc: undefined,
      data: { roles: [1], status: 'active' },
      req: { user, payload } as never,
    } as never)

    expect(data.roles).toEqual([1])
  })
})
