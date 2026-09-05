/**
 * 删除 media 的公开缓存失效。
 *
 * 守护的核心事实：引用 media 的外键是 `ON DELETE SET NULL`，父文档不经过 Payload
 * 的写入路径，它们各自的 afterChange 失效钩子一次都不会触发——在这之前
 * `Media` 上没有任何钩子，删掉一张图后前台最长 5 分钟继续吐已删除的文件 URL。
 *
 * 本文件用 mock 守的是「反查 → tag 映射 → 两段钩子交接」这套逻辑。
 * 「SET NULL 让 afterDelete 反查恒空」这个前提 mock 表达不了，
 * 由 `tests/media-delete-cache-postgres.test.ts` 在真库上守。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }))

import { revalidateTag } from 'next/cache'

import { Media } from '@/collections/Media'
import { CITY_PROFILES_TAG, cityProfileTag } from '@/domain/city-site-profile/cache-invalidator'
import {
  collectMediaCacheTagsBeforeDelete,
  invalidateMediaConsumerCacheAfterDelete,
} from '@/domain/media/media-cache-hook'
import {
  ARTICLES_CATEGORY_TAG,
  BUILDINGS_CATEGORY_TAG,
  LISTINGS_CATEGORY_TAG,
  PAGES_CATEGORY_TAG,
  SITEMAP_TAG,
  SITE_SETTINGS_TAG,
  buildingsCityTag,
  facetsTag,
  homeTag,
  listingsCityTag,
} from '@/domain/public-catalog/cache-tags'

const mockedRevalidateTag = vi.mocked(revalidateTag)

const MEDIA_ID = 42
const CITY_SLUG = 'shanghai'

type FindArgs = { collection: string; where?: unknown }
type FindByIDArgs = { collection: string; id: number | string }

type Fixture = {
  /** 各 collection 的反查命中结果，缺省为空数组（没有引用）。 */
  hits?: Partial<Record<string, Record<string, unknown>[]>>
  /** 站点设置 Global 的内容。 */
  siteSettings?: Record<string, unknown>
  /** 这些 collection 的反查会抛错，用来验「查询失败 ≠ 没有引用」。 */
  failing?: readonly string[]
}

/** depth 0 的楼盘/房源反查要靠这两条按 id 的小查询才能解析出城市。 */
const RELATED_BY_ID: Record<string, Record<string, unknown>> = {
  'locations:7': { id: 7, type: 'city', slug: CITY_SLUG, name: '上海' },
  'buildings:5': { id: 5, city: 7 },
}

function makeReq(fixture: Fixture = {}) {
  const findCalls: FindArgs[] = []
  const hits = fixture.hits ?? {}
  const failing = new Set(fixture.failing ?? [])

  return {
    findCalls,
    context: {} as Record<string, unknown>,
    req: {
      payload: {
        find: async ({ collection, where }: FindArgs) => {
          findCalls.push({ collection, where })
          if (failing.has(collection)) throw new Error(`boom: ${collection}`)
          return { docs: hits[collection] ?? [] }
        },
        findByID: async ({ collection, id }: FindByIDArgs) =>
          RELATED_BY_ID[`${collection}:${id}`] ?? null,
        findGlobal: async () => {
          if (failing.has('site-settings')) throw new Error('boom: site-settings')
          return fixture.siteSettings ?? {}
        },
      },
    },
  }
}

type HookRunner = (args: Record<string, unknown>) => Promise<unknown>

async function runDelete(fixture: Fixture = {}, id: number | string = MEDIA_ID) {
  const { req, context, findCalls } = makeReq(fixture)
  await (collectMediaCacheTagsBeforeDelete as unknown as HookRunner)({ context, id, req })
  const tagsAfterCollect = invalidatedTags()
  await (invalidateMediaConsumerCacheAfterDelete as unknown as HookRunner)({
    context,
    doc: { id },
    id,
    req,
  })
  return { context, findCalls, tagsAfterCollect, req }
}

function invalidatedTags(): string[] {
  return mockedRevalidateTag.mock.calls.map((call) => String(call[0]))
}

beforeEach(() => {
  mockedRevalidateTag.mockClear()
})

describe('Media 删除的公开缓存失效', () => {
  it('两段钩子都接在 Media 上——只写模块不接线等于没做（OPT-053 教训）', () => {
    expect(Media.hooks?.beforeDelete).toContain(collectMediaCacheTagsBeforeDelete)
    expect(Media.hooks?.afterDelete).toContain(invalidateMediaConsumerCacheAfterDelete)
  })

  it('城市站点配置引用这张图 → 失效该城市的 profile 与首页', async () => {
    await runDelete({
      hits: {
        'city-site-profiles': [{ id: 3, city: { id: 7, slug: CITY_SLUG, type: 'city' } }],
      },
    })

    expect(invalidatedTags()).toEqual(
      expect.arrayContaining([
        cityProfileTag(CITY_SLUG),
        CITY_PROFILES_TAG,
        homeTag(CITY_SLUG),
        SITEMAP_TAG,
      ]),
    )
  })

  it('区域封面引用这张图 → 失效该城市的列表 / facet / 首页', async () => {
    await runDelete({
      hits: {
        locations: [
          { id: 9, type: 'district', slug: 'huangpu', city: { id: 7, slug: CITY_SLUG } },
        ],
      },
    })

    expect(invalidatedTags()).toEqual(
      expect.arrayContaining([
        cityProfileTag(CITY_SLUG),
        homeTag(CITY_SLUG),
        listingsCityTag(CITY_SLUG),
        buildingsCityTag(CITY_SLUG),
        facetsTag(CITY_SLUG),
      ]),
    )
  })

  it('房源图集引用这张图 → 经楼盘解析出城市并做城市级失效', async () => {
    await runDelete({ hits: { listings: [{ id: 11, building: 5 }] } })

    expect(invalidatedTags()).toEqual(
      expect.arrayContaining([
        homeTag(CITY_SLUG),
        facetsTag(CITY_SLUG),
        listingsCityTag(CITY_SLUG),
        buildingsCityTag(CITY_SLUG),
        SITEMAP_TAG,
      ]),
    )
  })

  it('楼盘封面引用这张图 → 同样做城市级失效', async () => {
    await runDelete({ hits: { buildings: [{ id: 5, city: 7 }] } })

    expect(invalidatedTags()).toEqual(
      expect.arrayContaining([homeTag(CITY_SLUG), buildingsCityTag(CITY_SLUG)]),
    )
  })

  it('资讯封面引用这张图 → 失效资讯类目与 sitemap', async () => {
    await runDelete({ hits: { articles: [{ id: 2 }] } })

    expect(invalidatedTags()).toEqual(
      expect.arrayContaining([ARTICLES_CATEGORY_TAG, SITEMAP_TAG]),
    )
    expect(invalidatedTags()).not.toContain(SITE_SETTINGS_TAG)
  })

  it('内容页头图引用这张图 → 失效内容页类目与 sitemap', async () => {
    await runDelete({ hits: { pages: [{ id: 4 }] } })

    expect(invalidatedTags()).toEqual(expect.arrayContaining([PAGES_CATEGORY_TAG, SITEMAP_TAG]))
  })

  it('站点设置的 logo 引用这张图 → 失效全站的站点设置 tag', async () => {
    await runDelete({ siteSettings: { logo: MEDIA_ID } })

    expect(invalidatedTags()).toContain(SITE_SETTINGS_TAG)
  })

  it('站点设置的类型卡封面引用这张图 → 同样失效（数组里的引用不能漏）', async () => {
    await runDelete({
      siteSettings: { logo: null, typeCards: [{ slot: 'coworking', coverImage: MEDIA_ID }] },
    })

    expect(invalidatedTags()).toContain(SITE_SETTINGS_TAG)
  })

  it('站点设置引用的是别的图 → 不失效站点设置', async () => {
    await runDelete({ siteSettings: { logo: 999, typeCards: [{ coverImage: 998 }] } })

    expect(invalidatedTags()).not.toContain(SITE_SETTINGS_TAG)
  })

  it('没有任何消费方引用 → 一个 tag 都不失效', async () => {
    await runDelete()

    expect(invalidatedTags()).toEqual([])
  })

  it('反查发生在 beforeDelete，失效发生在 afterDelete——顺序反了会一个 tag 都失效不掉', async () => {
    const { tagsAfterCollect } = await runDelete({
      hits: { 'city-site-profiles': [{ id: 3, city: { id: 7, slug: CITY_SLUG } }] },
    })

    // beforeDelete 只负责算，不能提前失效：删除还可能失败（NOT NULL + SET NULL 死结）。
    expect(tagsAfterCollect).toEqual([])
    expect(invalidatedTags()).toContain(cityProfileTag(CITY_SLUG))
  })

  it('七个消费方都要反查到，不能只覆盖一部分', async () => {
    const { findCalls, req } = await runDelete()
    const scanned = findCalls.map((call) => call.collection)

    expect(scanned).toEqual([
      'articles',
      'pages',
      'city-site-profiles',
      'locations',
      'buildings',
      'listings',
    ])
    // 站点设置是 Global，只能取回来比字段，不在 find 列表里。
    expect(typeof req.payload.findGlobal).toBe('function')
  })

  it('反查查询失败 ≠ 没有引用：退化成该消费方的类目级失效并留痕', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await runDelete({ failing: ['articles', 'site-settings'] })

      expect(invalidatedTags()).toEqual(
        expect.arrayContaining([ARTICLES_CATEGORY_TAG, SITEMAP_TAG, SITE_SETTINGS_TAG]),
      )
      const consumers = errors.mock.calls
        .filter((call) => call[0] === '[media-cache-invalidation] lookup_failed')
        .map((call) => (call[1] as { consumer: string }).consumer)
      expect(consumers).toEqual(expect.arrayContaining(['articles', 'site-settings']))
    } finally {
      errors.mockRestore()
    }
  })

  it('afterDelete 拿不到 beforeDelete 的结果时保守全失效并留痕，不静默跳过', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { req } = makeReq()
      await (invalidateMediaConsumerCacheAfterDelete as unknown as HookRunner)({
        context: {},
        doc: { id: MEDIA_ID },
        id: MEDIA_ID,
        req,
      })

      expect(invalidatedTags()).toEqual(
        expect.arrayContaining([
          ARTICLES_CATEGORY_TAG,
          PAGES_CATEGORY_TAG,
          SITE_SETTINGS_TAG,
          LISTINGS_CATEGORY_TAG,
          BUILDINGS_CATEGORY_TAG,
          SITEMAP_TAG,
        ]),
      )
      expect(errors).toHaveBeenCalledWith(
        '[media-cache-invalidation] tags_missing',
        expect.objectContaining({ errorCode: 'media_cache_tags_missing' }),
      )
    } finally {
      errors.mockRestore()
    }
  })

  it('批量删除时按 media id 分桶，两条删除的 tag 不会互相串台', async () => {
    const { req, context } = makeReq({
      hits: { 'city-site-profiles': [{ id: 3, city: { id: 7, slug: CITY_SLUG } }] },
    })

    await (collectMediaCacheTagsBeforeDelete as unknown as HookRunner)({ context, id: 1, req })
    await (collectMediaCacheTagsBeforeDelete as unknown as HookRunner)({ context, id: 2, req })

    const buckets = context.mediaDeleteCacheTags as Record<string, string[]>
    expect(Object.keys(buckets).sort()).toEqual(['1', '2'])

    await (invalidateMediaConsumerCacheAfterDelete as unknown as HookRunner)({
      context,
      doc: { id: 1 },
      id: 1,
      req,
    })

    // 消费掉自己那一桶，另一条删除的结果原封不动地留着。
    expect(Object.keys(buckets)).toEqual(['2'])
    expect(invalidatedTags()).toContain(cityProfileTag(CITY_SLUG))
  })
})
