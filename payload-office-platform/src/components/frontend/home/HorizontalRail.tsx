'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'

/**
 * OPT-035 通栏横滑基元：首卡对齐栏线（scroll-padding 与容器同边距）、
 * scroll-snap 吸附、右缘 44×44 悬浮箭头、端点隐藏对应箭头。
 * 被热门楼盘 / 精选房源 / 核心商圈房源三处复用；卡片由调用方以 children 传入，
 * 每张卡包一层 .hm-rail__item。
 */
export default function HorizontalRail({ ariaLabel, children }: Readonly<{
  ariaLabel: string
  children: React.ReactNode
}>) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [canPrev, setCanPrev] = useState(false)
  const [canNext, setCanNext] = useState(false)

  const sync = useCallback(() => {
    const el = trackRef.current
    if (!el) return
    setCanPrev(el.scrollLeft > 4)
    setCanNext(el.scrollLeft < el.scrollWidth - el.clientWidth - 4)
  }, [])

  useEffect(() => {
    sync()
    const el = trackRef.current
    if (!el) return
    const observer = new ResizeObserver(sync)
    observer.observe(el)
    return () => observer.disconnect()
  }, [sync])

  const scroll = (dir: 1 | -1) => {
    const el = trackRef.current
    if (!el) return
    const card = el.firstElementChild
    const step = card ? card.getBoundingClientRect().width + 16 : 416
    el.scrollBy({ left: dir * step, behavior: 'smooth' })
  }

  return (
    <div className="hm-rail">
      <div className="hm-rail__track" ref={trackRef} onScroll={sync} role="list" aria-label={ariaLabel}>
        {children}
      </div>
      <button type="button" className="hm-rail__arrow hm-rail__arrow--prev" hidden={!canPrev}
        aria-label="上一组" onClick={() => scroll(-1)}>
        <svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true"><path d="M8 1L2 8l6 7" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      <button type="button" className="hm-rail__arrow hm-rail__arrow--next" hidden={!canNext}
        aria-label="下一组" onClick={() => scroll(1)}>
        <svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true"><path d="M2 1l6 7-6 7" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
    </div>
  )
}
