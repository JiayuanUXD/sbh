import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPayload, type Payload } from 'payload'
import sharp from 'sharp'

import config from '@/payload.config'

/**
 * 「按类型浏览」单城封面覆盖引用的媒体，必须能被删除。
 *
 * ## 病因
 *
 * `city_site_profiles_type_card_overrides.cover_image_id` 是 `NOT NULL`，
 * 而它指向 media 的外键是 `ON DELETE SET NULL`——两者互斥。删 media 时 PG 试图
 * 把该列置 NULL，直接撞非空约束：
 *
 *   23502 non-null violation
 *   UPDATE ONLY "city_site_profiles_type_card_overrides" SET "cover_image_id" = NULL
 *
 * 与楼盘侧 OPT-050、房源侧 `20260819_113218` 是同一个死结。这两处的头注释都写过
 * 病理，唯独 OPT-060 加字段时又踩了一遍。
 *
 * 根因不在本仓库而在 Payload：`@payloadcms/drizzle` 的 `traverseFields.js` 对
 * **每一个**单值 relationship / upload 列都写死 `onDelete: 'set null'`，
 * 同时只要 `field.required` 就加 `notNull`。即「required 的 upload 字段」必然
 * 生成这对自相矛盾的约束，且没有任何配置开关可以改 `onDelete`。
 *
 * ## 为什么处方是「放宽 NOT NULL」而不是拦截或级联
 *
 * 迁移 `20260819_113218` 已确立口径：审计表脱钩保留、纯关系表由钩子删除、
 * 有业务含义的引用则拦住不删。封面覆盖三者都不是——它是**纯装饰性的运营配置**，
 * 且读侧本来就按「配了就用、没配就回落」设计：
 *
 *   `mapTypeCardOverrides` 映射不出封面的行**逐行丢弃**（见 type-card-covers.ts），
 *   然后回落到「站点设置」全局默认，再回落到该类型首条房源封面。
 *
 * 全局默认那一份（`site_settings_type_cards.cover_image_id`）本来就是可空的。
 * 单城覆盖只是它的按城市版本，没有理由更严。
 *
 * ## 这条测试为什么必须走真库
 *
 * 死结在**数据库约束**上，mock 永远碰不到：字段配置写错了单测照样全绿，
 * 而运营在后台点删除照样看到 500。同 `building-delete-postgres.test.ts` 的理由。
 */

const databaseAvailable =
  typeof process.env.DATABASE_URL === 'string' && process.env.DATABASE_URL.startsWith('postgres')

/** 覆盖行用的槽位：刻意避开夹具里已有的 traditional-office，不干扰既有数据。 */
const TEST_SLOT = 'creative-park'
const MEDIA_ALT_PREFIX = 'TYPECARD-OVERRIDE-DELETE-'

describe.skipIf(!databaseAvailable)('媒体删除：被单城「按类型浏览」封面覆盖引用时', () => {
  let payload: Payload
  let profileId: number | string
  /** 用例会改写 profile 的 typeCardOverrides，跑完必须还原，否则污染其它真库 spec。 */
  let originalOverrides: unknown

  beforeAll(async () => {
    payload = await getPayload({ config })
    const profiles = await payload.find({
      collection: 'city-site-profiles',
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    profileId = profiles.docs[0].id
    originalOverrides = profiles.docs[0].typeCardOverrides
  })

  afterAll(async () => {
    if (profileId !== undefined) {
      await payload
        .update({
          collection: 'city-site-profiles',
          id: profileId,
          data: { typeCardOverrides: originalOverrides as never },
          overrideAccess: true,
        })
        .catch(() => null)
    }
    // 兜底按 alt 前缀再扫一遍：覆盖「用例内已删」与「用例中途失败漏记」两种情况。
    const leftovers = await payload
      .find({
        collection: 'media',
        where: { alt: { like: MEDIA_ALT_PREFIX } },
        depth: 0,
        overrideAccess: true,
        limit: 100,
      })
      .catch(() => ({ docs: [] as Array<{ id: number | string }> }))
    for (const doc of leftovers.docs) {
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
        name: `typecard-override-${tag}-${Date.now()}.jpg`,
        size: buffer.length,
      },
      overrideAccess: true,
    })
  }

  async function readOverrides() {
    const doc = await payload.findByID({
      collection: 'city-site-profiles',
      id: profileId,
      depth: 0,
      overrideAccess: true,
    })
    return (doc.typeCardOverrides ?? []) as Array<{ slot?: string; coverImage?: unknown }>
  }

  it('删除被覆盖行引用的媒体不再 500——这一步才真正穿过 SET NULL + NOT NULL 死结', async () => {
    const media = await makeMedia('deletable')
    await payload.update({
      collection: 'city-site-profiles',
      id: profileId,
      data: { typeCardOverrides: [{ slot: TEST_SLOT, coverImage: Number(media.id) }] as never },
      overrideAccess: true,
    })

    // 前置断言：引用确实建立了，否则下面删成功也说明不了任何问题。
    const before = await readOverrides()
    expect(before.some((row) => row.slot === TEST_SLOT)).toBe(true)

    await expect(
      payload.delete({ collection: 'media', id: media.id, overrideAccess: true }),
    ).resolves.toBeTruthy()
  })

  it('媒体删掉后覆盖行仍在，封面被置空——由读侧逐行丢弃并回落，而不是整份 profile 失效', async () => {
    const media = await makeMedia('setnull')
    await payload.update({
      collection: 'city-site-profiles',
      id: profileId,
      data: { typeCardOverrides: [{ slot: TEST_SLOT, coverImage: Number(media.id) }] as never },
      overrideAccess: true,
    })

    await payload.delete({ collection: 'media', id: media.id, overrideAccess: true })

    const after = await readOverrides()
    const row = after.find((r) => r.slot === TEST_SLOT)
    expect(row).toBeDefined()
    expect(row?.coverImage ?? null).toBeNull()
  })
})
