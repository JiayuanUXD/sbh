'use client'

import Link from 'next/link'
import type { ReadonlyURLSearchParams } from 'next/navigation'
import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { safeTrackCityEvent, track } from '@/lib/frontend/analytics'
import type { PublicNavItem } from '@/lib/frontend/public-nav'
import {
  cityAwareHref,
  citySwitchHref,
  filterPublicCityOptions,
  resolveTrustedCity,
} from '@/components/frontend/CitySwitcher'
import type { PublicCityOption } from '@/app/(frontend)/_lib/city-context'
import { citySwitchPreservedFilters, getCityPageType } from '@/lib/frontend/city-routes'

function isDesktopNavigationViewport(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(min-width: 1280px)').matches
}

/**
 * 公开站点主导航
 *
 * 设计依据：specs/frontend-mvp/design.md §6.4、§14.2
 * 守护不变量：
 *   - 语义化 <nav aria-label="主导航">；
 *   - 桌面端水平展示，移动端折叠为可访问抽屉；
 *   - 当前页用 aria-current="page" 标识；
 *   - 抽屉打开时锁焦点、Esc 关闭、归还焦点到触发器；
 *   - 触控目标 ≥ 44×44px。
 */

/**
 * 判断当前路径是否匹配给定 href。
 * - href 含 query 时：pathname 与 query 参数须同时精确匹配
 *   （如 /listings?type=serviced-office 仅在 type=serviced-office 时高亮）
 * - href 无 query 时：pathname 匹配即可，但若当前 URL 含更具体的 type 筛选
 *   则不高亮"在租房源"总览，避免与子分类同时高亮
 * - `exact` 为真时只认全等，不做前缀匹配（首页专用，理由见下）
 *
 * 导出仅供单测：判错的表现是"两项同时高亮"，类型层与构建期都看不出来，
 * 只能靠断言。见 tests/site-nav-current.test.ts。
 */
export function isCurrent(
  pathname: string,
  searchParams: Pick<ReadonlyURLSearchParams, 'get' | 'has'>,
  href: string,
  exact = false,
): boolean {
  const [path, query = ''] = href.split('?')
  if (!path) return false
  // 首页必须精确匹配，否则它会前缀命中自己底下的每一个页面。
  //
  // 原来只判 `path === '/'`，单城市模式下是对的。但多城市模式下
  // `cityAwareHref` 把 `/` 重写成 `/shanghai`，于是落到下面那行前缀匹配——
  // 在 /shanghai/buildings 上「首页」与「找楼盘」会**同时**带 aria-current="page"、
  // 同时画激活下划线。移动抽屉共用这份判据，同样受影响。
  //
  // `exact` 由调用方按**重写前**的 item.href 是否为 `/` 决定，不靠路径形状去猜——
  // 猜的话 `/listings`、`/news` 这些单段路径会被误判成首页，反而破坏现有高亮。
  if (exact || path === '/') return pathname === path
  if (pathname !== path && !pathname.startsWith(path + '/')) return false
  if (query) {
    // href 含 query：当前 search 须包含 href 的全部 query 参数
    const hrefParams = new URLSearchParams(query)
    for (const [key, value] of hrefParams) {
      if (searchParams.get(key) !== value) return false
    }
    return true
  }
  // href 无 query（如 /listings 总览）：仅当当前无 type 筛选时高亮
  return !searchParams.has('type')
}

export default function SiteNav({
  items,
  cities,
  defaultCity,
  multiCityRoutingEnabled,
  pathname,
  searchParams,
  onRefreshSearchParams,
}: Readonly<{
  /**
   * 主导航项（OPT-054）。href 已由服务端从目标池解析好——本组件不认识目标 id，
   * 也不该认识：解析放在客户端等于把路由池也打包进浏览器。
   */
  items: readonly PublicNavItem[]
  cities: readonly PublicCityOption[]
  defaultCity: string
  multiCityRoutingEnabled: boolean
  pathname: string
  searchParams: Pick<ReadonlyURLSearchParams, 'get' | 'getAll' | 'has' | 'size' | 'toString'>
  /** 展开抽屉前取最新 query，保证城市切换链接保留当前筛选（设计 §7.2）。 */
  onRefreshSearchParams?: () => void
}>) {
  const [open, setOpen] = useState(false)
  const toggleRef = useRef<HTMLButtonElement | null>(null)
  const drawerRef = useRef<HTMLDivElement | null>(null)
  const currentCity = resolveTrustedCity(pathname, cities, defaultCity, searchParams)
  const citySlug = currentCity?.slug
  const trustedCities = filterPublicCityOptions(cities)
  const sourceUrl = searchParams.size > 0 ? `${pathname}?${searchParams.toString()}` : pathname
  const cityPageType = getCityPageType(pathname)

  // Esc 关闭 + Tab 焦点锁定，归还焦点到触发器
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        toggleRef.current?.focus()
        return
      }
      if (e.key === 'Tab') {
        const drawer = drawerRef.current
        if (!drawer) return
        const focusable = Array.from(
          drawer.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true')
        if (focusable.length === 0) {
          e.preventDefault()
          return
        }
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  // 锁定背景滚动
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  // 打开时把焦点移入抽屉首个可聚焦元素
  useEffect(() => {
    if (!open) return
    const first = drawerRef.current?.querySelector<HTMLAnchorElement>('a, button')
    first?.focus()
  }, [open])

  useEffect(() => {
    if (!open || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const desktopMedia = window.matchMedia('(min-width: 1280px)')
    const closeAtDesktopBreakpoint = (event: MediaQueryListEvent) => {
      if (!event.matches) return
      setOpen(false)
      toggleRef.current?.focus()
    }
    desktopMedia.addEventListener('change', closeAtDesktopBreakpoint)
    if (desktopMedia.matches) closeAtDesktopBreakpoint({ matches: true } as MediaQueryListEvent)
    return () => desktopMedia.removeEventListener('change', closeAtDesktopBreakpoint)
  }, [open])

  return (
    <>
      {/* 桌面端导航 */}
      <nav className="site-nav" aria-label="主导航">
        {items.map((item) => {
          const href = citySlug ? cityAwareHref(item.href, citySlug, multiCityRoutingEnabled) : item.href
          const current = isCurrent(pathname, searchParams, href, item.href === '/')
          return (
            <Link
              key={item.href}
              href={href}
              prefetch={item.href.startsWith('/listings') ? false : undefined}
              className="site-nav__link"
              aria-current={current ? 'page' : undefined}
            >
              {item.label}
            </Link>
          )
        })}
      </nav>

      {/* 右侧动作区：仅移动端菜单触发器。
          原先这里还有一个头部 CTA「获取选址方案」（非委托页开询价弹层、委托页滚动
          聚焦本页表单），2026-09-03 按产品要求全站移除——各页自身的转化入口
          （委托/发布页的页内表单与吸底 CTA、房源与楼盘详情页的询价入口）保持不变。
          容器保留：移动端靠它让 logo 在左、汉堡靠右。 */}
      <div className="site-header__actions">
        {/* 移动端菜单触发器 */}
        <button
          ref={toggleRef}
          type="button"
          className="site-menu-toggle"
          aria-label={open ? '关闭菜单' : '打开菜单'}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-controls="mobile-drawer"
          onClick={() => {
            const nextOpen = isDesktopNavigationViewport() ? false : !open
            if (nextOpen) onRefreshSearchParams?.()
            if (nextOpen && multiCityRoutingEnabled && currentCity) {
              safeTrackCityEvent(track, 'city_switcher_opened', {
                city: currentCity.slug,
                status: currentCity.serviceStatus,
                page_type: cityPageType,
              })
            }
            setOpen(nextOpen)
          }}
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            {open ? (
              <>
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="18" y1="6" x2="6" y2="18" />
              </>
            ) : (
              <>
                <line x1="3" y1="7" x2="21" y2="7" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="17" x2="21" y2="17" />
              </>
            )}
          </svg>
        </button>
      </div>

      {/* 移动端抽屉 */}
      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="mobile-drawer__overlay"
              onClick={() => {
            setOpen(false)
            toggleRef.current?.focus()
          }}
        >
          <div
            ref={drawerRef}
            id="mobile-drawer"
            className="mobile-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="导航菜单"
            onClick={(e) => e.stopPropagation()}
          >
            <nav className="mobile-drawer__nav" aria-label="主导航（移动）">
              {items.map((item) => {
                const href = citySlug ? cityAwareHref(item.href, citySlug, multiCityRoutingEnabled) : item.href
                const current = isCurrent(pathname, searchParams, href, item.href === '/')
                return (
                  <Link
                    key={item.href}
                    href={href}
                    prefetch={item.href.startsWith('/listings') ? false : undefined}
                    className="mobile-drawer__link"
                    aria-current={current ? 'page' : undefined}
                    onClick={() => {
                      setOpen(false)
                      toggleRef.current?.focus()
                    }}
                  >
                    {item.label}
                  </Link>
                )
              })}
            </nav>
            {/* 抽屉可见关闭入口：汉堡按钮此时会盖在抽屉面板下面点不到，抽屉里
                在此之前没有任何按钮（唯一能关的是左侧窄遮罩或 Esc）。用绝对定位
                钉在抽屉右上角（见 styles.css .mobile-drawer__close），不影响它
                在文档流里的位置——放在导航链接之后、城市切换之前，避免变成
                焦点循环里新的首/尾元素（Tab 到底再回到最前时应落回第一条导航
                链接，Shift+Tab 从最前应绕到最后一条城市链接，city-switcher
                测试按这个假设断言）。 */}
            <button
              type="button"
              className="mobile-drawer__close"
              aria-label="关闭菜单"
              onClick={() => {
                setOpen(false)
                toggleRef.current?.focus()
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="18" y1="6" x2="6" y2="18" />
              </svg>
            </button>
            {multiCityRoutingEnabled && citySlug ? (
              <div className="mobile-drawer__cities" aria-label="切换城市">
                <p className="mobile-drawer__cities-title">切换城市</p>
                {trustedCities.map((city) => {
                  const href = citySwitchHref(sourceUrl, city.slug, multiCityRoutingEnabled)
                  if (!href) return null
                  return (
                    <Link
                      key={city.slug}
                      href={href}
                      className="mobile-drawer__link"
                      aria-current={city.slug === citySlug ? 'page' : undefined}
                      onClick={() => {
                        if (currentCity && city.slug !== currentCity.slug) {
                          safeTrackCityEvent(track, 'city_switched', {
                            from_city: currentCity.slug,
                            to_city: city.slug,
                            status: city.serviceStatus,
                            page_type: cityPageType,
                            filters_preserved: citySwitchPreservedFilters(sourceUrl, href),
                          })
                        }
                        setOpen(false)
                        toggleRef.current?.focus()
                      }}
                    >
                      <span>{city.name}</span>
                      <span className="mobile-drawer__city-status">
                        {city.serviceStatus === 'live' ? '已开通' : '正在开通'}
                      </span>
                    </Link>
                  )
                })}
              </div>
            ) : null}
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  )
}
