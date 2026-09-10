import { describe, expect, it, vi } from 'vitest'

import { Users } from '@/collections/Users'
import type { RequestContext } from '@/domain/auth/access'
import { BUILTIN_ROLES, type BuiltinRoleCode } from '@/test/factory/roles'
import type { Field } from 'payload'
import type { Role, User } from '@/payload-types'

/**
 * 守卫：`roles` / `cityScope` / `status` 三个敏感字段必须有字段级 `access.update`，
 * 判据是 `user:manage`。
 *
 * 背景（M1 审查 P0「自我提权」的收口）：`Users.access.update` 对「自己改自己」
 * 整体放行（为了让人能改自己的密码和姓名），集合层因此拦不住自改 `roles`。
 * 早先的兜底是 `protectSelfPrivilegeEscalation` 这个 beforeChange 钩子，它把敏感字段
 * 从 data 里 **delete 掉**——权限上够用，但 `status` 是 `required`，而字段校验跑在
 * 集合 beforeChange **之后**，于是低权账号的**任何**自改都会 400
 * 「账号状态：该字段为必填项目」（2026-09-11 在后台账户页实测复现）。
 *
 * 字段级 access 是 Payload 为此提供的正确机制：拒绝时它 `delete` 后立刻用
 * `getFallbackValue` 回填**原文档的值**（`payload/dist/fields/hooks/beforeValidate/promise.js`），
 * 字段既改不动也不会变成缺失，必填校验照常通过。
 */

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 4,
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

function reqForRole(code: BuiltinRoleCode): RequestContext {
  return {
    user: makeUser(),
    payload: { find: vi.fn(async () => ({ docs: [makeBuiltinRole(code)] })) },
  } as unknown as RequestContext
}

/** 在 Users.fields 里按名字找字段（含 row 容器一层展开） */
function findField(name: string): Field {
  const flat: Field[] = []
  for (const f of Users.fields) {
    flat.push(f)
    if ('fields' in f && Array.isArray(f.fields)) flat.push(...(f.fields as Field[]))
  }
  const found = flat.find((f) => 'name' in f && f.name === name)
  if (!found) throw new Error(`Users 里找不到字段 ${name}`)
  return found
}

async function canUpdateField(name: string, role: BuiltinRoleCode): Promise<unknown> {
  const field = findField(name)
  const fn = (field as { access?: { update?: unknown } }).access?.update
  if (typeof fn !== 'function') throw new Error(`字段 ${name} 未声明 access.update`)
  return (fn as (a: unknown) => unknown)({ req: reqForRole(role) })
}

const SENSITIVE_FIELDS = ['roles', 'cityScope', 'status'] as const

describe('users 敏感字段的字段级 access.update', () => {
  it.each(SENSITIVE_FIELDS)('%s 声明了 access.update', (name) => {
    const field = findField(name)
    expect(typeof (field as { access?: { update?: unknown } }).access?.update).toBe('function')
  })

  it.each(SENSITIVE_FIELDS)('%s：无 user:manage（BRK）→ 拒绝', async (name) => {
    await expect(canUpdateField(name, 'BRK')).resolves.toBe(false)
  })

  it.each(SENSITIVE_FIELDS)('%s：有 user:manage（ADM）→ 放行', async (name) => {
    await expect(canUpdateField(name, 'ADM')).resolves.toBe(true)
  })

  it('未登录 → 拒绝（不依赖集合层已经拦住）', async () => {
    const field = findField('roles')
    const fn = (field as { access?: { update?: (a: unknown) => unknown } }).access?.update
    expect(typeof fn).toBe('function')
    await expect(
      (fn as (a: unknown) => unknown)({
        req: { user: null, payload: { find: vi.fn(async () => ({ docs: [] })) } },
      }),
    ).resolves.toBe(false)
  })
})
