import React from 'react'
import type { Metadata, Viewport } from 'next'
import { getMultiCityRoutingEnabled, siteConfig } from '@/lib/frontend/site-config'
import SiteHeader from '@/components/frontend/SiteHeader'
import SiteFooter from '@/components/frontend/SiteFooter'
import { AnalyticsInit } from '@/lib/frontend/analytics'
import { listPublicCityOptions, listPublicCityProfiles } from './_lib/city-context'
import './styles.css'

// The shared shell resolves its trusted city options and analytics profiles
// from Payload. CloudBase builds the image without the runtime PostgreSQL
// service, so all routes under this layout must resolve that shell at request
// time instead of during image-build prerendering.
export const dynamic = 'force-dynamic'

// F0.5：metadataBase 由类型化环境配置提供，禁止硬编码生产域名。
// 见 specs/frontend-mvp/tasks.md 与 design.md §11。
// 所有页面 canonical / OG 默认基于此 URL 解析相对路径。
export const metadata: Metadata = {
  metadataBase: siteConfig.siteUrl,
  title: {
    default: '商办租赁 · 上海中高端办公租赁平台',
    template: '%s · 商办租赁',
  },
  description: '上海甲级写字楼、独栋办公、共享办公与整层办公租赁平台。',
  applicationName: '商办租赁',
  authors: [{ name: '商办租赁平台' }],
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type: 'website',
    locale: 'zh_CN',
    siteName: '商办租赁',
  },
  robots: {
    index: true,
    follow: true,
  },
}

// F2.1：theme-color 与设计 token 中的 canvas 颜色保持一致，
// 让移动端浏览器地址栏与页面背景融合，避免滚动时露出白色色块。
export const viewport: Viewport = {
  themeColor: '#fcfbf8',
  width: 'device-width',
  initialScale: 1,
}

export default async function RootLayout(props: { children: React.ReactNode }) {
  const { children } = props
  const [cities, profiles] = await Promise.all([
    listPublicCityOptions(),
    listPublicCityProfiles(),
  ])
  const multiCityRoutingEnabled = getMultiCityRoutingEnabled()
  return (
    <html lang="zh-CN">
      <body suppressHydrationWarning>
        {/* F2.2：skip link，键盘用户跳过头部直达主内容（WCAG 2.2 AA） */}
        <a href="#main-content" className="skip-link">跳到主要内容</a>
        <SiteHeader cities={cities} defaultCity={siteConfig.defaultCity} multiCityRoutingEnabled={multiCityRoutingEnabled} />
        <main id="main-content" className="site-main">{children}</main>
        <SiteFooter cities={cities} defaultCity={siteConfig.defaultCity} multiCityRoutingEnabled={multiCityRoutingEnabled} />
        {/* OPT-010：埋点采集初始化，订阅页面隐藏/卸载 flush */}
        <React.Suspense fallback={null}>
          <AnalyticsInit defaultCity={siteConfig.defaultCity} multiCityRoutingEnabled={multiCityRoutingEnabled} cities={profiles.map((profile) => ({
            slug: profile.citySlug,
            serviceStatus: profile.serviceStatus,
          }))} />
        </React.Suspense>
      </body>
    </html>
  )
}
