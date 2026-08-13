// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const trackSpy = vi.hoisted(() => vi.fn())
vi.mock('@/lib/frontend/analytics', () => ({
  track: trackSpy,
  safeTrackCityEvent: (tracker: typeof trackSpy, name: string, props: Record<string, unknown>) => {
    tracker(name, props)
  },
}))
vi.mock('@/components/frontend/InquiryModal', () => ({
  default: ({ triggerLabel, onTriggerClick }: { triggerLabel: string; onTriggerClick?: () => void }) => (
    React.createElement('button', { type: 'button', onClick: onTriggerClick }, triggerLabel)
  ),
}))

import ComingSoonCityView from '@/components/frontend/city/ComingSoonCityView'

const view = readFileSync('src/components/frontend/city/ComingSoonCityView.tsx', 'utf8')
const css = readFileSync('src/app/(frontend)/styles.css', 'utf8')
const comingSoonStyles = css.slice(css.indexOf('.city-coming-soon'))
let root: Root | null = null

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = null
  document.body.replaceChildren()
  trackSpy.mockClear()
})

describe('ComingSoonCityView shell', () => {
  it('does not nest a main landmark and can render the public profile hero media', () => {
    expect(view).toContain('<div className="city-coming-soon">')
    expect(view).not.toContain('<main className="city-coming-soon">')
    expect(view).toContain('profile.hero.media ? <img className="city-coming-soon__media"')
  })

  it('styles readable responsive city sections and 44px action targets', () => {
    expect(css).toContain('.city-coming-soon__hero')
    expect(css).toContain('.city-coming-soon__regions ul')
    expect(css).toContain('min-height: 44px')
    expect(css).toContain('@media (max-width: 767px)')
    expect(comingSoonStyles).not.toContain('var(--paper)')
    expect(comingSoonStyles).not.toContain('var(--ink)')
    expect(comingSoonStyles).not.toContain('var(--line)')
    expect(comingSoonStyles).toContain('var(--color-paper)')
    expect(comingSoonStyles).toContain('var(--color-ink)')
    expect(comingSoonStyles).toContain('var(--color-line)')
  })

  it('tracks each coming-soon action using only trusted city enums', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(React.createElement(ComingSoonCityView, { city: {
      id: 2,
      slug: 'hangzhou',
      name: '杭州',
      serviceStatus: 'coming-soon',
      profile: {
        cityId: 2, citySlug: 'hangzhou', cityName: '杭州', serviceStatus: 'coming-soon',
        switcherVisible: true, sortOrder: 20,
        seoTitle: '杭州办公租赁', seoDescription: '杭州办公租赁与选址服务。',
        hero: { eyebrow: '', heading: '', body: '', media: null },
        intro: { heading: '', body: '' }, contact: { heading: '', body: '' },
        featuredRegions: [],
      },
    } })))

    const partner = container.querySelector<HTMLAnchorElement>('a[href="/city-partner?city=hangzhou"]')
    if (!partner) throw new Error('missing partner CTA')
    await act(async () => partner.click())

    expect(trackSpy).toHaveBeenCalledWith('coming_soon_cta_clicked', {
      city: 'hangzhou', status: 'coming-soon', cta_type: 'city-partner',
    })
    expect(trackSpy).toHaveBeenCalledWith('city_partner_cta_clicked', {
      city: 'hangzhou', status: 'coming-soon',
    })
    expect(JSON.stringify(trackSpy.mock.calls)).not.toMatch(/phone|query|\?city/)
  })
})
