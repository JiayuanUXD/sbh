'use client'

import React, { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/frontend/ui'
import { track } from '@/lib/frontend/analytics'
import {
  LANDING_CONVERTED_EVENT,
  safeTrackLandingEvent,
  type LandingAnalyticsTrack,
  type LandingPageType,
} from '@/lib/frontend/analytics/landing'

type FocusableLandingTarget = {
  tabIndex: number
  disabled?: boolean
  hasAttribute: (qualifiedName: string) => boolean
  scrollIntoView: (options: ScrollIntoViewOptions) => void
  focus: (options?: FocusOptions) => void
}

type LandingFocusEnvironment = {
  findTarget: (targetId: string) => unknown
  prefersReducedMotion: () => boolean
}

type BottomCtaBarProps = {
  text: string
  ctaLabel: string
  targetId: string
  pageType: LandingPageType
  /** 用户已提交成功后吸底/收束条展示的文案；缺省则沿用 text。 */
  convertedText?: string
}

function isFocusableTarget(target: unknown): target is FocusableLandingTarget {
  if (typeof target !== 'object' || target === null) return false

  const candidate = target as Partial<FocusableLandingTarget>
  return typeof candidate.tabIndex === 'number'
    && candidate.tabIndex >= 0
    && typeof candidate.hasAttribute === 'function'
    && !candidate.hasAttribute('disabled')
    && candidate.disabled !== true
    && typeof candidate.scrollIntoView === 'function'
    && typeof candidate.focus === 'function'
}

export function focusLandingTarget(targetId: string, environment: LandingFocusEnvironment): boolean {
  const target = environment.findTarget(targetId)
  if (!isFocusableTarget(target)) return false

  target.scrollIntoView({
    behavior: environment.prefersReducedMotion() ? 'auto' : 'smooth',
    block: 'center',
  })
  target.focus({ preventScroll: true })
  return true
}

export function activateBottomCta(
  pageType: LandingPageType,
  targetId: string,
  environment: LandingFocusEnvironment,
  analyticsTrack: LandingAnalyticsTrack = track,
): boolean {
  safeTrackLandingEvent(analyticsTrack, 'landing_bottom_cta_click', {
    page_type: pageType,
  })
  return focusLandingTarget(targetId, environment)
}

/** CTA 锚点进入视口后才吸底，回滚到锚点前则恢复普通流。 */
export function shouldDockBottomCta(anchorTop: number, viewportHeight: number): boolean {
  return Number.isFinite(anchorTop)
    && Number.isFinite(viewportHeight)
    && viewportHeight > 0
    && anchorTop <= viewportHeight
}

function createBrowserFocusEnvironment(): LandingFocusEnvironment {
  return {
    findTarget: (targetId) => {
      const target = document.getElementById(targetId)
      return target instanceof HTMLElement ? target : null
    },
    prefersReducedMotion: () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  }
}

export { createBrowserFocusEnvironment }

export default function BottomCtaBar({ text, ctaLabel, targetId, pageType, convertedText }: BottomCtaBarProps) {
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const barRef = useRef<HTMLDivElement | null>(null)
  const [docked, setDocked] = useState(false)
  const [barHeight, setBarHeight] = useState(0)
  const [converted, setConverted] = useState(false)
  const footerVisibleRef = useRef(false)

  // 表单提交成功 → 收束条切「已收到」态，不再对用户重复索取。
  useEffect(() => {
    const onConverted = (event: Event) => {
      const detail = (event as CustomEvent<{ pageType?: string }>).detail
      if (detail?.pageType === pageType) setConverted(true)
    }
    window.addEventListener(LANDING_CONVERTED_EVENT, onConverted)
    return () => window.removeEventListener(LANDING_CONVERTED_EVENT, onConverted)
  }, [pageType])

  useEffect(() => {
    const anchor = anchorRef.current
    const bar = barRef.current
    if (!anchor || !bar) return

    const mobileQuery = window.matchMedia('(max-width: 640px)')
    let animationFrame: number | null = null

    const updateBarHeight = () => {
      const nextHeight = Math.ceil(bar.getBoundingClientRect().height)
      setBarHeight((currentHeight) => currentHeight === nextHeight ? currentHeight : nextHeight)
    }
    const updateDocking = () => {
      animationFrame = null
      updateBarHeight()
      // 页脚进入视口时让行：滚到底不再被吸底条遮挡页脚末行。
      const nextDocked = !converted
        && !footerVisibleRef.current
        && mobileQuery.matches
        && shouldDockBottomCta(anchor.getBoundingClientRect().top, window.innerHeight)
      setDocked((currentDocked) => currentDocked === nextDocked ? currentDocked : nextDocked)
    }
    const scheduleUpdate = () => {
      if (animationFrame !== null) return
      animationFrame = window.requestAnimationFrame(updateDocking)
    }
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(scheduleUpdate)
    const footer = document.querySelector('footer')
    const footerObserver = footer && typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver(
        (entries) => {
          footerVisibleRef.current = entries.some((entry) => entry.isIntersecting)
          scheduleUpdate()
        },
        { threshold: 0 },
      )
      : null

    resizeObserver?.observe(bar)
    if (footer) footerObserver?.observe(footer)
    updateDocking()
    window.addEventListener('scroll', scheduleUpdate, { passive: true })
    window.addEventListener('resize', scheduleUpdate)
    mobileQuery.addEventListener('change', scheduleUpdate)

    return () => {
      window.removeEventListener('scroll', scheduleUpdate)
      window.removeEventListener('resize', scheduleUpdate)
      mobileQuery.removeEventListener('change', scheduleUpdate)
      resizeObserver?.disconnect()
      footerObserver?.disconnect()
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame)
    }
  }, [converted])

  const focusTarget = () => {
    activateBottomCta(pageType, targetId, createBrowserFocusEnvironment())
  }

  return (
    <div
      ref={anchorRef}
      className="bottom-cta-anchor"
      style={docked && barHeight > 0 ? { minHeight: `${barHeight}px` } : undefined}
    >
      <div ref={barRef} className={docked ? 'bottom-cta bottom-cta--docked' : 'bottom-cta'}>
        {converted ? (
          <p className="bottom-cta__text" role="status">{convertedText ?? text}</p>
        ) : (
          <>
            <p className="bottom-cta__text">{text}</p>
            <Button variant="primary" size="lg" onClick={focusTarget}>{ctaLabel}</Button>
          </>
        )}
      </div>
    </div>
  )
}
