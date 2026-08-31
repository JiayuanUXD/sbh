/**
 * 房源 / 楼盘公开缓存失效 hook。
 *
 * 守护的核心事实：在这之前 `Listings` / `Buildings` 两个 collection **没有任何**
 * 缓存失效接线（只有 Articles / Pages / CitySiteProfiles / Locations 有），
 * 后台下架一条房源后城市列表、首页、facet、sitemap 最长陈旧 5 分钟。
 *
 * 这里断言的是"失效被真的触发了、范围覆盖到正确的城市"，
 * 失效档位本身（硬失效 vs 陈旧一次）由 tests/public-cache-immediate-expiry.test.ts 守护。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }))

import { revalidateTag } from 'next/cache'

import { Buildings } from '@/collections/Buildings'
import { Listings } from '@/collections/Listings'
import {
  invalidateBuildingPublicCacheAfterChange,
  invalidateBuildingPublicCacheAfterDelete,
  invalidateListingPublicCacheAfterChange,
  invalidateListingPublicCacheAfterDelete,
} from '@/domain/public-catalog/supply-cache-hook'
import {
  SITEMAP_TAG,
  buildingsCityTag,
  facetsTag,
  homeTag,
  listingsCityTag,
  LISTINGS_CATEGORY_TAG,
  BUILDINGS_CATEGORY_TAG,
} from '@/domain/public-catalog/cache-tags'

const mockedRevalidateTag = vi.mocked(revalidateTag)

type HookArgs = {
  doc: unknown
  previousDoc?: unknown
  req: unknown
}

/** 与仓库既有 hook 测试同一范式（见 admin-auto-publish-hook.test.ts）。 */
function runHook(hook: unknown, args: HookArgs): Promise<unknown> {
  return (hook as (a: unknown) => Promise<unknown>)(args)
}

type FindByIDArgs = { collection: string; id: number | string }

/** 只实现 hook 真正用到的 payload.findByID。 */
function makeReq(docs: Record<string, Record<string, unknown>>) {
  const calls: FindByIDArgs[] = []
  return {
    calls,
    req: {
      payload: {
        findByID: async ({ collection, id }: FindByIDArgs) => {
          calls.push({ collection, id })
          const found = docs[`${collection}:${id}`]
          if (!found) throw new Error('not found')
          return found
        },
      },
    },
  }
}

function invalidatedTags(): string[] {
  return mockedRevalidateTag.mock.calls.map((call) => String(call[0]))
}

describe('房源 / 楼盘公开缓存失效 hook', () => {
  beforeEach(() => {
    mockedRevalidateTag.mockReset()
    mockedRevalidateTag.mockImplementation(() => undefined)
  })

  it('房源保存后失效所属城市的列表、首页、facet 与 sitemap', async () => {
    const { req } = makeReq({})
    await runHook(invalidateListingPublicCacheAfterChange, {
      // depth≥2：building.city 已展开，不需要额外查询
      doc: { id: 11, building: { id: 5, city: { slug: 'shanghai' } } },
      previousDoc: { id: 11, building: { id: 5, city: { slug: 'shanghai' } } },
      req,
    })

    const tags = invalidatedTags()
    expect(tags).toContain(listingsCityTag('shanghai'))
    expect(tags).toContain(homeTag('shanghai'))
    expect(tags).toContain(facetsTag('shanghai'))
    expect(tags).toContain(buildingsCityTag('shanghai'))
    expect(tags).toContain(SITEMAP_TAG)
  })

  it('building 只是 id 时经楼盘反查城市', async () => {
    const { req, calls } = makeReq({
      'buildings:5': { id: 5, city: 7 },
      'locations:7': { id: 7, type: 'city', slug: 'beijing' },
    })
    await runHook(invalidateListingPublicCacheAfterChange, {
      doc: { id: 11, building: 5 },
      req,
    })

    expect(calls).toEqual([
      { collection: 'buildings', id: 5 },
      { collection: 'locations', id: 7 },
    ])
    expect(invalidatedTags()).toContain(listingsCityTag('beijing'))
  })

  it('房源换楼盘跨城市时新旧城市都失效', async () => {
    const { req } = makeReq({})
    await runHook(invalidateListingPublicCacheAfterChange, {
      doc: { id: 11, building: { id: 6, city: { slug: 'beijing' } } },
      previousDoc: { id: 11, building: { id: 5, city: { slug: 'shanghai' } } },
      req,
    })

    const tags = invalidatedTags()
    // 只失效新城市会把已经搬走的房源留在旧城市的列表里
    expect(tags).toContain(listingsCityTag('shanghai'))
    expect(tags).toContain(listingsCityTag('beijing'))
  })

  it('城市解析不出时退化到类目级兜底并留痕', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { req } = makeReq({})

    await runHook(invalidateListingPublicCacheAfterChange, {
      doc: { id: 11, building: null },
      req,
    })

    const tags = invalidatedTags()
    expect(tags).toContain(LISTINGS_CATEGORY_TAG)
    expect(tags).toContain(BUILDINGS_CATEGORY_TAG)
    expect(tags).toContain(SITEMAP_TAG)
    expect(errorSpy).toHaveBeenCalledWith(
      '[supply-cache-invalidation] city_unresolved',
      expect.objectContaining({ reason: 'listing', objectId: 11 }),
    )
    errorSpy.mockRestore()
  })

  /**
   * 2026-08-31 本地夹具库实测：软删楼盘之后，对它旗下房源的任何写入都会
   * 「返回成功但不落库」。链路是 —— 本 hook 用 `findByID` 反查楼盘，软删楼盘
   * 默认不可见 → Payload 抛 NotFound，抛之前先 `killTransaction(req)` 把调用方
   * 那笔 update 的事务整个回滚掉；本 hook 的 `catch { return null }` 把错吞了，
   * update 结尾拿着已被删掉的 transactionID 去 commit，drizzle 查不到 session
   * 直接 return —— 于是调用方看到一个字段已更新的 doc，DB 里什么都没变。
   *
   * 这里的假 payload 按 Payload 3.86 的真实契约建模（trash 可见性 +
   * killTransaction 副作用），所以断言 `req.transactionID` 还在，等价于断言
   * 「调用方那笔写入没有被这个 hook 悄悄回滚」。
   */
  function makeTrashAwareReq(docs: Record<string, Record<string, unknown>>) {
    const calls: Array<{ collection: string; id: number | string; trash?: boolean }> = []
    const req: Record<string, unknown> = { transactionID: 'txn-1' }
    req.payload = {
      findByID: async (args: {
        collection: string
        id: number | string
        trash?: boolean
        disableErrors?: boolean
      }) => {
        calls.push({ collection: args.collection, id: args.id, trash: args.trash })
        const doc = docs[`${args.collection}:${args.id}`]
        const visible = doc && (doc.deletedAt == null || args.trash === true)
        if (!visible) {
          if (args.disableErrors === true) return null
          delete req.transactionID
          throw new Error('NotFound')
        }
        return doc
      },
    }
    return { req, calls }
  }

  it('楼盘被软删后，旗下房源的写入事务不能被这个 hook 回滚', async () => {
    const { req, calls } = makeTrashAwareReq({
      'buildings:5': { id: 5, city: 7, deletedAt: '2026-08-31T00:00:00.000Z' },
      'locations:7': { id: 7, type: 'city', slug: 'shanghai' },
    })

    await runHook(invalidateListingPublicCacheAfterChange, {
      doc: { id: 11, building: 5 },
      req,
    })

    // 事务还在 = 调用方那笔 update 会真的落库
    expect(req.transactionID).toBe('txn-1')
    // 软删楼盘照样要能算出城市：房源下架后旧列表页必须失效
    expect(calls[0]).toMatchObject({ collection: 'buildings', id: 5, trash: true })
    expect(invalidatedTags()).toContain(listingsCityTag('shanghai'))
  })

  it('楼盘外键悬空（真的查不到）时降级兜底，同样不动事务', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { req } = makeTrashAwareReq({})

    await runHook(invalidateListingPublicCacheAfterChange, {
      doc: { id: 11, building: 5 },
      req,
    })

    expect(req.transactionID).toBe('txn-1')
    expect(invalidatedTags()).toContain(LISTINGS_CATEGORY_TAG)
    errorSpy.mockRestore()
  })

  it('楼盘的 city 指向已消失的 location 时也不动事务', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { req } = makeTrashAwareReq({ 'buildings:5': { id: 5, city: 7 } })

    await runHook(invalidateBuildingPublicCacheAfterChange, {
      doc: { id: 5, city: 7 },
      req,
    })

    expect(req.transactionID).toBe('txn-1')
    expect(invalidatedTags()).toContain(BUILDINGS_CATEGORY_TAG)
    errorSpy.mockRestore()
  })

  it('房源删除同样触发失效', async () => {
    const { req } = makeReq({})
    await runHook(invalidateListingPublicCacheAfterDelete, {
      doc: { id: 11, building: { id: 5, city: { slug: 'shanghai' } } },
      req,
    })
    expect(invalidatedTags()).toContain(listingsCityTag('shanghai'))
  })

  it('楼盘保存后失效所属城市', async () => {
    const { req } = makeReq({})
    await runHook(invalidateBuildingPublicCacheAfterChange, {
      doc: { id: 5, city: { slug: 'shenzhen' } },
      req,
    })
    const tags = invalidatedTags()
    expect(tags).toContain(buildingsCityTag('shenzhen'))
    expect(tags).toContain(homeTag('shenzhen'))
  })

  it('失效抛错不阻断写入，afterChange 仍返回 doc', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockedRevalidateTag.mockImplementation(() => {
      throw new Error('boom')
    })
    const { req } = makeReq({})
    const doc = { id: 11, building: { id: 5, city: { slug: 'shanghai' } } }

    await expect(
      runHook(invalidateListingPublicCacheAfterChange, { doc, req }),
    ).resolves.toBe(doc)
    errorSpy.mockRestore()
  })

  it('不在 Next 请求上下文时整体降级为 warn，不刷 error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    // Job / 脚本里写入时 next/cache 抛的就是这个 invariant
    mockedRevalidateTag.mockImplementation(() => {
      throw new Error('Invariant: static generation store missing in revalidateTag')
    })
    const { req } = makeReq({})

    await runHook(invalidateListingPublicCacheAfterChange, {
      doc: { id: 11, building: { id: 5, city: { slug: 'shanghai' } } },
      req,
    })

    expect(warnSpy).toHaveBeenCalledWith(
      '[public-cache-revalidation] skipped_outside_request_scope',
      expect.objectContaining({ reason: 'listing' }),
    )
    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
    warnSpy.mockRestore()
  })
})

/**
 * 接线契约。
 *
 * 这次 bug 的直接教训：`cache-invalidator.ts` 那条事件驱动失效链路写完了、
 * 有单测、从 index.ts 导出了，但 `registerCacheInvalidatorConsumers` 在生产
 * 一个调用点都没有——测试全绿，失效从未发生过。
 *
 * 所以光测 hook 函数本身不够，必须锁住"它真的挂在 collection 上"。
 *
 * collection 必须在**文件顶部静态导入**，不能在 it() 里 `await import()`。
 * `@/collections/Listings` 拉起的模块图很大，空机 + 热缓存下仍要 ~3.2s，
 * 已经吃掉 5000ms 默认 testTimeout 的三分之二；全量 `pnpm test`（278 个文件抢 8 核，
 * 首次跑还是冷的 Vite transform 缓存）照超不误，而单跑本文件又恒绿——
 * 看上去很像测试顺序污染，实际就是超时。静态导入把这笔开销挪到文件加载
 * 阶段（不受 testTimeout 管），也是仓库里另外 19 个导入 collection 的测试文件的写法。
 */
describe('失效 hook 的 collection 接线', () => {
  it('Listings 挂了 afterChange / afterDelete 失效 hook', () => {
    expect(Listings.hooks?.afterChange).toContain(invalidateListingPublicCacheAfterChange)
    expect(Listings.hooks?.afterDelete).toContain(invalidateListingPublicCacheAfterDelete)
  })

  it('Buildings 挂了 afterChange / afterDelete 失效 hook', () => {
    expect(Buildings.hooks?.afterChange).toContain(invalidateBuildingPublicCacheAfterChange)
    expect(Buildings.hooks?.afterDelete).toContain(invalidateBuildingPublicCacheAfterDelete)
  })
})
