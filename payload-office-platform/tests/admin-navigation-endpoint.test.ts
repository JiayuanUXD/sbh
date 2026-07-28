import { describe, expect, it, vi } from 'vitest'
import type { PayloadRequest } from 'payload'

import { createAdminNavigationEndpoint } from '@/endpoints/admin-navigation-endpoint'
import type { Role, User } from '@/payload-types'

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
  } as Role
}

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 42,
    name: 'admin',
    email: 'admin@example.com',
    status: 'active',
    sessionVersion: 3,
    roles: [1],
    updatedAt: '',
    createdAt: '',
    collection: 'users',
    ...overrides,
  } as User
}

type CountCall = {
  collection: string
  where: object
  overrideAccess: boolean
  req: PayloadRequest
}

function makeReq(options: {
  user?: User | null
  role?: Role
  count?: (input: CountCall) => Promise<{ totalDocs: number }>
} = {}): {
  req: PayloadRequest
  count: ReturnType<typeof vi.fn<(input: CountCall) => Promise<{ totalDocs: number }>>>
  error: ReturnType<typeof vi.fn>
} {
  const user = options.user === undefined ? makeUser() : options.user
  const role = options.role ?? makeRole()
  const count = vi.fn(
    options.count ??
      (async () => ({
        totalDocs: 4,
      })),
  )
  const error = vi.fn()
  const req: Partial<PayloadRequest> = {
    user,
    headers: new Headers(),
    method: 'GET',
    url: 'http://localhost/api/admin-navigation?cityIds=999&teamIds=999',
  }
  Object.assign(req, {
    payload: {
      find: vi.fn(async () => ({ docs: user ? [role] : [] })),
      count,
      logger: { error },
    },
  })

  return { req: req as PayloadRequest, count, error }
}

async function run(req: PayloadRequest): Promise<{
  status: number
  body: Record<string, object | string | boolean>
}> {
  const endpoint = createAdminNavigationEndpoint()
  const response = (await endpoint.handler(req)) as Response
  return {
    status: response.status,
    body: await response.json() as Record<string, object | string | boolean>,
  }
}

describe('GET /admin-navigation', () => {
  it('未登录返回 401 且不执行统计', async () => {
    const { req, count } = makeReq({ user: null })

    const result = await run(req)

    expect(result.status).toBe(401)
    expect(result.body.ok).toBe(false)
    expect(count).not.toHaveBeenCalled()
  })

  it('返回固定合同并对每项 count 强制透传 req 与 overrideAccess=false', async () => {
    const { req, count } = makeReq()

    const result = await run(req)

    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    expect(result.body.badges).toEqual({
      tasks: 4,
      notifications: 4,
      listingReviews: 4,
      listingReports: 4,
      leads: 4,
      formSubmissions: 4,
    })
    expect(typeof result.body.asOf).toBe('string')
    expect(count).toHaveBeenCalledTimes(6)
    for (const [call] of count.mock.calls) {
      expect(call.overrideAccess).toBe(false)
      expect(call.req).toBe(req)
    }
  })

  it('客户端 query 中的城市和团队参数不参与服务端 badge scope', async () => {
    const role = makeRole({
      code: 'OPS',
      dataScope: 'city',
      menuPermissions: ['leads'],
      operationPermissions: [],
    })
    const user = makeUser({ cityScope: [11] })
    const { req, count } = makeReq({ role, user })

    await run(req)

    expect(count).toHaveBeenCalledTimes(1)
    expect(count.mock.calls[0][0]).toMatchObject({
      collection: 'leads',
      where: {
        and: [
          expect.any(Object),
          { city: { in: [11] } },
        ],
      },
    })
  })

  it('没有入口权限时省略 key 且不查询该 Collection', async () => {
    const role = makeRole({
      code: 'BRK',
      dataScope: 'self',
      menuPermissions: ['todos'],
      operationPermissions: ['task:read'],
    })
    const { req, count } = makeReq({ role })

    const result = await run(req)

    expect(result.body.badges).toEqual({ tasks: 4 })
    expect(count).toHaveBeenCalledTimes(1)
    expect(count.mock.calls[0][0].collection).toBe('tasks')
  })

  it('单项失败时记录服务端日志并省略该 key', async () => {
    const { req, error } = makeReq({
      count: async ({ collection }) => {
        if (collection === 'notifications') {
          throw new Error('notification count failed')
        }
        return { totalDocs: 2 }
      },
    })

    const result = await run(req)

    expect(result.status).toBe(200)
    expect(result.body.badges).toEqual({
      tasks: 2,
      listingReviews: 2,
      listingReports: 2,
      leads: 2,
      formSubmissions: 2,
    })
    expect(error).toHaveBeenCalledTimes(1)
    expect(error.mock.calls[0][0]).toContain('notifications')
  })
})
