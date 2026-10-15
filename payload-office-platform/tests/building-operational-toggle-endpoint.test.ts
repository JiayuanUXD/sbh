import { describe, expect, it, vi } from 'vitest'
import type { PayloadRequest } from 'payload'

import { createBuildingOperationalToggleEndpoint } from '@/endpoints/building-operational-toggle-endpoint'
import type { Role, User } from '@/payload-types'

/**
 * 楼盘启停 endpoint 的 HTTP 装配层测试（M3.4 / R3, M3 验收门第 3 条）
 *
 * 权限门（building:freeze）与取参真实执行；findByID/update 用 vi.fn mock。
 * 验证：未登录 401 / 无权限 403 / 缺 ID 400 / 楼盘不存在 404 / 当前状态非法 400 /
 * 正常 active→disabled 与 disabled→active 翻转，且 update 只写 operationalStatus、
 * 绝不触碰任何 Listing 字段（M3 验收门第 3 条「房源状态值保持不变」）。
 */

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
  currentStatus?: unknown
  findByIDThrows?: boolean
  /** 传了才挂 req.data / req.json（编辑页旧调用方不带 body，默认不挂） */
  body?: unknown
}): {
  req: PayloadRequest
  findByID: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  create: ReturnType<typeof vi.fn>
} {
  const {
    user = makeUser(),
    routeParams = { id: '1' },
    userRoles = [makeAdmRole()],
    currentStatus = 'active',
    findByIDThrows = false,
    body,
  } = params
  const find = vi.fn(async () => ({ docs: userRoles }))
  const findByID = vi.fn(async () => {
    if (findByIDThrows) throw new Error('not found')
    return { id: 1, operationalStatus: currentStatus }
  })
  const update = vi.fn(async () => ({ id: 1 }))
  // OPT-113：启停与批量启停共用一个执行核心，每次实际写入都记一行审计（building.freeze / restore）
  const create = vi.fn(async () => ({ id: 999, auditId: 'aud_test001' }))
  // OPT-113：业务写 + 审计写包在同一事务里（runInRequestTransaction），夹具得有事务三件套
  const db = {
    beginTransaction: vi.fn(async () => 'tx-1'),
    commitTransaction: vi.fn(async () => undefined),
    rollbackTransaction: vi.fn(async () => undefined),
  }
  const req = {
    user: user ?? null,
    routeParams,
    payload: { find, findByID, update, create, db },
    ...(body !== undefined ? { data: body, json: async () => body } : {}),
  }
  return { req: req as unknown as PayloadRequest, findByID, update, create }
}

async function run(req: PayloadRequest): Promise<{ status: number; body: any }> {
  const endpoint = createBuildingOperationalToggleEndpoint()
  const res = (await endpoint.handler!(req)) as Response
  const body = await res.json()
  return { status: res.status, body }
}

describe('building-operational-toggle-endpoint/权限门', () => {
  it('未登录 → 401', async () => {
    const { req, update } = makeReq({ user: null })
    const { status } = await run(req)
    expect(status).toBe(401)
    expect(update).not.toHaveBeenCalled()
  })

  it('无 building:freeze 权限 → 403', async () => {
    const opsRole = makeAdmRole({
      id: 2,
      code: 'OPS',
      operationPermissions: ['building:update'],
    })
    const { req, update } = makeReq({
      userRoles: [opsRole],
      user: makeUser({ roles: [2] }),
    })
    const { status } = await run(req)
    expect(status).toBe(403)
    expect(update).not.toHaveBeenCalled()
  })
})

describe('building-operational-toggle-endpoint/取参与状态校验', () => {
  it('缺楼盘 ID → 400', async () => {
    const { req, update } = makeReq({ routeParams: {} })
    const { status, body } = await run(req)
    expect(status).toBe(400)
    expect(body.error).toContain('楼盘 ID')
    expect(update).not.toHaveBeenCalled()
  })

  it('楼盘不存在 → 404', async () => {
    const { req, update } = makeReq({ findByIDThrows: true })
    const { status } = await run(req)
    expect(status).toBe(404)
    expect(update).not.toHaveBeenCalled()
  })

  it('当前启停状态非法 → 400', async () => {
    const { req, update } = makeReq({ currentStatus: 'garbage' })
    const { status } = await run(req)
    expect(status).toBe(400)
    expect(update).not.toHaveBeenCalled()
  })
})

describe('building-operational-toggle-endpoint/翻转', () => {
  it('active → disabled，且只写 operationalStatus', async () => {
    const { req, update } = makeReq({ currentStatus: 'active', routeParams: { id: '7' } })
    const { status, body } = await run(req)
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.buildingId).toBe('7')
    expect(body.operationalStatus).toBe('disabled')

    // update 只触碰 buildings.operationalStatus，绝不改任何 Listing
    expect(update).toHaveBeenCalledTimes(1)
    const arg = update.mock.calls[0][0]
    expect(arg.collection).toBe('buildings')
    expect(arg.id).toBe('7')
    expect(arg.data).toEqual({ operationalStatus: 'disabled' })
    // 透传 req → auditFieldsPlugin 记录 lastModifiedBy
    expect(arg.req).toBeDefined()
  })

  it('disabled → active', async () => {
    const { req, update } = makeReq({ currentStatus: 'disabled' })
    const { status, body } = await run(req)
    expect(status).toBe(200)
    expect(body.operationalStatus).toBe('active')
    expect(update.mock.calls[0][0].data).toEqual({ operationalStatus: 'active' })
  })
})

/**
 * OPT-113：列表里的「停用」按读到的行状态渲染，行数据可能已经过期（别人刚停用过）。
 * 纯翻转语义下，过期的「停用」点下去会变成「启用」——与按钮上写的相反。
 * 带 target 时按目标值写；已是目标值则幂等返回，不翻转。
 */
describe('building-operational-toggle-endpoint/target（OPT-113）', () => {
  it('target=disabled 且当前 active → 停用', async () => {
    const { req, update } = makeReq({ currentStatus: 'active', body: { target: 'disabled' } })
    const { status, body } = await run(req)
    expect(status).toBe(200)
    expect(body).toMatchObject({ ok: true, operationalStatus: 'disabled', changed: true })
    expect(update.mock.calls[0][0].data).toEqual({ operationalStatus: 'disabled' })
  })

  it('target=disabled 但已经停用 → 幂等成功，不写库、不翻回启用', async () => {
    const { req, update } = makeReq({ currentStatus: 'disabled', body: { target: 'disabled' } })
    const { status, body } = await run(req)
    expect(status).toBe(200)
    expect(body).toMatchObject({ ok: true, operationalStatus: 'disabled', changed: false })
    expect(update).not.toHaveBeenCalled()
  })

  it('target=active 且当前 disabled → 启用', async () => {
    const { req, update } = makeReq({ currentStatus: 'disabled', body: { target: 'active' } })
    const { body } = await run(req)
    expect(body).toMatchObject({ ok: true, operationalStatus: 'active', changed: true })
    expect(update.mock.calls[0][0].data).toEqual({ operationalStatus: 'active' })
  })

  it('target 非法 → 400，不写库', async () => {
    const { req, update } = makeReq({ body: { target: 'frozen' } })
    const { status } = await run(req)
    expect(status).toBe(400)
    expect(update).not.toHaveBeenCalled()
  })

  it('body 里没有 target → 保持旧的翻转语义', async () => {
    const { req, update } = makeReq({ currentStatus: 'active', body: {} })
    const { body } = await run(req)
    expect(body).toMatchObject({ ok: true, operationalStatus: 'disabled', changed: true })
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('权限门先于 target 校验：无 building:freeze 时幂等路径也是 403', async () => {
    const opsRole = makeAdmRole({ id: 2, code: 'OPS', operationPermissions: ['building:update'] })
    const { req } = makeReq({
      userRoles: [opsRole],
      user: makeUser({ roles: [2] }),
      currentStatus: 'disabled',
      body: { target: 'disabled' },
    })
    expect((await run(req)).status).toBe(403)
  })
})

describe('building-operational-toggle-endpoint/审计（OPT-113）', () => {
  function auditActions(create: ReturnType<typeof vi.fn>): unknown[] {
    return create.mock.calls
      .map((c) => (c as unknown as [{ collection: string; data: Record<string, unknown> }])[0])
      .filter((a) => a.collection === 'audit-logs')
      .map((a) => a.data.action)
  }

  it('停用写 building.freeze、启用写 building.restore', async () => {
    const disable = makeReq({ currentStatus: 'active' })
    await run(disable.req)
    expect(auditActions(disable.create)).toEqual(['building.freeze'])

    const enable = makeReq({ currentStatus: 'disabled' })
    await run(enable.req)
    expect(auditActions(enable.create)).toEqual(['building.restore'])
  })

  it('已是目标状态的幂等返回不写审计', async () => {
    const { req, create } = makeReq({ currentStatus: 'disabled', body: { target: 'disabled' } })
    await run(req)
    expect(auditActions(create)).toEqual([])
  })
})
