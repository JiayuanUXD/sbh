import type { Metadata } from 'next'
import Link from 'next/link'
import React from 'react'
import { EmptyState } from '@/components/frontend/ui/States'

/**
 * C 端全局 404 —— (frontend) 路由组没有自己的 not-found 边界时，无效城市 slug、
 * 失效的收藏链接、拼错的地址一律落到 Next.js 内置默认 404（英文、无页头页脚、
 * 自带 `prefers-color-scheme: dark`），与站内白底中文视觉完全割裂。
 *
 * 本文件与 `(frontend)/layout.tsx` 同级，由该 layout 包裹（复用其 SiteHeader /
 * SiteFooter），因此这里只渲染 `<main>` 内的正文，不重复渲染页头页脚。
 *
 * 不读取任何数据：出口链接全部指向不依赖具体城市的路由（`/`、`/listings`、
 * `/buildings`、`/news`），未接入多城市路由的城市会在这些路由内部按默认城市
 * 处理，本文件不需要自己猜城市 slug，因此也不需要 `dynamic = 'force-dynamic'`。
 */
export const metadata: Metadata = {
  title: '页面未找到',
  robots: { index: false, follow: true },
}

export default function NotFound(): React.JSX.Element {
  return (
    <EmptyState
      title="这个地址不存在"
      description="链接可能已经失效，或者你要找的房源、楼盘已经下架。换个入口，继续找你需要的办公空间。"
      action={
        <>
          <Link href="/" className="btn btn--primary">回首页</Link>
          <Link href="/listings" className="btn btn--ghost">找办公室</Link>
          <Link href="/buildings" className="btn btn--ghost">找楼盘</Link>
          <Link href="/news" className="btn btn--ghost">看资讯</Link>
        </>
      }
    />
  )
}
