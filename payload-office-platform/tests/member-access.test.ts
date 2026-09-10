import { describe, expect, it, vi } from 'vitest'
import type { PayloadRequest } from 'payload'
import { BUILTIN_ROLES, type BuiltinRoleCode } from '@/test/factory/roles'
import type { Role, User } from '@/payload-types'
import {
  canManageMembers,
  clearSessionsOnDisable,
  guardMemberCreate,
  guardMemberLogin,
  isStaffRequest,
  memberCollectionAccess,
} from '@/domain/member/member-access'

function makeStaff(overrides: Partial<User> = {}): User {
  return {
    id: 1, name: 'staff', email: 'staff@example.com', status: 'active', sessionVersion: 1,
    roles: [1], updatedAt: '', createdAt: '', collection: 'users', ...overrides,
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

function makeReq(params: { user?: unknown; roles?: Role[]; context?: Record<string, unknown> }): PayloadRequest {
  return {
    user: params.user ?? null,
    context: params.context ?? {},
    payload: { find: vi.fn(async () => ({ docs: params.roles ?? [] })) },
  } as unknown as PayloadRequest
}

const memberUser = { id: 9, collection: 'members', username: '13800001234', status: 'active' }

describe('members access', () => {
  it('isStaffRequest 只认 users 集合的用户', () => {
    expect(isStaffRequest({ user: makeStaff() })).toBe(true)
    expect(isStaffRequest({ user: memberUser })).toBe(false)
    expect(isStaffRequest({ user: null })).toBe(false)
  })

  it.each(['read', 'create', 'update', 'unlock'] as const)('%s：匿名 / 会员 / 无权员工拒绝，持 member:manage 员工放行', async (op) => {
    const fn = memberCollectionAccess?.[op]
    expect(typeof fn).toBe('function')
    const call = (req: PayloadRequest) => (fn as (a: { req: PayloadRequest }) => Promise<boolean> | boolean)({ req })
    expect(await call(makeReq({ user: null }))).toBe(false)
    expect(await call(makeReq({ user: memberUser }))).toBe(false)
    expect(await call(makeReq({ user: makeStaff(), roles: [makeRole('BRK')] }))).toBe(false)
    expect(await call(makeReq({ user: makeStaff(), roles: [makeRole('OPS')] }))).toBe(true)
    expect(await call(makeReq({ user: makeStaff(), roles: [makeRole('ADM')] }))).toBe(true)
  })

  it('delete 对任何人都是 false', async () => {
    const fn = memberCollectionAccess?.delete as (a: { req: PayloadRequest }) => boolean
    expect(fn({ req: makeReq({ user: makeStaff(), roles: [makeRole('ADM')] }) })).toBe(false)
  })

  it('创建闸门：无 memberFlow 且非管理员 → 抛错；带 memberFlow 放行；管理员放行', async () => {
    const run = (req: PayloadRequest) =>
      (guardMemberCreate as unknown as (a: Record<string, unknown>) => Promise<unknown>)({
        operation: 'create', req, data: { username: '13800001234' }, context: req.context,
      })
    await expect(run(makeReq({ user: null }))).rejects.toThrow(/验证流程/)
    await expect(run(makeReq({ user: memberUser }))).rejects.toThrow(/验证流程/)
    await expect(run(makeReq({ user: null, context: { memberFlow: 'sms' } }))).resolves.toBeTruthy()
    await expect(run(makeReq({ user: makeStaff(), roles: [makeRole('ADM')] }))).resolves.toBeTruthy()
  })

  it('登录闸门：只有 memberFlow=password 且 active 才通过', async () => {
    const run = (ctx: Record<string, unknown>, status: string) =>
      (guardMemberLogin as unknown as (a: Record<string, unknown>) => Promise<unknown>)({
        req: makeReq({ context: ctx }), user: { ...memberUser, status }, context: ctx,
      })
    await expect(run({}, 'active')).rejects.toThrow()
    await expect(run({ memberFlow: 'password' }, 'disabled')).rejects.toThrow()
    await expect(run({ memberFlow: 'password' }, 'active')).resolves.toBeTruthy()
  })

  it('停用即清空 sessions', async () => {
    const data = await (clearSessionsOnDisable as unknown as (a: Record<string, unknown>) => Promise<Record<string, unknown>>)({
      operation: 'update', req: makeReq({}), originalDoc: { status: 'active', sessions: [{ id: 'x' }] },
      data: { status: 'disabled' }, context: {},
    })
    expect(data.sessions).toEqual([])
  })

  it('canManageMembers 对会员上下文恒 false，即便 payload.find 返回 ADM', async () => {
    expect(await canManageMembers({ req: makeReq({ user: memberUser, roles: [makeRole('ADM')] }) })).toBe(false)
  })
})
