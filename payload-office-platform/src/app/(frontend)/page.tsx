import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import React from 'react'
import CityHomeView from '@/components/frontend/city/CityHomeView'
import {
  listPublicCityProfiles,
  livePlatformStatsSlugs,
  resolveCityContext,
} from '@/app/(frontend)/_lib/city-context'
import { cityHomeMetadata, renderCityHomeRoute } from '@/app/(frontend)/_lib/city-home'
import { getCachedHomepage, getCachedPlatformStats } from '@/lib/frontend/cached-queries'
import { buildPageMetadata } from '@/lib/frontend/metadata'
import { getMultiCityRoutingEnabled, siteConfig } from '@/lib/frontend/site-config'
import './styles.css'
import { getCachedSiteSettings } from '@/lib/frontend/site-settings'

export const dynamic = 'force-dynamic'

/**
 * OPT-068：多城市模式下 `/` 直接渲染默认城市首页（不再 307 到 `/shanghai`），
 * 因此 Metadata 也随之走城市口径——canonical 仍指向 `/shanghai`，URL 归属不变。
 * 关闭多城市路由时保持原有的根页文案与 canonical `/`。
 */
export async function generateMetadata(): Promise<Metadata> {
  if (!getMultiCityRoutingEnabled()) {
    return buildPageMetadata({
      title: '上海中高端商务办公租赁平台',
      description: '覆盖核心商务区、总部型整层、精装办公与高规格写字楼资源，帮企业更快完成选址决策。',
      canonicalPath: '/',
    })
  }
  const city = await resolveCityContext(siteConfig.defaultCity)
  if (!city) return { title: '页面未找到', robots: { index: false, follow: false } }
  return cityHomeMetadata(city)
}

/** Legacy canonical view while the server-side migration flag remains off. */
export default async function HomePage() {
  const city = await resolveCityContext(siteConfig.defaultCity)
  if (!city || city.serviceStatus !== 'live') notFound()
  if (getMultiCityRoutingEnabled()) {
    // OPT-068：直出，不再 307。根路径是搜索引擎与收藏夹最常见的入口，一次多余的
    // 往返（线上实测 0.16–0.70 秒）全落在首屏之前；canonical 由上面的
    // generateMetadata 指向 `/<city>`，URL 归属与重复内容处置不变。
    return renderCityHomeRoute(city)
  }
  // 两条链彼此独立（单城 homepage vs 跨城汇总 stats），并发拉取
  const [homepage, bandStats, siteSettings] = await Promise.all([
    getCachedHomepage(city.slug),
    listPublicCityProfiles().then((profiles) =>
      getCachedPlatformStats(livePlatformStatsSlugs(profiles)),
    ),
    // OPT-053：路由层取站点设置，往下当 props 传（CityHomeView 保持同步纯编排层）。
    // 与 layout 那次读取由 unstable_cache 在同一请求内去重，不多打一次库。
    getCachedSiteSettings(),
  ])
  // bandStats 只喂数据带（平台规模陈述）。三处 section 链接的数字由 CityHomeView
  // 内部改取 homepage.stats（单城口径）——它们的落点是城市域路由，见组件注释。
  return <CityHomeView city={city} homepage={homepage} routeMode="legacy" bandStats={bandStats} siteSettings={siteSettings} />
}
