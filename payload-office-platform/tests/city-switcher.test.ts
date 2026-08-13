// @vitest-environment happy-dom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const navigationState = vi.hoisted(() => ({
  pathname: '/shanghai/listings',
  search: 'areaMin=100&district=pudong&page=3',
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

async function renderShell() {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(React.createElement(React.Fragment, null,
      React.createElement(SiteHeader, { cities, defaultCity: 'shanghai' }),
      React.createElement(SiteFooter, { cities, defaultCity: 'shanghai' }),
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
})
