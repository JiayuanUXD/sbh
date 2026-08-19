import { describe, expect, it, vi } from 'vitest'
import type { PayloadRequest } from 'payload'

import { createListingPublishEndpoint } from '@/endpoints/listing-publish-endpoint'
import type { Role, User } from '@/payload-types'

/**
 * 房源显式发布 endpoint 的 HTTP 装配层测试（M4.6 / R4, R8）
 *
 * POST /api/listings/:id/publish  body { action, reason?, expectedVersion? }
 *   action ∈ publish | unpublish | mark_leased
 *
 * 覆盖的不变量：
 *  - 权限：publish/mark_leased 要 listing:publish；unpublish 要 listing:unpublish。
 *  - 发布前置：reviewStatus 必须 approved 且有效供给谓词通过，否则拒绝（不改状态）。
 *  - 下架必填原因。
 *  - mark_leased 副作用：publicationStatus=leased + isFeatured=false（撤销推荐+收回可见）。
 *  - 版本乐观锁：expectedVersion 与当前不符 → 409，且 update 不触发。
 *  - 审核通过不隐式发布：本端点只动发布轴，不写 reviewStatus。
 *
 * 权限门与取参真实执行；findByID/update 用 vi.fn mock。
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

/**
 * 构造一个"有效供给齐全"的房源文档：审核通过、已提交足量图片、
 * 楼盘/城市启用、商户有效、关系在有效期内。各测试按需覆盖单个字段来制造不合格。
 */
function makeEffectiveListing(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    version: 3,
    reviewStatus: 'approved',
    publicationStatus: 'draft',
    supplyVisibilityHold: 'normal',
    isFeatured: true,
    gallery: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
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
  routeParams?: Record<string, unknown>
  userRoles?: Role[]
  listing?: Record<string, unknown> | null
  findByIDThrows?: boolean
  body?: Record<string, unknown>
  relationDocs?: Array<Record<string, unknown>>
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
    listing = makeEffectiveListing(),
    findByIDThrows = false,
    body = { action: 'publish' },
    // 当前生效的房源-商户关系（无限期，起始很早）
    relationDocs = [{
      id: 1,
      effectiveFrom: '2000-01-01T00:00:00.000Z',
      effectiveTo: null,
      merchant: makeEffectiveListing().merchant,
    }],
  } = params

  // find 被两处调用：加载角色（collection: 'roles'）与查关系（collection: 'listing-merchant-relations'）
  const find = vi.fn(async (args: { collection?: string }) => {
    if (args?.collection === 'listing-merchant-relations') return { docs: relationDocs }
    return { docs: userRoles }
  })
  const findByID = vi.fn(async () => {
    if (findByIDThrows) throw new Error('not found')
    return listing
  })
  const update = vi.fn(async () => ({ id: 1 }))
  const create = vi.fn(async () => ({ id: 999, auditId: 'aud_test001' }))
  const req = {
    user: user ?? null,
    routeParams,
    data: body,
    json: async () => body,
    payload: { find, findByID, update, create },
    headers: {},
  }
  return { req: req as unknown as PayloadRequest, findByID, update, create }
}

async function run(req: PayloadRequest): Promise<{ status: number; body: any }> {
  const endpoint = createListingPublishEndpoint()
  const res = (await endpoint.handler!(req)) as Response
  const body = await res.json()
  return { status: res.status, body }
}

describe('listing-publish-endpoint/权限门', () => {
  it('未登录 → 401', async () => {
    const { req, update } = makeReq({ user: null })
    const { status } = await run(req)
    expect(status).toBe(401)
    expect(update).not.toHaveBeenCalled()
  })

  it('publish 无 listing:publish 权限 → 403', async () => {
    const role = makeAdmRole({ id: 2, code: 'BRK', operationPermissions: ['listing:update'] })
    const { req, update } = makeReq({
      userRoles: [role],
      user: makeUser({ roles: [2] }),
      body: { action: 'publish' },
    })
    const { status } = await run(req)
    expect(status).toBe(403)
    expect(update).not.toHaveBeenCalled()
  })

  it('unpublish 无 listing:unpublish 权限 → 403', async () => {
    const role = makeAdmRole({ id: 2, code: 'BRK', operationPermissions: ['listing:publish'] })
    const { req, update } = makeReq({
      userRoles: [role],
      user: makeUser({ roles: [2] }),
      listing: makeEffectiveListing({ publicationStatus: 'published' }),
      body: { action: 'unpublish', reason: '房东撤单' },
    })
    const { status } = await run(req)
    expect(status).toBe(403)
    expect(update).not.toHaveBeenCalled()
  })
})

describe('listing-publish-endpoint/取参与动作校验', () => {
  it('缺房源 ID → 400', async () => {
    const { req, update } = makeReq({ routeParams: {} })
    const { status, body } = await run(req)
    expect(status).toBe(400)
    expect(body.error).toContain('房源 ID')
    expect(update).not.toHaveBeenCalled()
  })

  it('非法 action → 400', async () => {
    const { req, update } = makeReq({ body: { action: 'garbage' } })
    const { status } = await run(req)
    expect(status).toBe(400)
    expect(update).not.toHaveBeenCalled()
  })

  it('房源不存在 → 404', async () => {
    const { req, update } = makeReq({ findByIDThrows: true })
    const { status } = await run(req)
    expect(status).toBe(404)
    expect(update).not.toHaveBeenCalled()
  })
})

describe('listing-publish-endpoint/发布前置校验', () => {
  it('审核未通过不能发布 → 422，且不改状态', async () => {
    const { req, update } = makeReq({
      listing: makeEffectiveListing({ reviewStatus: 'pending' }),
      body: { action: 'publish' },
    })
    const { status, body } = await run(req)
    expect(status).toBe(422)
    expect(body.ok).toBe(false)
    expect(update).not.toHaveBeenCalled()
  })

  // 2026-08-19 反转：图片数量不再是发布前置条件（前台可见性不再看它，
  // 见 effective-supply.ts 头部）。无图房源可以发布，前台走缺省图降级。
  it('无图也能发布 → 200，且真的写了发布轴', async () => {
    const { req, update } = makeReq({
      listing: makeEffectiveListing({ gallery: [] }),
      body: { action: 'publish' },
    })
    const { status, body } = await run(req)
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(update).toHaveBeenCalled()
  })

  it('无生效商户关系不能发布 → 422', async () => {
    const { req, update } = makeReq({
      body: { action: 'publish' },
      relationDocs: [],
    })
    const { status, body } = await run(req)
    expect(status).toBe(422)
    expect(body.reasons).toContain('RELATION_NOT_EFFECTIVE')
    expect(update).not.toHaveBeenCalled()
  })

  it('非法发布转移（leased 再 publish）→ 409', async () => {
    const { req, update } = makeReq({
      listing: makeEffectiveListing({ publicationStatus: 'leased' }),
      body: { action: 'publish' },
    })
    const { status } = await run(req)
    expect(status).toBe(409)
    expect(update).not.toHaveBeenCalled()
  })
})

describe('listing-publish-endpoint/下架', () => {
  it('下架未填原因 → 422', async () => {
    const { req, update } = makeReq({
      listing: makeEffectiveListing({ publicationStatus: 'published' }),
      body: { action: 'unpublish' },
    })
    const { status } = await run(req)
    expect(status).toBe(422)
    expect(update).not.toHaveBeenCalled()
  })

  it('下架填原因 → 200，publicationStatus=unpublished', async () => {
    const { req, update } = makeReq({
      listing: makeEffectiveListing({ publicationStatus: 'published' }),
      body: { action: 'unpublish', reason: '房东临时撤单' },
    })
    const { status, body } = await run(req)
    expect(status).toBe(200)
    expect(body.publicationStatus).toBe('unpublished')
    const arg = update.mock.calls[0][0]
    expect(arg.collection).toBe('listings')
    expect(arg.data.publicationStatus).toBe('unpublished')
    // 不触碰审核轴
    expect(arg.data.reviewStatus).toBeUndefined()
  })
})

describe('listing-publish-endpoint/发布成功', () => {
  it('有效供给齐全 → 200，publicationStatus=published，不改审核轴', async () => {
    const { req, update } = makeReq({ body: { action: 'publish' } })
    const { status, body } = await run(req)
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.publicationStatus).toBe('published')
    const arg = update.mock.calls[0][0]
    expect(arg.collection).toBe('listings')
    expect(arg.id).toBe('1')
    expect(arg.data.publicationStatus).toBe('published')
    expect(arg.data.reviewStatus).toBeUndefined()
    expect(arg.req).toBeDefined()
  })
})

describe('listing-publish-endpoint/标记成交副作用', () => {
  it('mark_leased → 200，publicationStatus=leased 且 isFeatured=false', async () => {
    const { req, update } = makeReq({
      listing: makeEffectiveListing({ publicationStatus: 'published', isFeatured: true }),
      body: { action: 'mark_leased' },
    })
    const { status, body } = await run(req)
    expect(status).toBe(200)
    expect(body.publicationStatus).toBe('leased')
    const arg = update.mock.calls[0][0]
    expect(arg.data.publicationStatus).toBe('leased')
    expect(arg.data.isFeatured).toBe(false)
  })
})

describe('listing-publish-endpoint/版本乐观锁', () => {
  it('expectedVersion 与当前不符 → 409，update 不触发', async () => {
    const { req, update } = makeReq({
      listing: makeEffectiveListing({ version: 3 }),
      body: { action: 'publish', expectedVersion: 2 },
    })
    const { status } = await run(req)
    expect(status).toBe(409)
    expect(update).not.toHaveBeenCalled()
  })

  it('expectedVersion 相符 → 放行', async () => {
    const { req, update } = makeReq({
      listing: makeEffectiveListing({ version: 3 }),
      body: { action: 'publish', expectedVersion: 3 },
    })
    const { status } = await run(req)
    expect(status).toBe(200)
    expect(update).toHaveBeenCalledTimes(1)
  })
})
