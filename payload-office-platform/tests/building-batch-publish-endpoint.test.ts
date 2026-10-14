import { describe, expect, it, vi } from 'vitest'
import type { PayloadRequest } from 'payload'

import { createBuildingBatchPublishEndpoint } from '@/endpoints/building-batch-publish-endpoint'
import type { Role, User } from '@/payload-types'

/**
 * 楼盘批量上下架 endpoint（OPT-113）
 *
 * POST /api/buildings/batch-publish  body { action, items: [{ id, expectedVersion? }] }
 *
 * 不变量：
 *  - 权限 building:update（与编辑页改「发布状态」字段同一道门）；building:freeze 不能替代。
 *  - 上架：草稿 / 下架 → 已发布；下架：已发布 → 下架。其余条目「不适用」，不写库。
 *  - 只写 status，绝不碰启停轴 operationalStatus，也不碰任何房源。
 *  - 每条成功写一行 building.update 审计（changedFields = ['status']）。
 *  - 逐条执行、逐条出结果。
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
  return {
    id,
    name: `楼盘${id}`,
    version: 2,
    status: 'published',
    operationalStatus: 'active',
    ...overrides,
  }
}

function makeReq(params: {
  user?: User | null
  userRoles?: Role[]
  buildings?: Record<string, unknown>[]
  updateThrowsFor?: number[]
  body?: unknown
}) {
  const {
    user = makeUser(),
    userRoles = [makeRole()],
    buildings = [],
    updateThrowsFor = [],
    body = {},
  } = params
  const byId = new Map(buildings.map((b) => [String(b.id), b]))
  const find = vi.fn(async () => ({ docs: userRoles }))
  const findByID = vi.fn(async (args: { id: string | number }) => {
    const doc = byId.get(String(args.id))
    if (!doc) throw new Error('not found')
    return doc
  })
  const update = vi.fn(async (args: {
    collection?: string
    id: string | number
    data: Record<string, unknown>
    req?: unknown
  }) => {
    if (updateThrowsFor.includes(Number(args.id))) throw new Error('db down')
    return { ...byId.get(String(args.id)), ...args.data }
  })
  const create = vi.fn(async () => ({ id: 999, auditId: 'aud_test001' }))
  const req = {
    user: user ?? null,
    routeParams: {},
    data: body,
    json: async () => body,
    payload: { find, findByID, update, create },
    headers: {},
  }
  return { req: req as unknown as PayloadRequest, findByID, update, create }
}

async function run(req: PayloadRequest): Promise<{ status: number; body: any }> {
  const endpoint = createBuildingBatchPublishEndpoint()
  const res = (await endpoint.handler!(req)) as Response
  return { status: res.status, body: await res.json() }
}

function auditRows(create: ReturnType<typeof vi.fn>) {
  return create.mock.calls
    .map((c) => (c as unknown as [{ collection: string; data: Record<string, unknown> }])[0])
    .filter((a) => a.collection === 'audit-logs')
}

describe('building-batch-publish/装配与权限', () => {
  it('挂在 /batch-publish（POST）', () => {
    const endpoint = createBuildingBatchPublishEndpoint()
    expect(endpoint.path).toBe('/batch-publish')
    expect(endpoint.method).toBe('post')
  })

  it('未登录 → 401', async () => {
    const { req, update } = makeReq({
      user: null,
      body: { action: 'publish', items: [{ id: 1 }] },
    })
    expect((await run(req)).status).toBe(401)
    expect(update).not.toHaveBeenCalled()
  })

  it('只有 building:freeze 没有 building:update → 403', async () => {
    const { req, update } = makeReq({
      user: makeUser({ roles: [2] }),
      userRoles: [makeRole({ id: 2, code: 'OPS', operationPermissions: ['building:freeze'] })],
      buildings: [makeBuilding(1)],
      body: { action: 'unpublish', items: [{ id: 1 }] },
    })
    expect((await run(req)).status).toBe(403)
    expect(update).not.toHaveBeenCalled()
  })

  it('OPS 的 building:update 足够', async () => {
    const { req, update } = makeReq({
      user: makeUser({ roles: [2] }),
      userRoles: [makeRole({ id: 2, code: 'OPS', operationPermissions: ['building:update'] })],
      buildings: [makeBuilding(1)],
      body: { action: 'unpublish', items: [{ id: 1 }] },
    })
    const { status, body } = await run(req)
    expect(status).toBe(200)
    expect(body.succeeded).toBe(1)
    expect(update).toHaveBeenCalledTimes(1)
  })
})

describe('building-batch-publish/请求体校验', () => {
  it.each([undefined, 'archive', 'freeze', 'mark_leased'])('动作 %s → 400', async (action) => {
    const { req, findByID } = makeReq({ body: { action, items: [{ id: 1 }] } })
    expect((await run(req)).status).toBe(400)
    expect(findByID).not.toHaveBeenCalled()
  })

  it('条目非法 → 400', async () => {
    const { req, findByID } = makeReq({ body: { action: 'publish', items: [{ id: 0 }] } })
    expect((await run(req)).status).toBe(400)
    expect(findByID).not.toHaveBeenCalled()
  })

  it('请求体缺失 → 400', async () => {
    const { req } = makeReq({ body: null })
    expect((await run(req)).status).toBe(400)
  })
})

describe('building-batch-publish/逐条执行', () => {
  it('批量下架：已发布 → 下架；草稿 / 已下架不适用；不存在的单独报错', async () => {
    const { req, update, create } = makeReq({
      buildings: [
        makeBuilding(1),
        makeBuilding(2, { status: 'draft' }),
        makeBuilding(3, { status: 'archived' }),
        makeBuilding(4),
      ],
      body: {
        action: 'unpublish',
        items: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 99 }],
      },
    })
    const { status, body } = await run(req)
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.action).toBe('unpublish')
    expect(body.succeeded).toBe(2)
    expect(body.failed).toBe(3)
    expect(body.results.map((r: { id: number }) => r.id)).toEqual([1, 2, 3, 4, 99])
    expect(body.results[0]).toEqual({ id: 1, ok: true, status: 'archived' })
    expect(body.results[1]).toMatchObject({ id: 2, ok: false, code: 'ILLEGAL_TRANSITION' })
    expect(body.results[1].error).toContain('草稿')
    expect(body.results[2]).toMatchObject({ id: 3, ok: false, code: 'ILLEGAL_TRANSITION' })
    expect(body.results[4]).toMatchObject({ id: 99, ok: false, error: '楼盘不存在' })

    // 只写 status：启停轴与房源都不碰
    expect(update).toHaveBeenCalledTimes(2)
    for (const call of update.mock.calls) {
      expect(call[0].collection).toBe('buildings')
      expect(call[0].data).toEqual({ status: 'archived' })
      expect(call[0].req).toBe(req)
    }

    const audits = auditRows(create)
    expect(audits).toHaveLength(2)
    for (const row of audits) {
      expect(row.data.action).toBe('building.update')
      expect(row.data.changedFields).toEqual(['status'])
    }
  })

  it('批量上架：草稿与已下架都落已发布', async () => {
    const { req, update } = makeReq({
      buildings: [makeBuilding(1, { status: 'draft' }), makeBuilding(2, { status: 'archived' })],
      body: { action: 'publish', items: [{ id: 1 }, { id: 2 }] },
    })
    const { body } = await run(req)
    expect(body.succeeded).toBe(2)
    expect(update.mock.calls.map((c) => c[0].data)).toEqual([
      { status: 'published' },
      { status: 'published' },
    ])
  })

  it('停用中的楼盘照样可以上架（两条轴独立，上架不替运营决定启停）', async () => {
    const { req, update } = makeReq({
      buildings: [makeBuilding(1, { status: 'archived', operationalStatus: 'disabled' })],
      body: { action: 'publish', items: [{ id: 1 }] },
    })
    const { body } = await run(req)
    expect(body.results[0]).toEqual({ id: 1, ok: true, status: 'published' })
    expect(update.mock.calls[0][0].data).toEqual({ status: 'published' })
  })

  it('版本号对不上 → 这一条 VERSION_CONFLICT，不写库', async () => {
    const { req, update } = makeReq({
      buildings: [makeBuilding(1, { version: 4 }), makeBuilding(2, { version: 4 })],
      body: {
        action: 'unpublish',
        items: [
          { id: 1, expectedVersion: 3 },
          { id: 2, expectedVersion: 4 },
        ],
      },
    })
    const { body } = await run(req)
    expect(body.results[0]).toMatchObject({ id: 1, ok: false, code: 'VERSION_CONFLICT' })
    expect(body.results[1]).toEqual({ id: 2, ok: true, status: 'archived' })
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('某条写库抛错只算这一条失败', async () => {
    const { req, update } = makeReq({
      buildings: [makeBuilding(1), makeBuilding(2)],
      updateThrowsFor: [1],
      body: { action: 'unpublish', items: [{ id: 1 }, { id: 2 }] },
    })
    const { status, body } = await run(req)
    expect(status).toBe(200)
    expect(body.results[0]).toEqual({ id: 1, ok: false, error: '写入失败，请重试' })
    expect(body.results[1]).toEqual({ id: 2, ok: true, status: 'archived' })
    expect(update).toHaveBeenCalledTimes(2)
  })
})
