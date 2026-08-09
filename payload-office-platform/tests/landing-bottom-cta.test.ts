import { describe, expect, it } from 'vitest'
import { focusLandingTarget } from '@/components/frontend/landing/BottomCtaBar'

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
})
