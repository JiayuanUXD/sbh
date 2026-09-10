import { describe, expect, it, vi } from 'vitest'

import { Users } from '@/collections/Users'
import type { RequestContext } from '@/domain/auth/access'
import { BUILTIN_ROLES, type BuiltinRoleCode } from '@/test/factory/roles'
import type { Role, User } from '@/payload-types'

/**
 * 守卫：`users` 的写侧 access 不得对匿名请求放行。
 *
 * 背景（2026-09-10 端到端复现）：`Users.access.create` 曾写着
 * `if (!req.user) return true`，注释以为「首次创建管理员」需要匿名放行。
 * 该前提不成立，于是任何人 `POST /api/users {email,password,name}` 都能建出
 * 一个无角色、`status: 'active'` 的后台账号并登录，进而读到所有只判
 * `Boolean(req.user)` 的数据（follow-ups / lead-ownership-history / teams 全表，
 * 以及 listings.roomNumber、leads.visitorRef 字段）。
 *
 * 为什么改成 `return false` 不会挡住首建管理员与 seed：
 *   - `registerFirstUser`（node_modules/payload/dist/auth/operations/registerFirstUser.js）
 *     自己用 `payload.create({ overrideAccess: true })`，根本不经过本 access；
 *     且它在 users 表非空时先抛 Forbidden，本就不是常规入口。
 *   - `scripts/seed.ts` 走 Local API，`payload.create` 默认 `overrideAccess: true`。
 *
 * 删掉本文件的任一断言都不会让别的测试变红，所以它必须独立存在。
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
  } as unknown as Role
}

function makeReq(params: { user?: User | null; roles?: Role[] }): RequestContext {
  return {
    user: params.user ?? null,
    payload: { find: vi.fn(async () => ({ docs: params.roles ?? [] })) },
  } as unknown as RequestContext
}

async function canCreate(req: RequestContext): Promise<unknown> {
  const fn = Users.access?.create
  if (typeof fn !== 'function') throw new Error('Users.access.create 未声明')
  return (fn as (a: unknown) => unknown | Promise<unknown>)({ req })
}

describe('users 写侧 access：匿名不得自注册', () => {
  it('未登录 → create 拒绝（匿名 POST /api/users 应 403，而不是走到字段校验的 400）', async () => {
    await expect(canCreate(makeReq({ user: null }))).resolves.toBe(false)
  })

  it('已登录但无 user:manage（BRK）→ create 拒绝', async () => {
    const req = makeReq({ user: makeUser(), roles: [makeBuiltinRole('BRK')] })
    await expect(canCreate(req)).resolves.toBe(false)
  })

  it('已登录且有 user:manage（ADM）→ create 放行', async () => {
    const req = makeReq({ user: makeUser(), roles: [makeBuiltinRole('ADM')] })
    await expect(canCreate(req)).resolves.toBe(true)
  })
})
