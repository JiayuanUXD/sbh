import { describe, expect, it, vi } from 'vitest'
import type { PayloadRequest } from 'payload'

import { createDictionariesEndpoint } from '../src/endpoints/dictionaries-endpoint'
import { listEnumDictionaries, getEnumDictionary } from '../src/domain/dictionary/enum-registry'
import type { Role, User } from '../src/payload-types'

/**
 * M2.6 字典发布基线 endpoint 测试（R2）
 *
 * 业务不变量：
 *   - GET /api/dictionaries 返回全部只读枚举字典
 *   - GET /api/dictionaries?code=merchant.type 返回单个字典详情
 *   - 未登录返回 401
 *   - 不存在的 code 返回 404
 *   - includeDisplayTags=true 时附带可见展示标签
 */

function makeUser(): User {
  return {
    id: 1,
    name: 'test-user',
    email: 'test@example.com',
    status: 'active',
    sessionVersion: 1,
    updatedAt: '',
    createdAt: '',
    collection: 'users',
  } as unknown as User
}

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
  } as unknown as Role
}

/** 构造 mock req：携带 user / payload.find（用于角色加载与 display-tags 查询） */
function makeReq(query: Record<string, unknown> = {}, user: User | null = null): PayloadRequest {
  const findFn = vi.fn(async (params: { collection: string }) => {
    if (params.collection === 'roles') {
      return { docs: user ? [makeRole()] : [] }
    }
    if (params.collection === 'display-tags') {
      return {
        docs: [
          { code: 'tag_a', name: '标签 A', sortOrder: 1 },
          { code: 'tag_b', name: '标签 B', sortOrder: 2 },
        ],
        totalDocs: 2,
        totalPages: 1,
        page: 1,
      }
    }
    return { docs: [], totalDocs: 0, totalPages: 1, page: 1 }
  })
  return {
    query,
    user,
    payload: { find: findFn },
    headers: {},
    method: 'GET',
    url: '/api/dictionaries',
  } as unknown as PayloadRequest
}

async function callEndpoint(req: PayloadRequest) {
  const endpoint = createDictionariesEndpoint()
  return endpoint.handler(req as never) as Response
}

describe('createDictionariesEndpoint', () => {
  it('未登录返回 401', async () => {
    const req = makeReq({}, null)
    const res = await callEndpoint(req)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  it('已登录列出全部只读枚举字典', async () => {
    const req = makeReq({}, makeUser())
    const res = await callEndpoint(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(Array.isArray(body.dictionaries)).toBe(true)
    // 至少包含商户类型字典
    const merchantTypeDict = body.dictionaries.find(
      (d: { code: string }) => d.code === 'merchant.type',
    )
    expect(merchantTypeDict).toBeDefined()
    expect(merchantTypeDict.readonly).toBe(true)
    expect(merchantTypeDict.entries.length).toBeGreaterThan(0)
  })

  it('?code=merchant.type 返回单个字典', async () => {
    const req = makeReq({ code: 'merchant.type' }, makeUser())
    const res = await callEndpoint(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.dictionary).toBeDefined()
    expect(body.dictionary.code).toBe('merchant.type')
    expect(body.dictionary.entries.length).toBeGreaterThan(0)
  })

  it('不存在的 code 返回 404', async () => {
    const req = makeReq({ code: 'not.exist' }, makeUser())
    const res = await callEndpoint(req)
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toContain('not.exist')
  })

  it('includeDisplayTags=true 时附带可见展示标签', async () => {
    const req = makeReq({ includeDisplayTags: 'true' }, makeUser())
    const res = await callEndpoint(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(Array.isArray(body.dictionaries)).toBe(true)
    expect(Array.isArray(body.displayTags)).toBe(true)
    expect(body.displayTags).toHaveLength(2)
    expect(body.displayTags[0]).toEqual({ code: 'tag_a', label: '标签 A', sortOrder: 1 })
  })

  it('includeDisplayTags 缺省时 displayTags=null', async () => {
    const req = makeReq({}, makeUser())
    const res = await callEndpoint(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.displayTags).toBeNull()
  })
})

describe('enum-registry 与 endpoint 一致性', () => {
  it('listEnumDictionaries 返回的所有 code 都能 getEnumDictionary 命中', () => {
    const list = listEnumDictionaries()
    for (const d of list) {
      const got = getEnumDictionary(d.code)
      expect(got).toBeDefined()
      expect(got?.code).toBe(d.code)
    }
  })

  it('每个字典 entries 长度与真源数组一致（防漏更新）', () => {
    const list = listEnumDictionaries()
    for (const d of list) {
      expect(d.entries.length).toBeGreaterThan(0)
      // 所有 entry 必须有 value + label
      for (const e of d.entries) {
        expect(typeof e.value).toBe('string')
        expect(typeof e.label).toBe('string')
        expect(e.label.length).toBeGreaterThan(0)
      }
    }
  })
})
