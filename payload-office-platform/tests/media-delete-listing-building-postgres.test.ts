import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPayload, type Payload } from 'payload'
import sharp from 'sharp'

import config from '@/payload.config'

/**
 * 被房源图集 / 房源与楼盘媒体工作台引用的媒体，必须能被删除（OPT-070）。
 *
 * ## 病因
 *
 * 三列同时是 `NOT NULL` 和 `ON DELETE SET NULL`——互斥：
 *
 *   listings_gallery.image_id          notnull=true  ondel=SET NULL  ❌
 *   listings_media_items.resource_id   notnull=true  ondel=SET NULL  ❌
 *   buildings_media_items.resource_id  notnull=true  ondel=SET NULL  ❌
 *
 * 删 media 时 PG 试图把这些列置 NULL，直接撞非空约束（23502），后台只显示
 * 「Something went wrong.」。与 `20260819_113218`（房源硬删）、OPT-050（楼盘硬删）、
 * 58b4c43（单城封面覆盖）是同一个死结，根因在 Payload：`@payloadcms/drizzle` 的
 * `traverseFields.js` 对每个单值 relationship / upload 列写死 `onDelete: 'set null'`，
 * 同时只要 `field.required` 就加 `notNull`，且没有开关能改 `onDelete`。
 *
 * ## 处方与前三次不同：钩子摘除，而不是放宽 NOT NULL
 *
 * `20260819_113218` 的三分口径是「审计表脱钩保留 / 纯关系行由钩子删除 /
 * 有业务含义的引用拦住不删」。这三列属**第二类**：`mediaItems` 行去掉 `resource`
 * 之后 `kind`/`category`/`alt` 描述的是空气，`gallery` 行本身就只有一个 `image`。
 *
 * 所以走 OPT-050 对 `building_merchant_relations` 的原话处方——「**不放宽 NOT NULL**
 * ——那只会留下一堆无意义关系行」。保持 NOT NULL 还保住一条真实不变量：
 * `galleryCount` 在三处都是裸 `gallery.length`（`review-transition.ts:161`、
 * `listing-review-queue-row.ts:54`、`ListingCompletenessCardClient.tsx:94`），
 * 只要 `image_id` 非空，行数就等于真实图片数；一旦放宽，2 张真图会被算成 3 张，
 * 「提交审核至少 3 张」那道门就被静默放松了。
 *
 * ## 这条测试为什么必须走真库
 *
 * 死结在**数据库约束**上，mock 永远碰不到：钩子哪怕漏了一张表，单测照样全绿，
 * 而运营在后台点删除照样看到 500。同 `building-delete-postgres.test.ts` 与
 * `media-delete-type-card-override-postgres.test.ts` 的理由。
 */

const databaseAvailable =
  typeof process.env.DATABASE_URL === 'string' && process.env.DATABASE_URL.startsWith('postgres')

const TAG = 'OPT070-'
const MEDIA_ALT_PREFIX = `${TAG}media-`

describe.skipIf(!databaseAvailable)('媒体删除：被房源图集 / 媒体工作台引用时', () => {
  let payload: Payload
  let cityId: number | string
  let districtId: number | string
  const createdListings: Array<number | string> = []

  beforeAll(async () => {
    payload = await getPayload({ config })
    const city = await payload.find({
      collection: 'locations',
      where: { type: { equals: 'city' } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    cityId = city.docs[0].id
    const district = await payload.find({
      collection: 'locations',
      where: { type: { equals: 'district' } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    districtId = district.docs[0].id
  })

  /**
   * 清理兜底按前缀再扫一遍，不能只靠 createdXxx 数组——用例内部已删的文档再删会失败，
   * 而 `.catch(() => null)` 会把失败吞掉，看着清理成功、实际残留污染其它真库 spec。
   * 这个坑 `building-delete-postgres.test.ts` 的头注释里有完整记录。
   *
   * 顺序：房源 → 楼盘 → 媒体。房源引用楼盘，楼盘删除有守卫（OPT-050），
   * 媒体被前两者引用，倒着删会互相绊住。
   */
  afterAll(async () => {
    for (const id of createdListings) {
      await payload
        .delete({ collection: 'listings', id, overrideAccess: true, trash: true })
        .catch(() => null)
    }
    for (const collection of ['listings', 'buildings'] as const) {
      const field = collection === 'listings' ? 'title' : 'name'
      const leftovers = await payload
        .find({
          collection,
          where: { [field]: { like: TAG } },
          depth: 0,
          overrideAccess: true,
          limit: 100,
          trash: true,
        })
        .catch(() => ({ docs: [] as Array<{ id: number | string }> }))
      for (const doc of leftovers.docs) {
        await payload.delete({ collection, id: doc.id, overrideAccess: true }).catch(() => null)
      }
    }
    const media = await payload
      .find({
        collection: 'media',
        where: { alt: { like: MEDIA_ALT_PREFIX } },
        depth: 0,
        overrideAccess: true,
        limit: 100,
      })
      .catch(() => ({ docs: [] as Array<{ id: number | string }> }))
    for (const doc of media.docs) {
      await payload.delete({ collection: 'media', id: doc.id, overrideAccess: true }).catch(() => null)
    }
  })

  async function makeMedia(tag: string) {
    const buffer = await sharp({
      create: { width: 16, height: 16, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .jpeg({ quality: 60 })
      .toBuffer()
    return payload.create({
      collection: 'media',
      data: { alt: `${MEDIA_ALT_PREFIX}${tag}`, usage: 'other' },
      file: {
        data: buffer,
        mimetype: 'image/jpeg',
        name: `opt070-${tag}-${Date.now()}.jpg`,
        size: buffer.length,
      },
      overrideAccess: true,
    })
  }

  async function makeBuilding(tag: string) {
    const stamp = `${tag}-${Date.now()}`
    return payload.create({
      collection: 'buildings',
      data: {
        name: `${TAG}${stamp}`,
        slug: `opt070-${stamp}`,
        city: Number(cityId),
        district: Number(districtId),
        status: 'published',
        operationalStatus: 'active',
      },
      overrideAccess: true,
    })
  }

  async function makeListing(tag: string, buildingId: number | string, extra: Record<string, unknown>) {
    const stamp = `${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
    const listing = await payload.create({
      collection: 'listings',
      data: {
        title: `${TAG}${stamp}`,
        slug: `opt070-${stamp}`,
        listingType: 'traditional-office',
        building: Number(buildingId),
        area: 100,
        price: { amount: 5, currency: 'CNY', period: 'day', unit: 'sqm' },
        ...extra,
      } as never,
      overrideAccess: true,
    })
    createdListings.push(listing.id)
    return listing
  }

  const mediaItem = (resourceId: number | string, alt: string) => ({
    resource: Number(resourceId),
    kind: 'image' as const,
    category: 'workspace' as const,
    alt,
  })

  async function readListing(id: number | string) {
    return payload.findByID({ collection: 'listings', id, depth: 0, overrideAccess: true })
  }

  const idsOf = (rows: unknown): Array<number | string> =>
    Array.isArray(rows)
      ? rows
          .map((row) => {
            if (!row || typeof row !== 'object') return null
            const value = (row as { image?: unknown; resource?: unknown }).image
              ?? (row as { resource?: unknown }).resource
            if (typeof value === 'number' || typeof value === 'string') return value
            if (value && typeof value === 'object') {
              const nested = (value as { id?: unknown }).id
              if (typeof nested === 'number' || typeof nested === 'string') return nested
            }
            return null
          })
          .filter((v): v is number | string => v !== null)
      : []

  it('被房源媒体工作台（及其派生图集）引用的媒体可以删除，且两张子表的对应行都被摘掉', async () => {
    const building = await makeBuilding('workbench')
    const [keep, drop] = await Promise.all([makeMedia('wb-keep'), makeMedia('wb-drop')])
    const listing = await makeListing('workbench', building.id, {
      mediaItems: [mediaItem(keep.id, '保留的图'), mediaItem(drop.id, '要删的图')],
    })

    // 前置断言：引用确实建立了，否则删成功说明不了任何问题。
    const before = await readListing(listing.id)
    expect(idsOf(before.mediaItems).map(Number)).toEqual([Number(keep.id), Number(drop.id)])
    expect(idsOf(before.gallery).map(Number)).toEqual([Number(keep.id), Number(drop.id)])

    // 这一步才真正穿过 SET NULL + NOT NULL 死结。
    await expect(
      payload.delete({ collection: 'media', id: drop.id, overrideAccess: true }),
    ).resolves.toBeTruthy()

    const after = await readListing(listing.id)
    expect(idsOf(after.mediaItems).map(Number)).toEqual([Number(keep.id)])
    expect(idsOf(after.gallery).map(Number)).toEqual([Number(keep.id)])
  })

  it('只被 legacy 图集引用（没有 mediaItems）的媒体也能删除——本地库多数存量房源是这个形态', async () => {
    const building = await makeBuilding('legacy')
    const [keep, drop] = await Promise.all([makeMedia('lg-keep'), makeMedia('lg-drop')])
    // 直接写 gallery、不写 mediaItems：syncListingMedia 对这种「双方都无 mediaItems」
    // 的存量形态不派生，gallery 原样保留（见 Listings.ts 该 hook 的第 3 条）。
    const listing = await makeListing('legacy', building.id, {
      gallery: [{ image: Number(keep.id) }, { image: Number(drop.id) }],
    })

    const before = await readListing(listing.id)
    expect(idsOf(before.gallery).map(Number)).toEqual([Number(keep.id), Number(drop.id)])
    expect(before.mediaItems ?? []).toHaveLength(0)

    await expect(
      payload.delete({ collection: 'media', id: drop.id, overrideAccess: true }),
    ).resolves.toBeTruthy()

    const after = await readListing(listing.id)
    expect(idsOf(after.gallery).map(Number)).toEqual([Number(keep.id)])
  })

  it('被楼盘媒体工作台引用的媒体可以删除，派生的楼盘图集行一并清掉', async () => {
    const building = await makeBuilding('bmedia')
    const [keep, drop] = await Promise.all([makeMedia('bd-keep'), makeMedia('bd-drop')])
    await payload.update({
      collection: 'buildings',
      id: building.id,
      data: {
        mediaItems: [
          { resource: Number(keep.id), kind: 'image', category: 'exterior', alt: '保留的图' },
          { resource: Number(drop.id), kind: 'image', category: 'exterior', alt: '要删的图' },
        ],
      } as never,
      overrideAccess: true,
    })

    const before = await payload.findByID({
      collection: 'buildings',
      id: building.id,
      depth: 0,
      overrideAccess: true,
    })
    expect(idsOf(before.mediaItems).map(Number)).toEqual([Number(keep.id), Number(drop.id)])
    expect(idsOf(before.gallery).map(Number)).toEqual([Number(keep.id), Number(drop.id)])

    await expect(
      payload.delete({ collection: 'media', id: drop.id, overrideAccess: true }),
    ).resolves.toBeTruthy()

    const after = await payload.findByID({
      collection: 'buildings',
      id: building.id,
      depth: 0,
      overrideAccess: true,
    })
    expect(idsOf(after.mediaItems).map(Number)).toEqual([Number(keep.id)])
    expect(idsOf(after.gallery).map(Number)).toEqual([Number(keep.id)])
  })

  it('只摘被删的那张：同一房源剩下的图顺序不乱（_order 留空档后仍按序读出）', async () => {
    const building = await makeBuilding('order')
    const [first, middle, last] = await Promise.all([
      makeMedia('od-1'),
      makeMedia('od-2'),
      makeMedia('od-3'),
    ])
    const listing = await makeListing('order', building.id, {
      mediaItems: [
        mediaItem(first.id, '第一张'),
        mediaItem(middle.id, '第二张'),
        mediaItem(last.id, '第三张'),
      ],
    })

    // 删中间那张：_order 会留下 1,3 的空档，读侧必须仍然按序返回。
    await payload.delete({ collection: 'media', id: middle.id, overrideAccess: true })

    const after = await readListing(listing.id)
    expect(idsOf(after.mediaItems).map(Number)).toEqual([Number(first.id), Number(last.id)])
    expect(idsOf(after.gallery).map(Number)).toEqual([Number(first.id), Number(last.id)])
    const alts = (after.mediaItems as Array<{ alt?: string }>).map((m) => m.alt)
    expect(alts).toEqual(['第一张', '第三张'])
  })

  it('删除不该动到没引用这张图的房源', async () => {
    const building = await makeBuilding('isolate')
    const [shared, other] = await Promise.all([makeMedia('is-shared'), makeMedia('is-other')])
    const victim = await makeListing('isolate-victim', building.id, {
      mediaItems: [mediaItem(shared.id, '被删的图')],
    })
    const bystander = await makeListing('isolate-bystander', building.id, {
      mediaItems: [mediaItem(other.id, '无关的图')],
    })

    await payload.delete({ collection: 'media', id: shared.id, overrideAccess: true })

    const victimAfter = await readListing(victim.id)
    expect(idsOf(victimAfter.mediaItems)).toHaveLength(0)
    const bystanderAfter = await readListing(bystander.id)
    expect(idsOf(bystanderAfter.mediaItems).map(Number)).toEqual([Number(other.id)])
  })

  it('媒体删除失败时子表行不消失——摘除必须与删除同事务', async () => {
    const building = await makeBuilding('txn')
    const media = await makeMedia('txn')
    const listing = await makeListing('txn', building.id, {
      mediaItems: [mediaItem(media.id, '事务用图')],
    })

    // 用一个不存在的 id 触发删除失败：钩子不该已经把别的房源的行摘掉。
    await payload
      .delete({ collection: 'media', id: 999_999_999, overrideAccess: true })
      .catch(() => null)

    const after = await readListing(listing.id)
    expect(idsOf(after.mediaItems).map(Number)).toEqual([Number(media.id)])
  })
})
