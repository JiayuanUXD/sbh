import React from 'react'
import type { Metadata, Viewport } from 'next'
import { getMultiCityRoutingEnabled, siteConfig } from '@/lib/frontend/site-config'
import { getCachedSiteSettings } from '@/lib/frontend/site-settings'
import SiteHeader from '@/components/frontend/SiteHeader'
import SiteFooter from '@/components/frontend/SiteFooter'
import Script from 'next/script'

import { AnalyticsInit } from '@/lib/frontend/analytics'
import { resolveUmamiConfig } from '@/lib/frontend/analytics/umami-config'
import { listPublicCityOptions, listPublicCityProfiles } from './_lib/city-context'
import './styles.css'
// surface.css 必须在 home.css / list.css 之前：后两者依赖并覆写它的 .sf-* 基元
import './styles/surface.css'
import './styles/home.css'
import './styles/list.css'
import './styles/detail.css'
// recruit.css 必须在 styles.css 之后：招募页要在本页作用域内覆写 .filter-bar__input /
// .btn 这类全局原语。它独立成文件而不是追加到 styles.css 末尾，是因为
// tests/coming-soon-city-view.test.ts 对 styles.css 尾部切片做内容断言（禁新体系 token）。
import './styles/recruit.css'

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

// F2.1：theme-color 与设计 token 中的 bg 颜色保持一致，
// 让移动端浏览器地址栏与页面背景融合，避免滚动时露出白色色块。
export const viewport: Viewport = {
  themeColor: '#f5f5f7',
  width: 'device-width',
  initialScale: 1,
}

export default async function RootLayout(props: { children: React.ReactNode }) {
  const { children } = props
  // OPT-053：站点设置在这里读一次喂给页头页脚。页面组件是不透明 children，
  // **注入不了 props**——它们自己调 getCachedSiteSettings()，同一请求内由缓存去重。
  const [cities, profiles, siteSettings] = await Promise.all([
    listPublicCityOptions(),
    listPublicCityProfiles(),
    getCachedSiteSettings(),
  ])
  const multiCityRoutingEnabled = getMultiCityRoutingEnabled()
  const umami = resolveUmamiConfig()
  // `data-scroll-behavior="smooth"` 是给 Next 的显式握手，不是装饰：
  // styles.css 给 html 设了 `scroll-behavior: smooth`（锚点跳转与「回到顶部」要用）。
  // Next 的 disableSmoothScrollDuringRouteTransition 只有读到这个属性，才会在路由跳转期间
  // 把 scroll-behavior 临时压成 auto；没有它就直接执行 `scrollTop = 0`——于是从「上一页滚到
  // 一半」跳到新页面时，会平滑地一路滚上去，像一段多余的入场动画（只在上一页已经往下滚过时
  // 出现，所以表现为「有时候」）。dev 下 Next 会就此打印 warning，实现见
  // next/dist/shared/lib/router/utils/disable-smooth-scroll.js。
  // 守卫见 tests/frontend-layout-scroll-behavior.test.ts。
  return (
    <html lang="zh-CN" data-scroll-behavior="smooth">
      <body suppressHydrationWarning>
        {/* F2.2：skip link，键盘用户跳过头部直达主内容（WCAG 2.2 AA） */}
        <a href="#main-content" className="skip-link">跳到主要内容</a>
        <SiteHeader cities={cities} defaultCity={siteConfig.defaultCity} multiCityRoutingEnabled={multiCityRoutingEnabled} brand={{ siteName: siteSettings.siteName, logo: siteSettings.logo, mainNav: siteSettings.mainNav }} />
        <main id="main-content" className="site-main">{children}</main>
        <SiteFooter cities={cities} defaultCity={siteConfig.defaultCity} multiCityRoutingEnabled={multiCityRoutingEnabled} settings={siteSettings} />
        {/*
          OPT-064：自托管 Umami 采集脚本。未配置 NEXT_PUBLIC_UMAMI_* 时整段不渲染，
          adapter 那边同步退化为 Noop（判据同源于 resolveUmamiConfig，不会两边打架）。

          注意这三个 NEXT_PUBLIC_* 是**构建期内联**的，配在 CloudRun 的服务级
          环境变量里对客户端 bundle 不可见——它们的归属是 Dockerfile 的 builder
          阶段 ENV，改了要重新构建才生效。
        */}
        {umami && (
          <>
            <Script
              defer
              src={`${umami.src}/script.js`}
              data-website-id={umami.websiteId}
              strategy="afterInteractive"
            />
            {/* 热图（点击 + 滚动）走独立开关：它比普通采集重得多，存储量级也完全不同 */}
            {umami.heatmap && (
              <Script
                defer
                src={`${umami.src}/recorder.js`}
                data-website-id={umami.websiteId}
                strategy="afterInteractive"
              />
            )}
          </>
        )}
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
