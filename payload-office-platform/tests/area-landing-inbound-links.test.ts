import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/shanghai',
}))

import HomeDistrictBento from '@/components/frontend/home/HomeDistrictBento'
import HomeHero from '@/components/frontend/home/HomeHero'
import type { DistrictCardViewModel } from '@/domain/public-catalog/contracts'

const city = {
  id: 1, slug: 'shanghai', name: '上海', serviceStatus: 'live' as const,
  profile: {
    citySlug: 'shanghai', cityName: '上海', serviceStatus: 'live' as const, seoTitle: '', seoDescription: '', cityId: 1,
    switcherVisible: true, sortOrder: 1, avgResponseHours: null,
    hero: { eyebrow: '', heading: '', body: '', media: null, video: null, videoEnabled: true },
    intro: { heading: '', body: '' }, contact: { heading: '', body: '' }, featuredRegions: [], typeCardOverrides: [],
    featuredDistrictCount: 5 as const,
  },
}
const districts = [{ id: 15, slug: 'xuhui', name: '徐汇区' }, { id: 2, slug: 'jingan', name: '静安区' }]
const cards: DistrictCardViewModel[] = [
  { id: 40, slug: 'lujiazui', name: '陆家嘴', coverImage: null, buildings: ['A 大厦'] },
  { id: 41, slug: 'caohejing', name: '漕河泾', coverImage: null, buildings: [] },
  { id: 42, slug: 'zhangjiang', name: '张江', coverImage: null, buildings: [] },
]

describe('首页入口链接指向区域落地页（OPT-119）', () => {
  it('prefixed：热门商圈卡链到 /shanghai/area/<商圈slug>，不再是对商圈无效的 ?district=', () => {
    const html = renderToStaticMarkup(createElement(HomeDistrictBento, { cards, totalAreas: 3, citySlug: 'shanghai' }))
    expect(html).toContain('href="/shanghai/area/lujiazui"')
    expect(html).toContain('href="/shanghai/area/caohejing"')
    expect(html).not.toContain('?district=lujiazui')
  })

  it('legacy（无城市前缀）：没有落地页，保持原筛选页链接', () => {
    const html = renderToStaticMarkup(createElement(HomeDistrictBento, { cards, totalAreas: 3 }))
    expect(html).toContain('href="/listings?district=lujiazui"')
    expect(html).not.toContain('/area/')
  })

  it('prefixed：Hero 热门筛选 chips 链到行政区落地页', () => {
    const html = renderToStaticMarkup(createElement(HomeHero, { city, districts, routeMode: 'prefixed', heading: 'h', slogan: 's' }))
    expect(html).toContain('href="/shanghai/area/xuhui"')
    expect(html).toContain('href="/shanghai/area/jingan"')
  })

  it('legacy：Hero chips 仍走筛选页', () => {
    const html = renderToStaticMarkup(createElement(HomeHero, { city, districts, routeMode: 'legacy', heading: 'h', slogan: 's' }))
    expect(html).toContain('href="/listings?district=xuhui"')
    expect(html).not.toContain('/area/')
  })
})
