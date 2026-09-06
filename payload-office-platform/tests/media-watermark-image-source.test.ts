import { describe, expect, it, vi } from 'vitest'

/**
 * OPT-071 图片水印。
 *
 * 这里钉的是三类东西，每一类都对应一个**静默失效**——出错时没有任何报错，
 * 只有几个月后「水印怎么不对」的困惑：
 *
 *   1. 版本哈希对 logo 身份敏感（否则换图不重刷，新旧 logo 永久共存）；
 *   2. 选了图片却拿不到素材时**回落到文字**，不是不打水印（否则裸奔的图带着
 *      version 永久留在生产，每轮重刷都判 skip）；
 *   3. 满铺的 base64 只出现一次（否则一份 30 KB 的 logo 能把 overlay 撑到几 MB，
 *      而这是每张图烘一次都要付的代价）。
 */

import {
  buildBadgeOverlay,
  buildTiledOverlay,
  computeWatermarkVersion,
  mergeWatermarkConfig,
  DEFAULT_WATERMARK_CONFIG,
  type WatermarkImageAsset,
} from '@/domain/media/watermark'
import {
  buildPreviewWatermarkConfig,
  loadPreviewImageAsset,
  resolveWatermarkRenderContext,
} from '@/domain/media/watermark-settings'

const ASSET: WatermarkImageAsset = {
  dataUri: 'data:image/png;base64,AAAABBBBCCCC',
  width: 60,
  height: 30,
}

/** depth 1 展开后的 media 文档形态。 */
const MEDIA_DOC = {
  id: 7,
  updatedAt: '2026-09-06T00:00:00.000Z',
  filename: 'logo.png',
  mimeType: 'image/png',
  width: 60,
  height: 30,
}

function storedWatermark(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    tiled: { source: 'image', text: '商办荟', image: MEDIA_DOC, imageScale: 0.2, density: 3, opacity: 0.4, angle: -30 },
    badge: { source: 'image', text: '商办荟', image: MEDIA_DOC, imageScale: 0.12, position: 'bottom-right', opacity: 0.9 },
    ...overrides,
  }
}

describe('版本哈希必须对 logo 身份敏感', () => {
  it('换一张 logo（id 变）→ 版本变', () => {
    const a = mergeWatermarkConfig(storedWatermark())
    const b = mergeWatermarkConfig(
      storedWatermark({
        tiled: { ...storedWatermark().tiled, image: { ...MEDIA_DOC, id: 8 } },
      }),
    )
    expect(computeWatermarkVersion(a)).not.toBe(computeWatermarkVersion(b))
  })

  /**
   * 这条是 `updatedAt` 存在的全部理由：运营用同名文件覆盖上传，Payload 复用同一条
   * media 记录、id 不变，但像素完全换了。只哈希 id 的话版本不动，之后每一轮重刷
   * 都判「已是当前版本」跳过——旧 logo 永久留在存量图上。
   */
  it('同名覆盖上传（id 不变、updatedAt 变）→ 版本仍然要变', () => {
    const a = mergeWatermarkConfig(storedWatermark())
    const b = mergeWatermarkConfig(
      storedWatermark({
        tiled: { ...storedWatermark().tiled, image: { ...MEDIA_DOC, updatedAt: '2026-09-07T00:00:00.000Z' } },
      }),
    )
    expect(computeWatermarkVersion(a)).not.toBe(computeWatermarkVersion(b))
  })

  it('从文字切到图片 → 版本变', () => {
    const text = mergeWatermarkConfig({ ...storedWatermark(), tiled: { ...storedWatermark().tiled, source: 'text' } })
    const image = mergeWatermarkConfig(storedWatermark())
    expect(computeWatermarkVersion(text)).not.toBe(computeWatermarkVersion(image))
  })
})

describe('mergeWatermarkConfig 的图片源落定', () => {
  it('拿到展开后的 media 文档 → source 保持 image，imageRef 带 id 与 updatedAt', () => {
    const config = mergeWatermarkConfig(storedWatermark())
    expect(config.tiled.source).toBe('image')
    expect(config.tiled.imageRef).toEqual({ id: '7', updatedAt: MEDIA_DOC.updatedAt })
  })

  /**
   * depth 0 读出来的关系是裸 id，拿不到 updatedAt。此时**必须**判成没有图片、回落文字，
   * 而不是拿 id 硬凑一个 ref——后者会一路正常直到某天换 logo 不生效，那时没人查得出来。
   */
  it('只拿到裸 id（depth 0 的形态）→ 回落成文字', () => {
    const config = mergeWatermarkConfig({ ...storedWatermark(), tiled: { ...storedWatermark().tiled, image: 7 } })
    expect(config.tiled.source).toBe('text')
    expect(config.tiled.imageRef).toBeNull()
  })

  it('选了图片但字段为空 → 回落成文字', () => {
    const config = mergeWatermarkConfig({ ...storedWatermark(), badge: { ...storedWatermark().badge, image: null } })
    expect(config.badge.source).toBe('text')
  })

  it('imageScale 超范围被夹取', () => {
    const tooBig = mergeWatermarkConfig({ ...storedWatermark(), tiled: { ...storedWatermark().tiled, imageScale: 9 } })
    expect(tooBig.tiled.imageScale).toBe(0.5)
    const tooSmall = mergeWatermarkConfig({ ...storedWatermark(), badge: { ...storedWatermark().badge, imageScale: 0 } })
    expect(tooSmall.badge.imageScale).toBe(0.03)
  })

  it('两种版式各自独立：满铺用图、角标用字', () => {
    const config = mergeWatermarkConfig({
      ...storedWatermark(),
      badge: { ...storedWatermark().badge, source: 'text' },
    })
    expect(config.tiled.source).toBe('image')
    expect(config.badge.source).toBe('text')
  })
})

describe('图片 overlay 渲染', () => {
  const config = mergeWatermarkConfig(storedWatermark())

  it('满铺把 base64 放进 defs，格子用 use 引用——data URI 只出现一次', () => {
    const svg = buildTiledOverlay({ width: 800, height: 600, config: config.tiled, image: ASSET }).toString()
    expect(svg.split('base64,').length - 1).toBe(1)
    expect(svg).toContain('<defs>')
    expect(svg).toContain('<use href="#wm"')
    // 格子数应该远多于 1，否则「只出现一次」这条断言就没有意义了
    expect(svg.split('<use ').length - 1).toBeGreaterThan(10)
  })

  it('满铺不透明度挂在 g 上，不逐格重复', () => {
    const svg = buildTiledOverlay({ width: 800, height: 600, config: config.tiled, image: ASSET }).toString()
    expect(svg.split('opacity=').length - 1).toBe(1)
  })

  it('角标按比例算宽高，位置贴右下', () => {
    const svg = buildBadgeOverlay({ width: 1000, height: 500, config: config.badge, image: ASSET }).toString()
    const logoWidth = Math.round(1000 * 0.12)
    const logoHeight = Math.round(logoWidth * (30 / 60))
    const margin = Math.round(1000 * 0.025)
    expect(svg).toContain(`width="${logoWidth}"`)
    expect(svg).toContain(`height="${logoHeight}"`)
    expect(svg).toContain(`x="${1000 - margin - logoWidth}"`)
    expect(svg).toContain(`y="${500 - margin - logoHeight}"`)
  })

  it('图片角标不画描边——栅格图描不了', () => {
    const svg = buildBadgeOverlay({ width: 1000, height: 500, config: config.badge, image: ASSET }).toString()
    expect(svg).not.toContain('stroke')
  })

  /**
   * 最危险的失败模式：静默不打水印。version 照样会被写上，之后每一轮重刷都判
   * 「已是当前版本」跳过，这批裸奔的图永久留在生产。回落到文字至少保住
   * 「有水印」这条不变量，运营也会立刻从预览里看出不对。
   */
  it('source=image 但没传素材 → 画文字，不是什么都不画', () => {
    const tiled = buildTiledOverlay({ width: 800, height: 600, config: config.tiled, image: null }).toString()
    expect(tiled).toContain('<text')
    const badge = buildBadgeOverlay({ width: 800, height: 600, config: config.badge, image: undefined }).toString()
    expect(badge).toContain('<text')
  })

  it('素材宽高非法 → 同样回落画文字', () => {
    const broken = { dataUri: ASSET.dataUri, width: 0, height: 30 }
    const svg = buildBadgeOverlay({ width: 800, height: 600, config: config.badge, image: broken }).toString()
    expect(svg).toContain('<text')
  })

  it('图片源下文案为空也能渲染（运营切到图片就不会再填文字）', () => {
    const emptyText = mergeWatermarkConfig({
      ...storedWatermark(),
      tiled: { ...storedWatermark().tiled, text: '' },
    })
    // 文案为空时会回落成 DEFAULT 的文案，但图片源下根本不看它
    const svg = buildTiledOverlay({ width: 800, height: 600, config: emptyText.tiled, image: ASSET }).toString()
    expect(svg).toContain('<use href="#wm"')
    expect(svg).not.toContain('<text')
  })
})

describe('resolveWatermarkRenderContext', () => {
  function fake(watermark: unknown, bytes: Buffer | null = Buffer.from('PNGBYTES')) {
    const get = vi.fn(async () => bytes)
    const payload = { findGlobal: vi.fn(async () => ({ watermark, siteName: '商办荟' })) } as never
    const writer = { get, put: vi.fn() } as never
    return { payload, writer, get }
  }

  it('两种版式指向同一张图时只读一次字节', async () => {
    const { payload, writer, get } = fake(storedWatermark())
    const ctx = await resolveWatermarkRenderContext(payload, writer)
    expect(get).toHaveBeenCalledTimes(1)
    expect(ctx.assets.tiled).not.toBeNull()
    expect(ctx.assets.badge).not.toBeNull()
    expect(ctx.assets.tiled?.dataUri.startsWith('data:image/png;base64,')).toBe(true)
  })

  /**
   * 读不到字节不抛错：水印图丢了不该让整条上传失败。返回 null → 构造器回落到文字，
   * 「有水印」这条不变量仍然成立。
   */
  it('存储里读不到字节 → 素材为 null，不抛错', async () => {
    const { payload, writer } = fake(storedWatermark(), null)
    const ctx = await resolveWatermarkRenderContext(payload, writer)
    expect(ctx.assets.tiled).toBeNull()
    expect(ctx.assets.badge).toBeNull()
  })

  it('文字源不碰存储', async () => {
    const { payload, writer, get } = fake({ ...storedWatermark(), tiled: { source: 'text' }, badge: { source: 'text' } })
    const ctx = await resolveWatermarkRenderContext(payload, writer)
    expect(get).not.toHaveBeenCalled()
    expect(ctx.assets).toEqual({ tiled: null, badge: null })
  })

  it('配置从没保存过时给出缺省且不碰存储', async () => {
    const { payload, writer, get } = fake(null)
    const ctx = await resolveWatermarkRenderContext(payload, writer)
    expect(get).not.toHaveBeenCalled()
    expect(ctx.config.enabled).toBe(DEFAULT_WATERMARK_CONFIG.enabled)
  })
})

/**
 * 2026-09-06 生产验收失败的那条：预览对图片源不实时。
 *
 * 初版只有文字参数走查询串，`source` 与图片取的是**已保存**的配置。运营在表单里把版式
 * 切到「图片」、选好 logo，预览却还在画文字——而同一个面板里密度、透明度、角度改一下
 * 立刻就变。没有任何东西能区分「还没保存」和「图片水印是坏的」。
 *
 * 混着来是最糟的形态：一半实时一半不实时，比全都不实时更误导人。
 */
describe('预览配置必须吃实时的 source 与 imageId', () => {
  const build = (qs: string) => buildPreviewWatermarkConfig(new URLSearchParams(qs), '商办荟')

  it('source=image + imageId → 两种版式都立住图片源', () => {
    const config = build('source=image&imageId=42&imageScale=0.25')
    expect(config.tiled.source).toBe('image')
    expect(config.badge.source).toBe('image')
    expect(config.tiled.imageRef?.id).toBe('42')
    expect(config.badge.imageRef?.id).toBe('42')
  })

  it('imageScale 跟随表单实时值', () => {
    expect(build('source=image&imageId=42&imageScale=0.25').tiled.imageScale).toBe(0.25)
  })

  it('source=image 但没有 imageId → 回落文字（运营还没选素材）', () => {
    const config = build('source=image&imageScale=0.25')
    expect(config.tiled.source).toBe('text')
    expect(config.tiled.imageRef).toBeNull()
  })

  it('不传 source → 保持文字，行为与改动前一致', () => {
    expect(build('text=%E5%95%86%E5%8A%9E%E8%8D%9F&density=3').tiled.source).toBe('text')
  })

  it('文字参数仍然实时——这条从一开始就是对的，别在重构里弄丢', () => {
    const config = build('text=ACME&density=5&opacity=0.6&angle=45')
    expect(config.tiled.text).toBe('ACME')
    expect(config.tiled.density).toBe(5)
    expect(config.tiled.angle).toBe(45)
  })
})

describe('loadPreviewImageAsset', () => {
  function fake(doc: unknown, bytes: Buffer | null = Buffer.from('BYTES')) {
    const findByID = vi.fn(async () => {
      if (doc === null) throw new Error('Not Found')
      return doc
    })
    return {
      payload: { findByID } as never,
      writer: { get: vi.fn(async () => bytes), put: vi.fn() } as never,
      findByID,
    }
  }
  const DOC = { id: 9, filename: 'logo.png', mimeType: 'image/png', width: 100, height: 50 }

  it('按 id 读出素材', async () => {
    const { payload, writer } = fake(DOC)
    const asset = await loadPreviewImageAsset(payload, writer, '9')
    expect(asset?.width).toBe(100)
    expect(asset?.dataUri.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('id 为空时不查库', async () => {
    const { payload, writer, findByID } = fake(DOC)
    expect(await loadPreviewImageAsset(payload, writer, '')).toBeNull()
    expect(await loadPreviewImageAsset(payload, writer, null)).toBeNull()
    expect(findByID).not.toHaveBeenCalled()
  })

  /** media 被删了不是异常，是「没有素材」——预览回落到文字，不应该 500。 */
  it('media 不存在时返回 null 而不是抛错', async () => {
    const { payload, writer } = fake(null)
    expect(await loadPreviewImageAsset(payload, writer, '999')).toBeNull()
  })

  it('存储里读不到字节时返回 null', async () => {
    const { payload, writer } = fake(DOC, null)
    expect(await loadPreviewImageAsset(payload, writer, '9')).toBeNull()
  })
})
