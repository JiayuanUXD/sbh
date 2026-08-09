// @vitest-environment happy-dom

import React, { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const trackSpy = vi.hoisted(() => vi.fn())

vi.mock('@/lib/frontend/analytics', () => ({ track: trackSpy }))

import LandingViewAnalytics from '@/components/frontend/landing/LandingViewAnalytics'

describe('LandingViewAnalytics', () => {
  afterEach(() => {
    document.body.replaceChildren()
    trackSpy.mockReset()
  })

  it('reports one exposure per mount even when StrictMode replays effects', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        React.createElement(
          StrictMode,
          null,
          React.createElement(LandingViewAnalytics, { pageType: 'entrust' }),
        ),
      )
    })

    expect(trackSpy).toHaveBeenCalledTimes(1)
    expect(trackSpy).toHaveBeenCalledWith('landing_view', { page_type: 'entrust' })

    await act(async () => root.unmount())
  })
})
