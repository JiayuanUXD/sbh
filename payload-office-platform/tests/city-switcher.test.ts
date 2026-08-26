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
import { SITE_SETTINGS_FALLBACK } from '@/lib/frontend/site-settings'
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
  window.history.replaceState({}, '', '/')
})

/**
 * 外壳不再经 next/navigation 的 useSearchParams 读 query，而是挂载后读
 * window.location.search（见 lib/frontend/use-client-search-params.ts）。
 * 因此渲染前必须把 navigationState 落到真实 URL 上——这也比 mock 更贴近实际，
 * 断言本身未作任何改动。
 */
function syncWindowUrl(): void {
  const query = navigationState.search ? `?${navigationState.search}` : ''
  window.history.replaceState({}, '', `${navigationState.pathname}${query}`)
}

async function renderSwitcher(multiCityRoutingEnabled = true) {
  syncWindowUrl()
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(React.createElement(CitySwitcher, {
      cities,
      defaultCity: 'shanghai',
      multiCityRoutingEnabled,
    }))
  })
  return container
}

async function rerenderSwitcher(
  options: ReadonlyArray<(typeof cities)[number]> = cities,
  multiCityRoutingEnabled = true,
) {
  syncWindowUrl()
  await act(async () => {
    root?.render(React.createElement(CitySwitcher, {
      cities: options,
      defaultCity: 'shanghai',
      multiCityRoutingEnabled,
    }))
  })
}

async function renderShell(
  options: ReadonlyArray<(typeof cities)[number]> = cities,
  multiCityRoutingEnabled = true,
) {
  syncWindowUrl()
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(React.createElement(React.Fragment, null,
      // OPT-053：站点标识/页脚文案由 layout 注入；本用例验的是城市切换器，
      // 拿兜底值即可。
      React.createElement(SiteHeader, {
        cities: options,
        defaultCity: 'shanghai',
        multiCityRoutingEnabled,
        brand: { siteName: SITE_SETTINGS_FALLBACK.siteName, logo: null },
      }),
      React.createElement(SiteFooter, {
        cities: options,
        defaultCity: 'shanghai',
        multiCityRoutingEnabled,
        settings: SITE_SETTINGS_FALLBACK,
      }),
    ))
  })
  return container
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => element.click())
}

async function changeInput(element: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(element, value)
    element.dispatchEvent(new InputEvent('input', { bubbles: true, data: value }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
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

  it('reports city-only lead switches as preserving no filters on desktop and mobile', async () => {
    navigationState.pathname = '/entrust'
    navigationState.search = 'city=shanghai'
    await renderShell()

    const trigger = document.querySelector<HTMLButtonElement>('[aria-controls="city-switcher-menu"]')
    if (!trigger) throw new Error('missing city switcher trigger')
    await click(trigger)
    const desktopHangzhou = document.querySelector<HTMLAnchorElement>('#city-switcher-menu a[href="/entrust?city=hangzhou"]')
    if (!desktopHangzhou) throw new Error('missing desktop Hangzhou lead option')
    await click(desktopHangzhou)
    expect(trackSpy).toHaveBeenCalledWith('city_switched', {
      from_city: 'shanghai', to_city: 'hangzhou', status: 'coming-soon',
      page_type: 'entrust', filters_preserved: false,
    })

    trackSpy.mockClear()
    // 上面的桌面端点击会真实导航 URL；移动端半段是独立场景，重置回该用例的前提。
    syncWindowUrl()
    const toggle = document.querySelector<HTMLButtonElement>('[aria-controls="mobile-drawer"]')
    if (!toggle) throw new Error('missing mobile menu toggle')
    await click(toggle)
    const mobileHangzhou = document.querySelector<HTMLAnchorElement>('.mobile-drawer__cities a[href="/entrust?city=hangzhou"]')
    if (!mobileHangzhou) throw new Error('missing mobile Hangzhou lead option')
    await click(mobileHangzhou)
    expect(trackSpy).toHaveBeenCalledWith('city_switched', {
      from_city: 'shanghai', to_city: 'hangzhou', status: 'coming-soon',
      page_type: 'entrust', filters_preserved: false,
    })
  })

  it('uses the one trusted lead-query city for desktop and mobile opened/from-city attribution', async () => {
    navigationState.pathname = '/city-partner'
    navigationState.search = 'city=hangzhou'
    await renderShell()

    const trigger = document.querySelector<HTMLButtonElement>('[aria-controls="city-switcher-menu"]')
    if (!trigger) throw new Error('missing city switcher trigger')
    expect(trigger.textContent).toContain('\u676d\u5dde')
    expect(document.querySelector<HTMLAnchorElement>('a[aria-label]')?.getAttribute('href')).toBe('/hangzhou')
    expect(document.querySelector<HTMLAnchorElement>('.site-nav a[href="/hangzhou/listings"]')).not.toBeNull()
    expect(document.querySelector<HTMLAnchorElement>('.site-footer a[href="/hangzhou/buildings"]')).not.toBeNull()
    await click(trigger)
    expect(trackSpy).toHaveBeenCalledWith('city_switcher_opened', {
      city: 'hangzhou', status: 'coming-soon', page_type: 'city-partner',
    })
    const desktopShanghai = document.querySelector<HTMLAnchorElement>('#city-switcher-menu a[href="/city-partner?city=shanghai"]')
    if (!desktopShanghai) throw new Error('missing desktop Shanghai partner option')
    await click(desktopShanghai)
    expect(trackSpy).toHaveBeenCalledWith('city_switched', {
      from_city: 'hangzhou', to_city: 'shanghai', status: 'live',
      page_type: 'city-partner', filters_preserved: false,
    })

    trackSpy.mockClear()
    // 上面的桌面端点击会真实导航 URL；移动端半段是独立场景，重置回该用例的前提。
    syncWindowUrl()
    const toggle = document.querySelector<HTMLButtonElement>('[aria-controls="mobile-drawer"]')
    if (!toggle) throw new Error('missing mobile menu toggle')
    await click(toggle)
    expect(trackSpy).toHaveBeenCalledWith('city_switcher_opened', {
      city: 'hangzhou', status: 'coming-soon', page_type: 'city-partner',
    })
    const mobileShanghai = document.querySelector<HTMLAnchorElement>('.mobile-drawer__cities a[href="/city-partner?city=shanghai"]')
    if (!mobileShanghai) throw new Error('missing mobile Shanghai partner option')
    await click(mobileShanghai)
    expect(trackSpy).toHaveBeenCalledWith('city_switched', {
      from_city: 'hangzhou', to_city: 'shanghai', status: 'live',
      page_type: 'city-partner', filters_preserved: false,
    })
  })

  it.each(['city=unknown', 'city=news', 'city=hangzhou&city=shanghai'])(
    'falls back consistently across the whole lead shell for unsafe query %s',
    async (search) => {
      navigationState.pathname = '/publish'
      navigationState.search = search
      await renderShell()

      expect(document.querySelector<HTMLAnchorElement>('a[aria-label]')?.getAttribute('href')).toBe('/shanghai')
      expect(document.querySelector<HTMLButtonElement>('[aria-controls="city-switcher-menu"]')?.textContent).toContain('\u4e0a\u6d77')
      expect(document.querySelector<HTMLAnchorElement>('.site-nav a[href="/shanghai/listings"]')).not.toBeNull()
      expect(document.querySelector<HTMLAnchorElement>('.site-footer a[href="/shanghai/buildings"]')).not.toBeNull()
    },
  )

  it('keeps flag-off shell owners on legacy routes without offering misleading city choices', async () => {
    navigationState.pathname = '/hangzhou/listings'
    navigationState.search = 'areaMin=100'
    await renderShell(cities, false)

    expect(document.querySelector<HTMLAnchorElement>('a[aria-label]')?.getAttribute('href')).toBe('/')
    expect(document.querySelector<HTMLAnchorElement>('.site-nav a[href="/listings"]')).not.toBeNull()
    expect(document.querySelector<HTMLAnchorElement>('.site-nav a[href="/buildings"]')).not.toBeNull()
    expect(document.querySelector<HTMLAnchorElement>('.site-nav a[href="/entrust?city=hangzhou"]')).not.toBeNull()
    expect(document.querySelector<HTMLAnchorElement>('.site-nav a[href="/news"]')).not.toBeNull()
    expect(document.querySelector<HTMLAnchorElement>('.site-footer a[href="/listings?type=traditional-office"]')).not.toBeNull()

    expect(document.querySelector<HTMLButtonElement>('[aria-controls="city-switcher-menu"]')).toBeNull()
    expect(trackSpy).not.toHaveBeenCalledWith('city_switcher_opened', expect.anything())

    const menuToggle = document.querySelector<HTMLButtonElement>('[aria-controls="mobile-drawer"]')
    if (!menuToggle) throw new Error('missing mobile menu toggle')
    await click(menuToggle)
    expect(document.querySelector('.mobile-drawer__cities')).toBeNull()
    expect(trackSpy).not.toHaveBeenCalledWith('city_switcher_opened', expect.anything())
  })

  it('submits the global header inquiry with the same trusted lead-query city as the shell', async () => {
    navigationState.pathname = '/publish'
    navigationState.search = 'city=hangzhou'
    window.history.replaceState({}, '', '/publish?city=hangzhou')
    const fetchSpy = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({ targetResolution: 'general' }),
    }))
    vi.stubGlobal('fetch', fetchSpy)
    await renderShell()

    const inquiryTrigger = document.querySelector<HTMLButtonElement>('[data-event-name="inquiry_open_trigger"]')
    if (!inquiryTrigger) throw new Error('missing header inquiry trigger')
    await click(inquiryTrigger)

    const contactForm = document.querySelector<HTMLFormElement>('.modal__form')
    const contactInputs = [...document.querySelectorAll<HTMLInputElement>('.modal__form input')]
    const [name, phone, teamSize] = contactInputs.filter((input) => input.type !== 'checkbox')
    const consent = contactInputs.find((input) => input.type === 'checkbox')
    if (!contactForm || !name || !phone || !teamSize || !consent) throw new Error('missing inquiry contact fields')
    await changeInput(name, '\u5f20\u4e09')
    await changeInput(phone, '13800001111')
    await changeInput(teamSize, '10')
    await act(async () => consent.click())
    await act(async () => contactForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))

    const requirementsForm = document.querySelector<HTMLFormElement>('.modal__form')
    if (!requirementsForm) throw new Error('missing inquiry requirements form')
    await act(async () => requirementsForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body.city).toBe('hangzhou')
    expect(body.source).toMatchObject({ pageType: 'home', path: '/publish' })
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

  it('keeps the trusted live prefixed city home transparent before scroll and keeps coming-soon solid', async () => {
    navigationState.pathname = '/shanghai'
    navigationState.search = ''
    const container = await renderShell()

    expect(container.querySelector('header')?.className).toContain('site-header--transparent')

    navigationState.pathname = '/hangzhou'
    const containerHangzhou = await renderShell()
    expect(containerHangzhou.querySelector('header')?.className).not.toContain('site-header--transparent')
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
