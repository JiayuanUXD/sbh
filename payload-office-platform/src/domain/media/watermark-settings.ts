/**
 * OPT-069 水印配置的**唯一读取路径**。
 *
 * 「读 `site-settings` → `mergeWatermarkConfig(watermark, siteName)`」曾在三处各抄一份
 * （`plugins/watermark.ts`、`watermark-rebake.ts`、`scripts/backfill-watermark.ts`），
 * 而第四条路——后台预览端点——已经分叉了：它传的是 `fallbackText = null`。
 * 于是运营按 `SiteSettings` 里「留空则回落为『站点名称』」的说明清空文案之后，
 * **预览渲染 `商办荟`（DEFAULT 常量）、烘焙渲染站点名称**，正好打穿那个 tab 存在的
 * 唯一意义（所见即所得）。抄三份就是它发生的原因，所以收口到这里。
 *
 * `tests/watermark-config-resolution.test.ts` 有一条源码守卫：四条路都必须引用本模块、
 * 都不许自己调 `findGlobal`。只测行为拦不住「有人又抄一份」——新抄的那份一开始必然
 * 与共享实现一致，漂移要几个月后才显形。
 */

import type { Payload } from 'payload'

import {
  DEFAULT_WATERMARK_CONFIG,
  mergeWatermarkConfig,
  type WatermarkConfig,
  type WatermarkImageAsset,
} from './watermark'
import { MEDIA_COS_PREFIX } from '@/lib/storage/cos-config'
import type { MediaWriter } from '@/lib/storage/media-writer'

/** `SiteSettings` 里与水印有关的两个字段。`siteName` 是文案的回落值。 */
export type WatermarkSiteSettings = { watermark?: unknown; siteName?: string | null }

/**
 * `depth: 1` 是硬要求，不是随手写的。
 *
 * OPT-071 起水印可以用上传的图片当水印源，而 `normalizeImageRef` **只认展开后的对象形态**：
 * depth 0 读出来的 upload 关系只有一个裸 id，拿不到 `updatedAt`——运营同名覆盖上传时
 * id 不变而像素全变，只哈希 id 等于「换了 logo 但版本没变」，之后每一轮重刷都判 skip，
 * 新旧 logo 永久共存。depth 1 顺带把 filename / width / height 一起带回来，
 * `resolveWatermarkRenderContext` 因此不需要为读素材再查一次库。
 *
 * `tests/watermark-config-resolution.test.ts` 钉住这条：改回 depth 0 会红。
 */
export async function readWatermarkSiteSettings(payload: Payload): Promise<WatermarkSiteSettings> {
  return (await payload.findGlobal({
    slug: 'site-settings',
    depth: 1,
    overrideAccess: true,
  })) as WatermarkSiteSettings
}

/**
 * 烘焙侧的配置：上传插件、重刷任务、回刷脚本三条路共用。
 *
 * 三处若各读各的，会在「配置缺省」这件事上给出不同答案，表现为「新上传带水印、重刷后不带」
 * 这种极难查的错位；`watermark.version` 是这份配置的哈希，读法不同还会让版本判定永远不命中，
 * 续跑退化成全量重烘且没有任何报错。
 */
export async function resolveWatermarkConfig(payload: Payload): Promise<WatermarkConfig> {
  const settings = await readWatermarkSiteSettings(payload)
  return mergeWatermarkConfig(settings?.watermark, settings?.siteName)
}

/**
 * 预览侧的配置：查询参数（后台表单里的**实时值**，可能还没保存）+ 站点名称回落。
 *
 * 三件事必须与烘焙侧一致，所以同样过 `mergeWatermarkConfig`：
 *
 *   - 空文案回落到 `fallbackText`（站点名称），与烘焙一致——这正是分叉过的那一条；
 *   - 超范围的 density / opacity / angle 按同一套规则夹取（两个 overlay 构造器自身不校验）；
 *   - 缺字段回落到 `DEFAULT_WATERMARK_CONFIG`。
 *
 * `enabled` 恒 true：预览只是渲染样张给人看，与总开关无关。
 */
export function buildPreviewWatermarkConfig(
  params: URLSearchParams,
  fallbackText: string | null | undefined,
): WatermarkConfig {
  const number = (key: string, fallback: number): number => {
    const raw = Number(params.get(key))
    return Number.isFinite(raw) ? raw : fallback
  }

  /**
   * `source` 与图片 id 也从查询参数来，**和文字参数一样实时**。
   *
   * 沿革（真实事故，2026-09-06 生产验收）：初版只有文字参数走查询串，`source` 与
   * 图片取的是**已保存**的配置。运营在表单里把版式切到「图片」、选好 logo，预览却还在
   * 画文字——而同一个面板里密度、透明度、角度改一下立刻就变。于是没有任何东西能区分
   * 「还没保存」和「图片水印是坏的」，验收直接判失败。
   *
   * 混着来是最糟的形态：一半实时一半不实时，比全都不实时更误导人。
   *
   * `updatedAt` 在这里填占位值：它存在的意义是让**版本哈希**能察觉同名覆盖上传，
   * 而预览不参与哈希、不写 version，只需要 source 能立住。
   */
  const imageId = (params.get('imageId') ?? '').trim()
  const previewImageRef = imageId ? { id: imageId, updatedAt: 'preview' } : null
  const sourceOf = (key: string): 'text' | 'image' =>
    params.get(key) === 'image' && previewImageRef ? 'image' : 'text'

  return mergeWatermarkConfig(
    {
      enabled: true,
      tiled: {
        source: sourceOf('source'),
        image: previewImageRef,
        imageScale: number('imageScale', DEFAULT_WATERMARK_CONFIG.tiled.imageScale),
        text: params.get('text'),
        density: number('density', DEFAULT_WATERMARK_CONFIG.tiled.density),
        opacity: number('opacity', DEFAULT_WATERMARK_CONFIG.tiled.opacity),
        angle: number('angle', DEFAULT_WATERMARK_CONFIG.tiled.angle),
      },
      badge: {
        source: sourceOf('source'),
        image: previewImageRef,
        imageScale: number('imageScale', DEFAULT_WATERMARK_CONFIG.badge.imageScale),
        text: params.get('text'),
        position: params.get('position'),
        opacity: number('opacity', DEFAULT_WATERMARK_CONFIG.badge.opacity),
      },
    },
    fallbackText,
  )
}

/**
 * 按 media id 读一枚水印素材，**供预览使用**。
 *
 * 与烘焙那条路（`resolveWatermarkRenderContext`）分开：烘焙读的是已保存配置指向的图，
 * 预览读的是运营此刻在表单里选中的图——后者还没落库，只有一个 id。
 * 两者共用 `loadAsset`，所以「怎么把字节做成 data URI」仍然只有一处定义。
 *
 * 调用方已过 `site_settings:manage`，因此 `overrideAccess: true` 是安全的：
 * 能改站点配置的人本来就能看全部媒体。
 */
export async function loadPreviewImageAsset(
  payload: Payload,
  writer: MediaWriter,
  imageId: string | null | undefined,
): Promise<WatermarkImageAsset | null> {
  const id = (imageId ?? '').trim()
  if (!id) return null
  try {
    const media = await payload.findByID({ collection: 'media', id, depth: 0, overrideAccess: true })
    const doc = readMediaDoc(media)
    if (!doc) return null
    return await loadAsset(doc, writer)
  } catch {
    // 找不到这条 media（被删了 / id 非法）不是异常，是「没有素材」——回落到文字。
    return null
  }
}


/** 两种版式各自的图片素材。为 null 表示这一版式用文字（或素材取不到，已回落）。 */
export type WatermarkAssets = {
  tiled: WatermarkImageAsset | null
  badge: WatermarkImageAsset | null
}

/** 渲染一次水印需要的全部输入：配置 + 素材字节。四条渲染路径共用。 */
export type WatermarkRenderContext = {
  config: WatermarkConfig
  assets: WatermarkAssets
}

/**
 * depth 1 展开后的 media 文档里，读字节与算比例需要的那几个字段。
 *
 * 缺任何一项就返回 null → 回落到文字。`width` / `height` 尤其不能少：
 * `<image>` 只给宽度时由 `preserveAspectRatio` 决定高度，不同 librsvg 版本行为不一致，
 * 显式给两个值才稳（见 `WatermarkImageAsset` 的注释）。
 */
type WatermarkMediaDoc = {
  filename: string
  mimeType: string
  width: number
  height: number
}

function readMediaDoc(value: unknown): WatermarkMediaDoc | null {
  if (value == null || typeof value !== 'object') return null
  const doc = value as Record<string, unknown>
  const { filename, mimeType, width, height } = doc
  if (typeof filename !== 'string' || !filename) return null
  if (typeof mimeType !== 'string' || !mimeType) return null
  if (typeof width !== 'number' || typeof height !== 'number') return null
  if (width <= 0 || height <= 0) return null
  return { filename, mimeType, width, height }
}

/**
 * 读一枚水印图片的字节，做成 data URI。
 *
 * 走 `MediaWriter` 按对象键直读，与重刷任务、回刷脚本同一条通道——**不走站点文件路由**。
 * 理由与 `backfill-watermark.ts` 头注释「读原图字节」一节相同：这里要的是存储里实际存着的
 * 字节，而文件路由端出来的是 Payload 愿意返回的东西（过 access control、按记录的 prefix 找键、
 * COS 模式下还要站点自己转发一次）。烘焙发生在上传管线内部，此刻站点未必能自己请求自己。
 *
 * 取不到就返回 null → 上层回落到文字。**刻意不抛错**：水印图读不到不该让整条上传失败，
 * 而回落到文字仍然保证「有水印」这条不变量。
 */
async function loadAsset(doc: WatermarkMediaDoc, writer: MediaWriter): Promise<WatermarkImageAsset | null> {
  const bytes = await writer.get({ prefix: MEDIA_COS_PREFIX, filename: doc.filename })
  if (!bytes || bytes.length === 0) return null
  return {
    dataUri: `data:${doc.mimeType};base64,${bytes.toString('base64')}`,
    width: doc.width,
    height: doc.height,
  }
}

/**
 * 配置 + 素材，一次读齐。**烘焙、重刷、回刷脚本、后台预览四条路都必须走这里。**
 *
 * 四处各读各的会在「素材取不到时怎么办」这件事上给出不同答案，表现为「新上传带 logo、
 * 重刷后变成文字」这种极难查的错位；而 `watermark.version` 是配置的哈希，读法不同还会让
 * 版本判定永远不命中。`tests/watermark-config-resolution.test.ts` 有源码守卫钉住这条。
 *
 * 两种版式指向同一张图时只读一次字节——满铺 + 角标用同一个 logo 是最常见的配法，
 * 而每张被烘焙的图都要付这次读取。
 */
export async function resolveWatermarkRenderContext(
  payload: Payload,
  writer: MediaWriter,
): Promise<WatermarkRenderContext> {
  const settings = await readWatermarkSiteSettings(payload)
  const config = mergeWatermarkConfig(settings?.watermark, settings?.siteName)

  const stored = (settings?.watermark ?? {}) as Record<string, any>
  const tiledDoc = config.tiled.source === 'image' ? readMediaDoc(stored?.tiled?.image) : null
  const badgeDoc = config.badge.source === 'image' ? readMediaDoc(stored?.badge?.image) : null

  const cache = new Map<string, WatermarkImageAsset | null>()
  const load = async (doc: WatermarkMediaDoc): Promise<WatermarkImageAsset | null> => {
    const key = doc.filename
    if (cache.has(key)) return cache.get(key) ?? null
    const asset = await loadAsset(doc, writer)
    cache.set(key, asset)
    return asset
  }

  return {
    config,
    assets: {
      tiled: tiledDoc ? await load(tiledDoc) : null,
      badge: badgeDoc ? await load(badgeDoc) : null,
    },
  }
}
