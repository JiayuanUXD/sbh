'use client'

import Link from 'next/link'
import { usePathname, useSearchParams, type ReadonlyURLSearchParams } from 'next/navigation'
import React, { useEffect, useRef, useState } from 'react'
import InquiryModal from '@/components/frontend/InquiryModal'
import {
  createBrowserFocusEnvironment,
  focusLandingTarget,
} from '@/components/frontend/landing/BottomCtaBar'
import { track } from '@/lib/frontend/analytics'
import { safeTrackLandingEvent } from '@/lib/frontend/analytics/landing'
import { MAIN_NAV_ITEMS } from '@/lib/frontend/public-nav'

export type CtaPageType = 'home' | 'search' | 'building' | 'content' | 'entrust'

export function resolveCtaPageType(pathname: string): CtaPageType {
  if (pathname.startsWith('/entrust')) return 'entrust'
  if (pathname.startsWith('/buildings')) return 'building'
  if (pathname.startsWith('/news')) return 'content'
  if (pathname.startsWith('/listings')) return 'search'
  return 'home'
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
 */
function isCurrent(
  pathname: string,
  searchParams: ReadonlyURLSearchParams,
  href: string,
): boolean {
  const [path, query = ''] = href.split('?')
  if (!path) return false
  if (path === '/') return pathname === '/'
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

export default function SiteNav() {
  const pathname = usePathname() || '/'
  const searchParams = useSearchParams()
  const [open, setOpen] = useState(false)
  const toggleRef = useRef<HTMLButtonElement | null>(null)
  const drawerRef = useRef<HTMLDivElement | null>(null)

  // 顶部 CTA「获取选址方案」是通用选址需求入口（无具体房源/楼盘 target），
  // pageType 仅记录入口上下文，按当前路径粗分类以便分析。
  const ctaPageType = resolveCtaPageType(pathname)

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
        ).filter((el) => el.offsetParent !== null)
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

  return (
    <>
      {/* 桌面端导航 */}
      <nav className="site-nav" aria-label="主导航">
        {MAIN_NAV_ITEMS.map((item) => {
          const current = isCurrent(pathname, searchParams, item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={item.href.startsWith('/listings') ? false : undefined}
              className="site-nav__link"
              aria-current={current ? 'page' : undefined}
            >
              {item.label}
            </Link>
          )
        })}
      </nav>

      {/* 右侧动作区：铜色 CTA + 移动端菜单触发器。
          委托找房页自带零门槛表单，头部 CTA 直接滚动聚焦本页表单，
          避免同屏出现弹窗重表单与页面轻表单两条转化路径；其余页保留询价弹层。
          包一层 .site-header__actions，保证移动端 logo 在左、CTA+汉堡整体靠右。 */}
      <div className="site-header__actions">
        {ctaPageType === 'entrust' ? (
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={() => {
              safeTrackLandingEvent(track, 'landing_header_cta_click', { page_type: 'entrust' })
              const focused = focusLandingTarget('entrust-phone', createBrowserFocusEnvironment())
              if (!focused) window.scrollTo({ top: 0, behavior: 'smooth' })
            }}
          >
            获取选址方案
          </button>
        ) : (
          <InquiryModal
            pageType={ctaPageType}
            triggerLabel="获取选址方案"
            triggerVariant="primary"
            triggerClassName="btn--sm"
          />
        )}

        {/* 移动端菜单触发器 */}
        <button
          ref={toggleRef}
          type="button"
          className="site-menu-toggle"
          aria-label={open ? '关闭菜单' : '打开菜单'}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-controls="mobile-drawer"
          onClick={() => setOpen((v) => !v)}
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
      {open && (
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
              {MAIN_NAV_ITEMS.map((item) => {
                const current = isCurrent(pathname, searchParams, item.href)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
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
          </div>
        </div>
      )}
    </>
  )
}
