/**
 * OPT-096：主导航「找办公室 / 找楼盘」的固定二级菜单（代码规则，不走后台配置）。
 *
 * 渲染断言用 renderToStaticMarkup 直出 SiteHeader（写法同 site-header-features.test.ts），
 * usePathname mock 成 `/shanghai/buildings`，验「父项 + 租赁子项高亮、出售子项不高亮」。
 */
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/shanghai/buildings',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => undefined }),
}))

import SiteHeader from '@/components/frontend/SiteHeader'
import { attachMainNavSubmenu, NAV_SUBMENU_BY_HREF } from '@/lib/frontend/nav-submenu'
import { MAIN_NAV_ITEMS } from '@/lib/frontend/public-nav'
import { SITE_SETTINGS_FALLBACK } from '@/lib/frontend/site-settings-view'

const CITIES = [
  { slug: 'shanghai', name: '上海', serviceStatus: 'live' as const, sortOrder: 10, servicePhone: null },
  { slug: 'hangzhou', name: '杭州', serviceStatus: 'live' as const, sortOrder: 20, servicePhone: null },
]

function renderHeader() {
  return renderToStaticMarkup(
    React.createElement(SiteHeader, {
      cities: CITIES,
      defaultCity: 'shanghai',
      multiCityRoutingEnabled: true,
      brand: { siteName: '站', logo: null, mainNav: SITE_SETTINGS_FALLBACK.mainNav },
    }),
  )
}

describe('OPT-096 导航子项：数据层', () => {
  it('只有 /listings 与 /buildings 两个目标有子项，各自是租赁 / 出售', () => {
    expect(Object.keys(NAV_SUBMENU_BY_HREF).sort()).toEqual(['/buildings', '/listings'])
    expect(NAV_SUBMENU_BY_HREF['/listings']).toEqual([
      { href: '/listings', label: '租赁' },
      { href: '/sale', label: '出售' },
    ])
    expect(NAV_SUBMENU_BY_HREF['/buildings']).toEqual([
      { href: '/buildings', label: '租赁' },
      { href: '/buildings?business=sale', label: '出售' },
    ])
  })

  it('attachMainNavSubmenu 按 href 挂子项，其余项不带 children 键', () => {
    const out = attachMainNavSubmenu([
      { href: '/', label: '首页' },
      { href: '/listings', label: '找办公室（改过名）' },
      { href: '/listings?type=coworking', label: '共享办公' },
    ])
    expect(out[0]).toEqual({ href: '/', label: '首页' })
    expect(out[1]).toEqual({ href: '/listings', label: '找办公室（改过名）', children: NAV_SUBMENU_BY_HREF['/listings'] })
    expect(out[2]).toEqual({ href: '/listings?type=coworking', label: '共享办公' })
  })

  it('默认导航与站点设置兜底都已带子项', () => {
    const fromDefaults = MAIN_NAV_ITEMS.find((i) => i.href === '/buildings')
    const fromFallback = SITE_SETTINGS_FALLBACK.mainNav.find((i) => i.href === '/buildings')
    expect(fromDefaults?.children?.map((c) => c.label)).toEqual(['租赁', '出售'])
    expect(fromFallback?.children?.map((c) => c.label)).toEqual(['租赁', '出售'])
  })
})

describe('OPT-096 导航子项：SiteNav 渲染', () => {
  it('桌面：找办公室 / 找楼盘渲染为带下拉的分组，父项 aria-haspopup，子项城市前缀化', () => {
    const html = renderHeader()
    expect((html.match(/class="site-nav__group"/g) ?? []).length).toBe(2)
    // Next 的 Link 把 href 渲染在最后：class → aria-* → href
    expect(html).toMatch(/<a[^>]*class="site-nav__link"[^>]*aria-haspopup="true"[^>]*href="\/shanghai\/listings"/)
    expect(html).toContain('href="/shanghai/sale"')
    expect(html).toContain('href="/shanghai/buildings?business=sale"')
    expect((html.match(/class="site-nav__sub"/g) ?? []).length).toBe(4)
  })

  it('在 /shanghai/buildings 上：父项「找楼盘」与子项「租赁」高亮，「出售」不高亮', () => {
    const html = renderHeader()
    expect(html).toMatch(/<a[^>]*class="site-nav__link"[^>]*aria-current="page"[^>]*aria-haspopup="true"[^>]*href="\/shanghai\/buildings"/)
    expect(html).toMatch(/<a[^>]*class="site-nav__sub"[^>]*aria-current="page"[^>]*href="\/shanghai\/buildings"[^?]/)
    expect(html).not.toMatch(/<a[^>]*class="site-nav__sub"[^>]*aria-current="page"[^>]*href="\/shanghai\/buildings\?business=sale"/)
  })
})
