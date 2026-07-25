import { describe, expect, it, vi } from 'vitest'
import type { PayloadRequest } from 'payload'

import { createBuildingDedupCheckEndpoint } from '@/endpoints/building-dedup-check-endpoint'
import type { User } from '@/payload-types'

/**
 * 楼盘查重 endpoint 的 HTTP 装配层测试（M3.2）
 *
 * 重点：query 取参（name/cityId/latitude/longitude/excludeId 均为字符串）
 * 正确解析为领域输入,并透传给 findBuildingDuplicates 的 payload.find where。
 * 未登录 → 401。查重不阻断保存,仅返回候选报告。
 */

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

function makeReq(params: {
  user?: User | null
  query?: Record<string, unknown>
  candidates?: Array<Record<string, unknown>>
}): { req: PayloadRequest; find: ReturnType<typeof vi.fn> } {
  const { user = makeUser(), query = {}, candidates = [] } = params
  const find = vi.fn(async () => ({ docs: candidates }))
  const req = {
    user: user ?? null,
    query,
    payload: { find },
  }
  return { req: req as unknown as PayloadRequest, find }
}

async function run(req: PayloadRequest): Promise<{ status: number; body: any }> {
  const endpoint = createBuildingDedupCheckEndpoint()
  const res = (await endpoint.handler!(req)) as Response
  const body = await res.json()
  return { status: res.status, body }
}

describe('building-dedup-check-endpoint/auth', () => {
  it('未登录 → 401', async () => {
    const { req } = makeReq({ user: null })
    const { status, body } = await run(req)
    expect(status).toBe(401)
    expect(body.ok).toBe(false)
  })
})

describe('building-dedup-check-endpoint/query 取参', () => {
  it('数字型 cityId 字符串解析为数字并进入同城 where', async () => {
    const { req, find } = makeReq({
      query: { name: '环球金融中心', cityId: '100', latitude: '31.2', longitude: '121.5' },
    })
    const { status, body } = await run(req)

    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    // findBuildingDuplicates 用 cityId 建同城 where
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'buildings',
        where: expect.objectContaining({ city: { equals: 100 } }),
      }),
    )
  })

  it('excludeId 进入 id.not_equals（编辑时排除自身）', async () => {
    const { req, find } = makeReq({
      query: { name: 'A', cityId: '5', excludeId: '42' },
    })
    await run(req)
    const call = find.mock.calls[0][0] as { where: Record<string, unknown> }
    expect(call.where.id).toEqual({ not_equals: 42 })
  })

  it('缺 cityId → 不查询直接空报告（同城是前提）', async () => {
    const { req, find } = makeReq({ query: { name: 'A' } })
    const { status, body } = await run(req)
    expect(status).toBe(200)
    expect(body.report.total).toBe(0)
    expect(body.report.hasDuplicate).toBe(false)
    expect(find).not.toHaveBeenCalled()
  })

  it('同城归一化同名候选被标记为重复', async () => {
    const { req } = makeReq({
      query: { name: '环球 金融中心', cityId: '100' },
      candidates: [
        {
          id: 7,
          name: '环球金融中心',
          slug: 'hqjrzx',
          city: 100,
          district: 3,
          address: '世纪大道100号',
          operationalStatus: 'operational',
          latitude: null,
          longitude: null,
        },
      ],
    })
    const { status, body } = await run(req)
    expect(status).toBe(200)
    expect(body.report.hasDuplicate).toBe(true)
    expect(body.report.total).toBe(1)
    expect(body.report.candidates[0].id).toBe(7)
    expect(body.report.candidates[0].reasons).toContain('SAME_NAME')
  })
})
