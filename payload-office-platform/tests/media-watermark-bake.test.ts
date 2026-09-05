import { readFileSync } from 'fs'
import path from 'path'

import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import {
  computeWatermarkVersion,
  DEFAULT_WATERMARK_CONFIG,
  mergeWatermarkConfig,
} from '@/domain/media/watermark'
import { MEDIA_COS_PREFIX } from '@/lib/storage/cos-config'
import { MEDIA_SOURCE_PREFIX, type MediaWriter } from '@/lib/storage/media-writer'
import {
  bakeAfterUpload,
  bakeWatermark,
  createBakeAfterUpload,
  watermarkPlugin,
  WATERMARK_CONTEXT_KEY,
  WATERMARK_SKIP_KEY,
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

  /**
   * 必须注入假写入器：开关关着时本 hook 现在**照样写备份**（见下面那条用例），
   * 用默认实例会真往仓库目录写 `media-source/office.jpg`。
   */
  async function run(args: {
    doc: Record<string, unknown>
    freshBytes: boolean
    enabled: boolean
  }): Promise<{
    updates: Array<Record<string, unknown>>
    puts: Array<{ prefix: string; filename: string; body: string }>
  }> {
    const updates: Array<Record<string, unknown>> = []
    const puts: Array<{ prefix: string; filename: string; body: string }> = []
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
    const hook = createBakeAfterUpload(() => ({
      put: async ({ prefix, filename, body }) => {
        puts.push({ prefix, filename, body: body.toString() })
      },
      get: async () => null,
    }))
    await hook({ doc: args.doc, req, operation: 'update' } as unknown as Parameters<typeof bakeAfterUpload>[0])
    return { updates, puts }
  }

  it('新字节落地但开关关闭 → 清掉 version / appliedAt，让它读作「从没烘过」', async () => {
    const { updates } = await run({ doc: photo, freshBytes: true, enabled: false })
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({ collection: 'media', id: 1, data: CLEARED })
  })

  /**
   * 备份归口在这里：本 hook 是唯一**知道手里的字节是刚上传的干净原件**的地方。
   * 开关关着的窗口期（功能默认关闭、要等回填跑完运营才打开）里上传的图，若不备份，
   * 日后开关打开、第一次烘焙中断在「覆盖写母版」与「写 version」之间，就再也拿不回
   * 干净原件——重刷只能从 `media-source/` 取，那里空着。
   */
  it('开关关闭时也写备份——这是唯一知道字节是新的地方，错过就没有第二次机会', async () => {
    const { updates, puts } = await run({ doc: photo, freshBytes: true, enabled: false })
    expect(puts).toEqual([
      { prefix: MEDIA_SOURCE_PREFIX, filename: 'office.jpg', body: 'fresh' },
    ])
    // 只写备份，绝不写 media/：开关关着时不烘，存储里的母版仍是干净的。
    expect(puts.filter((put) => put.prefix === MEDIA_COS_PREFIX)).toEqual([])
    // version 照旧清掉：存储字节没被烘过。
    expect(updates[0]).toMatchObject({ data: CLEARED })
  })

  it('本来就没有 version 时开关关闭也照样写备份——不写库不代表不备份', async () => {
    const { updates, puts } = await run({
      doc: { ...photo, watermark: null },
      freshBytes: true,
      enabled: false,
    })
    expect(puts).toEqual([
      { prefix: MEDIA_SOURCE_PREFIX, filename: 'office.jpg', body: 'fresh' },
    ])
    expect(updates).toEqual([])
  })

  it('usage 不是实景图 / 格式不可烘 → 不备份（media-source/ 只为可烘的实景图存在）', async () => {
    expect((await run({ doc: { ...photo, usage: 'brand' }, freshBytes: true, enabled: true })).puts).toEqual([])
    expect((await run({ doc: { ...photo, mimeType: 'image/gif' }, freshBytes: true, enabled: true })).puts).toEqual([])
  })

  it('新字节落地但 usage 不是 listing-photo → 同样清掉', async () => {
    const { updates } = await run({ doc: { ...photo, usage: 'brand' }, freshBytes: true, enabled: true })
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({ data: CLEARED })
  })

  it('新字节落地但格式不可烘（gif）→ 同样清掉', async () => {
    const { updates } = await run({ doc: { ...photo, mimeType: 'image/gif' }, freshBytes: true, enabled: true })
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({ data: CLEARED })
  })

  it('没有新字节（只改 alt / usage）→ 什么都不碰，存储字节与记录的 version 仍一致', async () => {
    const { updates, puts } = await run({ doc: { ...photo, usage: 'brand' }, freshBytes: false, enabled: false })
    expect(updates).toEqual([])
    // 没有新字节就没有「新的干净原件」，备份也不该动。
    expect(puts).toEqual([])
  })

  it('本来就没有 version → 无事可清，不多写一次库', async () => {
    const { updates } = await run({
      doc: { ...photo, usage: 'brand', watermark: null },
      freshBytes: true,
      enabled: true,
    })
    expect(updates).toEqual([])
  })
})

/**
 * Payload 的 Local API **每次**嵌套调用都会把 `req.context` 换成新对象
 * （`utilities/createLocalReq.js:86` 调 `getRequestContext`，第 4-20 行三个分支
 * 全部返回新对象，从不复用同一个引用），并且是在**调用方传进去的那个 req 上原地改**
 * （`createLocalReq` 解构 `req = {}` 后直接赋值）。
 *
 * 所以任何缓存了 `req.context` 引用的收尾逻辑都会删错对象。守卫一旦残留，
 * 同一个 req 里后续的媒体全部静默跳过烘焙——Task 7 的批量重刷正是这种
 * 一个 req 跑几十行的场景。
 */
describe('bakeAfterUpload 的递归守卫必须解引用 live 的 req.context', () => {
  const photo = {
    id: 7,
    filename: 'office.jpg',
    mimeType: 'image/jpeg',
    usage: 'listing-photo',
    watermark: { version: 'stale0000stale00', appliedAt: '2026-09-01T00:00:00.000Z' },
  }

  /**
   * 注入假写入器：开关关着时 hook 仍会写一次备份，用默认实例会真往仓库目录落盘。
   * 本组只关心 `req.context` 的解引用，写入器只要不报错即可。
   */
  const hook = createBakeAfterUpload(() => ({ put: async () => {}, get: async () => null }))

  /** 复刻 Payload：嵌套 update 后 req.context 变成一个新对象（内容延续）。 */
  function makeReq(enabled: boolean) {
    const req: Record<string, unknown> = {
      context: { [WATERMARK_CONTEXT_KEY]: Buffer.from('fresh') } as Record<string, unknown>,
      payload: {
        findGlobal: async () => ({ watermark: { enabled }, siteName: '商办荟' }),
        update: async () => {
          req.context = { ...(req.context as Record<string, unknown>) }
          return {}
        },
      },
    }
    return req
  }

  const ctx = (req: Record<string, unknown>) => req.context as Record<string, unknown>

  it('嵌套 update 换掉 req.context 之后，守卫不残留', async () => {
    const req = makeReq(false)
    await hook({ doc: photo, req, operation: 'update' } as never)
    expect(ctx(req)[WATERMARK_SKIP_KEY]).toBeUndefined()
  })

  it('守卫残留会让同一个 req 的下一条媒体被静默跳过——这里断言它不会', async () => {
    const req = makeReq(false)
    await hook({ doc: photo, req, operation: 'update' } as never)
    // 第二条媒体：重新放入干净母版，它必须仍然被处理（陈旧 version 被清）。
    ctx(req)[WATERMARK_CONTEXT_KEY] = Buffer.from('fresh-2')
    let secondUpdated = false
    ;(req.payload as Record<string, unknown>).update = async () => {
      secondUpdated = true
      req.context = { ...ctx(req) }
      return {}
    }
    await hook({ doc: { ...photo, id: 8 }, req, operation: 'update' } as never)
    expect(secondUpdated).toBe(true)
  })

  it('消费后清掉干净母版——同一个 req 的第二条媒体不能拿第一条的字节去烘', async () => {
    const req = makeReq(false)
    await hook({ doc: photo, req, operation: 'update' } as never)
    expect(ctx(req)[WATERMARK_CONTEXT_KEY]).toBeUndefined()
  })
})

/**
 * 烘焙成功路径。写入器可注入，否则这一段（备份 → 覆盖写 → 写 version）没有任何
 * 自动化证据：有人调换 put 顺序、删掉备份、或改坏 resolveConfig 的接线，全量测试照样绿。
 * 而「备份先于覆盖」是这个功能可逆性的唯一保障。
 */
describe('bakeAfterUpload 烘焙成功路径（注入假写入器）', () => {
  type Put = { prefix: string; filename: string; mimeType: string; size: number }

  function makeWriter(failOnPrefix?: string) {
    const puts: Put[] = []
    const writer: MediaWriter = {
      put: async ({ prefix, filename, body, mimeType }) => {
        if (prefix === failOnPrefix) throw new Error('[test] 写入失败')
        puts.push({ prefix, filename, mimeType, size: body.length })
      },
      get: async () => null,
    }
    return { puts, writer }
  }

  const doc = {
    id: 42,
    filename: 'office.jpg',
    mimeType: 'image/jpeg',
    usage: 'listing-photo',
    watermark: null,
    sizes: {
      thumb: { filename: 'office-320x213.webp', width: 320, height: 213 },
      card: { filename: 'office-768x512.webp', width: 768, height: 512 },
      hero: { filename: 'office-1600x1067.webp', width: 1600, height: 1067 },
    },
  }

  function hookWith(writer: MediaWriter) {
    const applied = watermarkPlugin({ createWriter: () => writer })({
      collections: [{ slug: 'media' }],
    } as never) as unknown as {
      collections: Array<{ slug: string; hooks: { afterChange: Array<(a: unknown) => Promise<unknown>> } }>
    }
    return applied.collections[0].hooks.afterChange.at(-1)!
  }

  async function makeReq(cleanMaster: Buffer, updates: Array<Record<string, unknown>>) {
    const req: Record<string, unknown> = {
      context: { [WATERMARK_CONTEXT_KEY]: cleanMaster } as Record<string, unknown>,
      payload: {
        findGlobal: async () => ({ watermark: { enabled: true }, siteName: '商办荟' }),
        update: async (update: Record<string, unknown>) => {
          updates.push(update)
          req.context = { ...(req.context as Record<string, unknown>) }
          return {}
        },
      },
    }
    return req
  }

  async function run(writer: MediaWriter) {
    const updates: Array<Record<string, unknown>> = []
    const cleanMaster = await makeBase(2400, 1600)
    const req = await makeReq(cleanMaster, updates)
    await hookWith(writer)({ doc, req, operation: 'create' })
    return { updates, cleanMaster }
  }

  it('备份写在任何覆盖写之前——顺序反了就丢掉干净原件', async () => {
    const { puts, writer } = makeWriter()
    await run(writer)
    expect(puts[0]).toMatchObject({ prefix: MEDIA_SOURCE_PREFIX, filename: 'office.jpg' })
    const firstCos = puts.findIndex((put) => put.prefix === MEDIA_COS_PREFIX)
    const lastBackup = puts.map((put) => put.prefix).lastIndexOf(MEDIA_SOURCE_PREFIX)
    expect(lastBackup).toBeLessThan(firstCos)
  })

  it('备份的是干净原件本身，不是烘过的字节', async () => {
    const { puts, writer } = makeWriter()
    const { cleanMaster } = await run(writer)
    expect(puts[0].size).toBe(cleanMaster.length)
  })

  it('覆盖写母版与 card / hero，thumb 的 key 从不被写', async () => {
    const { puts, writer } = makeWriter()
    await run(writer)
    const cosKeys = puts.filter((put) => put.prefix === MEDIA_COS_PREFIX).map((put) => put.filename)
    expect(cosKeys).toEqual(['office.jpg', 'office-768x512.webp', 'office-1600x1067.webp'])
    expect(puts.map((put) => put.filename)).not.toContain('office-320x213.webp')
  })

  it('写回的 watermark.version 等于当前配置的哈希', async () => {
    const { writer } = makeWriter()
    const { updates } = await run(writer)
    const expected = computeWatermarkVersion(mergeWatermarkConfig({ enabled: true }, '商办荟'))
    expect(updates).toHaveLength(1)
    const data = updates[0].data as { watermark: { version: string; appliedAt: string } }
    expect(data.watermark.version).toBe(expected)
    expect(typeof data.watermark.appliedAt).toBe('string')
  })

  it('备份失败时中止：一个 media/ 的 key 都不许被写，version 也不写', async () => {
    const { puts, writer } = makeWriter(MEDIA_SOURCE_PREFIX)
    const updates: Array<Record<string, unknown>> = []
    const req = await makeReq(await makeBase(1200, 800), updates)
    // 不吞错：Payload 的 killTransaction 要靠异常冒泡才会回滚整个 req 事务。
    await expect(hookWith(writer)({ doc, req, operation: 'create' })).rejects.toThrow('[test] 写入失败')
    expect(puts.filter((put) => put.prefix === MEDIA_COS_PREFIX)).toEqual([])
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
