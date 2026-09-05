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

import { DEFAULT_WATERMARK_CONFIG, mergeWatermarkConfig, type WatermarkConfig } from './watermark'

/** `SiteSettings` 里与水印有关的两个字段。`siteName` 是文案的回落值。 */
export type WatermarkSiteSettings = { watermark?: unknown; siteName?: string | null }

export async function readWatermarkSiteSettings(payload: Payload): Promise<WatermarkSiteSettings> {
  return (await payload.findGlobal({
    slug: 'site-settings',
    depth: 0,
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

  return mergeWatermarkConfig(
    {
      enabled: true,
      tiled: {
        text: params.get('text'),
        density: number('density', DEFAULT_WATERMARK_CONFIG.tiled.density),
        opacity: number('opacity', DEFAULT_WATERMARK_CONFIG.tiled.opacity),
        angle: number('angle', DEFAULT_WATERMARK_CONFIG.tiled.angle),
      },
      badge: {
        text: params.get('text'),
        position: params.get('position'),
        opacity: number('opacity', DEFAULT_WATERMARK_CONFIG.badge.opacity),
      },
    },
    fallbackText,
  )
}
