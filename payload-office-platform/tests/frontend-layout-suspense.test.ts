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
  it('keeps the prefixed shell renderable when every Task 5 search-param consumer suspends', async () => {
    const element = await RootLayout({ children: React.createElement('section', null, 'city content') })

    expect(() => renderToStaticMarkup(element)).not.toThrow()
    const markup = renderToStaticMarkup(element)
    expect(markup).toContain('city content')
    expect(markup).toContain('class="site-nav"')
    expect(markup).toContain('aria-label=')
    expect(markup).toContain('class="site-footer"')
  })
})
