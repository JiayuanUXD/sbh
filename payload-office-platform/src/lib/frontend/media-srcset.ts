// 从叶子模块导入，**不要**走 `@/domain/public-catalog` 这个 barrel：barrel 会把
// `supply-adapter`（进而 `payload` 的服务端上传代码）拖进客户端包。本文件被
// `ui/Media.tsx`（'use client'）引用，走 barrel 会让 dev 直接报
// `Can't resolve 'fs/promises'`、图片路由 500——2026-09-04 实测踩过一次。
import { pickVariantSrc } from '@/domain/public-catalog/mappers'
import type { MediaViewModel } from '@/domain/public-catalog/contracts'

/**
 * 派生尺寸 → `srcset` / `sizes`（OPT-068）。
 *
 * ## 修的是什么
 *
 * `Media.imageSizes` 早在 OPT-059 就配好了 thumb 320 / card 768 / hero 1600 三档
 * webp，但**只有走 `<Media>` 组件的调用方吃到 srcset**；楼盘封面那一批（首页热门
 * 楼盘 rail、楼盘列表卡 / 紧凑行、房源详情「所在楼盘」、楼盘详情「周边楼盘」）
 * 是手写 `<img src={coverImage.src}>`，直出原图。线上首页热门楼盘两张封面各
 * 1.7MB / 1.8MB，卡片显示宽度只有 ~360px。
 *
 * ## 为什么是这一份而不是各写各的
 *
 * `srcset` 的拼法、挑哪一档当 `src`、没有派生时该退回什么，这三件事必须同一个
 * 答案：卡片之间视觉一致（`.agent/frontend.md` 的全站一致性），而 `sizes` 写错
 * 只会让浏览器**选错档**、不会报错——同义逻辑散成六份的话，错了也看不出来。
 *
 * 存量图没有派生尺寸是常态（OPT-059 §7：不回填）——`scripts/backfill-media-sizes.ts`
 * 负责补，补之前这里一律退回原图，行为与改动前完全一致。
 */

/**
 * 派生档位的最小输入形状。
 *
 * 刻意不直接用 `Pick<MediaViewModel, 'variants'>`：`ui/Media.tsx` 有一份自己的
 * 本地 `MediaViewModel`（`variants` 可为 `null`），两处形状名同实异。这里只声明
 * 「有一组 {src,width}」这一个要求，两边都能喂。
 */
export type VariantSource = Readonly<{
  variants?: readonly Readonly<{ src: string; width: number }>[] | null
}>

/** `variants` → `"a 320w, b 768w, c 1600w"`；没有派生返回 undefined（不发 srcset）。 */
export function buildSrcSet(media: VariantSource): string | undefined {
  const variants = media.variants
  if (!variants || variants.length === 0) return undefined
  return variants.map((variant) => `${variant.src} ${variant.width}w`).join(', ')
}

export type CardCoverProps = Readonly<{
  src: string
  srcSet?: string
  sizes?: string
}>

/**
 * 卡片封面的 `<img>` 三件套。
 *
 * @param sizes 该图在版面里的显示宽度，如 `'(max-width: 767px) 100vw, 320px'`。
 *   只有存在派生尺寸时才发 `sizes`——没有 `srcset` 的 `sizes` 对浏览器无意义。
 * @param targetWidth 不支持 srcset 的浏览器会用 `src`，因此 `src` 挑「宽度 ≥ 该值的
 *   最小档」，默认 768（card 档）。
 */
export function cardCoverProps(
  media: MediaViewModel,
  sizes: string,
  targetWidth = 768,
): CardCoverProps {
  const srcSet = buildSrcSet(media)
  return {
    src: pickVariantSrc(media, targetWidth),
    ...(srcSet ? { srcSet, sizes } : {}),
  }
}
