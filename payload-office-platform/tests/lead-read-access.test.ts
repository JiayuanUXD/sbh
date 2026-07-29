import { describe, expect, it, vi } from 'vitest'

import {
  buildLeadReadScope,
  leadReadAccess,
} from '@/domain/crm/lead-read-access'
import type { PermissionContext } from '@/domain/auth/permission-context'
import type { Role, User } from '@/payload-types'
import type { RequestContext } from '@/domain/auth/access'

function permission(
  overrides: Partial<PermissionContext> = {},
): PermissionContext {
  return {
    userId: 42,
    roleCodes: ['BRK'],
    cityIds: 'all',
    teamIds: new Set(),
    operationPermissions: new Set(),
    fieldPermissions: new Set(['phone:full']),
    menuPermissions: new Set(['my-leads']),
    dataScope: 'self',
    ...overrides,
  }
}

function requestFor(params: {
  user?: Partial<User> | null
  role?: Partial<Role>
}): RequestContext {
  const role = {
    id: 7,
    code: 'BRK',
    name: '经纪人',
    status: 'active',
    isBuiltin: true,
    dataScope: 'self',
    menuPermissions: ['my-leads'],
    operationPermissions: [],
    fieldPermissions: ['phone:full'],
    updatedAt: '',
    createdAt: '',
    ...params.role,
  } as Role
  const user = params.user === null
    ? null
    : {
        id: 42,
        name: '经纪人',
        email: 'broker@example.com',
        status: 'active',
        roles: [role.id],
        cityScope: [],
        sessionVersion: 1,
        updatedAt: '',
        createdAt: '',
        collection: 'users',
        ...params.user,
      } as User

  return {
    user,
    payload: {
      find: vi.fn(async () => ({ docs: [role] })),
    },
  } as unknown as RequestContext
}

describe('lead read access', () => {
  it('self scope 只允许读取 owner.user 为当前账号的线索', () => {
    expect(buildLeadReadScope(permission())).toEqual({
      'owner.user': { equals: 42 },
    })
  })

  it('self scope 同时叠加服务端账号城市上限', () => {
    expect(
      buildLeadReadScope(
        permission({ cityIds: new Set<number | string>([10, 20]) }),
      ),
    ).toEqual({
      and: [
        { 'owner.user': { equals: 42 } },
        { city: { in: [10, 20] } },
      ],
    })
  })

  it('未登录拒绝读取，global 保持原有全局读取', async () => {
    await expect(
      leadReadAccess({ req: requestFor({ user: null }) }),
    ).resolves.toBe(false)

    await expect(
      leadReadAccess({
        req: requestFor({
          role: { code: 'ADM', dataScope: 'global' },
        }),
      }),
    ).resolves.toBe(true)
  })
})
