'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import React, { Suspense, useEffect, useState } from 'react'
import SiteNav from '@/components/frontend/SiteNav'

/**
 * 公开站点页头外壳（client）：首页首屏透明压视频，下滑后切回奶油实底。
 *
 * 从 (frontend)/layout.tsx 抽出为 client 组件，因为需要 usePathname 判首页
 * 与 scroll 监听切透明/实底；logo / SiteNav / InquiryModal 全部收敛到此处。
 *
 * 守护不变量：
 *   - 仅首页（pathname === '/'）且未滚动时透明；非首页始终实底，不受污染；
 *   - 滚动阈值 40px（约导航高度），过阈即切回实底；
 *   - skip link 仍由 layout 渲染，焦点顺序不变。
 */
export default function SiteHeader() {
  const pathname = usePathname()
  const isHome = pathname === '/'
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
        <Link href="/" className="site-logo" aria-label="商办租赁首页">商办租赁</Link>
        <Suspense fallback={<nav className="site-nav" aria-label="主导航" />}>
          <SiteNav />
        </Suspense>
      </div>
    </header>
  )
}
