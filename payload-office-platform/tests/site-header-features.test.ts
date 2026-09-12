/**
 * OPT-094：顶栏「登录 / 会员入口」开关与「客服电话」入口的渲染判据。
 *
 * 用 renderToStaticMarkup 直出（SiteHeader 是 client 组件，但不依赖浏览器 API 即可首屏渲染）。
 * usePathname mock 成 `/hangzhou`，让 resolveTrustedCity 命中杭州这座城，验证城市覆盖号生效。
 */
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/hangzhou',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => undefined }),
}))

import SiteHeader from '@/components/frontend/SiteHeader'
import { resolveHeaderFeatures } from '@/lib/frontend/header-features'
import { SITE_SETTINGS_FALLBACK } from '@/lib/frontend/site-settings-view'

const CITIES = [
  { slug: 'shanghai', name: '上海', serviceStatus: 'live' as const, sortOrder: 10, servicePhone: null },
  { slug: 'hangzhou', name: '杭州', serviceStatus: 'live' as const, sortOrder: 20, servicePhone: '0571 8888 6666' },
]

function render(over: Partial<Parameters<typeof resolveHeaderFeatures>[0] & object> = {}, cities = CITIES) {
  return renderToStaticMarkup(
    React.createElement(SiteHeader, {
      cities,
      defaultCity: 'shanghai',
      multiCityRoutingEnabled: true,
      brand: {
        siteName: SITE_SETTINGS_FALLBACK.siteName,
        logo: null,
        mainNav: SITE_SETTINGS_FALLBACK.mainNav,
        headerFeatures: resolveHeaderFeatures(over),
      },
    }),
  )
}

describe('SiteHeader 顶栏功能（OPT-094）', () => {
  it('默认：登录入口不渲染，没配号码时也没有客服电话', () => {
    const html = render({}, CITIES.map((c) => ({ ...c, servicePhone: null })))
    expect(html).not.toContain('member-login')
    expect(html).not.toContain('member-menu-slot')
    expect(html).not.toContain('class="service-phone"')
  })

  it('brand 不带 headerFeatures 时按兜底：登录入口关', () => {
    const html = renderToStaticMarkup(
      React.createElement(SiteHeader, {
        cities: CITIES,
        defaultCity: 'shanghai',
        multiCityRoutingEnabled: true,
        brand: { siteName: '站', logo: null, mainNav: SITE_SETTINGS_FALLBACK.mainNav },
      }),
    )
    expect(html).not.toContain('member-login')
  })

  it('开关打开后登录入口回来', () => {
    const html = render({ memberEntryVisible: true })
    expect(html).toContain('member-login')
    expect(html).toContain('href="/login?returnTo=%2Fhangzhou"')
  })

  it('当前城市配了号码就用本城的，tel: 去掉分隔符', () => {
    const html = render({ servicePhone: '400-820-1234' })
    expect(html).toContain('class="service-phone"')
    expect(html).toContain('href="tel:057188886666"')
    expect(html).toContain('0571 8888 6666')
    expect(html).not.toContain('tel:4008201234')
  })

  it('当前城市没配号码回落全站默认', () => {
    const cities = CITIES.map((c) => ({ ...c, servicePhone: null }))
    const html = render({ servicePhone: '400-820-1234' }, cities)
    expect(html).toContain('href="tel:4008201234"')
    expect(html).toContain('400-820-1234')
  })

  it('电话开关关着时，城市配了号码也不显示', () => {
    const html = render({ servicePhone: '400-820-1234', servicePhoneVisible: false })
    expect(html).not.toContain('class="service-phone"')
    expect(html).not.toContain('tel:')
  })

  it('图标入口带可读的 aria-label，号码文本保留在 DOM 供窄屏读屏', () => {
    const html = render({ servicePhone: '400-820-1234' })
    expect(html).toContain('aria-label="拨打客服电话 0571 8888 6666"')
    expect(html).toContain('class="service-phone__number"')
  })
})
