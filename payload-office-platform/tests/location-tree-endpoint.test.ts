import { describe, expect, it, vi } from 'vitest'
import type { PayloadRequest } from 'payload'

import { createLocationTreeEndpoint } from '../src/endpoints/location-tree-endpoint'
import type { User } from '../src/payload-types'

/**
 * OPT-074 级联选择数据源：GET /api/locations/tree 业务不变量
 *
 *   - 只返回行政链三型（city / district / business_area），不含地铁链
 *     （地铁链生产 1302 节点，得按需分层，不走这条路）
 *   - **不过滤 status**：组件要靠它把已停用的历史值回显出来并标注，
 *     过滤掉就成空白了
 *   - **不过滤 frontendVisible**：生产行政区 65/74、商圈 279/294 都是 false，
 *     它是前台展示开关，不是后台可用性开关
 *   - 查询走 overrideAccess:false（随当前用户数据权限，与 location-search 同口径）
 *   - 未登录 401；已登录但无地理菜单权限 403
 */

function makeUser(): User {
  return {
    id: 1,
    name: 'test-admin',
    email: 'admin@example.com',
    status: 'active',
    sessionVersion: 1,
    roles: [9],
    updatedAt: '',
    createdAt: '',
    collection: 'users',
  } as unknown as User
}

function makeRole(menuPermissions: string[]) {
  return { id: 9, code: 'OPS', status: 'active', menuPermissions, dataScope: 'global' }
}

/** depth:0 下 Payload 返回的 locations 文档形状（关系字段是裸 id） */
const LOCATION_DOCS = [
  { id: 1, name: '上海', type: 'city', parent: null, immutableCode: 'SH', status: 'active', sortOrder: 1, frontendVisible: true },
  { id: 2, name: '长宁区', type: 'district', parent: 1, immutableCode: 'SH-CHANGNING', status: 'active', sortOrder: 2, frontendVisible: false },
  { id: 3, name: '虹桥', type: 'business_area', parent: 2, immutableCode: 'SH-CHANGNING-HONGQIAO', status: 'active', sortOrder: 3, frontendVisible: false },
  { id: 8, name: '静安寺', type: 'business_area', parent: 2, immutableCode: 'SH-CHANGNING-JINGANSI', status: 'disabled', sortOrder: 4, frontendVisible: false },
]

function makePayloadFindByCollection(locationDocs: unknown[], roleDocs: unknown[]) {
  const locationCalls: Array<Record<string, unknown>> = []
  const find = vi.fn(async (args: { collection?: string }) => {
    if (args?.collection === 'roles') {
      return { docs: roleDocs, totalDocs: roleDocs.length, totalPages: 1, page: 1 }
    }
    locationCalls.push(args as Record<string, unknown>)
    return { docs: locationDocs, totalDocs: locationDocs.length, totalPages: 1, page: 1 }
  })
  return { find, locationCalls }
}

function makeReq(
  findDocs: unknown[] = LOCATION_DOCS,
  user: User | null = makeUser(),
  roleDocs: unknown[] = [makeRole(['locations', 'business-areas'])],
): PayloadRequest & { __locationCalls: Array<Record<string, unknown>> } {
  const { find, locationCalls } = makePayloadFindByCollection(findDocs, roleDocs)
  return {
    query: {},
    user,
    payload: { find },
    __locationCalls: locationCalls,
    headers: {},
    method: 'GET',
    url: '/api/locations/tree',
  } as unknown as PayloadRequest & { __locationCalls: Array<Record<string, unknown>> }
}

const call = (req: PayloadRequest) =>
  createLocationTreeEndpoint().handler(req) as Promise<Response>

describe('GET /api/locations/tree', () => {
  it('端点挂在 locations collection 上，路径是去 slug 前缀的 /tree', () => {
    const endpoint = createLocationTreeEndpoint()
    expect(endpoint.path).toBe('/tree')
    expect(endpoint.method).toBe('get')
  })

  it('未登录 → 401', async () => {
    const res = await call(makeReq(LOCATION_DOCS, null))
    expect(res.status).toBe(401)
  })

  it('已登录但无地理菜单权限 → 403', async () => {
    const res = await call(makeReq(LOCATION_DOCS, makeUser(), [makeRole(['listings'])]))
    expect(res.status).toBe(403)
  })

  it('有权限 → 200，返回摊平的行政链节点', async () => {
    const res = await call(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.nodes.map((n: { id: number }) => n.id)).toEqual([1, 2, 3, 8])
  })

  it('关系字段映射成 parentId，城市的 parentId 为 null', async () => {
    const body = await (await call(makeReq())).json()
    expect(body.nodes.find((n: { id: number }) => n.id === 1).parentId).toBeNull()
    expect(body.nodes.find((n: { id: number }) => n.id === 3).parentId).toBe(2)
  })

  it('★ 返回体含 status 且不过滤停用节点 —— 组件要靠它回显历史值', async () => {
    const body = await (await call(makeReq())).json()
    const disabled = body.nodes.find((n: { id: number }) => n.id === 8)
    expect(disabled.status).toBe('disabled')
  })

  it('★ 不按 frontendVisible 过滤 —— 生产 279/294 商圈都是 false', async () => {
    const body = await (await call(makeReq())).json()
    expect(body.nodes.filter((n: { frontendVisible: boolean }) => !n.frontendVisible)).toHaveLength(3)
  })

  it('查询条件只要行政链三型，不含地铁节点', async () => {
    const req = makeReq()
    await call(req)
    expect(req.__locationCalls).toHaveLength(1)
    expect(req.__locationCalls[0].where).toEqual({
      type: { in: ['city', 'district', 'business_area'] },
    })
  })

  it('查询走 overrideAccess:false，继承当前用户数据权限', async () => {
    const req = makeReq()
    await call(req)
    expect(req.__locationCalls[0].overrideAccess).toBe(false)
  })

  it('缺字段的脏数据不炸：name/immutableCode 兜底空串，sortOrder 兜底 0', async () => {
    const req = makeReq([{ id: 5, type: 'district', parent: 1, status: 'active' }])
    const body = await (await call(req)).json()
    expect(body.nodes[0]).toMatchObject({
      id: 5,
      name: '',
      immutableCode: '',
      sortOrder: 0,
      frontendVisible: false,
      status: 'active',
    })
  })
})
