import { describe, expect, it, vi } from 'vitest'
import type { PayloadRequest } from 'payload'

import {
  createBuildingBatchDeactivationImpactEndpoint,
  createBuildingBatchOperationalEndpoint,
} from '@/endpoints/building-batch-operational-endpoint'
import type { Role, User } from '@/payload-types'

/**
 * 楼盘批量停用 / 启用 endpoint 与批量停用预检 endpoint（OPT-113）
 *
 * POST /api/buildings/batch-operational-status   body { target, items: [{ id, expectedVersion? }] }
 * POST /api/buildings/batch-deactivation-impact  body { items: [{ id }] }
 *
 * 不变量：
 *  - 两个端点都要 building:freeze（停用专用码）；building:update 不能替代。
 *  - 只写 operationalStatus，绝不碰发布状态 status，也不碰任何房源。
 *  - 已是目标状态 → 幂等成功，不写库、不写审计。
 *  - 每条成功写一行审计：停用 building.freeze、启用 building.restore。
 *  - 逐条执行、逐条出结果；版本冲突 / 不存在 / 抛错只影响这一条。
 */

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

function makeBuilding(id: number, overrides: Record<string, unknown> = {}) {
  return { id, name: `楼盘${id}`, version: 2, status: 'published', operationalStatus: 'active', ...overrides }
}

function makeReq(params: {
  user?: User | null
  userRoles?: Role[]
  buildings?: Record<string, unknown>[]
  listings?: Record<string, unknown>[]
  updateThrowsFor?: number[]
  body?: unknown
}) {
  const {
    user = makeUser(),
    userRoles = [makeRole()],
    buildings = [],
    listings = [],
    updateThrowsFor = [],
    body = {},
  } = params
  const byId = new Map(buildings.map((b) => [String(b.id), b]))
  const find = vi.fn(async (args: { collection?: string }) => {
    if (args.collection === 'roles') return { docs: userRoles }
    if (args.collection === 'listing-reports') return { docs: [] }
    if (args.collection === 'listings') return { docs: listings }
    throw new Error(`unexpected collection: ${String(args.collection)}`)
  })
  const findByID = vi.fn(async (args: { id: string | number }) => {
    const doc = byId.get(String(args.id))
    if (!doc) throw new Error('not found')
    return doc
  })
  const update = vi.fn(
    async (args: {
      collection?: string
      id: string | number
      data: Record<string, unknown>
      req?: unknown
    }) => {
      if (updateThrowsFor.includes(Number(args.id))) throw new Error('db down')
      return { ...byId.get(String(args.id)), ...args.data }
    },
  )
  const create = vi.fn(async () => ({ id: 999, auditId: 'aud_test001' }))
  const req = {
    user: user ?? null,
    routeParams: {},
    data: body,
    json: async () => body,
    payload: { find, findByID, update, create },
    headers: {},
  }
  return { req: req as unknown as PayloadRequest, find, findByID, update, create }
}

async function runStatus(req: PayloadRequest): Promise<{ status: number; body: any }> {
  const res = (await createBuildingBatchOperationalEndpoint().handler!(req)) as Response
  return { status: res.status, body: await res.json() }
}

async function runImpact(req: PayloadRequest): Promise<{ status: number; body: any }> {
  const res = (await createBuildingBatchDeactivationImpactEndpoint().handler!(req)) as Response
  return { status: res.status, body: await res.json() }
}

function auditRows(create: ReturnType<typeof vi.fn>) {
  return create.mock.calls
    .map((c) => (c as unknown as [{ collection: string; data: Record<string, unknown> }])[0])
    .filter((a) => a.collection === 'audit-logs')
}

const OPS_UPDATE_ONLY = {
  user: makeUser({ roles: [2] }),
  userRoles: [makeRole({ id: 2, code: 'OPS', operationPermissions: ['building:update'] })],
}

describe('batch-operational-status/装配与权限', () => {
  it('挂在 /batch-operational-status（POST）', () => {
    const endpoint = createBuildingBatchOperationalEndpoint()
    expect(endpoint.path).toBe('/batch-operational-status')
    expect(endpoint.method).toBe('post')
  })

  it('未登录 → 401', async () => {
    const { req, update } = makeReq({
      user: null,
      body: { target: 'disabled', items: [{ id: 1 }] },
    })
    expect((await runStatus(req)).status).toBe(401)
    expect(update).not.toHaveBeenCalled()
  })

  it('只有 building:update 没有 building:freeze → 403', async () => {
    const { req, update } = makeReq({
      ...OPS_UPDATE_ONLY,
      buildings: [makeBuilding(1)],
      body: { target: 'disabled', items: [{ id: 1 }] },
    })
    expect((await runStatus(req)).status).toBe(403)
    expect(update).not.toHaveBeenCalled()
  })
})

describe('batch-operational-status/请求体校验', () => {
  it.each([undefined, 'toggle', 'frozen', 'archived'])('target=%s → 400', async (target) => {
    const { req, findByID } = makeReq({ body: { target, items: [{ id: 1 }] } })
    expect((await runStatus(req)).status).toBe(400)
    expect(findByID).not.toHaveBeenCalled()
  })

  it('条目非法 → 400', async () => {
    const { req, findByID } = makeReq({ body: { target: 'disabled', items: [] } })
    expect((await runStatus(req)).status).toBe(400)
    expect(findByID).not.toHaveBeenCalled()
  })
})

describe('batch-operational-status/逐条执行', () => {
  it('批量停用：只写 operationalStatus，逐条 building.freeze 审计；已停用的幂等不写', async () => {
    const { req, update, create } = makeReq({
      buildings: [
        makeBuilding(1),
        makeBuilding(2, { operationalStatus: 'disabled' }),
        makeBuilding(3, { status: 'archived' }),
      ],
      body: { target: 'disabled', items: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 99 }] },
    })
    const { status, body } = await runStatus(req)
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.action).toBe('disabled')
    expect(body.results).toEqual([
      { id: 1, ok: true, status: 'disabled' },
      { id: 2, ok: true, status: 'disabled' },
      { id: 3, ok: true, status: 'disabled' },
      { id: 99, ok: false, error: '楼盘不存在' },
    ])
    expect(body.succeeded).toBe(3)
    expect(body.failed).toBe(1)

    // 已停用的 2 号不写库；下架中的 3 号照样停用（两条轴独立）
    expect(update.mock.calls.map((c) => c[0].id)).toEqual([1, 3])
    for (const call of update.mock.calls) {
      expect(call[0].collection).toBe('buildings')
      expect(call[0].data).toEqual({ operationalStatus: 'disabled' })
      expect(call[0].req).toBe(req)
    }
    const audits = auditRows(create)
    expect(audits).toHaveLength(2)
    for (const row of audits) {
      expect(row.data.action).toBe('building.freeze')
      expect(row.data.changedFields).toEqual(['operationalStatus'])
    }
  })

  it('批量启用：写 building.restore 审计', async () => {
    const { req, update, create } = makeReq({
      buildings: [makeBuilding(1, { operationalStatus: 'disabled' })],
      body: { target: 'active', items: [{ id: 1 }] },
    })
    const { body } = await runStatus(req)
    expect(body.results).toEqual([{ id: 1, ok: true, status: 'active' }])
    expect(update.mock.calls[0][0].data).toEqual({ operationalStatus: 'active' })
    expect(auditRows(create).map((a) => a.data.action)).toEqual(['building.restore'])
  })

  it('版本号对不上 → 这一条 VERSION_CONFLICT，不写库', async () => {
    const { req, update } = makeReq({
      buildings: [makeBuilding(1, { version: 4 }), makeBuilding(2, { version: 4 })],
      body: {
        target: 'disabled',
        items: [
          { id: 1, expectedVersion: 3 },
          { id: 2, expectedVersion: 4 },
        ],
      },
    })
    const { body } = await runStatus(req)
    expect(body.results[0]).toMatchObject({ id: 1, ok: false, code: 'VERSION_CONFLICT' })
    expect(body.results[1]).toEqual({ id: 2, ok: true, status: 'disabled' })
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('当前启停状态非法 → 这一条失败，不写库', async () => {
    const { req, update } = makeReq({
      buildings: [makeBuilding(1, { operationalStatus: 'garbage' })],
      body: { target: 'disabled', items: [{ id: 1 }] },
    })
    const { body } = await runStatus(req)
    expect(body.results[0]).toMatchObject({ id: 1, ok: false })
    expect(update).not.toHaveBeenCalled()
  })

  it('某条写库抛错只算这一条失败', async () => {
    const { req, update } = makeReq({
      buildings: [makeBuilding(1), makeBuilding(2)],
      updateThrowsFor: [1],
      body: { target: 'disabled', items: [{ id: 1 }, { id: 2 }] },
    })
    const { status, body } = await runStatus(req)
    expect(status).toBe(200)
    expect(body.results[0]).toEqual({ id: 1, ok: false, error: '写入失败，请重试' })
    expect(body.results[1]).toEqual({ id: 2, ok: true, status: 'disabled' })
    expect(update).toHaveBeenCalledTimes(2)
  })
})

describe('batch-deactivation-impact', () => {
  it('挂在 /batch-deactivation-impact（POST）', () => {
    const endpoint = createBuildingBatchDeactivationImpactEndpoint()
    expect(endpoint.path).toBe('/batch-deactivation-impact')
    expect(endpoint.method).toBe('post')
  })

  it('只有 building:update → 403，一条不查', async () => {
    const { req, find } = makeReq({ ...OPS_UPDATE_ONLY, body: { items: [{ id: 1 }] } })
    expect((await runImpact(req)).status).toBe(403)
    expect(find.mock.calls.filter((c) => c[0].collection === 'listings')).toHaveLength(0)
  })

  it('条目非法 → 400', async () => {
    const { req } = makeReq({ body: { items: [{ id: 'x' }] } })
    expect((await runImpact(req)).status).toBe(400)
  })

  it('返回汇总报告（一次 listings 查询，building in）', async () => {
    const merchant = {
      status: 'active',
      qualificationStatus: 'valid',
      qualificationExpiresAt: '2999-01-01T00:00:00.000Z',
      serviceCities: [{ id: 100 }],
    }
    const { req, find } = makeReq({
      listings: [
        { id: 1, building: { id: 5, city: { id: 100 } }, merchant },
        { id: 2, building: { id: 6, city: { id: 100 } }, merchant },
      ],
      body: { items: [{ id: 5 }, { id: 6 }] },
    })
    const { status, body } = await runImpact(req)
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.report.total).toBe(2)
    expect(body.report.byBuilding).toEqual([
      { buildingId: 5, count: 1 },
      { buildingId: 6, count: 1 },
    ])
    const listingCalls = find.mock.calls.filter((c) => c[0].collection === 'listings')
    expect(listingCalls).toHaveLength(1)
  })
})
