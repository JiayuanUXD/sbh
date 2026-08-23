import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import React from 'react'
import CityHomeView from '@/components/frontend/city/CityHomeView'
import {
  listPublicCityProfiles,
  livePlatformStatsSlugs,
  resolveCityContext,
} from '@/app/(frontend)/_lib/city-context'
import { getCachedHomepage, getCachedPlatformStats } from '@/lib/frontend/cached-queries'
import { buildPageMetadata } from '@/lib/frontend/metadata'
import { getMultiCityRoutingEnabled, siteConfig } from '@/lib/frontend/site-config'
import { prefixedCanonicalPath } from '@/lib/frontend/city-routes'
import './styles.css'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = buildPageMetadata({
  title: '上海中高端商务办公租赁平台',
  description: '覆盖核心商务区、总部型整层、精装办公与高规格写字楼资源，帮企业更快完成选址决策。',
  canonicalPath: '/',
})

/** Legacy canonical view while the server-side migration flag remains off. */
export default async function HomePage() {
  const city = await resolveCityContext(siteConfig.defaultCity)
  if (!city || city.serviceStatus !== 'live') notFound()
  if (getMultiCityRoutingEnabled()) {
    const destination = prefixedCanonicalPath('/', city.slug)
    if (!destination) notFound()
    redirect(destination)
  }
  // 两条链彼此独立（单城 homepage vs 跨城汇总 stats），并发拉取
  const [homepage, bandStats] = await Promise.all([
    getCachedHomepage(city.slug),
    listPublicCityProfiles().then((profiles) =>
      getCachedPlatformStats(livePlatformStatsSlugs(profiles)),
    ),
  ])
  // bandStats 只喂数据带（平台规模陈述）。三处 section 链接的数字由 CityHomeView
  // 内部改取 homepage.stats（单城口径）——它们的落点是城市域路由，见组件注释。
  return <CityHomeView city={city} homepage={homepage} routeMode="legacy" bandStats={bandStats} />
}
