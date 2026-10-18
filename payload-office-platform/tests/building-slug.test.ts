import type { PayloadRequest, SanitizedCollectionConfig } from 'payload'
import { describe, expect, it, vi } from 'vitest'

import { Buildings } from '@/collections/Buildings'
import type { Building } from '@/payload-types'

type SlugQuery = {
  collection: string
  where: { slug: { equals: string }; id?: { not_equals: string | number } }
  overrideAccess?: boolean
  trash?: boolean
  req?: PayloadRequest
}

function makeReq(occupied: readonly string[] = []) {
  // 仅替代数据库边界，真实执行集合的 beforeValidate 链与 shared/slug 工具。
  const find = vi.fn(async ({ where }: SlugQuery) => ({
    totalDocs: occupied.includes(where.slug.equals) ? 1 : 0,
    docs: [],
  }))
  const req = { payload: { find }, transactionID: 'building-slug-test' } as unknown as PayloadRequest
  return { req, find }
}

async function validate(
  data: Partial<Building> | undefined,
  options: { originalDoc?: Partial<Building>; occupied?: readonly string[] } = {},
) {
  const { req, find } = makeReq(options.occupied)
  let result = data
  for (const hook of Buildings.hooks?.beforeValidate ?? []) {
    result = await hook({
      collection: Buildings as SanitizedCollectionConfig,
      context: {},
      data: result,
      operation: options.originalDoc ? 'update' : 'create',
      originalDoc: options.originalDoc,
      req,
    })
  }
  return { data: result, req, find }
}

describe('building-slug/保存前补全 URL 标识', () => {
  it('新建未提供标识时在 beforeValidate 按名称生成拼音', async () => {
    const { data } = await validate({ name: '创科大厦' })
    expect(data?.slug).toBe('chuang-ke-da-sha')
  })

  it.each([
    { occupied: ['chuang-ke-da-sha'], expected: 'chuang-ke-da-sha-2' },
    { occupied: ['chuang-ke-da-sha', 'chuang-ke-da-sha-2'], expected: 'chuang-ke-da-sha-3' },
  ])('冲突 $occupied 时生成 $expected', async ({ occupied, expected }) => {
    const { data } = await validate({ name: '创科大厦' }, { occupied })
    expect(data?.slug).toBe(expected)
  })

  it.each(['draft', 'published', 'archived'] as const)('去重不受 %s 发布状态限制', async (status) => {
    const { data, find, req } = await validate(
      { name: '创科大厦', status },
      { occupied: ['chuang-ke-da-sha'] },
    )
    expect(data?.slug).toBe('chuang-ke-da-sha-2')
    expect(find.mock.calls[0]?.[0]).toMatchObject({
      collection: 'buildings',
      where: { slug: { equals: 'chuang-ke-da-sha' } },
      overrideAccess: true,
      trash: true,
      req,
    })
    expect(find.mock.calls[0]?.[0].req).toBe(req)
    expect(find.mock.calls[0]?.[0].where).not.toHaveProperty('status')
  })

  it('回收站中占用的标识同样避让', async () => {
    const { req, find } = makeReq()
    find.mockImplementation(async (query) => ({
      // 模拟数据库只有 trash:true 才返回的软删除记录。
      totalDocs: query.trash && query.where.slug.equals === 'hui-shou-zhan' ? 1 : 0,
      docs: [],
    }))
    let data: Partial<Building> = { name: '回收站' }
    for (const hook of Buildings.hooks?.beforeValidate ?? []) {
      data = await hook({
        collection: Buildings as SanitizedCollectionConfig,
        context: {},
        data,
        operation: 'create',
        req,
      })
    }
    expect(data.slug).toBe('hui-shou-zhan-2')
  })

  it.each([{}, { name: '改名后的楼盘' }, { slug: '' }, { slug: '   ' }])(
    '部分更新 %j 保留已存标识',
    async (patch) => {
      const { data, find } = await validate(patch, {
        originalDoc: { id: 42, name: '原名称', slug: 'original-url' },
      })
      expect(data?.slug).toBe('original-url')
      expect(find).not.toHaveBeenCalled()
    },
  )

  it.each([undefined, { id: 42, slug: 'original-url' }])(
    '显式自定义标识保持 API 输入值：原文档 %j',
    async (originalDoc) => {
      const { data, find } = await validate(
        { name: '创科大厦', slug: 'my-custom-url' },
        { originalDoc },
      )
      expect(data?.slug).toBe('my-custom-url')
      expect(find).not.toHaveBeenCalled()
    },
  )

  it.each(['###', '🏢🏢'])('仅符号名称 %s 使用 building 基名并去重', async (name) => {
    const { data } = await validate({ name }, { occupied: ['building'] })
    expect(data?.slug).toBe('building-2')
  })

  it('旧记录缺少标识时可用原名称补齐并排除自身', async () => {
    const { data, find } = await validate(
      { status: 'draft' },
      { originalDoc: { id: 42, name: '创科大厦' } },
    )
    expect(data?.slug).toBe('chuang-ke-da-sha')
    expect(find.mock.calls[0]?.[0].where.id).toEqual({ not_equals: 42 })
  })

  it.each([undefined, {}, { name: '' }])('缺少名称的数据 %j 留给 required 校验', async (input) => {
    const { data, find } = await validate(input)
    expect(data).toEqual(input ? { ...input, grade: 'ungraded' } : input)
    expect(find).not.toHaveBeenCalled()
  })
})
