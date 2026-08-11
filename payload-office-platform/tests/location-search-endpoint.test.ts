import { describe, expect, it, vi } from 'vitest'
import type { PayloadRequest } from 'payload'

import { searchLocations, locationSearchTarget } from '../src/domain/geography/location-search'
import { createLocationSearchEndpoint } from '../src/endpoints/location-search-endpoint'
import type { User } from '../src/payload-types'

/**
 * Task 13 全局搜索：GET /api/locations/search 业务不变量
 *
 *   - 命中：按 name / immutableCode 模糊匹配，返回 { id, name, type, cityId, cityName, parentName }
 *   - 空串 / 短词（trim 后 <2）：直接空数组，不打库
 *   - 跨城同名：结果带 cityId/cityName 可区分
 *   - 未登录：401
 *   - 查询走 overrideAccess:false（随当前用户数据权限）
 */

function makeUser(): User {
  return {
    id: 1,
    name: 'test-admin',
    email: 'admin@example.com',
    status: 'active',
    sessionVersion: 1,
    updatedAt: '',
    createdAt: '',
    collection: 'users',
  } as unknown as User
}

/** 构造 mock req：find 按 collection 返回预设 docs */
function makePayloadFind(docs: unknown[]) {
  return vi.fn(async () => ({ docs, totalDocs: docs.length, totalPages: 1, page: 1 }))
}

function makeReq(query: Record<string, unknown> = {}, findDocs: unknown[] = [], user: User | null = makeUser()): PayloadRequest {
  return {
    query,
    user,
    payload: { find: makePayloadFind(findDocs) },
    headers: {},
    method: 'GET',
    url: '/api/locations/search',
  } as unknown as PayloadRequest
}

async function callEndpoint(req: PayloadRequest): Promise<{ status: number; body: any; findCalls: unknown[][] }> {
  const endpoint = createLocationSearchEndpoint()
  const res = (await endpoint.handler(req as never)) as Response
  const body = await res.json()
  const findCalls = (req.payload as unknown as { find: { mock: { calls: unknown[][] } } }).find.mock.calls
  return { status: res.status, body, findCalls }
}

describe('searchLocations（纯函数）', () => {
  it('命中：按 name / immutableCode 模糊匹配并整形结果', async () => {
    const payload = {
      find: makePayloadFind([
        { id: 1005, name: '龙翔桥站', type: 'metro_station', immutableCode: 'HZ-L1-LXQ', city: { id: 1001, name: '杭州' }, parent: { id: 1004, name: '1号线' } },
      ]),
    }
    const results = await searchLocations(payload as never, '龙翔', 20)
    expect(results).toEqual([
      { id: 1005, name: '龙翔桥站', immutableCode: 'HZ-L1-LXQ', type: 'metro_station', cityId: 1001, cityName: '杭州', parentName: '1号线' },
    ])
  })

  it('空串 / 短词（trim 后 <2）直接返回空数组，不打库', async () => {
    const payload = { find: makePayloadFind([]) }
    await expect(searchLocations(payload as never, '', 20)).resolves.toEqual([])
    await expect(searchLocations(payload as never, '   ', 20)).resolves.toEqual([])
    await expect(searchLocations(payload as never, '杭', 20)).resolves.toEqual([])
    expect((payload.find as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(0)
  })

  it('城市节点：cityId/cityName 取自身', async () => {
    const payload = { find: makePayloadFind([{ id: 1001, name: '杭州', immutableCode: 'HZ', type: 'city', city: null, parent: null }]) }
    const results = await searchLocations(payload as never, '杭州', 20)
    expect(results).toEqual([{ id: 1001, name: '杭州', immutableCode: 'HZ', type: 'city', cityId: 1001, cityName: '杭州', parentName: '' }])
  })

  it('跨城同名：cityId/cityName 可区分两城同名节点', async () => {
    const payload = {
      find: makePayloadFind([
        { id: 10, name: '人民广场', type: 'metro_station', city: { id: 1001, name: '杭州' }, parent: { id: 1004, name: '1号线' } },
        { id: 20, name: '人民广场', type: 'metro_station', city: { id: 2001, name: '苏州' }, parent: { id: 2004, name: '2号线' } },
      ]),
    }
    const results = await searchLocations(payload as never, '人民广场', 20)
    expect(results).toHaveLength(2)
    expect(new Set(results.map((r) => r.cityId)).size).toBe(2)
    expect(results.map((r) => r.cityName)).toEqual(['杭州', '苏州'])
  })

  it('查询走 overrideAccess:false（随当前用户数据权限）', async () => {
    const payload = { find: makePayloadFind([]) }
    await searchLocations(payload as never, '杭州', 20)
    const arg = (payload.find as unknown as { mock: { calls: [{ overrideAccess: boolean; collection: string }][] } }).mock.calls[0][0]
    expect(arg.overrideAccess).toBe(false)
    expect(arg.collection).toBe('locations')
  })

  it('limit 透传给 find', async () => {
    const payload = { find: makePayloadFind([]) }
    await searchLocations(payload as never, '杭州', 5)
    const arg = (payload.find as unknown as { mock: { calls: [{ limit: number }][] } }).mock.calls[0][0]
    expect(arg.limit).toBe(5)
  })
})

describe('locationSearchTarget（结果 → 后台编辑入口）', () => {
  it('城市 → 城市详情页', () => {
    expect(locationSearchTarget({ id: 1001, type: 'city', immutableCode: 'HZ' } as never)).toBe(
      '/admin/geography/cities/1001',
    )
  })

  it('行政区/商圈/地铁线路 → 对应模块列表并用区域代码定位', () => {
    expect(locationSearchTarget({ id: 1, type: 'district', immutableCode: 'HZ-XC' } as never)).toBe(
      '/admin/geography/districts?q=HZ-XC',
    )
    expect(locationSearchTarget({ id: 2, type: 'business_area', immutableCode: 'HZ-QJ' } as never)).toBe(
      '/admin/geography/business-areas?q=HZ-QJ',
    )
    expect(locationSearchTarget({ id: 3, type: 'metro_line', immutableCode: 'HZ-L1' } as never)).toBe(
      '/admin/geography/metro-lines?q=HZ-L1',
    )
  })

  it('地铁站 → Payload 原生编辑页', () => {
    expect(locationSearchTarget({ id: 5, type: 'metro_station', immutableCode: 'HZ-L1-LXQ' } as never)).toBe(
      '/admin/collections/locations/5',
    )
  })
})

describe('createLocationSearchEndpoint（HTTP 包装）', () => {
  it('未登录返回 401', async () => {
    const req = makeReq({ q: '龙翔' }, [], null)
    const r = await callEndpoint(req)
    expect(r.status).toBe(401)
    expect(r.body.ok).toBe(false)
    expect(r.findCalls).toHaveLength(0)
  })

  it('已登录命中返回 { ok:true, results }', async () => {
    const req = makeReq(
      { q: '龙翔' },
      [{ id: 1005, name: '龙翔桥站', type: 'metro_station', city: { id: 1001, name: '杭州' }, parent: { id: 1004, name: '1号线' } }],
    )
    const r = await callEndpoint(req)
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)
    expect(r.body.results).toHaveLength(1)
    expect(r.body.results[0].cityName).toBe('杭州')
  })

  it('短词不打库：find 不被调用', async () => {
    const req = makeReq({ q: '杭' })
    const r = await callEndpoint(req)
    expect(r.status).toBe(200)
    expect(r.body.results).toEqual([])
    expect(r.findCalls).toHaveLength(0)
  })

  it('limit 上限收敛到 50', async () => {
    const req = makeReq({ q: '龙翔', limit: '999' }, [])
    const r = await callEndpoint(req)
    expect(r.status).toBe(200)
    const arg = (req.payload as unknown as { find: { mock: { calls: [{ limit: number }][] } } }).find.mock.calls[0][0]
    expect(arg.limit).toBe(50)
  })
})