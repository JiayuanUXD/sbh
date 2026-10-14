import { describe, expect, it, vi } from 'vitest'
import type { PayloadRequest } from 'payload'

import { createListingBatchPublishEndpoint } from '@/endpoints/listing-batch-publish-endpoint'
import type { Role, User } from '@/payload-types'

/**
 * 房源批量上下架 endpoint（OPT-113）
 *
 * POST /api/listings/batch-publish  body { action, items: [{ id, expectedVersion? }], reason? }
 *
 * 不变量：
 *  - 只接受 publish / unpublish（成交是终态，不给批量）。
 *  - 权限按动作鉴权一次：publish 要 listing:publish，unpublish 要 listing:unpublish。
 *  - 下架原因在任何一条执行前校验，缺原因整批 422、一条不改。
 *  - 逐条执行、逐条出结果：一条不满足 / 冲突 / 抛错不影响其它条。
 *  - 逐条规则与单条端点同源（审核未过、非法转移、版本冲突都按单条口径出错误码）。
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

function makeListing(id: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    title: `房源${id}`,
    version: 3,
    reviewStatus: 'approved',
    publicationStatus: 'draft',
    supplyVisibilityHold: 'normal',
    isFeatured: false,
    building: { id: 5, city: { id: 100 } },
    merchant: {
      id: 20,
      status: 'active',
      qualificationStatus: 'valid',
      qualificationExpiresAt: '2999-01-01T00:00:00.000Z',
      serviceCities: [{ id: 100 }],
    },
    ...overrides,
  }
}

function makeReq(params: {
  user?: User | null
  userRoles?: Role[]
  listings?: Record<string, unknown>[]
  /** 这些 id 的 update 抛错 */
  updateThrowsFor?: number[]
  body?: unknown
}) {
  const {
    user = makeUser(),
    userRoles = [makeRole()],
    listings = [],
    updateThrowsFor = [],
    body = {},
  } = params
  const byId = new Map(listings.map((l) => [String(l.id), l]))

  const find = vi.fn(async (args: { collection?: string }) => {
    if (args?.collection && args.collection !== 'roles') {
      throw new Error(`Unexpected collection: ${args.collection}`)
    }
    return { docs: userRoles }
  })
  const findByID = vi.fn(async (args: { id: string | number }) => {
    const doc = byId.get(String(args.id))
    if (!doc) throw new Error('not found')
    return doc
  })
  const update = vi.fn(async (args: { id: string | number; data: Record<string, unknown> }) => {
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
  const endpoint = createListingBatchPublishEndpoint()
  const res = (await endpoint.handler!(req)) as Response
  return { status: res.status, body: await res.json() }
}

describe('listing-batch-publish/装配', () => {
  it('挂在 /batch-publish（POST），不与 /:id/publish 冲突', () => {
    const endpoint = createListingBatchPublishEndpoint()
    expect(endpoint.path).toBe('/batch-publish')
    expect(endpoint.method).toBe('post')
  })
})

describe('listing-batch-publish/动作与权限', () => {
  it('mark_leased / mark_sold 不给批量 → 400，一条不读', async () => {
    for (const action of ['mark_leased', 'mark_sold', 'nope', undefined]) {
      const { req, findByID, update } = makeReq({
        listings: [makeListing(1)],
        body: { action, items: [{ id: 1 }] },
      })
      const { status } = await run(req)
      expect(status).toBe(400)
      expect(findByID).not.toHaveBeenCalled()
      expect(update).not.toHaveBeenCalled()
    }
  })

  it('未登录 → 401', async () => {
    const { req, update } = makeReq({
      user: null,
      body: { action: 'publish', items: [{ id: 1 }] },
    })
    expect((await run(req)).status).toBe(401)
    expect(update).not.toHaveBeenCalled()
  })

  it('批量上架缺 listing:publish → 403', async () => {
    const { req, update } = makeReq({
      user: makeUser({ roles: [2] }),
      userRoles: [makeRole({ id: 2, code: 'OPS', operationPermissions: ['listing:unpublish'] })],
      listings: [makeListing(1)],
      body: { action: 'publish', items: [{ id: 1 }] },
    })
    expect((await run(req)).status).toBe(403)
    expect(update).not.toHaveBeenCalled()
  })

  it('批量下架缺 listing:unpublish → 403（有 publish 也不行）', async () => {
    const { req, update } = makeReq({
      user: makeUser({ roles: [2] }),
      userRoles: [makeRole({ id: 2, code: 'OPS', operationPermissions: ['listing:publish'] })],
      listings: [makeListing(1, { publicationStatus: 'published' })],
      body: { action: 'unpublish', items: [{ id: 1 }], reason: '业主收回' },
    })
    expect((await run(req)).status).toBe(403)
    expect(update).not.toHaveBeenCalled()
  })
})

describe('listing-batch-publish/请求体校验', () => {
  it('条目非法 → 400，一条不读', async () => {
    const { req, findByID } = makeReq({ body: { action: 'publish', items: [{ id: 'x' }] } })
    const { status, body } = await run(req)
    expect(status).toBe(400)
    expect(body.ok).toBe(false)
    expect(findByID).not.toHaveBeenCalled()
  })

  it('空条目 → 400', async () => {
    const { req } = makeReq({ body: { action: 'publish', items: [] } })
    expect((await run(req)).status).toBe(400)
  })

  it('批量下架缺原因 → 422 且一条不改', async () => {
    for (const reason of [undefined, '', '   ']) {
      const { req, findByID, update } = makeReq({
        listings: [makeListing(1, { publicationStatus: 'published' })],
        body: { action: 'unpublish', items: [{ id: 1 }], reason },
      })
      const { status, body } = await run(req)
      expect(status).toBe(422)
      expect(body.code).toBe('UNPUBLISH_REASON_REQUIRED')
      expect(findByID).not.toHaveBeenCalled()
      expect(update).not.toHaveBeenCalled()
    }
  })

  it('请求体不是 JSON 对象 → 400', async () => {
    const { req } = makeReq({ body: 'publish' })
    expect((await run(req)).status).toBe(400)
  })
})

describe('listing-batch-publish/逐条执行', () => {
  it('批量上架：成功与各类失败并存，逐条出结果，只改成功的', async () => {
    const { req, update } = makeReq({
      listings: [
        makeListing(1),
        makeListing(2, { reviewStatus: 'pending' }),
        makeListing(3, { publicationStatus: 'published' }),
        makeListing(4, { publicationStatus: 'unpublished' }),
      ],
      body: {
        action: 'publish',
        items: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 404 }],
      },
    })
    const { status, body } = await run(req)
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.action).toBe('publish')
    expect(body.succeeded).toBe(2)
    expect(body.failed).toBe(3)

    const byId = new Map(body.results.map((r: { id: number }) => [r.id, r]))
    expect(byId.get(1)).toEqual({ id: 1, ok: true, status: 'published' })
    expect(byId.get(4)).toEqual({ id: 4, ok: true, status: 'published' })
    expect(byId.get(2)).toMatchObject({ ok: false, code: 'REVIEW_NOT_APPROVED' })
    expect(byId.get(3)).toMatchObject({ ok: false, code: 'ILLEGAL_TRANSITION' })
    expect(byId.get(404)).toMatchObject({ ok: false, error: '房源不存在' })

    // 结果顺序与请求顺序一致（列表按此回显）
    expect(body.results.map((r: { id: number }) => r.id)).toEqual([1, 2, 3, 4, 404])

    expect(update).toHaveBeenCalledTimes(2)
    for (const call of update.mock.calls) {
      expect(call[0].data).toEqual({ publicationStatus: 'published' })
    }
  })

  it('有效供给不满足：结果带 reasons，供列表逐条展示', async () => {
    const { req, update } = makeReq({
      listings: [makeListing(1, { merchant: null })],
      body: { action: 'publish', items: [{ id: 1 }] },
    })
    const { body } = await run(req)
    expect(body.results[0].ok).toBe(false)
    expect(Array.isArray(body.results[0].reasons)).toBe(true)
    expect(body.results[0].reasons.length).toBeGreaterThan(0)
    expect(update).not.toHaveBeenCalled()
  })

  it('批量下架：同一原因 trim 后写进每条的审计', async () => {
    const { req, update, create } = makeReq({
      listings: [
        makeListing(1, { publicationStatus: 'published' }),
        makeListing(2, { publicationStatus: 'published' }),
      ],
      body: { action: 'unpublish', items: [{ id: 1 }, { id: 2 }], reason: '  业主收回  ' },
    })
    const { status, body } = await run(req)
    expect(status).toBe(200)
    expect(body.succeeded).toBe(2)
    expect(update).toHaveBeenCalledTimes(2)
    for (const call of update.mock.calls) {
      expect(call[0].data).toEqual({ publicationStatus: 'unpublished' })
    }
    const auditRows = create.mock.calls
      .map((c) => (c as unknown as [{ collection: string; data: Record<string, unknown> }])[0])
      .filter((a) => a.collection === 'audit-logs')
    expect(auditRows).toHaveLength(2)
    for (const row of auditRows) {
      expect(row.data.action).toBe('listing.unpublish')
      expect(row.data.reason).toBe('业主收回')
    }
  })

  it('版本号对不上的那条 409 VERSION_CONFLICT，其余照常', async () => {
    const { req, update } = makeReq({
      listings: [makeListing(1, { version: 5 }), makeListing(2, { version: 5 })],
      body: {
        action: 'publish',
        items: [
          { id: 1, expectedVersion: 4 },
          { id: 2, expectedVersion: 5 },
        ],
      },
    })
    const { body } = await run(req)
    expect(body.results[0]).toMatchObject({ id: 1, ok: false, code: 'VERSION_CONFLICT' })
    expect(body.results[1]).toEqual({ id: 2, ok: true, status: 'published' })
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('某条写库抛错只算这一条失败，不中断后面的', async () => {
    const { req, update } = makeReq({
      listings: [makeListing(1), makeListing(2), makeListing(3)],
      updateThrowsFor: [2],
      body: { action: 'publish', items: [{ id: 1 }, { id: 2 }, { id: 3 }] },
    })
    const { status, body } = await run(req)
    expect(status).toBe(200)
    expect(body.succeeded).toBe(2)
    expect(body.failed).toBe(1)
    expect(body.results[1]).toMatchObject({ id: 2, ok: false })
    expect(typeof body.results[1].error).toBe('string')
    expect(update).toHaveBeenCalledTimes(3)
  })

  it('重复 id 只执行一次', async () => {
    const { req, update } = makeReq({
      listings: [makeListing(1)],
      body: { action: 'publish', items: [{ id: 1 }, { id: '1' }] },
    })
    const { body } = await run(req)
    expect(body.results).toHaveLength(1)
    expect(update).toHaveBeenCalledTimes(1)
  })
})
