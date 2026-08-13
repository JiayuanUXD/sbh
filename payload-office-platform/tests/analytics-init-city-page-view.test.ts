// @vitest-environment happy-dom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const navigationState = vi.hoisted(() => ({
  pathname: '/entrust',
  search: 'city=hangzhou',
}))

vi.mock('next/navigation', () => ({
  usePathname: () => navigationState.pathname,
  useSearchParams: () => new URLSearchParams(navigationState.search),
}))
vi.mock('@/lib/frontend/analytics/web-vitals', () => ({
  initWebVitals: async () => () => undefined,
}))

import { AnalyticsInit } from '@/lib/frontend/analytics/init'
import type { CityAnalyticsTrack } from '@/lib/frontend/analytics/landing'

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)

const cities = [
  { slug: 'shanghai', serviceStatus: 'live' as const },
  { slug: 'hangzhou', serviceStatus: 'coming-soon' as const },
]

let root: Root | null = null
let visibility = 'visible'

function render(tracker: CityAnalyticsTrack, multiCityRoutingEnabled = true) {
  if (!root) {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  }
  return act(async () => {
    root?.render(React.createElement(AnalyticsInit, {
      cities,
      defaultCity: 'shanghai',
      multiCityRoutingEnabled,
      tracker,
    }))
  })
}

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = null
  document.body.replaceChildren()
  navigationState.pathname = '/entrust'
  navigationState.search = 'city=hangzhou'
  visibility = 'visible'
})

describe('AnalyticsInit city page visibility', () => {
  it('waits for visibility, emits the latest navigation once, and dedupes rerenders', async () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
    const tracker = vi.fn()
    visibility = 'hidden'
    await render(tracker)
    expect(tracker).not.toHaveBeenCalled()

    visibility = 'visible'
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    expect(tracker).toHaveBeenCalledTimes(1)
    expect(tracker).toHaveBeenLastCalledWith('city_page_view', {
      city: 'hangzhou', status: 'coming-soon', page_type: 'entrust',
    })

    await render(tracker)
    expect(tracker).toHaveBeenCalledTimes(1)

    navigationState.pathname = '/publish'
    navigationState.search = 'city=shanghai'
    await render(tracker)
    expect(tracker).toHaveBeenCalledTimes(2)
    expect(tracker).toHaveBeenLastCalledWith('city_page_view', {
      city: 'shanghai', status: 'live', page_type: 'publish',
    })

    navigationState.pathname = '/news'
    navigationState.search = ''
    await render(tracker)
    expect(tracker).toHaveBeenCalledTimes(2)
    navigationState.pathname = '/publish'
    navigationState.search = 'city=shanghai'
    await render(tracker)
    expect(tracker).toHaveBeenCalledTimes(3)
  })

  it('holds a hidden navigation and emits only its latest trusted route after becoming visible', async () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
    const tracker = vi.fn()
    await render(tracker)
    expect(tracker).toHaveBeenCalledTimes(1)

    visibility = 'prerender'
    navigationState.pathname = '/city-partner'
    navigationState.search = 'city=hangzhou'
    await render(tracker)
    expect(tracker).toHaveBeenCalledTimes(1)

    visibility = 'visible'
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    expect(tracker).toHaveBeenCalledTimes(2)
    expect(tracker).toHaveBeenLastCalledWith('city_page_view', {
      city: 'hangzhou', status: 'coming-soon', page_type: 'city-partner',
    })
  })
})
