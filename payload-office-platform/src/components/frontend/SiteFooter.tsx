'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import React from 'react'
import { useClientSearchParams } from '@/lib/frontend/use-client-search-params'
import { cityAwareHref, resolveTrustedCity } from '@/components/frontend/CitySwitcher'
import type { PublicCityOption } from '@/app/(frontend)/_lib/city-context'
import { FOOTER_COLUMNS } from '@/lib/frontend/public-nav'

type FooterShellProps = Readonly<{
  cities: readonly PublicCityOption[]
  defaultCity: string
  multiCityRoutingEnabled: boolean
  pathname: string
}>

function FooterContents({
  cities,
  defaultCity,
  multiCityRoutingEnabled,
  pathname,
  searchParams,
}: FooterShellProps & Readonly<{
  searchParams: Pick<URLSearchParams, 'getAll'>
}>) {
  const currentCity = resolveTrustedCity(pathname, cities, defaultCity, searchParams)
  const citySlug = currentCity?.slug
  const year = new Date().getFullYear()
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <div className="site-footer__brand">
          <Link href={multiCityRoutingEnabled && citySlug ? `/${citySlug}` : '/'} className="site-footer__logo">商办租赁</Link>
          <p className="site-footer__tagline">
            聚合上海甲级写字楼、独栋办公、共享办公与整层办公机会，免费帮成长型企业匹配更体面的办公室。
          </p>
        </div>
        <nav className="site-footer__nav" aria-label="页脚导航">
          {FOOTER_COLUMNS.map((col) => (
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
          <span>© {year} 商办租赁平台</span>
          <span>上海 · 商务办公租赁</span>
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
}: Readonly<{
  cities: readonly PublicCityOption[]
  defaultCity: string
  multiCityRoutingEnabled: boolean
}>) {
  const pathname = usePathname() || '/'
  const [searchParams] = useClientSearchParams()
  return (
    <FooterContents
      cities={cities}
      defaultCity={defaultCity}
      multiCityRoutingEnabled={multiCityRoutingEnabled}
      pathname={pathname}
      searchParams={searchParams}
    />
  )
}
