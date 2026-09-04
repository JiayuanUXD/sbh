import type { Metadata } from 'next'
import React from 'react'
import CityHomeView from '@/components/frontend/city/CityHomeView'
import ComingSoonCityView from '@/components/frontend/city/ComingSoonCityView'
import type { CityContext } from '@/domain/city-site-profile/resolver'
import { getCachedHomepage } from '@/lib/frontend/cached-queries'
import { buildCityPageMetadata } from '@/lib/frontend/metadata'
import { getCachedSiteSettings } from '@/lib/frontend/site-settings'
import { getMultiCityRoutingEnabled } from '@/lib/frontend/site-config'

/**
 * 城市首页的取数 + 渲染 + Metadata（OPT-068）。
 *
 * ## 为什么抽出来
 *
 * 根路径 `/` 在多城市模式下原先是 `redirect('/shanghai')`：搜索引擎与收藏夹最常见的
 * 入口，用户白等一个往返（线上实测多 0.16–0.70 秒）才开始渲染。现在 `/` 直接渲染
 * 默认城市首页，canonical 仍指向 `/shanghai`（唯一 URL 归属不变，避免重复内容）。
 *
 * 两条路由要渲染同一个页面，**渲染只能有一处定义**——否则「首页改了一处、另一处
 * 没改」是必然发生的事（本仓库已因同类重复翻过车，见 `.agent/frontend.md`）。
 */

export type CityHomeProps = Readonly<{
  homepage: Awaited<ReturnType<typeof getCachedHomepage>>
  siteSettings: Awaited<ReturnType<typeof getCachedSiteSettings>>
}>

/** 城市首页取数：首页数据与站点设置并发；同一请求内由 unstable_cache 去重。 */
export async function loadCityHomeProps(city: CityContext): Promise<CityHomeProps> {
  const [homepage, siteSettings] = await Promise.all([
    getCachedHomepage(city.slug),
    getCachedSiteSettings(),
  ])
  return { homepage, siteSettings }
}

/**
 * 城市首页路由渲染入口：**未开城的城市不取库存**（即将开放页没有供给可展示，
 * 取了就是白打一次全量查询——`tests/city-route-pages.test.ts` 有守卫）。
 */
export async function renderCityHomeRoute(city: CityContext): Promise<React.JSX.Element> {
  if (city.serviceStatus === 'coming-soon') {
    return <ComingSoonCityView city={city} />
  }
  return renderCityHome(city, await loadCityHomeProps(city))
}

/**
 * 城市首页渲染。`bandStats` 用单城口径（`homepage.stats`）——根路径此前用的是跨城
 * 汇总，但多城市模式下 `/` 就是默认城市的首页，数据带说的也该是这个城市。
 */
export function renderCityHome(city: CityContext, props: CityHomeProps): React.JSX.Element {
  if (city.serviceStatus === 'coming-soon') {
    return <ComingSoonCityView city={city} />
  }
  return (
    <CityHomeView
      city={city}
      homepage={props.homepage}
      routeMode="prefixed"
      bandStats={props.homepage.stats}
      siteSettings={props.siteSettings}
    />
  )
}

/** 城市首页 Metadata：canonical 落在 `/<city>`，`/` 与 `/<city>` 两条路由同一份。 */
export function cityHomeMetadata(city: CityContext): Metadata {
  return buildCityPageMetadata({
    city,
    pageType: 'home',
    multiCityRoutingEnabled: getMultiCityRoutingEnabled(),
  })
}
