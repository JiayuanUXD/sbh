'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import React, { useEffect, useState } from 'react'
import SiteNav from '@/components/frontend/SiteNav'
import { resolveTrustedCity } from '@/components/frontend/CitySwitcher'
import { useClientSearchParams } from '@/lib/frontend/use-client-search-params'
import type { PublicCityOption } from '@/app/(frontend)/_lib/city-context'

type HeaderShellProps = Readonly<{
  cities: readonly PublicCityOption[]
  defaultCity: string
  multiCityRoutingEnabled: boolean
  pathname: string
}>

function HeaderContents({
  cities,
  defaultCity,
  multiCityRoutingEnabled,
  pathname,
  searchParams,
  onRefreshSearchParams,
}: HeaderShellProps & Readonly<{
  searchParams: Pick<URLSearchParams, 'get' | 'getAll' | 'has' | 'size' | 'toString'>
  onRefreshSearchParams?: () => void
}>) {
  const currentCity = resolveTrustedCity(pathname, cities, defaultCity, searchParams)
  return (
    <>
      <Link href={multiCityRoutingEnabled && currentCity ? `/${currentCity.slug}` : '/'} className="site-logo" aria-label="商办租赁首页">商办租赁</Link>
      <SiteNav
        cities={cities}
        defaultCity={defaultCity}
        multiCityRoutingEnabled={multiCityRoutingEnabled}
        pathname={pathname}
        searchParams={searchParams}
        onRefreshSearchParams={onRefreshSearchParams}
      />
    </>
  )
}

/**
 * 公开站点页头外壳（client）：首页首屏透明压视频，下滑后切回奶油实底。
 *
 * 从 (frontend)/layout.tsx 抽出为 client 组件，因为需要 usePathname 判首页
 * 与 scroll 监听切透明/实底；logo / SiteNav / InquiryModal 全部收敛到此处。
 *
 * 守护不变量：
 *   - 外壳不得引入流式 Suspense 边界，query 一律经 useClientSearchParams
 *     在挂载后读取（原因见该 hook 的注释）；
 *   - 仅首页（pathname === '/'）且未滚动时透明；非首页始终实底，不受污染；
 *   - 滚动阈值 40px（约导航高度），过阈即切回实底；
 *   - skip link 仍由 layout 渲染，焦点顺序不变。
 */
export default function SiteHeader({
  cities,
  defaultCity,
  multiCityRoutingEnabled,
}: Readonly<{
  cities: readonly PublicCityOption[]
  defaultCity: string
  multiCityRoutingEnabled: boolean
}>) {
  const pathname = usePathname() || '/'
  const [searchParams, refreshSearchParams] = useClientSearchParams()
  const fallbackCity = resolveTrustedCity(pathname, cities, defaultCity, searchParams)
  const isTrustedCityHome = fallbackCity !== null && pathname === `/${fallbackCity.slug}`
  const isHome = pathname === '/' || isTrustedCityHome
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    if (!isHome) return
    const onScroll = () => setScrolled(window.scrollY > 40)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [isHome])

  const className = [
    'site-header',
    isHome && !scrolled ? 'site-header--transparent' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <header className={className}>
      <div className="site-header__inner">
        <HeaderContents
          cities={cities}
          defaultCity={defaultCity}
          multiCityRoutingEnabled={multiCityRoutingEnabled}
          pathname={pathname}
          searchParams={searchParams}
          onRefreshSearchParams={refreshSearchParams}
        />
      </div>
    </header>
  )
}
