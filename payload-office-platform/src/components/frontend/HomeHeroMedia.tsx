'use client'

import React, { useEffect, useState } from 'react'
import { HERO_POSTER_SRC } from '@/lib/frontend/hero-poster'
import type { MediaViewModel } from '@/domain/public-catalog/contracts'

type NetworkInformation = Readonly<{
  saveData?: boolean
}>

type NavigatorWithConnection = Navigator & Readonly<{
  connection?: NetworkInformation
}>

/** 内置默认背景视频。运营没配 heroVideo 时用它——这是接线前的线上形态。 */
const DEFAULT_HERO_VIDEO_SRC = '/api/media/file/hero-bg.mp4?prefix=media'

/**
 * 首屏背景：图与视频**各自独立取值**，不互斥。
 *
 * 改之前这里是 `{!poster && loadVideo && <video>}`——配了 poster 就不渲染视频。
 * 于是运营在后台配了张 Hero 背景图，实际效果是「动态视频背景消失了」，
 * 而后台没有任何地方说明这个副作用。这不是「配置不生效」，是生效方式是错的：
 * **图本来就是视频的封面与降级底图，两者本该同时存在。**
 *
 * 「只要静态图、不要视频」现在由 `videoEnabled` 显式表达（默认开）——
 * 拆掉互斥等于拿走了原来那个隐式开关，不补一个就是修一个缺口开另一个。
 *
 * 三道既有闸门保留不动：prefers-reduced-motion / 移动端视口 / saveData。
 */
export default function HomeHeroMedia({
  poster,
  video,
  videoEnabled = true,
}: Readonly<{
  poster?: MediaViewModel | null
  /** 运营配置的背景视频；缺省用 DEFAULT_HERO_VIDEO_SRC。 */
  video?: Readonly<{ src: string }> | null
  /** 关掉则只渲染背景图。 */
  videoEnabled?: boolean
}> = {}) {
  const [loadVideo, setLoadVideo] = useState(false)

  useEffect(() => {
    if (!videoEnabled) return
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const mobileViewport = window.matchMedia('(max-width: 767px)').matches
    const saveData = (navigator as NavigatorWithConnection).connection?.saveData === true

    if (prefersReducedMotion || mobileViewport || saveData) return

    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(() => setLoadVideo(true), { timeout: 1500 })
      return () => window.cancelIdleCallback(id)
    }

    const id = globalThis.setTimeout(() => setLoadVideo(true), 800)
    return () => globalThis.clearTimeout(id)
  }, [videoEnabled])

  return (
    <div className="hero__bg" aria-hidden="true">
      <img
        src={poster?.src ?? HERO_POSTER_SRC}
        alt={poster?.alt ?? ''}
        loading="eager"
        decoding="async"
        className="hero__poster"
      />
      {videoEnabled && loadVideo && (
        // poster 与上面的 <img> 同源，不再各写一份
        <video autoPlay muted loop playsInline preload="none" poster={poster?.src ?? HERO_POSTER_SRC}>
          <source src={video?.src ?? DEFAULT_HERO_VIDEO_SRC} type="video/mp4" />
        </video>
      )}
    </div>
  )
}
