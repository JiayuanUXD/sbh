'use client'

import React, { useState } from 'react'

/**
 * 媒体图片原语
 *
 * 设计依据：specs/frontend-mvp/design.md §6.5、§13
 * 守护不变量：
 *   - 显式 width/height 防 CLS（web-design-guidelines）；
 *   - 缺失 alt 时由调用方传入可读替代（楼盘名 + 空间类型）；
 *   - 图片失败或**本就没有图**都展示固定比例缺省图，不阻塞详情。两种情形文案
 *     不同：无图房源是常态（前台可见性已不再要求图片，见 domain/review/
 *     effective-supply.ts），说「暂未加载」会让人以为是网络问题一直等下去；
 *   - below-fold 默认 lazy；首屏可设 priority。
 */

export type MediaViewModel = {
  src: string
  alt: string | null
  width?: number | null
  height?: number | null
  blurDataURL?: string | null
  /** 派生尺寸，按宽度升序（OPT-059）。缺省表示存量图，回落 src。 */
  variants?: readonly { src: string; width: number }[] | null
  /** 裁切焦点百分比（0-100）。缺省 → CSS 回退 50%，等于改动前的居中裁切。 */
  focal?: { x: number; y: number } | null
}

type Props = {
  media: MediaViewModel | null | undefined
  /** 宽高比，如 '4/3'、'16/10'；不设时按 width/height */
  ratio?: '4/3' | '16/10' | '1/1' | 'auto'
  /** 是否首屏关键图（开启 priority） */
  priority?: boolean
  /** 缺失时的占位文案 */
  fallbackAlt?: string
  className?: string
  /** HTML sizes 属性：告诉浏览器该图在版面里的显示宽度，指导它从 srcset 选档 */
  sizes?: string
  /**
   * 图片是纯装饰：同一可点击区域内已有可见文字表达同样的信息（如卡片标题），
   * 图片本身不承载额外信息。开启后 `media.alt` / `fallbackAlt` 一律不使用——
   * 正常渲染时 `alt=""`；加载失败或缺失渲染占位块时整体对辅助技术隐藏
   * （不发 `role="img"` / `aria-label`），因为占位块的文案是给"图坏了"这件事
   * 本身的说明，装饰图坏了不该让读屏用户听到一段和卡片主体重复的公告。
   * OPT-059：首页「按类型浏览」「热门商圈」卡片属此类——图旁边就是类型名/商圈名。
   */
  decorative?: boolean
}

export function Media({ media, ratio = '4/3', priority = false, fallbackAlt, className, sizes, decorative = false }: Props) {
  const [errored, setErrored] = useState(false)
  const alt = decorative ? '' : media?.alt || fallbackAlt || ''
  const ratioStyle = ratio !== 'auto' ? { aspectRatio: ratio.replace('/', ' / ') } : undefined

  if (!media?.src || errored) {
    const missing = !media?.src
    return (
      <div
        className={['media-placeholder', className ?? ''].filter(Boolean).join(' ')}
        style={ratioStyle}
        role={decorative ? undefined : 'img'}
        aria-hidden={decorative ? 'true' : undefined}
        aria-label={decorative ? undefined : alt || (missing ? '暂无图片' : '图片加载失败')}
        data-media-state={missing ? 'missing' : 'errored'}
      >
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="9" cy="9" r="2" />
          <path d="m21 15-5-5L5 21" />
        </svg>
        <span className="media-placeholder__text">
          <strong>{missing ? '暂无图片' : '图片暂未加载'}</strong>
          <span>{missing ? '可查看房源信息或联系顾问' : '可先查看房源信息'}</span>
        </span>
      </div>
    )
  }

  // 派生尺寸缺省是常态（存量图不回填，见 OPT-059 spec §7）——此时不发 srcSet，
  // 浏览器就用 src，行为与改动前完全一致。
  const srcSet = media.variants?.length
    ? media.variants.map((v) => `${v.src} ${v.width}w`).join(', ')
    : undefined

  // focal 必须两轴齐全（mapMedia 已保证），这里再挡一次是因为本组件的 props
  // 类型对外开放，调用方可能手工构造。
  const focalStyle =
    media.focal && typeof media.focal.x === 'number' && typeof media.focal.y === 'number'
      ? ({ '--focal-x': `${media.focal.x}%`, '--focal-y': `${media.focal.y}%` } as React.CSSProperties)
      : undefined

  return (
    <img
      src={media.src}
      srcSet={srcSet}
      sizes={srcSet ? sizes : undefined}
      alt={alt}
      width={media.width ?? undefined}
      height={media.height ?? undefined}
      loading={priority ? undefined : 'lazy'}
      decoding={priority ? undefined : 'async'}
      // OPT-059 裁定：不接 next/image。其运行时优化器的缓存在 CloudRun 实例
      // 临时盘上，本仓库「合并 master 即上线」的发版频率会让它每次清空；且媒体
      // 走同源 Payload 文件路由，优化器未命中要打回自身 API 再回源 COS。
      // 改走上传时派生（Media.imageSizes）+ 原生 srcset。理由全文见
      // specs/work-items/OPT-059-image-pipeline-derived-sizes.md §4。
      onError={() => setErrored(true)}
      className={className}
      style={{ ...ratioStyle, ...focalStyle }}
    />
  )
}
