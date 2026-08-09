import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'
import BottomCtaBar, {
  focusLandingTarget,
  shouldDockBottomCta,
} from '@/components/frontend/landing/BottomCtaBar'

describe('focusLandingTarget', () => {
  it('scrolls to a focusable target and transfers focus without moving it again', () => {
    const scrollCalls: ScrollIntoViewOptions[] = []
    const focusCalls: FocusOptions[] = []
    const target = {
      tabIndex: 0,
      hasAttribute: () => false,
      scrollIntoView: (options: ScrollIntoViewOptions) => scrollCalls.push(options),
      focus: (options: FocusOptions) => focusCalls.push(options),
    }

    const focused = focusLandingTarget('entrust-phone', {
      findTarget: (id: string) => (id === 'entrust-phone' ? target : null),
      prefersReducedMotion: () => false,
    })

    expect(focused).toBe(true)
    expect(scrollCalls).toEqual([{ behavior: 'smooth', block: 'center' }])
    expect(focusCalls).toEqual([{ preventScroll: true }])
  })

  it('uses instant scrolling for reduced motion and ignores non-focusable targets', () => {
    const scrollCalls: ScrollIntoViewOptions[] = []
    const focusCalls: FocusOptions[] = []
    const target = {
      tabIndex: 0,
      hasAttribute: () => false,
      scrollIntoView: (options: ScrollIntoViewOptions) => scrollCalls.push(options),
      focus: (options: FocusOptions) => focusCalls.push(options),
    }

    expect(focusLandingTarget('entrust-phone', {
      findTarget: () => target,
      prefersReducedMotion: () => true,
    })).toBe(true)
    expect(scrollCalls).toEqual([{ behavior: 'auto', block: 'center' }])

    expect(focusLandingTarget('not-focusable', {
      findTarget: () => ({ tabIndex: -1 }),
      prefersReducedMotion: () => false,
    })).toBe(false)
    expect(focusCalls).toEqual([{ preventScroll: true }])
  })

  it('does not scroll or focus a disabled target', () => {
    const scrollCalls: ScrollIntoViewOptions[] = []
    const focusCalls: FocusOptions[] = []
    const target = {
      tabIndex: 0,
      disabled: true,
      hasAttribute: () => false,
      scrollIntoView: (options: ScrollIntoViewOptions) => scrollCalls.push(options),
      focus: (options: FocusOptions) => focusCalls.push(options),
    }

    expect(focusLandingTarget('entrust-phone', {
      findTarget: () => target,
      prefersReducedMotion: () => false,
    })).toBe(false)
    expect(scrollCalls).toEqual([])
    expect(focusCalls).toEqual([])
  })
})

describe('shouldDockBottomCta', () => {
  it('docks only after the CTA anchor reaches the viewport, and undocks before it', () => {
    expect(shouldDockBottomCta(813, 812)).toBe(false)
    expect(shouldDockBottomCta(812, 812)).toBe(true)
    expect(shouldDockBottomCta(-24, 812)).toBe(true)
  })

  it('does not dock for invalid viewport measurements', () => {
    expect(shouldDockBottomCta(0, 0)).toBe(false)
    expect(shouldDockBottomCta(Number.NaN, 812)).toBe(false)
  })

  it('renders an undocked anchor and bar before browser effects run', () => {
    const markup = renderToStaticMarkup(
      React.createElement(BottomCtaBar, {
        text: '现在开始定制服务',
        ctaLabel: '免费委托定制',
        targetId: 'entrust-phone',
      }),
    )

    expect(markup).toContain('class="bottom-cta-anchor"')
    expect(markup).toContain('class="bottom-cta"')
    expect(markup).not.toContain('bottom-cta--docked')
  })
})
