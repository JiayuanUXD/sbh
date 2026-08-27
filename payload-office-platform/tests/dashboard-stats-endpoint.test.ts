import { describe, expect, it, vi } from 'vitest'
import type { PayloadRequest } from 'payload'

import {
  createDashboardStatsEndpoint,
  createDashboardStatsPayloadPort,
} from '@/endpoints/dashboard-stats-endpoint'
import type { Role, User } from '@/payload-types'

function makeRole(): Role {
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
  } as Role
}

function makeUser(): User {
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
  } as User
}

function makeRequest(user: User | null): {
  req: PayloadRequest
  count: ReturnType<typeof vi.fn>
  find: ReturnType<typeof vi.fn>
  logError: ReturnType<typeof vi.fn>
} {
  const logError = vi.fn()
  const count = vi.fn(async ({ collection }: { collection: string }) => ({
    totalDocs: collection === 'listings' ? 7 : collection === 'buildings' ? 2 : 4,
  }))
  const find = vi.fn(async ({ collection }: { collection: string }) => {
    if (collection === 'roles') return { docs: [makeRole()] }
    if (collection === 'listing-reports') return { docs: [], hasNextPage: false, nextPage: null }
    if (collection === 'listings') return { docs: [], hasNextPage: false, nextPage: null }
    // OPT-034：FIND_COLLECTIONS 已移除 listing-merchant-relations（表已删），
    // 端点不会再以该 collection 调用 find；保留该分支会是永远打不到的死代码。
    throw new Error(`Unexpected collection: ${collection}`)
  })
  const req: Partial<PayloadRequest> = {
    user: user ?? undefined,
    headers: new Headers(),
    method: 'GET',
    url: 'http://localhost/api/dashboard-stats',
  }
  Object.assign(req, { payload: { count, find, logger: { error: logError } } })
  return { req: req as PayloadRequest, count, find, logError }
}

async function run(req: PayloadRequest) {
  const endpoint = createDashboardStatsEndpoint()
  const response = (await endpoint.handler(req)) as Response
  return { endpoint, response, body: await response.json() as Record<string, unknown> }
}

describe('GET /dashboard-stats', () => {
  it('适配器将统计端口参数完整转发给 Payload Local API', async () => {
    const { req, count, find } = makeRequest(makeUser())
    const port = createDashboardStatsPayloadPort(req.payload)

    await port.count({
      collection: 'listings',
      where: { isFeatured: { equals: true } },
      overrideAccess: false,
      req,
    })
    await port.find({
      collection: 'listings',
      where: { publicationStatus: { equals: 'published' } },
      depth: 1,
      limit: 500,
      page: 3,
      pagination: false,
      select: { building: true, merchant: true },
      sort: '-updatedAt',
      overrideAccess: false,
      req,
    })

    expect(count).toHaveBeenCalledWith({
      collection: 'listings',
      where: { isFeatured: { equals: true } },
      overrideAccess: false,
      req,
    })
    expect(find).toHaveBeenCalledWith({
      collection: 'listings',
      where: { publicationStatus: { equals: 'published' } },
      depth: 1,
      limit: 500,
      page: 3,
      pagination: false,
      select: { building: true, merchant: true },
      sort: '-updatedAt',
      overrideAccess: false,
      req,
    })
  })

  it('匿名请求返回 401，且不执行统计查询', async () => {
    const { req, count, find } = makeRequest(null)

    const result = await run(req)

    expect(result.response.status).toBe(401)
    expect(result.body).toEqual({ ok: false, error: '未登录或会话已失效' })
    expect(count).not.toHaveBeenCalled()
    expect(find).not.toHaveBeenCalled()
  })

  it('角色查询异常记录安全日志并返回不含原始错误的通用 500', async () => {
    const sensitiveMessage = 'role database failed: password=do-not-expose'
    const { req, count, find, logError } = makeRequest(makeUser())
    find.mockRejectedValueOnce(new Error(sensitiveMessage))

    const result = await run(req)

    expect(result.response.status).toBe(500)
    expect(result.body).toEqual({ ok: false, error: '运营数据暂时不可用' })
    expect(JSON.stringify(result.body)).not.toContain(sensitiveMessage)
    expect(logError).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(logError.mock.calls)).not.toContain(sensitiveMessage)
    expect(count).not.toHaveBeenCalled()
  })

  it('已登录请求返回 JSON 统计结果', async () => {
    const { req, count, find } = makeRequest(makeUser())

    const result = await run(req)

    expect(result.endpoint.path).toBe('/dashboard-stats')
    expect(result.endpoint.method).toBe('get')
    expect(result.response.status).toBe(200)
    expect(result.body).toEqual({
      ok: true,
      stats: {
        listings: 7,
        availableListings: 0,
        featuredListings: 7,
        listingsWithoutCover: 7,
        buildings: 2,
        leads: 4,
        newLeads: 4,
        activeLeads: 4,
        pendingReviews: 7,
        pendingRecheck: 7,
        openReports: 4,
        pendingSubmissions: 4,
      },
    })
    expect(count).toHaveBeenCalledTimes(11)
    expect(find).toHaveBeenCalled()
  })

  it('60 秒内同一用户命中缓存，不重复执行统计查询', async () => {
    const { req, count } = makeRequest(makeUser())
    const endpoint = createDashboardStatsEndpoint()

    const first = (await endpoint.handler(req)) as Response
    const countCallsAfterFirst = count.mock.calls.length
    const second = (await endpoint.handler(req)) as Response

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(count.mock.calls.length).toBe(countCallsAfterFirst)
    expect(await second.json()).toEqual(await first.json())
  })
})
