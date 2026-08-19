import { describe, expect, it, vi } from 'vitest'

import { Listings } from '@/collections/Listings'
import { cleanupListingRelations } from '@/domain/supply/listing-delete-cleanup'

/**
 * 房源永久删除前清理商户关系（修 "Something went wrong."）。
 *
 * 这些不是「覆盖率」用例，每一条都对应一个会让 bug 复发的具体走法：
 *   1. 不删关系 → PG 23502，后台永久删除恒 500（原 bug）；
 *   2. 漏了 overrideAccess → 关系表的字段级权限会二次拦截，出现「房源删了、关系还在」；
 *   3. hook 没挂上 beforeDelete → 代码写了等于没写；
 *   4. 挂到 beforeChange 之类的地方 → 每次保存都会误删关系。
 */

type DeleteCall = {
  collection: string
  where?: unknown
  overrideAccess?: boolean
  req?: unknown
}

function makeReq() {
  const calls: DeleteCall[] = []
  const req = {
    payload: {
      delete: vi.fn(async (args: DeleteCall) => {
        calls.push(args)
        return { docs: [], errors: [] }
      }),
    },
  }
  return { req, calls }
}

const run = async (id: number | string) => {
  const { req, calls } = makeReq()
  await (cleanupListingRelations as unknown as (a: unknown) => Promise<unknown>)({
    id,
    req,
    collection: {} as never,
    context: {} as never,
  })
  return calls
}

describe('cleanupListingRelations', () => {
  it('按房源 id 删除 listing-merchant-relations', async () => {
    const calls = await run(42)
    expect(calls).toHaveLength(1)
    expect(calls[0].collection).toBe('listing-merchant-relations')
    expect(calls[0].where).toEqual({ listing: { equals: 42 } })
  })

  it('string 型 id 同样按值匹配（Payload 的 id 可能是 string）', async () => {
    const calls = await run('42')
    expect(calls[0].where).toEqual({ listing: { equals: '42' } })
  })

  it('带 overrideAccess——否则关系表字段权限会拦出「房源删了关系还在」', async () => {
    const calls = await run(42)
    expect(calls[0].overrideAccess).toBe(true)
  })

  it('透传 req，保证与本次删除同一请求上下文', async () => {
    const { req, calls } = makeReq()
    await (cleanupListingRelations as unknown as (a: unknown) => Promise<unknown>)({
      id: 7,
      req,
      collection: {} as never,
      context: {} as never,
    })
    expect(calls[0].req).toBe(req)
  })

  it('删除失败必须向上抛，不能吞掉', async () => {
    const req = {
      payload: { delete: vi.fn(async () => { throw new Error('boom') }) },
    }
    await expect(
      (cleanupListingRelations as unknown as (a: unknown) => Promise<unknown>)({
        id: 1, req, collection: {} as never, context: {} as never,
      }),
    ).rejects.toThrow('boom')
    // 吞掉异常会让房源删了一半：关系没清、listings 行仍在，比原 bug 更难查。
  })
})

describe('cleanupListingRelations/接线', () => {
  it('挂在 Listings 的 beforeDelete 上', () => {
    expect(Listings.hooks?.beforeDelete ?? []).toContain(cleanupListingRelations)
  })

  it('不在 beforeChange / afterChange 上——保存房源不该删关系', () => {
    expect(Listings.hooks?.beforeChange ?? []).not.toContain(cleanupListingRelations)
    expect(Listings.hooks?.afterChange ?? []).not.toContain(cleanupListingRelations)
  })
})

describe('审计表引用不再是必填（否则 SET NULL 撞 NOT NULL）', () => {
  it('listing-reviews.listing 与 listing-reports.targetListing 都不能是 required', async () => {
    const { ListingReviews } = await import('@/collections/ListingReviews')
    const { ListingReports } = await import('@/collections/ListingReports')

    const find = (fields: unknown, name: string): Record<string, unknown> | null => {
      if (!Array.isArray(fields)) return null
      for (const raw of fields) {
        const node = raw as Record<string, unknown>
        if (node?.name === name) return node
        const nested = find(node?.fields, name) ?? find(node?.tabs, name)
        if (nested) return nested
      }
      return null
    }

    expect(find(ListingReviews.fields, 'listing')?.required).not.toBe(true)
    expect(find(ListingReports.fields, 'targetListing')?.required).not.toBe(true)
  })
})
