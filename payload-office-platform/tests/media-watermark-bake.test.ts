import { readFileSync } from 'fs'
import path from 'path'

import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import { DEFAULT_WATERMARK_CONFIG } from '@/domain/media/watermark'
import {
  bakeAfterUpload,
  bakeWatermark,
  watermarkPlugin,
  WATERMARK_CONTEXT_KEY,
} from '@/plugins/watermark'

async function makeBase(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 40, g: 40, b: 40 } },
  })
    .jpeg()
    .toBuffer()
}

/** 两张同尺寸图之间有差异的像素占比。 */
async function differenceRatio(a: Buffer, b: Buffer): Promise<number> {
  const [rawA, rawB] = await Promise.all([
    sharp(a).raw().toBuffer(),
    sharp(b).raw().toBuffer(),
  ])
  expect(rawA.length).toBe(rawB.length)
  let differing = 0
  for (let i = 0; i < rawA.length; i++) {
    if (Math.abs(rawA[i] - rawB[i]) > 8) differing++
  }
  return differing / rawA.length
}

const SIZES = [
  { name: 'thumb', filename: 'office-320x213.webp', width: 320, height: 213 },
  { name: 'card', filename: 'office-768x512.webp', width: 768, height: 512 },
  { name: 'hero', filename: 'office-1600x1067.webp', width: 1600, height: 1067 },
]

describe('bakeWatermark', () => {
  it('母版被满铺水印改写——差异像素占比显著', async () => {
    const cleanMaster = await makeBase(2400, 1600)
    const result = await bakeWatermark({
      cleanMaster,
      masterFilename: 'office.jpg',
      masterMimeType: 'image/jpeg',
      sizes: SIZES,
      config: { ...DEFAULT_WATERMARK_CONFIG, enabled: true },
    })
    const ratio = await differenceRatio(cleanMaster, result.master.body)
    expect(ratio).toBeGreaterThan(0.02)
  })

  it('母版保持原格式与原尺寸', async () => {
    const cleanMaster = await makeBase(2400, 1600)
    const result = await bakeWatermark({
      cleanMaster,
      masterFilename: 'office.jpg',
      masterMimeType: 'image/jpeg',
      sizes: SIZES,
      config: { ...DEFAULT_WATERMARK_CONFIG, enabled: true },
    })
    const meta = await sharp(result.master.body).metadata()
    expect(meta.format).toBe('jpeg')
    expect(meta.width).toBe(2400)
    expect(meta.height).toBe(1600)
    expect(result.master.mimeType).toBe('image/jpeg')
  })

  it('thumb 档不打水印——320px 图无盗用价值，9px 角标只会变成脏点', async () => {
    const cleanMaster = await makeBase(2400, 1600)
    const result = await bakeWatermark({
      cleanMaster,
      masterFilename: 'office.jpg',
      masterMimeType: 'image/jpeg',
      sizes: SIZES,
      config: { ...DEFAULT_WATERMARK_CONFIG, enabled: true },
    })
    const filenames = result.derivatives.map((item) => item.filename)
    expect(filenames).not.toContain('office-320x213.webp')
    expect(filenames).toEqual(['office-768x512.webp', 'office-1600x1067.webp'])
  })

  it('card / hero 派生图尺寸与输入声明一致，格式为 webp', async () => {
    const cleanMaster = await makeBase(2400, 1600)
    const result = await bakeWatermark({
      cleanMaster,
      masterFilename: 'office.jpg',
      masterMimeType: 'image/jpeg',
      sizes: SIZES,
      config: { ...DEFAULT_WATERMARK_CONFIG, enabled: true },
    })
    for (const derivative of result.derivatives) {
      const meta = await sharp(derivative.body).metadata()
      const declared = SIZES.find((size) => size.filename === derivative.filename)!
      expect(meta.format).toBe('webp')
      expect(meta.width).toBe(declared.width)
      expect(meta.height).toBe(declared.height)
      expect(derivative.mimeType).toBe('image/webp')
    }
  })

  it('派生图打的是角标不是满铺——改动集中在一角', async () => {
    const cleanMaster = await makeBase(2400, 1600)
    const result = await bakeWatermark({
      cleanMaster,
      masterFilename: 'office.jpg',
      masterMimeType: 'image/jpeg',
      sizes: SIZES,
      config: { ...DEFAULT_WATERMARK_CONFIG, enabled: true },
    })
    const hero = result.derivatives.find((item) => item.filename.includes('1600'))!
    const clean = await sharp(cleanMaster).resize({ width: 1600, height: 1067 }).webp().toBuffer()
    // 左上 1/4 应当几乎没动，右下 1/4 应当被改写
    const crop = (buffer: Buffer, left: number, top: number) =>
      sharp(buffer).extract({ left, top, width: 400, height: 260 }).png().toBuffer()
    const topLeftRatio = await differenceRatio(
      await crop(clean, 0, 0),
      await crop(hero.body, 0, 0),
    )
    const bottomRightRatio = await differenceRatio(
      await crop(clean, 1180, 780),
      await crop(hero.body, 1180, 780),
    )
    expect(bottomRightRatio).toBeGreaterThan(topLeftRatio * 3)
  })

  it('enabled 为 false 时原样返回，不改任何字节', async () => {
    const cleanMaster = await makeBase(1200, 800)
    const result = await bakeWatermark({
      cleanMaster,
      masterFilename: 'office.jpg',
      masterMimeType: 'image/jpeg',
      sizes: SIZES,
      config: { ...DEFAULT_WATERMARK_CONFIG, enabled: false },
    })
    expect(result.master.body).toEqual(cleanMaster)
    expect(result.derivatives).toEqual([])
  })

  it('动图原样返回、不出派生图——composite 不带 animated 只读第一帧，烘下去会静默变成静止图', async () => {
    // 静态与动态 WebP 共用 image/webp，MIME 层拦不住，只能靠 metadata().pages 兜底。
    const frame = (rgb: { r: number; g: number; b: number }) =>
      sharp({ create: { width: 640, height: 480, channels: 4, background: { ...rgb, alpha: 1 } } })
        .png()
        .toBuffer()
    const animated = await sharp(
      [await frame({ r: 40, g: 40, b: 40 }), await frame({ r: 200, g: 0, b: 0 })],
      { join: { animated: true } },
    )
      .webp()
      .toBuffer()
    // 先证明夹具真是多帧，否则下面的断言可能是靠别的分支蒙对的。
    expect((await sharp(animated).metadata()).pages).toBe(2)

    const result = await bakeWatermark({
      cleanMaster: animated,
      masterFilename: 'loop.webp',
      masterMimeType: 'image/webp',
      sizes: SIZES,
      // 显式 enabled: true——否则走的是 enabled 早退分支，验不到 pages 判定。
      config: { ...DEFAULT_WATERMARK_CONFIG, enabled: true },
    })
    expect(result.master.body).toEqual(animated)
    expect(result.master.mimeType).toBe('image/webp')
    expect(result.derivatives).toEqual([])
  })
})

/**
 * 不变量：`watermark.version` 有值 ⟺ 存储里的字节带着那个版本的水印。
 * 这些用例只走「不烘」的出口，不碰存储，所以 payload 用假对象即可。
 */
describe('bakeAfterUpload 维持 watermark.version 不变量', () => {
  const STALE = { version: 'stale0000stale00', appliedAt: '2026-09-01T00:00:00.000Z' }
  const CLEARED = { watermark: { version: null, appliedAt: null } }
  const photo = { id: 1, filename: 'office.jpg', mimeType: 'image/jpeg', usage: 'listing-photo', watermark: STALE }

  async function run(args: {
    doc: Record<string, unknown>
    freshBytes: boolean
    enabled: boolean
  }): Promise<Array<Record<string, unknown>>> {
    const updates: Array<Record<string, unknown>> = []
    const context: Record<string, unknown> = {}
    if (args.freshBytes) context[WATERMARK_CONTEXT_KEY] = Buffer.from('fresh')
    const req = {
      context,
      payload: {
        findGlobal: async () => ({ watermark: { enabled: args.enabled }, siteName: '商办荟' }),
        update: async (update: Record<string, unknown>) => {
          updates.push(update)
          return {}
        },
      },
    }
    await bakeAfterUpload({ doc: args.doc, req, operation: 'update' } as unknown as Parameters<typeof bakeAfterUpload>[0])
    return updates
  }

  it('新字节落地但开关关闭 → 清掉 version / appliedAt，让它读作「从没烘过」', async () => {
    const updates = await run({ doc: photo, freshBytes: true, enabled: false })
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({ collection: 'media', id: 1, data: CLEARED })
  })

  it('新字节落地但 usage 不是 listing-photo → 同样清掉', async () => {
    const updates = await run({ doc: { ...photo, usage: 'brand' }, freshBytes: true, enabled: true })
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({ data: CLEARED })
  })

  it('新字节落地但格式不可烘（gif）→ 同样清掉', async () => {
    const updates = await run({ doc: { ...photo, mimeType: 'image/gif' }, freshBytes: true, enabled: true })
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({ data: CLEARED })
  })

  it('没有新字节（只改 alt / usage）→ 什么都不碰，存储字节与记录的 version 仍一致', async () => {
    const updates = await run({ doc: { ...photo, usage: 'brand' }, freshBytes: false, enabled: false })
    expect(updates).toEqual([])
  })

  it('本来就没有 version → 无事可清，不多写一次库', async () => {
    const updates = await run({ doc: { ...photo, usage: 'brand', watermark: null }, freshBytes: true, enabled: true })
    expect(updates).toEqual([])
  })
})

/**
 * 插件挂载。slug 写错、或哪天有人把 hooks 展开顺序改坏，表现都是「水印静默不生效」——
 * 没有任何报错，只有线上图片没水印。所以挂载本身要有断言，不能只靠源码顺序守卫。
 */
describe('watermarkPlugin', () => {
  const applyTo = (collections: Array<Record<string, unknown>>) =>
    watermarkPlugin()({ collections } as never) as unknown as {
      collections: Array<{
        slug: string
        hooks?: { beforeOperation?: unknown[]; afterChange?: unknown[] }
      }>
    }

  it('给 media 挂上 beforeOperation 取母版与 afterChange 覆盖写', () => {
    const result = applyTo([{ slug: 'media' }])
    const media = result.collections.find((item) => item.slug === 'media')!
    expect(media.hooks?.beforeOperation).toHaveLength(1)
    expect(media.hooks?.afterChange).toEqual([bakeAfterUpload])
  })

  it('把自己追加在集合已有 hook 之后，不覆盖别人', () => {
    const existing = () => undefined
    const result = applyTo([
      { slug: 'media', hooks: { afterChange: [existing], beforeOperation: [existing] } },
    ])
    const media = result.collections.find((item) => item.slug === 'media')!
    // 追加而非前插：云存储插件的上传 hook 也在这个数组里，跑在我们之前才有文件可覆盖。
    expect(media.hooks?.afterChange).toEqual([existing, bakeAfterUpload])
    expect(media.hooks?.beforeOperation?.[0]).toBe(existing)
  })

  it('不碰其它集合', () => {
    const result = applyTo([{ slug: 'media' }, { slug: 'listings' }])
    const listings = result.collections.find((item) => item.slug === 'listings')!
    expect(listings.hooks).toBeUndefined()
  })
})

describe('payload.config 插件顺序', () => {
  it('watermarkPlugin 必须排在 s3Storage 之后', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/payload.config.ts'), 'utf8')
    const s3Index = source.indexOf('s3Storage({')
    const watermarkIndex = source.indexOf('watermarkPlugin()')
    expect(s3Index).toBeGreaterThan(-1)
    expect(watermarkIndex).toBeGreaterThan(-1)
    expect(watermarkIndex).toBeGreaterThan(s3Index)
  })
})
