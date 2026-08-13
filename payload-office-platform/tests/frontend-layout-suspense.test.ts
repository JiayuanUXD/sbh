import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

const suspendedSearchParams = new Promise<never>(() => undefined)

vi.mock('next/navigation', () => ({
  usePathname: () => '/hangzhou',
  useSearchParams: () => { throw suspendedSearchParams },
}))

vi.mock('@/app/(frontend)/_lib/city-context', () => ({
  listPublicCityOptions: async () => [
    { slug: 'shanghai', name: '上海', serviceStatus: 'live', sortOrder: 10 },
    { slug: 'hangzhou', name: '杭州', serviceStatus: 'coming-soon', sortOrder: 20 },
  ],
  listPublicCityProfiles: async () => [
    { citySlug: 'shanghai', serviceStatus: 'live' },
    { citySlug: 'hangzhou', serviceStatus: 'coming-soon' },
  ],
}))

vi.mock('@/lib/frontend/analytics/web-vitals', () => ({
  initWebVitals: async () => () => undefined,
}))

import RootLayout from '@/app/(frontend)/layout'

describe('frontend static prerender Suspense boundaries', () => {
  it('keeps complete deterministic shell links in SSR when query-dependent enhancement suspends', async () => {
    const element = await RootLayout({ children: React.createElement('section', null, 'city content') })

    expect(() => renderToStaticMarkup(element)).not.toThrow()
    const markup = renderToStaticMarkup(element)
    expect(markup).toContain('city content')
    expect(markup).toContain('aria-label="商办租赁首页"')
    expect(markup).toContain('href="/"')
    expect(markup).toContain('class="site-nav__link"')
    expect(markup).toContain('href="/listings"')
    expect(markup).toContain('data-event-name="inquiry_open_trigger"')
    expect(markup).toContain('class="site-footer"')
    expect(markup).toContain('class="site-footer__logo"')
    expect(markup).toContain('href="/buildings"')
  })
})
