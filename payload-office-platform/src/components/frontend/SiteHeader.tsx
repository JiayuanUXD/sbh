'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import React, { useEffect, useRef, useState } from 'react'
import SiteNav from '@/components/frontend/SiteNav'
import HeaderSearch from '@/components/frontend/HeaderSearch'
import CitySwitcher, { resolveTrustedCity } from '@/components/frontend/CitySwitcher'
import MemberMenu from '@/components/frontend/member/MemberMenu'
import type { MemberDto } from '@/domain/member/member-dto'
import { useClientSearchParams } from '@/lib/frontend/use-client-search-params'
import { isSvgLogo } from '@/lib/frontend/site-settings-view'
import type { PublicCityOption } from '@/app/(frontend)/_lib/city-context'

/** 站点标识。由 layout 从 `getCachedSiteSettings()` 取好传进来——本组件是 'use client'，
 *  拿不到服务端读取器。缺省时回落为文字站名，那正是接线前的线上形态。 */
export type SiteBrand = Readonly<{
  siteName: string
  logo: Readonly<{
    src: string
    alt: string
    mimeType?: string | null
    width?: number | null
    height?: number | null
  }> | null
  /** 主导航项（OPT-054），href 已在服务端解析完成。 */
  mainNav: readonly Readonly<{ href: string; label: string }>[]
}>

type HeaderShellProps = Readonly<{
  cities: readonly PublicCityOption[]
  defaultCity: string
  multiCityRoutingEnabled: boolean
  pathname: string
  brand: SiteBrand
  member?: MemberDto | null
}>

function HeaderContents({
  cities,
  defaultCity,
  multiCityRoutingEnabled,
  pathname,
  brand,
  member,
  searchParams,
  onRefreshSearchParams,
  showSearch,
}: HeaderShellProps & Readonly<{
  searchParams: Pick<URLSearchParams, 'get' | 'getAll' | 'has' | 'size' | 'toString'>
  onRefreshSearchParams?: () => void
  /** 首页仅在 Hero 搜索框被完全覆盖/滚出顶栏后才渲染顶栏搜索——避免首屏同屏出现两个搜索框造成视觉冗余；非首页始终渲染。 */
  showSearch: boolean
}>) {
  const currentCity = resolveTrustedCity(pathname, cities, defaultCity, searchParams)
  const isSvg = isSvgLogo(brand.logo)
  const logoAspectRatio =
    brand.logo?.width && brand.logo?.height
      ? `${brand.logo.width} / ${brand.logo.height}`
      : undefined

  return (
    <>
      <Link
        href={multiCityRoutingEnabled && currentCity ? `/${currentCity.slug}` : '/'}
        className="site-logo"
        aria-label={`${brand.siteName}首页`}
      >
        {brand.logo ? (
          isSvg ? (
            <span
              className="site-logo__icon"
              style={{
                '--logo-url': `url("${brand.logo.src}")`,
                ...(logoAspectRatio ? { aspectRatio: logoAspectRatio, width: 'auto' } : {}),
              } as React.CSSProperties}
              aria-hidden="true"
            />
          ) : (
            <img
              src={brand.logo.src}
              alt=""
              className="site-logo__img"
              width={brand.logo.width ?? undefined}
              height={brand.logo.height ?? undefined}
            />
          )
        ) : null}
        <span className="site-logo__text">{brand.siteName}</span>
      </Link>
      {multiCityRoutingEnabled ? (
        <CitySwitcher
          cities={cities}
          defaultCity={defaultCity}
          multiCityRoutingEnabled={multiCityRoutingEnabled}
        />
      ) : null}
      <span className="site-header__divider" aria-hidden="true" />
      <SiteNav
        items={brand.mainNav}
        cities={cities}
        defaultCity={defaultCity}
        multiCityRoutingEnabled={multiCityRoutingEnabled}
        pathname={pathname}
        searchParams={searchParams}
        onRefreshSearchParams={onRefreshSearchParams}
        member={member ?? null}
        actions={
          <>
            {showSearch ? (
              <HeaderSearch
                citySlug={multiCityRoutingEnabled && currentCity ? currentCity.slug : undefined}
                initialKeyword={searchParams.get('q') ?? undefined}
              />
            ) : null}
            <span className="member-menu-slot">
              <MemberMenu member={member ?? null} pathname={pathname} variant="desktop" />
            </span>
          </>
        }
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
 *   - 滚动阈值见 TRANSPARENT_SCROLL_THRESHOLD，过阈即切回实底；
 *   - skip link 仍由 layout 渲染，焦点顺序不变。
 */

/** 首页透明头切实底的滚动阈值，语义是「约一个头部高度」。
 *
 *  取 56 而不是 64：`--header-height` 是 64（≥768）/ 56（<768）两档（OPT-075），
 *  取小的那档能保证两个断点下都「刚滚出头部就切实底」，不会在移动端偏晚。
 *  这是本文件里唯一与该 token 联动的常量——CSS 侧的偏移全部走 `calc(var(--header-height) …)`，
 *  不需要在 JS 里重复。改 token 时记得回来看这一行。 */
const TRANSPARENT_SCROLL_THRESHOLD = 56

/** 首页首屏 Hero 搜索框滑出顶栏下沿的兜底滚动阈值。
 *
 *  正常情况下由 getBoundingClientRect 动态精确计算：
 *  当 .hm-search 的 bottom <= headerHeight 时，表示 Hero 搜索框已完全被顶栏覆盖/滚出视野，
 *  此时顶栏搜索框才出现（避免首屏视口内同时存在两个搜索框的视觉冗余）。
 *  若 DOM 中未找到 .hm-search（如未完成渲染或特殊场景），以 450px 作为安全兜底。 */
const HERO_SEARCH_FALLBACK_THRESHOLD = 450

export default function SiteHeader({
  cities,
  defaultCity,
  multiCityRoutingEnabled,
  brand,
  member,
}: Readonly<{
  cities: readonly PublicCityOption[]
  defaultCity: string
  multiCityRoutingEnabled: boolean
  brand: SiteBrand
  member?: MemberDto | null
}>) {
  const pathname = usePathname() || '/'
  const [searchParams, refreshSearchParams] = useClientSearchParams()
  const fallbackCity = resolveTrustedCity(pathname, cities, defaultCity, searchParams)
  const isTrustedCityHome = fallbackCity !== null && pathname === `/${fallbackCity.slug}` && fallbackCity.serviceStatus !== 'coming-soon'
  const isHome = pathname === '/' || isTrustedCityHome
  const headerRef = useRef<HTMLElement | null>(null)
  const [scrolled, setScrolled] = useState(false)
  const [heroSearchCovered, setHeroSearchCovered] = useState(false)

  useEffect(() => {
    if (!isHome) return

    let ticking = false
    const checkScroll = () => {
      const scrollY = window.scrollY
      setScrolled(scrollY > TRANSPARENT_SCROLL_THRESHOLD)

      const heroSearchEl = document.querySelector('.hm-search')
      if (heroSearchEl) {
        const rect = heroSearchEl.getBoundingClientRect()
        const headerHeight = headerRef.current?.offsetHeight ?? TRANSPARENT_SCROLL_THRESHOLD
        setHeroSearchCovered(rect.bottom <= headerHeight)
      } else {
        setHeroSearchCovered(scrollY > HERO_SEARCH_FALLBACK_THRESHOLD)
      }
      ticking = false
    }

    const onScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(checkScroll)
        ticking = true
      }
    }

    checkScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [isHome])

  const transparent = isHome && !scrolled
  const showSearch = !isHome || heroSearchCovered
  const className = ['site-header', transparent ? 'site-header--transparent' : '']
    .filter(Boolean)
    .join(' ')

  return (
    <header ref={headerRef} className={className}>
      <div className="site-header__inner">
        <HeaderContents
          cities={cities}
          defaultCity={defaultCity}
          multiCityRoutingEnabled={multiCityRoutingEnabled}
          pathname={pathname}
          brand={brand}
          member={member}
          searchParams={searchParams}
          onRefreshSearchParams={refreshSearchParams}
          showSearch={showSearch}
        />
      </div>
    </header>
  )
}
