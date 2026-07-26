import { describe, expect, it, vi } from 'vitest'
import type { PayloadRequest } from 'payload'

import { createListingReviewDecisionEndpoint } from '@/endpoints/listing-review-decision-endpoint'
import type { Role, User } from '@/payload-types'

/**
 * 房源审核决策 endpoint 的 HTTP 装配层测试（M4.6 / M4.4 / R4, R8）
 *
 * POST /api/listings/:id/review  body { decision, reason?, expectedVersion? }
 *   decision ∈ submit | withdraw | approve | reject
 *
 * 覆盖的不变量：
 *  - 权限：全部动作要 listing:review。
 *  - 审核状态机：非法转移（如 approved 再 approve）→ 409。
 *  - 驳回必填原因 → 缺原因 422。
 *  - 每个动作 append 一条 listing-reviews 不可变记录（decision + taskStatus + 快照 + 哈希）。
 *  - approve 只改 reviewStatus，绝不写 publicationStatus（审核通过不隐式发布）。
 *  - 版本乐观锁：expectedVersion 与当前不符 → 409，且不写审核记录、不改房源。
 *
 * 权限门与取参真实执行；find/findByID/update/create 用 vi.fn mock。
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

function makeListing(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    version: 3,
    reviewStatus: 'not_submitted',
    publicationStatus: 'draft',
    title: '示例房源',
    slug: 'demo',
    building: { id: 5 },
    merchant: { id: 20 },
    gallery: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    ...overrides,
  }
}

function makeReq(params: {
  user?: User | null
  routeParams?: Record<string, unknown>
  userRoles?: Role[]
  listing?: Record<string, unknown> | null
  findByIDThrows?: boolean
  body?: Record<string, unknown>
}): {
  req: PayloadRequest
  update: ReturnType<typeof vi.fn>
  create: ReturnType<typeof vi.fn>
} {
  const {
    user = makeUser(),
    routeParams = { id: '1' },
    userRoles = [makeAdmRole()],
    listing = makeListing(),
    findByIDThrows = false,
    body = { decision: 'submit' },
  } = params

  const find = vi.fn(async () => ({ docs: userRoles }))
  const findByID = vi.fn(async () => {
    if (findByIDThrows) throw new Error('not found')
    return listing
  })
  const update = vi.fn(async () => ({ id: 1 }))
  const create = vi.fn(async () => ({ id: 99 }))
  const req = {
    user: user ?? null,
    routeParams,
    data: body,
    json: async () => body,
    payload: { find, findByID, update, create },
  }
  return { req: req as unknown as PayloadRequest, update, create }
}

async function run(req: PayloadRequest): Promise<{ status: number; body: any }> {
  const endpoint = createListingReviewDecisionEndpoint()
  const res = (await endpoint.handler!(req)) as Response
  const body = await res.json()
  return { status: res.status, body }
}

describe('listing-review-decision-endpoint/权限门', () => {
  it('未登录 → 401', async () => {
    const { req, update, create } = makeReq({ user: null })
    const { status } = await run(req)
    expect(status).toBe(401)
    expect(update).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it('无 listing:review 权限 → 403', async () => {
    const role = makeAdmRole({ id: 2, code: 'BRK', operationPermissions: ['listing:update'] })
    const { req, update, create } = makeReq({
      userRoles: [role],
      user: makeUser({ roles: [2] }),
    })
    const { status } = await run(req)
    expect(status).toBe(403)
    expect(update).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })
})

describe('listing-review-decision-endpoint/取参与校验', () => {
  it('缺房源 ID → 400', async () => {
    const { req } = makeReq({ routeParams: {} })
    const { status, body } = await run(req)
    expect(status).toBe(400)
    expect(body.error).toContain('房源 ID')
  })

  it('非法 decision → 400', async () => {
    const { req } = makeReq({ body: { decision: 'garbage' } })
    const { status } = await run(req)
    expect(status).toBe(400)
  })

  it('房源不存在 → 404', async () => {
    const { req } = makeReq({ findByIDThrows: true })
    const { status } = await run(req)
    expect(status).toBe(404)
  })
})

describe('listing-review-decision-endpoint/状态机', () => {
  it('非法转移（approved 再 approve）→ 409', async () => {
    const { req, update, create } = makeReq({
      listing: makeListing({ reviewStatus: 'approved' }),
      body: { decision: 'approve' },
    })
    const { status } = await run(req)
    expect(status).toBe(409)
    expect(update).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it('驳回未填原因 → 422', async () => {
    const { req, update, create } = makeReq({
      listing: makeListing({ reviewStatus: 'pending' }),
      body: { decision: 'reject' },
    })
    const { status } = await run(req)
    expect(status).toBe(422)
    expect(update).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })
})

describe('listing-review-decision-endpoint/提交', () => {
  it('submit → 200，reviewStatus=pending，append 记录 taskStatus=pending', async () => {
    const { req, update, create } = makeReq({ body: { decision: 'submit' } })
    const { status, body } = await run(req)
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.reviewStatus).toBe('pending')

    // 房源审核轴更新
    const upd = update.mock.calls[0][0]
    expect(upd.collection).toBe('listings')
    expect(upd.data.reviewStatus).toBe('pending')
    // 不触碰发布轴
    expect(upd.data.publicationStatus).toBeUndefined()

    // append 一条审核记录
    const rec = create.mock.calls[0][0]
    expect(rec.collection).toBe('listing-reviews')
    expect(rec.data.decision).toBe('submit')
    expect(rec.data.taskStatus).toBe('pending')
    expect(rec.data.listing).toBe('1')
    // 快照 + 哈希由服务端推导
    expect(rec.data.snapshot).toBeDefined()
    expect(typeof rec.data.snapshotHash).toBe('string')
    expect(rec.data.snapshotHash.length).toBe(64)
  })
})

describe('listing-review-decision-endpoint/审核通过不隐式发布', () => {
  it('approve → 200，reviewStatus=approved，绝不写 publicationStatus', async () => {
    const { req, update, create } = makeReq({
      listing: makeListing({ reviewStatus: 'pending' }),
      body: { decision: 'approve' },
    })
    const { status, body } = await run(req)
    expect(status).toBe(200)
    expect(body.reviewStatus).toBe('approved')

    const upd = update.mock.calls[0][0]
    expect(upd.data.reviewStatus).toBe('approved')
    expect(upd.data.publicationStatus).toBeUndefined()

    const rec = create.mock.calls[0][0]
    expect(rec.data.decision).toBe('approve')
    expect(rec.data.taskStatus).toBe('resolved')
  })
})

describe('listing-review-decision-endpoint/驳回', () => {
  it('reject 填原因 → 200，reviewStatus=rejected，记录含原因', async () => {
    const { req, update, create } = makeReq({
      listing: makeListing({ reviewStatus: 'pending' }),
      body: { decision: 'reject', reason: '图片模糊' },
    })
    const { status, body } = await run(req)
    expect(status).toBe(200)
    expect(body.reviewStatus).toBe('rejected')

    const rec = create.mock.calls[0][0]
    expect(rec.data.decision).toBe('reject')
    expect(rec.data.taskStatus).toBe('resolved')
    expect(rec.data.reason).toBe('图片模糊')
  })
})

describe('listing-review-decision-endpoint/撤回', () => {
  it('withdraw → 200，reviewStatus=not_submitted，记录 taskStatus=cancelled', async () => {
    const { req, create } = makeReq({
      listing: makeListing({ reviewStatus: 'pending' }),
      body: { decision: 'withdraw' },
    })
    const { status, body } = await run(req)
    expect(status).toBe(200)
    expect(body.reviewStatus).toBe('not_submitted')

    const rec = create.mock.calls[0][0]
    expect(rec.data.decision).toBe('withdraw')
    expect(rec.data.taskStatus).toBe('cancelled')
  })
})

describe('listing-review-decision-endpoint/版本乐观锁', () => {
  it('expectedVersion 与当前不符 → 409，不写记录、不改房源', async () => {
    const { req, update, create } = makeReq({
      listing: makeListing({ reviewStatus: 'not_submitted', version: 3 }),
      body: { decision: 'submit', expectedVersion: 2 },
    })
    const { status } = await run(req)
    expect(status).toBe(409)
    expect(update).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it('expectedVersion 相符 → 放行', async () => {
    const { req, update, create } = makeReq({
      listing: makeListing({ reviewStatus: 'not_submitted', version: 3 }),
      body: { decision: 'submit', expectedVersion: 3 },
    })
    const { status } = await run(req)
    expect(status).toBe(200)
    expect(update).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledTimes(1)
  })
})
