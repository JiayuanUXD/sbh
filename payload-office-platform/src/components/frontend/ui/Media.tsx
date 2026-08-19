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
}

export function Media({ media, ratio = '4/3', priority = false, fallbackAlt, className }: Props) {
  const [errored, setErrored] = useState(false)
  const alt = media?.alt || fallbackAlt || ''
  const ratioStyle = ratio !== 'auto' ? { aspectRatio: ratio.replace('/', ' / ') } : undefined

  if (!media?.src || errored) {
    const missing = !media?.src
    return (
      <div
        className={['media-placeholder', className ?? ''].filter(Boolean).join(' ')}
        style={ratioStyle}
        role="img"
        aria-label={alt || (missing ? '暂无图片' : '图片加载失败')}
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

  return (
    <img
      src={media.src}
      alt={alt}
      width={media.width ?? undefined}
      height={media.height ?? undefined}
      loading={priority ? undefined : 'lazy'}
      decoding={priority ? undefined : 'async'}
      // priority 用于首屏关键图，由 Next.js 优化（暂走原生 img，后续接入 next/image）
      onError={() => setErrored(true)}
      className={className}
      style={ratioStyle}
    />
  )
}
