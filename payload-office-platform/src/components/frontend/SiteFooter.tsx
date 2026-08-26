'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import React from 'react'
import { useClientSearchParams } from '@/lib/frontend/use-client-search-params'
import { cityAwareHref, resolveTrustedCity } from '@/components/frontend/CitySwitcher'
import type { PublicCityOption } from '@/app/(frontend)/_lib/city-context'
// 必须从 site-settings-view 取，**不能从 site-settings 取**：后者 import 了 payload，
// 本组件是 'use client'，那条依赖链会把 sharp 拉进浏览器包，next build 直接失败
// （57 个 non-ecmascript placeable asset 错误），而 typecheck 与单测全绿。
import { renderCityPlaceholder, type SiteSettingsView } from '@/lib/frontend/site-settings-view'

type FooterShellProps = Readonly<{
  cities: readonly PublicCityOption[]
  defaultCity: string
  multiCityRoutingEnabled: boolean
  pathname: string
  /** 站点设置。本组件是 'use client'，由 layout 从 getCachedSiteSettings() 取好传入。 */
  settings: SiteSettingsView
}>

function FooterContents({
  cities,
  defaultCity,
  multiCityRoutingEnabled,
  pathname,
  settings,
  searchParams,
}: FooterShellProps & Readonly<{
  searchParams: Pick<URLSearchParams, 'getAll'>
}>) {
  const currentCity = resolveTrustedCity(pathname, cities, defaultCity, searchParams)
  const citySlug = currentCity?.slug
  const year = new Date().getFullYear()
  // 页脚此前两处写死「上海」（品牌说明与底栏副标题），七城平台上访问 /beijing
  // 照样宣称服务上海。城市名跟着路由走，不进配置——让运营手写只会换个地方再写死一次。
  const cityName = currentCity?.name ?? ''
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <div className="site-footer__brand">
          <Link href={multiCityRoutingEnabled && citySlug ? `/${citySlug}` : '/'} className="site-footer__logo">{settings.siteName}</Link>
          <p className="site-footer__tagline">
            {renderCityPlaceholder(settings.footerBrandBlurb, cityName)}
          </p>
        </div>
        <nav className="site-footer__nav" aria-label="页脚导航">
          {settings.footerColumns.map((col) => (
            <div key={col.title} className="site-footer__col">
              <h3 className="site-footer__col-title">{col.title}</h3>
              <ul className="site-footer__links" role="list">
                {col.links.map((link) => {
                  const href = citySlug ? cityAwareHref(link.href, citySlug, multiCityRoutingEnabled) : link.href
                  return (
                    <li key={link.href}>
                      <Link href={href} className="site-footer__link">{link.label}</Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </nav>
      </div>
      <div className="site-footer__bar">
        <div className="site-footer__bar-inner">
          <span>© {year} {settings.copyrightHolder}</span>
          <span>{cityName ? `${cityName} · ` : ''}{settings.footerTaglineSuffix}</span>
        </div>
      </div>
    </footer>
  )
}

/**
 * 公开站点页脚
 *
 * 设计依据：plans/temporal-imagining-sonnet.md §9（编辑式页脚）
 * 守护不变量：
 *   - 外壳不得引入流式 Suspense 边界，query 一律经 useClientSearchParams
 *     在挂载后读取（原因见该 hook 的注释）；
 *   - SSR 输出始终是完整确定性链接；query 城市在挂载后增强；
 *   - 延续 paper 底 + ink 文字的既有品牌基调，不引入新色值；
 *   - 链接对齐既有路由（/news 由 T6 落地，此前为预留入口）；
 *   - 语义化 <footer> 内分栏，移动端折叠为单列。
 */
export default function SiteFooter({
  cities,
  defaultCity,
  multiCityRoutingEnabled,
  settings,
}: Readonly<{
  cities: readonly PublicCityOption[]
  defaultCity: string
  multiCityRoutingEnabled: boolean
  settings: SiteSettingsView
}>) {
  const pathname = usePathname() || '/'
  const [searchParams] = useClientSearchParams()
  return (
    <FooterContents
      settings={settings}
      cities={cities}
      defaultCity={defaultCity}
      multiCityRoutingEnabled={multiCityRoutingEnabled}
      pathname={pathname}
      searchParams={searchParams}
    />
  )
}
