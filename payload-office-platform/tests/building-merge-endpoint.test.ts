import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { PayloadRequest } from 'payload'

import { createBuildingMergeEndpoint } from '@/endpoints/building-merge-endpoint'
import type { Role, User } from '@/payload-types'
import * as service from '@/domain/supply/building-dedup-service'

/**
 * 楼盘合并 endpoint 的 HTTP 装配层测试（M3.2）
 *
 * 权限门（building:delete）与取参真实执行；mergeBuildings 领域服务被 mock,
 * 用于验证:未登录 401 / 无权限 403 / 缺 ID 400 / 结果码→HTTP 状态映射。
 * mergeBuildings 自身的迁移+软删语义由 building-dedup-service.test.ts 覆盖。
 */

vi.mock('@/domain/supply/building-dedup-service', () => ({
  mergeBuildings: vi.fn(),
}))

const mergeBuildingsMock = vi.mocked(service.mergeBuildings)

function makeAdmRole(overrides: Partial<Role> = {}): Role {
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

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 10,
    name: 'admin',
    email: 'admin@example.com',
    status: 'active',
    sessionVersion: 1,
    roles: [1],
    updatedAt: '',
    createdAt: '',
    collection: 'users',
    ...overrides,
  } as unknown as User
}

function makeReq(params: {
  user?: User | null
  routeParams?: Record<string, unknown>
  body?: unknown
  userRoles?: Role[]
}): PayloadRequest {
  const {
    user = makeUser(),
    routeParams = { id: '1' },
    body = { targetId: 2 },
    userRoles = [makeAdmRole()],
  } = params
  const find = vi.fn(async () => ({ docs: userRoles }))
  const req = {
    user: user ?? null,
    routeParams,
    payload: { find },
    json: async () => body,
  }
  return req as unknown as PayloadRequest
}

async function run(req: PayloadRequest): Promise<{ status: number; body: any }> {
  const endpoint = createBuildingMergeEndpoint()
  const res = (await endpoint.handler!(req)) as Response
  const body = await res.json()
  return { status: res.status, body }
}

beforeEach(() => {
  mergeBuildingsMock.mockReset()
})

describe('building-merge-endpoint/权限门', () => {
  it('未登录 → 401', async () => {
    const req = makeReq({ user: null })
    const { status } = await run(req)
    expect(status).toBe(401)
    expect(mergeBuildingsMock).not.toHaveBeenCalled()
  })

  it('无 building:delete 权限 → 403', async () => {
    const opsRole = makeAdmRole({
      id: 2,
      code: 'OPS',
      operationPermissions: ['building:create'],
    })
    const req = makeReq({ userRoles: [opsRole], user: makeUser({ roles: [2] }) })
    const { status } = await run(req)
    expect(status).toBe(403)
    expect(mergeBuildingsMock).not.toHaveBeenCalled()
  })
})

describe('building-merge-endpoint/取参', () => {
  it('缺源楼盘 ID → 400', async () => {
    const req = makeReq({ routeParams: {} })
    const { status, body } = await run(req)
    expect(status).toBe(400)
    expect(body.error).toContain('源楼盘 ID')
    expect(mergeBuildingsMock).not.toHaveBeenCalled()
  })

  it('缺 targetId → 400', async () => {
    const req = makeReq({ body: {} })
    const { status, body } = await run(req)
    expect(status).toBe(400)
    expect(body.error).toContain('目标楼盘 ID')
    expect(mergeBuildingsMock).not.toHaveBeenCalled()
  })

  it('源与目标透传给 mergeBuildings', async () => {
    mergeBuildingsMock.mockResolvedValue({
      ok: true,
      report: { sourceId: 7, targetId: 9, migratedRelations: 2, migratedListings: 3 },
    })
    const req = makeReq({ routeParams: { id: '7' }, body: { targetId: 9 } })
    const { status, body } = await run(req)
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.report.migratedRelations).toBe(2)
    expect(mergeBuildingsMock).toHaveBeenCalledWith(
      expect.anything(),
      { sourceId: '7', targetId: 9 },
      expect.anything(),
    )
  })
})

describe('building-merge-endpoint/结果码→HTTP 状态', () => {
  it('INVALID_MERGE → 400', async () => {
    mergeBuildingsMock.mockResolvedValue({
      ok: false,
      code: 'INVALID_MERGE',
      error: '源与目标不能相同',
    })
    const { status, body } = await run(makeReq({}))
    expect(status).toBe(400)
    expect(body.code).toBe('INVALID_MERGE')
  })

  it('NOT_FOUND → 404', async () => {
    mergeBuildingsMock.mockResolvedValue({
      ok: false,
      code: 'NOT_FOUND',
      error: '楼盘不存在',
    })
    const { status } = await run(makeReq({}))
    expect(status).toBe(404)
  })

  it('RELATION_OVERLAP → 409', async () => {
    mergeBuildingsMock.mockResolvedValue({
      ok: false,
      code: 'RELATION_OVERLAP',
      error: '供给关系有效期重叠',
    })
    const { status } = await run(makeReq({}))
    expect(status).toBe(409)
  })
})
