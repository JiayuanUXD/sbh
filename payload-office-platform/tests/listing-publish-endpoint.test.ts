import { describe, expect, it, vi } from 'vitest'
import type { PayloadRequest } from 'payload'

import { createListingPublishEndpoint } from '@/endpoints/listing-publish-endpoint'
import type { Role, User } from '@/payload-types'

/**
 * 房源显式发布 endpoint 的 HTTP 装配层测试（M4.6 / R4, R8）
 *
 * POST /api/listings/:id/publish  body { action, reason?, expectedVersion? }
 *   action ∈ publish | unpublish | mark_leased | mark_sold
 *
 * 覆盖的不变量：
 *  - 权限：publish/mark_leased/mark_sold 要 listing:publish；unpublish 要 listing:unpublish。
 *  - 发布前置：reviewStatus 必须 approved 且有效供给谓词通过，否则拒绝（不改状态）。
 *  - 下架必填原因。
 *  - mark_leased / mark_sold 副作用：publicationStatus 落成交终态 + isFeatured=false（撤销推荐+收回可见）。
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
  } = params

  // OPT-034 起有效供给精筛直接读 listing.merchant（findByID 已 depth:2 展开），
  // 不再查 listing-merchant-relations——find 只应被角色加载（collection: 'roles'）调用。
  const find = vi.fn(async (args: { collection?: string }) => {
    if (args?.collection && args.collection !== 'roles') {
      throw new Error(`Unexpected collection: ${args.collection}`)
    }
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

/**
 * 取本次请求写进 audit-logs 的那一条 create 载荷。
 *
 * 审计走的是真实的 withAudit → writeAuditSuccess → payload.create（没有 mock 中间层），
 * 所以这里直接从 create mock 里挑 collection === 'audit-logs' 的调用——换句话说，
 * 断言的是「真的会落库的那份 data」，而不是某个被 stub 掉的中间参数。
 */
function auditCreateData(create: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const call = create.mock.calls.find(
    (args: unknown[]) => (args[0] as { collection?: string })?.collection === 'audit-logs',
  )
  expect(call, '高风险动作必须写一条审计').toBeDefined()
  return (call![0] as { data: Record<string, unknown> }).data
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

  it('未设置供给商户不能发布 → 422', async () => {
    const { req, update } = makeReq({
      listing: makeEffectiveListing({ merchant: null }),
      body: { action: 'publish' },
    })
    const { status, body } = await run(req)
    expect(status).toBe(422)
    expect(body.reasons).toContain('NO_SUPPLY_MERCHANT')
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

  // 弹层正文与输入框 placeholder 都写着「会记入审计」。原因只做非空校验、写完就丢的话，
  // 这句承诺就是假的：事后没人能回答「这套房源当初为什么被下架」。
  it('下架原因落进审计（首尾空格 trim 后写入 audit_logs.reason）', async () => {
    const { req, create } = makeReq({
      listing: makeEffectiveListing({ publicationStatus: 'published' }),
      body: { action: 'unpublish', reason: '  房东撤单  ' },
    })
    const { status } = await run(req)
    expect(status).toBe(200)
    const audit = auditCreateData(create)
    expect(audit.action).toBe('listing.unpublish')
    expect(audit.result).toBe('success')
    expect(audit.reason).toBe('房东撤单')
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

  // 不收原因的动作必须显式落 null，而不是把上一次请求的原因带过来或干脆缺字段：
  // 审计列里「空」和「没这个字段」在排查时是两件事。
  it('publish 不收原因，审计里 reason 为 null', async () => {
    const { req, create } = makeReq({ body: { action: 'publish' } })
    const { status } = await run(req)
    expect(status).toBe(200)
    const audit = auditCreateData(create)
    expect(audit.action).toBe('listing.publish')
    expect(audit.reason).toBeNull()
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

  it('mark_sold：与 mark_leased 对称，publicationStatus=sold 且 isFeatured=false', async () => {
    const { req, update } = makeReq({
      listing: makeEffectiveListing({ publicationStatus: 'published', businessType: 'sale', isFeatured: true }),
      body: { action: 'mark_sold' },
    })
    const res = await run(req)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, publicationStatus: 'sold' })
    expect(update).toHaveBeenCalledTimes(1)
    expect(update.mock.calls[0][0].data).toEqual({ publicationStatus: 'sold', isFeatured: false })
  })
})

/**
 * 租售守卫：动作条只按「已保存的 businessType」显隐成交按钮，但直调 API 绕得过界面。
 * leased 与 sold 都是终态，一旦写反就没有任何动作能改回来（状态机不给终态出边），
 * 所以端点必须自己再挡一次——这是本 endpoint 唯一一处新增拒绝。
 */
describe('listing-publish-endpoint/租售错标守卫', () => {
  it('mark_leased 拒绝出售房源：422 BUSINESS_TYPE_MISMATCH，不 update', async () => {
    const { req, update } = makeReq({
      listing: makeEffectiveListing({ publicationStatus: 'published', businessType: 'sale' }),
      body: { action: 'mark_leased' },
    })
    const res = await run(req)
    expect(res.status).toBe(422)
    expect(res.body.code).toBe('BUSINESS_TYPE_MISMATCH')
    expect(update).not.toHaveBeenCalled()
  })

  it('mark_sold 拒绝租赁房源：422 BUSINESS_TYPE_MISMATCH，不 update', async () => {
    const { req, update } = makeReq({
      listing: makeEffectiveListing({ publicationStatus: 'published', businessType: 'lease' }),
      body: { action: 'mark_sold' },
    })
    const res = await run(req)
    expect(res.status).toBe(422)
    expect(res.body.code).toBe('BUSINESS_TYPE_MISMATCH')
    expect(update).not.toHaveBeenCalled()
  })

  // 缺省（历史数据没有 businessType）按租赁处理，与动作条的缺省口径一致：
  // 缺省放行的是可发生的那一侧（mark_leased），拒绝的是不可解释的那一侧（mark_sold）。
  it('businessType 缺省时按租赁处理：mark_leased 放行、mark_sold 被拒', async () => {
    const leased = makeReq({
      listing: makeEffectiveListing({ publicationStatus: 'published' }),
      body: { action: 'mark_leased' },
    })
    expect((await run(leased.req)).status).toBe(200)
    expect(leased.update).toHaveBeenCalledTimes(1)

    const sold = makeReq({
      listing: makeEffectiveListing({ publicationStatus: 'published' }),
      body: { action: 'mark_sold' },
    })
    expect((await run(sold.req)).status).toBe(422)
    expect(sold.update).not.toHaveBeenCalled()
  })

  // 守卫不能吃掉更早的拒绝：终态房源上点 mark_sold 仍应是 409 非法转移，
  // 否则「已租房源」会被回报成「租售类型不对」，把运营指向错误的修法。
  it('非法转移优先于租售守卫：leased 上 mark_sold → 409', async () => {
    const { req, update } = makeReq({
      listing: makeEffectiveListing({ publicationStatus: 'leased', businessType: 'lease' }),
      body: { action: 'mark_sold' },
    })
    const res = await run(req)
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('ILLEGAL_TRANSITION')
    expect(update).not.toHaveBeenCalled()
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
