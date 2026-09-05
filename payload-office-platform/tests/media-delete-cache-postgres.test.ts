/**
 * 删除 media 的公开缓存失效——真库集成测试。
 *
 * ## 为什么必须有真库这一层
 *
 * 本改动的前提是一个**数据库行为**：引用 media 的外键是 `ON DELETE SET NULL`，
 * PostgreSQL 在 DELETE 语句里直接把父表的引用列置空，**父文档不经过 Payload 的
 * 写入路径**，它自己的 afterChange 失效钩子一次都不会触发。
 *
 * 这个前提 mock 表达不了：`tests/media-delete-cache-invalidation.test.ts` 里的
 * 假 payload 想让反查在删除后返回什么就返回什么，哪怕把反查错误地放在 `afterDelete`
 * 也照样全绿，而生产上会一个 tag 都失效不掉。
 *
 * 这里在真库上验五件事：
 *   1. 删 media 后父文档的外键真的被置空，且父文档 `updatedAt` 没变（= 没走写入路径）；
 *   2. 因此**删除后按 media id 反查恒空**——反查只能放在 `beforeDelete`；
 *   3. 六条反查 `where` 子句在真实 schema 上都合法（嵌套路径写错只会在运行时暴露）；
 *   4. 接到 `Media` 上的钩子在 `payload.delete` 时真的跑了，并算出了非空 tag 集合；
 *   5. **`beforeDelete` 里反查排在 OPT-070 的摘除之前**——顺序反了会部分静默漏
 *      （见文件末尾那个 describe，它把反序的漏法直接演出来）。
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { createLocalReq, getPayload, type Payload, type PayloadRequest } from 'payload'

import config from '@/payload.config'
import { Media } from '@/collections/Media'
import { CITY_PROFILES_TAG, cityProfileTag } from '@/domain/city-site-profile/cache-invalidator'
import {
  collectMediaCacheTagsBeforeDelete,
  collectMediaConsumerCacheTags,
} from '@/domain/media/media-cache-hook'
import { unmountMediaReferences } from '@/domain/media/media-delete-cleanup'
import { buildingsCityTag, homeTag } from '@/domain/public-catalog/cache-tags'

const databaseAvailable =
  typeof process.env.DATABASE_URL === 'string' && process.env.DATABASE_URL.startsWith('postgres')

const ALT_PREFIX = 'MEDIACACHE-'

async function tinyJpeg(): Promise<Buffer> {
  return sharp({ create: { width: 8, height: 8, channels: 3, background: '#334455' } })
    .jpeg({ quality: 40 })
    .toBuffer()
}

describe.skipIf(!databaseAvailable)('删除 media 的公开缓存失效（真库）', () => {
  let payload: Payload
  let req: PayloadRequest
  let profileId: number
  let citySlug: string
  let originalHeroMedia: number | null
  let buildingId: number
  let buildingCitySlug: string
  let originalBuildingCover: number | null
  const createdMedia: number[] = []

  async function uploadFixtureMedia(label: string): Promise<number> {
    const data = await tinyJpeg()
    const media = await payload.create({
      collection: 'media',
      data: { alt: `${ALT_PREFIX}${label}` },
      file: { data, mimetype: 'image/jpeg', name: `${ALT_PREFIX}${label}.jpg`, size: data.length },
      overrideAccess: true,
    })
    createdMedia.push(media.id)
    return media.id
  }

  /** 本库是 PG serial 主键，id 恒为 number；relationship 可能是裸 id 也可能是已展开文档。 */
  function relationId(value: unknown): number | null {
    if (typeof value === 'number') return value
    if (value && typeof value === 'object' && 'id' in value) {
      const id = (value as { id: unknown }).id
      if (typeof id === 'number') return id
    }
    return null
  }

  beforeAll(async () => {
    payload = await getPayload({ config })
    req = await createLocalReq({}, payload)

    // `sort: 'id'` 不是可省的：CI 的 postgres-migrations 作业把
    // `tests/*-postgres.test.ts` 放在同一次 vitest 里跑，文件之间默认并行，
    // 而 `media-delete-listing-building-postgres.test.ts` 会**自己创建**楼盘。
    // 不定序的话这里可能抓到别的用例正在用、且随时会被删掉的那一条。
    // 升序取最小 id = 种子数据，其它用例新建的行 id 都更大。
    const profiles = await payload.find({
      collection: 'city-site-profiles',
      depth: 1,
      limit: 1,
      sort: 'id',
      overrideAccess: true,
    })
    const profile = profiles.docs[0]
    profileId = profile.id
    citySlug = String((profile.city as { slug?: unknown })?.slug ?? '')
    originalHeroMedia = relationId(profile.heroMedia)

    const buildings = await payload.find({
      collection: 'buildings',
      where: { city: { exists: true } },
      depth: 1,
      limit: 1,
      sort: 'id',
      overrideAccess: true,
    })
    const building = buildings.docs[0]
    buildingId = building.id
    buildingCitySlug = String((building.city as { slug?: unknown })?.slug ?? '')
    originalBuildingCover = relationId(building.coverImage)
  })

  /**
   * 清理按 alt 前缀兜底再扫一遍，不只靠 createdMedia：用例内部已删过的记录再删一次会失败，
   * 而 `.catch(() => null)` 会把失败吞掉，留下的残留会污染别的真库用例。
   */
  afterAll(async () => {
    if (!payload) return
    await payload
      .update({
        collection: 'city-site-profiles',
        id: profileId,
        data: { heroMedia: originalHeroMedia },
        overrideAccess: true,
      })
      .catch(() => null)
    await payload
      .update({
        collection: 'buildings',
        id: buildingId,
        data: { coverImage: originalBuildingCover },
        overrideAccess: true,
      })
      .catch(() => null)

    const leftovers = await payload
      .find({
        collection: 'media',
        where: { alt: { like: ALT_PREFIX } },
        depth: 0,
        limit: 100,
        overrideAccess: true,
      })
      .catch(() => ({ docs: [] as Array<{ id: number }> }))
    for (const doc of leftovers.docs) {
      await payload.delete({ collection: 'media', id: doc.id, overrideAccess: true }).catch(() => null)
    }
  })

  it('六条反查 where 子句在真实 schema 上都合法（嵌套路径写错只在运行时暴露）', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      // 用一个不存在的 id：只要 where 子句合法，六条查询都应正常返回空结果。
      await collectMediaConsumerCacheTags(req, 2147483600)
      const failures = errors.mock.calls.filter(
        (call) => call[0] === '[media-cache-invalidation] lookup_failed',
      )
      expect(failures).toEqual([])
    } finally {
      errors.mockRestore()
    }
  })

  it('删 media 后父文档外键被置空、updatedAt 不变 —— 父文档没走 Payload 写入路径', async () => {
    const mediaId = await uploadFixtureMedia('premise')
    await payload.update({
      collection: 'city-site-profiles',
      id: profileId,
      data: { heroMedia: mediaId },
      overrideAccess: true,
    })
    const before = await payload.findByID({
      collection: 'city-site-profiles',
      id: profileId,
      depth: 0,
      overrideAccess: true,
    })
    expect(relationId(before.heroMedia)).toBe(mediaId)

    await payload.delete({ collection: 'media', id: mediaId, overrideAccess: true })

    const after = await payload.findByID({
      collection: 'city-site-profiles',
      id: profileId,
      depth: 0,
      overrideAccess: true,
    })
    expect(after.heroMedia ?? null).toBeNull()
    // 这一条是整个改动的立论：外键被 PG 置空，但父文档自己没有被更新过，
    // 所以 CitySiteProfiles 的 afterChange 失效钩子根本没机会跑。
    expect(after.updatedAt).toBe(before.updatedAt)
  })

  it('删除后按 media id 反查恒空 —— 所以反查只能放在 beforeDelete', async () => {
    const mediaId = await uploadFixtureMedia('lookup-window')
    await payload.update({
      collection: 'city-site-profiles',
      id: profileId,
      data: { heroMedia: mediaId },
      overrideAccess: true,
    })

    const tagsBeforeDelete = await collectMediaConsumerCacheTags(req, mediaId)
    expect(tagsBeforeDelete).toEqual(
      expect.arrayContaining([cityProfileTag(citySlug), CITY_PROFILES_TAG, homeTag(citySlug)]),
    )

    await payload.delete({ collection: 'media', id: mediaId, overrideAccess: true })

    // 同一个反查，删除之后一条都命中不了：把它放进 afterDelete 就等于什么都没失效。
    const tagsAfterDelete = await collectMediaConsumerCacheTags(req, mediaId)
    expect(tagsAfterDelete).toEqual([])
  })

  it('楼盘封面引用这张图 → 反查经真实关系解析出该楼盘所在城市', async () => {
    const mediaId = await uploadFixtureMedia('building-cover')
    await payload.update({
      collection: 'buildings',
      id: buildingId,
      data: { coverImage: mediaId },
      overrideAccess: true,
    })

    const tags = await collectMediaConsumerCacheTags(req, mediaId)
    expect(tags).toEqual(
      expect.arrayContaining([buildingsCityTag(buildingCitySlug), homeTag(buildingCitySlug)]),
    )
  })

  it('接在 Media 上的钩子在 payload.delete 时真的跑了，且算出了非空 tag 集合', async () => {
    const mediaId = await uploadFixtureMedia('wired')
    await payload.update({
      collection: 'city-site-profiles',
      id: profileId,
      data: { heroMedia: mediaId },
      overrideAccess: true,
    })

    const warns = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await payload.delete({ collection: 'media', id: mediaId, overrideAccess: true })

      // 测试进程里没有 Next 请求上下文，revalidateTag 会整批失败并降级成这一条 warn。
      // 它带着 reason 与 tagCount，正好能证明「钩子跑了、且算出了 N 个 tag」。
      const mediaWarns = warns.mock.calls.filter(
        (call) =>
          call[0] === '[public-cache-revalidation] skipped_outside_request_scope' &&
          (call[1] as { reason?: string })?.reason === 'media',
      )
      expect(mediaWarns).toHaveLength(1)
      expect((mediaWarns[0][1] as { tagCount: number }).tagCount).toBeGreaterThan(0)
    } finally {
      warns.mockRestore()
    }
  })
})

/**
 * OPT-070 的摘除落地之后才跑得通的一批：`listings_gallery.image_id`、
 * `listings_media_items.resource_id`、`buildings_media_items.resource_id` 三列曾是
 * `NOT NULL` + `ON DELETE SET NULL` 的死结，被它们引用的 media **根本删不掉**（23502）。
 *
 * 现在删得掉了，于是「只经图集 / 媒体工作台引用」的 media 第一次真的有了
 * 「缓存里挂着已删图片 URL」的窗口——这正是本改动要堵的口子，必须端到端验一遍。
 *
 * 夹具全部走**追加一行**：摘除只删 `WHERE resource_id = <本次 media>`，
 * 楼盘原有的行一条都不动，用例跑完自动回到原样。
 */
describe.skipIf(!databaseAvailable)('删除被媒体工作台引用的 media（OPT-070 摘除之后）', () => {
  let payload: Payload
  let req: PayloadRequest
  let buildingId: number
  let buildingCitySlug: string
  let originalMediaItems: unknown[]
  let originalCover: number | null
  /** 一张**不是**被测对象的封面图，见 attachToMediaItems 的注释。 */
  let coverMediaId: number

  async function uploadMedia(label: string): Promise<number> {
    const data = await tinyJpeg()
    const media = await payload.create({
      collection: 'media',
      data: { alt: `${ALT_PREFIX}${label}` },
      file: { data, mimetype: 'image/jpeg', name: `${ALT_PREFIX}${label}.jpg`, size: data.length },
      overrideAccess: true,
    })
    return media.id
  }

  /**
   * 往楼盘的媒体工作台追加一行指向这张图；派生的楼盘图集行由 syncBuildingMedia 一并生成。
   *
   * **必须显式指定一张别的封面图**：`syncBuildingMedia` 在文档此前没有封面时会
   * 自动把第一张图设成封面。CI 的 postgres-migrations 作业只跑 `pnpm seed`、
   * **不跑 `pnpm seed:media`**，种子楼盘因此没有封面——不显式指定的话，被测的那张图
   * 会当场变成封面，于是「反序反查」还能经 `coverImage` 这条标量列查到楼盘，
   * 顺序回归用例的前提就没了（本地跑过 seed:media，看不出这个差异）。
   */
  async function attachToMediaItems(mediaId: number): Promise<void> {
    await payload.update({
      collection: 'buildings',
      id: buildingId,
      data: {
        coverImage: coverMediaId,
        mediaItems: [
          ...(originalMediaItems as Array<Record<string, unknown>>),
          {
            resource: mediaId,
            kind: 'image',
            // category / alt 都是 required：缺了 Payload 会以 ValidationError 拒掉整次写入。
            category: 'exterior',
            alt: `${ALT_PREFIX}item`,
          },
        ],
      },
      overrideAccess: true,
    })
  }

  beforeAll(async () => {
    payload = await getPayload({ config })
    req = await createLocalReq({}, payload)

    const buildings = await payload.find({
      collection: 'buildings',
      where: { city: { exists: true } },
      depth: 1,
      limit: 1,
      sort: 'id',
      overrideAccess: true,
    })
    const building = buildings.docs[0]
    buildingId = building.id
    buildingCitySlug = String((building.city as { slug?: unknown })?.slug ?? '')

    // depth 0 重读：mediaItems 里的 resource 要是裸 id 才能原样写回去。
    const raw = await payload.findByID({
      collection: 'buildings',
      id: buildingId,
      depth: 0,
      overrideAccess: true,
    })
    originalMediaItems = Array.isArray(raw.mediaItems) ? raw.mediaItems : []
    originalCover = typeof raw.coverImage === 'number' ? raw.coverImage : null
    coverMediaId = await uploadMedia('other-cover')
  })

  afterAll(async () => {
    if (!payload) return
    await payload
      .update({
        collection: 'buildings',
        id: buildingId,
        data: {
          mediaItems: originalMediaItems as Array<Record<string, unknown>>,
          coverImage: originalCover,
        },
        overrideAccess: true,
      })
      .catch(() => null)
    const leftovers = await payload
      .find({
        collection: 'media',
        where: { alt: { like: ALT_PREFIX } },
        depth: 0,
        limit: 100,
        overrideAccess: true,
      })
      .catch(() => ({ docs: [] as Array<{ id: number }> }))
    for (const doc of leftovers.docs) {
      await payload.delete({ collection: 'media', id: doc.id, overrideAccess: true }).catch(() => null)
    }
  })

  it('只经媒体工作台 / 图集引用的 media 现在删得掉，且反查算出了该城市的 tag', async () => {
    const mediaId = await uploadMedia('mediaitems')
    await attachToMediaItems(mediaId)

    const tags = await collectMediaConsumerCacheTags(req, mediaId)
    expect(tags).toEqual(
      expect.arrayContaining([buildingsCityTag(buildingCitySlug), homeTag(buildingCitySlug)]),
    )

    // 这一步在 OPT-070 之前会以 23502 失败——两段钩子并存后必须仍然成功。
    await expect(
      payload.delete({ collection: 'media', id: mediaId, overrideAccess: true }),
    ).resolves.toBeTruthy()

    const after = await payload.findByID({
      collection: 'buildings',
      id: buildingId,
      depth: 0,
      overrideAccess: true,
    })
    const remaining = Array.isArray(after.mediaItems) ? after.mediaItems : []
    expect(remaining).toHaveLength(originalMediaItems.length)
  })

  it('Media.hooks.beforeDelete 里反查必须排在摘除之前（顺序写在配置里，不能只写在注释里）', () => {
    const hooks = Media.hooks?.beforeDelete ?? []
    expect(hooks.indexOf(collectMediaCacheTagsBeforeDelete)).toBeGreaterThanOrEqual(0)
    expect(hooks.indexOf(collectMediaCacheTagsBeforeDelete)).toBeLessThan(
      hooks.indexOf(unmountMediaReferences),
    )
  })

  it('顺序反了会部分静默漏：先摘除再反查，这座城市的缓存一个 tag 都不失效', async () => {
    const runHook = (hook: unknown, args: Record<string, unknown>): Promise<unknown> =>
      (hook as (a: Record<string, unknown>) => Promise<unknown>)(args)

    // 正序：反查 → 摘除。算得出城市。
    const rightOrderMedia = await uploadMedia('order-right')
    await attachToMediaItems(rightOrderMedia)
    const rightContext: Record<string, unknown> = {}
    await runHook(collectMediaCacheTagsBeforeDelete, {
      context: rightContext,
      id: rightOrderMedia,
      req,
    })
    await runHook(unmountMediaReferences, { id: rightOrderMedia, req })
    const rightTags = (rightContext.mediaDeleteCacheTags as Record<string, string[]>)[
      String(rightOrderMedia)
    ]
    expect(rightTags).toContain(buildingsCityTag(buildingCitySlug))
    await payload.delete({ collection: 'media', id: rightOrderMedia, overrideAccess: true })

    // 反序：摘除 → 反查。行已经没了，反查一无所获。
    // 这张图**不是**楼盘封面，所以标量列那条兜底也救不回来——正是「部分静默漏」的形状。
    const wrongOrderMedia = await uploadMedia('order-wrong')
    await attachToMediaItems(wrongOrderMedia)

    // 前提必须显式断言：封面一旦碰巧就是被测的这张图，反查会经 coverImage 命中，
    // 这条用例就会「通过」得毫无意义。
    const fixture = await payload.findByID({
      collection: 'buildings',
      id: buildingId,
      depth: 0,
      overrideAccess: true,
    })
    expect(fixture.coverImage).not.toBe(wrongOrderMedia)
    const wrongContext: Record<string, unknown> = {}
    await runHook(unmountMediaReferences, { id: wrongOrderMedia, req })
    await runHook(collectMediaCacheTagsBeforeDelete, {
      context: wrongContext,
      id: wrongOrderMedia,
      req,
    })
    const wrongTags = (wrongContext.mediaDeleteCacheTags as Record<string, string[]>)[
      String(wrongOrderMedia)
    ]
    expect(wrongTags).toEqual([])
    await payload.delete({ collection: 'media', id: wrongOrderMedia, overrideAccess: true })
  })
})
