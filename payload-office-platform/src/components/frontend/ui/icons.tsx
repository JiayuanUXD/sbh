/**
 * C 端共享图标原语
 *
 * 为什么存在：站内原先用**文字字符**当图标（`‹` `›` `×`），散在 6 个组件里。
 * 文字字形有自己的基线与 ink box，`display:flex` + `align-items:center` 居中的是
 * **行盒**不是字形——`‹` 的墨迹重心偏上，于是在圆形按钮里目视永远偏高一点点。
 * 靠 `line-height` / `padding-top` 去凑属于对症不对因，换个字号或字体就再次跑偏。
 * SVG 的 viewBox 是几何盒，flex 居中即真居中，且描边粗细可控。
 *
 * 造型取 Apple SF Symbols 的画法：24×24 viewBox、纯描边无填充、`stroke-linecap`
 * 与 `stroke-linejoin` 都是 round、`stroke-width: 2`。chevron 的开合角与 SF Symbols
 * 的 `chevron.left/right` 一致（从 (15,5) 折到 (8,12) 再到 (15,19)，即 ±45°），
 * 不用 `<` 那种更尖的夹角——后者在小尺寸下显得廉价。
 *
 * 尺寸由调用方给 `size`（默认 20），颜色一律 `currentColor`，交给按钮自己的
 * `color` 决定，不在图标里写死任何颜色。
 */
import React from 'react'

type IconProps = Readonly<{
  /** 边长（px），同时作用于宽高。默认 20。 */
  size?: number
  className?: string
}>

/**
 * 图标一律 `aria-hidden`：本仓库的调用点全部是带 `aria-label` 的 <button>，
 * 图标再暴露一次语义就会让读屏念两遍。若将来有「图标即唯一语义」的场景，
 * 由调用方在外层元素上给 role/aria-label，不要改这里。
 */
const base = (size: number, className?: string) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
  className,
})

export function ChevronLeftIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M15 5 8 12l7 7" />
    </svg>
  )
}

export function ChevronRightIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="m9 5 7 7-7 7" />
    </svg>
  )
}

/** SF Symbols `xmark`：两条等长对角线，端点 round。 */
export function XMarkIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

/**
 * 缺省图占位用的「照片」图标（SF Symbols `photo` 的描边画法）。
 * 与 `ui/Media.tsx`、`DetailGallery` 的空态共用同一张，避免两处各画一份。
 * 描边比上面几个细一档（1.5）：占位图是背景元素，不该和可点击控件一样重。
 */
export function PhotoIcon({ size = 40, className }: IconProps) {
  return (
    <svg {...base(size, className)} strokeWidth={1.5}>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="8.5" cy="8.5" r="1.75" />
      <path d="M21 14.5 16.5 10 5 21.5" />
    </svg>
  )
}
