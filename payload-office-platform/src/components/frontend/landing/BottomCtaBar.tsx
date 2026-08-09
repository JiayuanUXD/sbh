'use client'

import React from 'react'
import { Button } from '@/components/frontend/ui'

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

function createBrowserFocusEnvironment(): LandingFocusEnvironment {
  return {
    findTarget: (targetId) => {
      const target = document.getElementById(targetId)
      return target instanceof HTMLElement ? target : null
    },
    prefersReducedMotion: () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  }
}

export default function BottomCtaBar({ text, ctaLabel, targetId }: BottomCtaBarProps) {
  const focusTarget = () => {
    focusLandingTarget(targetId, createBrowserFocusEnvironment())
  }

  return (
    <div className="bottom-cta">
      <p className="bottom-cta__text">{text}</p>
      <Button variant="primary" size="lg" onClick={focusTarget}>{ctaLabel}</Button>
    </div>
  )
}
