'use client'

import React, { useEffect, useState } from 'react'

type NetworkInformation = Readonly<{
  saveData?: boolean
}>

type NavigatorWithConnection = Navigator & Readonly<{
  connection?: NetworkInformation
}>

export default function HomeHeroMedia() {
  const [loadVideo, setLoadVideo] = useState(false)

  useEffect(() => {
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
  }, [])

  return (
    <div className="hero__bg" aria-hidden="true">
      <img
        src="/hero/poster.jpg"
        alt=""
        loading="eager"
        decoding="async"
        className="hero__poster"
      />
      {loadVideo && (
        <video autoPlay muted loop playsInline preload="none" poster="/hero/poster.jpg">
          <source src="/api/media/file/hero-bg.mp4?prefix=media" type="video/mp4" />
        </video>
      )}
    </div>
  )
}
