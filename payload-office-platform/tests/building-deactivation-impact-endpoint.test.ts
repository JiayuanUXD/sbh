import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { PayloadRequest } from 'payload'

import { createBuildingDeactivationImpactEndpoint } from '@/endpoints/building-deactivation-impact-endpoint'
import type { Role, User } from '@/payload-types'
import * as service from '@/domain/supply/building-references'

/**
 * 楼盘停用影响预检 endpoint 的 HTTP 装配层测试（M3.5）
 *
 * 权限门（building:freeze，与 toggle-operational-status 一致）与取参真实执行；countBuildingDeactivationImpact 领域服务被
 * mock，用于验证：未登录 401 / 无权限 403 / 缺 ID 400 / 正常返回 report。
 * 语义：仅预检展示，不阻断停用；计数口径由 building-references.test.ts 覆盖。
 */

vi.mock('@/domain/supply/building-references', () => ({
  countBuildingDeactivationImpact: vi.fn(),
}))

const countMock = vi.mocked(service.countBuildingDeactivationImpact)

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
  userRoles?: Role[]
}): PayloadRequest {
  const { user = makeUser(), routeParams = { id: '1' }, userRoles = [makeAdmRole()] } = params
  const find = vi.fn(async () => ({ docs: userRoles }))
  const req = {
    user: user ?? null,
    routeParams,
    payload: { find },
  }
  return req as unknown as PayloadRequest
}

async function run(req: PayloadRequest): Promise<{ status: number; body: any }> {
  const endpoint = createBuildingDeactivationImpactEndpoint()
  const res = (await endpoint.handler!(req)) as Response
  const body = await res.json()
  return { status: res.status, body }
}

beforeEach(() => {
  countMock.mockReset()
})

describe('building-deactivation-impact-endpoint/权限门', () => {
  it('未登录 → 401', async () => {
    const { status } = await run(makeReq({ user: null }))
    expect(status).toBe(401)
    expect(countMock).not.toHaveBeenCalled()
  })

  it('无 building:freeze 权限 → 403', async () => {
    const opsRole = makeAdmRole({
      id: 2,
      code: 'OPS',
      operationPermissions: ['building:create'],
    })
    const { status } = await run(makeReq({ userRoles: [opsRole], user: makeUser({ roles: [2] }) }))
    expect(status).toBe(403)
    expect(countMock).not.toHaveBeenCalled()
  })
})

describe('building-deactivation-impact-endpoint/取参', () => {
  it('缺楼盘 ID → 400', async () => {
    const { status, body } = await run(makeReq({ routeParams: {} }))
    expect(status).toBe(400)
    expect(body.error).toContain('楼盘 ID')
    expect(countMock).not.toHaveBeenCalled()
  })
})

describe('building-deactivation-impact-endpoint/正常返回', () => {
  it('返回受影响房源计数 report，不阻断', async () => {
    countMock.mockResolvedValue({
      buildingId: 7,
      sources: [{ collection: 'listings', label: '对外可见房源', count: 3 }],
      total: 3,
      referenced: true,
    })
    const { status, body } = await run(makeReq({ routeParams: { id: '7' } }))
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.report.total).toBe(3)
    expect(body.report.referenced).toBe(true)
    // 楼盘 ID 透传给领域服务
    expect(countMock).toHaveBeenCalledWith(expect.anything(), '7', expect.anything())
  })
})
