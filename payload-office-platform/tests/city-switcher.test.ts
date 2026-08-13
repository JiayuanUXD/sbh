// @vitest-environment happy-dom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const navigationState = vi.hoisted(() => ({
  pathname: '/shanghai/listings',
  search: 'areaMin=100&district=pudong&page=3',
}))

const trackSpy = vi.hoisted(() => vi.fn())

vi.mock('@/lib/frontend/analytics', () => ({
  track: trackSpy,
  safeTrackCityEvent: (tracker: typeof trackSpy, name: string, props: Record<string, unknown>) => {
    tracker(name, props)
  },
}))

vi.mock('next/navigation', () => ({
  usePathname: () => navigationState.pathname,
  useSearchParams: () => new URLSearchParams(navigationState.search),
}))

import CitySwitcher from '@/components/frontend/CitySwitcher'
import SiteFooter from '@/components/frontend/SiteFooter'
import SiteHeader from '@/components/frontend/SiteHeader'

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)

const cities = [
  { slug: 'shanghai', name: '上海', serviceStatus: 'live' as const, sortOrder: 10 },
  { slug: 'hangzhou', name: '杭州', serviceStatus: 'coming-soon' as const, sortOrder: 20 },
]

let root: Root | null = null

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = null
  document.body.replaceChildren()
  vi.unstubAllGlobals()
  trackSpy.mockClear()
  navigationState.pathname = '/shanghai/listings'
  navigationState.search = 'areaMin=100&district=pudong&page=3'
})

async function renderSwitcher() {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(React.createElement(CitySwitcher, {
      cities,
      defaultCity: 'shanghai',
    }))
  })
  return container
}

async function rerenderSwitcher(options: ReadonlyArray<(typeof cities)[number]> = cities) {
  await act(async () => {
    root?.render(React.createElement(CitySwitcher, {
      cities: options,
      defaultCity: 'shanghai',
    }))
  })
}

async function renderShell(options: ReadonlyArray<(typeof cities)[number]> = cities) {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(React.createElement(React.Fragment, null,
      React.createElement(SiteHeader, { cities: options, defaultCity: 'shanghai' }),
      React.createElement(SiteFooter, { cities: options, defaultCity: 'shanghai' }),
    ))
  })
  return container
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => element.click())
}

describe('CitySwitcher', () => {
  it('renders the trusted cities with textual service status and the canonical switched link', async () => {
    await renderSwitcher()

    const trigger = document.querySelector<HTMLButtonElement>('[aria-controls="city-switcher-menu"]')
    if (!trigger) throw new Error('missing city switcher trigger')
    await click(trigger)

    const shanghai = document.querySelector<HTMLAnchorElement>('a[href="/shanghai/listings?areaMin=100"]')
    const hangzhou = document.querySelector<HTMLAnchorElement>('a[href="/hangzhou/listings?areaMin=100"]')
    expect(shanghai?.textContent).toContain('上海')
    expect(shanghai?.textContent).toContain('已开通')
    expect(shanghai?.getAttribute('aria-current')).toBe('page')
    expect(hangzhou?.textContent).toContain('杭州')
    expect(hangzhou?.textContent).toContain('正在开通')
    expect(trackSpy).toHaveBeenCalledWith('city_switcher_opened', {
      city: 'shanghai', status: 'live', page_type: 'listings',
    })
    if (!hangzhou) throw new Error('missing Hangzhou option')
    await click(hangzhou)
    expect(trackSpy).toHaveBeenCalledWith('city_switched', {
      from_city: 'shanghai', to_city: 'hangzhou', status: 'coming-soon',
      page_type: 'listings', filters_preserved: true,
    })
    expect(JSON.stringify(trackSpy.mock.calls)).not.toMatch(/district|page=|\?/)
  })

  it('closes on Escape and restores focus to the trigger', async () => {
    await renderSwitcher()
    const trigger = document.querySelector<HTMLButtonElement>('[aria-controls="city-switcher-menu"]')
    if (!trigger) throw new Error('missing city switcher trigger')
    await click(trigger)
    expect(document.querySelector('#city-switcher-menu')).not.toBeNull()

    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(document.querySelector('#city-switcher-menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('filters invalid and reserved city options so a global news path cannot become an active city home', async () => {
    navigationState.pathname = '/news'
    navigationState.search = ''
    const unsafeCities = [
      ...cities,
      { slug: 'news', name: '资讯', serviceStatus: 'live' as const, sortOrder: 30 },
      { slug: '../admin', name: '非法', serviceStatus: 'live' as const, sortOrder: 40 },
    ]
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await rerenderSwitcher(unsafeCities)

    const trigger = document.querySelector<HTMLButtonElement>('[aria-controls="city-switcher-menu"]')
    if (!trigger) throw new Error('missing city switcher trigger')
    expect(trigger.textContent).toContain('上海')
    await click(trigger)
    expect(document.querySelector('#city-switcher-menu')?.textContent).not.toContain('资讯')
    expect(document.querySelector('#city-switcher-menu')?.textContent).not.toContain('非法')
    expect(document.querySelector('#city-switcher-menu [aria-current="page"]')?.textContent).not.toContain('资讯')
  })

  it('keeps reserved and invalid city options out of the mobile drawer when an adversarial shell prop contains them', async () => {
    const unsafeCities = [
      ...cities,
      { slug: 'news', name: '资讯城市', serviceStatus: 'live' as const, sortOrder: 30 },
      { slug: '../admin', name: '非法城市', serviceStatus: 'live' as const, sortOrder: 40 },
    ]
    await renderShell(unsafeCities)
    const toggle = document.querySelector<HTMLButtonElement>('[aria-controls="mobile-drawer"]')
    if (!toggle) throw new Error('missing mobile menu toggle')
    await click(toggle)

    const cityDrawer = document.querySelector('.mobile-drawer__cities')
    expect(cityDrawer?.textContent).toContain('上海')
    expect(cityDrawer?.textContent).not.toContain('资讯城市')
    expect(cityDrawer?.textContent).not.toContain('非法城市')
    expect(trackSpy).toHaveBeenCalledWith('city_switcher_opened', {
      city: 'shanghai', status: 'live', page_type: 'listings',
    })
    const hangzhou = cityDrawer?.querySelector<HTMLAnchorElement>('a[href="/hangzhou/listings?areaMin=100"]')
    if (!hangzhou) throw new Error('missing mobile Hangzhou option')
    await click(hangzhou)
    expect(trackSpy).toHaveBeenCalledWith('city_switched', {
      from_city: 'shanghai', to_city: 'hangzhou', status: 'coming-soon',
      page_type: 'listings', filters_preserved: true,
    })
  })

  it('focuses the first option on open, supports menu navigation, and closes on an outside pointer', async () => {
    await renderSwitcher()
    const trigger = document.querySelector<HTMLButtonElement>('[aria-controls="city-switcher-menu"]')
    if (!trigger) throw new Error('missing city switcher trigger')
    await click(trigger)

    const options = [...document.querySelectorAll<HTMLAnchorElement>('#city-switcher-menu a')]
    expect(document.activeElement).toBe(options[0])
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })))
    expect(document.activeElement).toBe(options.at(-1))
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })))
    expect(document.activeElement).toBe(options.at(-2))
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })))
    expect(document.activeElement).toBe(options[0])
    await act(async () => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })))
    expect(document.querySelector('#city-switcher-menu')).toBeNull()
  })

  it('closes its popover when the trusted pathname changes', async () => {
    await renderSwitcher()
    const trigger = document.querySelector<HTMLButtonElement>('[aria-controls="city-switcher-menu"]')
    if (!trigger) throw new Error('missing city switcher trigger')
    await click(trigger)
    expect(document.querySelector('#city-switcher-menu')).not.toBeNull()

    navigationState.pathname = '/hangzhou/listings'
    navigationState.search = ''
    await rerenderSwitcher()
    expect(document.querySelector('#city-switcher-menu')).toBeNull()
  })

  it('does not reopen when navigation returns to the source URL after the menu was closed', async () => {
    await renderSwitcher()
    const trigger = document.querySelector<HTMLButtonElement>('[aria-controls="city-switcher-menu"]')
    if (!trigger) throw new Error('missing city switcher trigger')
    await click(trigger)
    expect(document.querySelector('#city-switcher-menu')).not.toBeNull()

    navigationState.pathname = '/hangzhou/listings'
    navigationState.search = ''
    await rerenderSwitcher()
    expect(document.querySelector('#city-switcher-menu')).toBeNull()

    navigationState.pathname = '/shanghai/listings'
    navigationState.search = 'areaMin=100&district=pudong&page=3'
    await rerenderSwitcher()
    expect(document.querySelector('#city-switcher-menu')).toBeNull()
  })

  it('closes the composite menu on Tab or Shift+Tab without cancelling the browser focus move', async () => {
    await renderSwitcher()
    const trigger = document.querySelector<HTMLButtonElement>('[aria-controls="city-switcher-menu"]')
    if (!trigger) throw new Error('missing city switcher trigger')
    await click(trigger)
    const menuItem = document.querySelector<HTMLAnchorElement>('#city-switcher-menu [role="menuitem"]')
    if (!menuItem) throw new Error('missing city menu item')
    expect(menuItem.tabIndex).toBe(-1)

    for (const shiftKey of [false, true]) {
      const tab = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true })
      await act(async () => document.dispatchEvent(tab))
      expect(tab.defaultPrevented).toBe(false)
      expect(document.querySelector('#city-switcher-menu')).toBeNull()
      if (!shiftKey) await click(trigger)
    }
  })

  it('makes the shell city-aware only from a trusted city pathname', async () => {
    navigationState.pathname = '/hangzhou/buildings'
    navigationState.search = ''
    await renderShell()

    const logo = document.querySelector<HTMLAnchorElement>('a[aria-label="商办租赁首页"]')
    expect(logo?.getAttribute('href')).toBe('/hangzhou')
    expect(document.querySelector<HTMLAnchorElement>('a[href="/hangzhou/listings"]')?.textContent).toContain('找办公室')
    expect(document.querySelector<HTMLAnchorElement>('a[href="/hangzhou/buildings"]')?.textContent).toContain('找楼盘')
    expect(document.querySelector<HTMLAnchorElement>('a[href="/entrust?city=hangzhou"]')?.textContent).toContain('委托找房')
    expect(document.querySelector<HTMLAnchorElement>('a[href="/publish?city=hangzhou"]')?.textContent).toContain('投放房源')
    expect(document.querySelector<HTMLAnchorElement>('a[href="/news"]')?.textContent).toContain('资讯')
    expect(document.querySelector<HTMLAnchorElement>('a[href="/hangzhou"]')?.textContent).toContain('商办租赁')
  })

  it('falls back to the configured default for reserved or unknown path segments without making them city pages', async () => {
    navigationState.pathname = '/news'
    navigationState.search = ''
    const container = await renderShell()

    const header = container.querySelector('header')
    expect(header?.className).not.toContain('site-header--transparent')
    expect(document.querySelector<HTMLAnchorElement>('a[aria-label="商办租赁首页"]')?.getAttribute('href')).toBe('/shanghai')
    expect(document.querySelector<HTMLAnchorElement>('a[href="/shanghai/listings"]')?.textContent).toContain('找办公室')
    expect(document.querySelector<HTMLAnchorElement>('a[href="/news"]')?.textContent).toContain('资讯')
  })

  it('keeps focus inside the mobile navigation drawer and returns it after Escape', async () => {
    await renderShell()
    const toggle = document.querySelector<HTMLButtonElement>('[aria-controls="mobile-drawer"]')
    if (!toggle) throw new Error('missing mobile menu toggle')
    await click(toggle)

    const drawer = document.querySelector<HTMLElement>('#mobile-drawer')
    if (!drawer) throw new Error('missing mobile drawer')
    const links = [...drawer.querySelectorAll<HTMLAnchorElement>('a[href]')]
    const first = links[0]
    const last = links.at(-1)
    if (!first || !last) throw new Error('missing focusable city drawer links')
    expect(last.getAttribute('href')).toBe('/hangzhou/listings?areaMin=100')

    await act(async () => {
      last.focus()
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    })
    expect(document.activeElement).toBe(first)

    await act(async () => {
      first.focus()
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }))
    })
    expect(document.activeElement).toBe(last)

    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(document.querySelector('#mobile-drawer')).toBeNull()
    expect(document.activeElement).toBe(toggle)
  })

  it('keeps the trusted prefixed city home transparent before scroll', async () => {
    navigationState.pathname = '/hangzhou'
    navigationState.search = ''
    const container = await renderShell()

    expect(container.querySelector('header')?.className).toContain('site-header--transparent')
  })

  it('closes the mobile drawer, restores scroll, and releases the focus trap when the desktop breakpoint activates', async () => {
    const listeners = new Set<(event: MediaQueryListEvent) => void>()
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      media: '(min-width: 1280px)',
      addEventListener: (type: string, listener: (event: MediaQueryListEvent) => void) => {
        if (type === 'change') listeners.add(listener)
      },
      removeEventListener: (type: string, listener: (event: MediaQueryListEvent) => void) => {
        if (type === 'change') listeners.delete(listener)
      },
    }))
    await renderShell()
    const toggle = document.querySelector<HTMLButtonElement>('[aria-controls="mobile-drawer"]')
    if (!toggle) throw new Error('missing mobile menu toggle')
    await click(toggle)
    expect(document.body.style.overflow).toBe('hidden')

    await act(async () => {
      for (const listener of listeners) listener({ matches: true } as MediaQueryListEvent)
    })
    expect(document.querySelector('#mobile-drawer')).toBeNull()
    expect(document.body.style.overflow).toBe('')

    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    await act(async () => document.dispatchEvent(tab))
    expect(tab.defaultPrevented).toBe(false)
  })

  it('closes an open mobile drawer immediately when the desktop media query already matches', async () => {
    let matchMediaCalls = 0
    vi.stubGlobal('matchMedia', () => ({
      matches: (matchMediaCalls += 1) > 1,
      media: '(min-width: 1280px)',
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }))
    await renderShell()
    const toggle = document.querySelector<HTMLButtonElement>('[aria-controls="mobile-drawer"]')
    if (!toggle) throw new Error('missing mobile menu toggle')
    await click(toggle)

    expect(document.querySelector('#mobile-drawer')).toBeNull()
    expect(document.body.style.overflow).toBe('')
    expect(document.activeElement).toBe(toggle)
  })
})
