import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import React from 'react'
import CityBuildingsView from '@/components/frontend/city/CityBuildingsView'
import ComingSoonCityView from '@/components/frontend/city/ComingSoonCityView'
import { resolveCityContext } from '@/app/(frontend)/_lib/city-context'
import { getCachedSearchBuildingsFiltered } from '@/lib/frontend/cached-queries'
import { buildBuildingCanonicalParams, parseBuildingSearchInput } from '@/domain/public-catalog'
import { resolveBuildingSearchInput } from '@/app/(frontend)/_lib/search-input'
import { buildCityPageMetadata } from '@/lib/frontend/metadata'
import { getMultiCityRoutingEnabled } from '@/lib/frontend/site-config'
// 版式解析复用房源页那一份（`lib/frontend/listing-url` 是两个列表页共用的 URL 基元
// 模块，本文件已经在用它的 buildHref/cloneSearchParams 家族）。刻意**不**新做一个
// 域层导出：`tests/city-route-pages.test.ts` 把 `@/domain/public-catalog` 整个 mock 成
// 固定导出表，新增域层函数在那里会 undefined，把楼盘路由整组用例带崩。
import { parseListingViewMode } from '@/lib/frontend/listing-url'

export const dynamic = 'force-dynamic'

type SearchParams = Record<string, string | string[] | undefined>
type Props = Readonly<{
  params: Promise<{ city: string }>
  searchParams: Promise<SearchParams>
}>

/**
 * Next 的 searchParams 是 `string | string[]`，解析层吃 `URLSearchParams`。
 * 与 `[city]/listings/page.tsx` 的同名函数逐行相同，刻意各留一份：两者都只有
 * 六行，抽成共享工具的收益抵不上多一层跨路由耦合（改一处要回想另一处）。
 * 多值只取第一个——楼盘筛选六个维度都是单选行。
 */
function toUrlSearchParams(value: SearchParams): URLSearchParams {
  const params = new URLSearchParams()
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === 'string') params.set(key, raw)
    else if (typeof raw?.[0] === 'string') params.set(key, raw[0])
  }
  return params
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ city: slug }, raw] = await Promise.all([params, searchParams])
  const city = await resolveCityContext(slug)
  if (!city) return { title: '页面未找到', robots: { index: false, follow: false } }
  // canonical 走规范化后的查询串：同一组筛选无论书写顺序如何都指向同一个 canonical。
  // 区域取值的合法性也要在这里判一次，否则 `?district=<不存在的区>` 会被 canonical
  // 当成一个有效筛选收录进索引（这类 URL 是可索引的，见 buildCityPageMetadata 的
  // noindex 判据），而页面上它根本没生效。未开城的城市除外：那一页渲染
  // ComingSoonCityView、不消费筛选参数、且一律 noindex，不该为了校正 canonical 去取
  // 区域词表（「未开城不查库」，见 tests/city-route-pages.test.ts）。
  const input = city.serviceStatus === 'coming-soon'
    ? parseBuildingSearchInput(toUrlSearchParams(raw))
    : await resolveBuildingSearchInput(city.slug, toUrlSearchParams(raw))
  const query = buildBuildingCanonicalParams(input).toString()
  return buildCityPageMetadata({
    city,
    pageType: 'buildings',
    canonicalQuery: query || undefined,
    multiCityRoutingEnabled: getMultiCityRoutingEnabled(),
  })
}

export default async function CityBuildingsPage({ params, searchParams }: Props) {
  const [{ city: slug }, raw] = await Promise.all([params, searchParams])
  const city = await resolveCityContext(slug)
  if (!city) notFound()
  if (city.serviceStatus === 'coming-soon') {
    return <ComingSoonCityView city={city} />
  }
  // 筛选 / 排序 / 分页 / 分组全在查询层完成，视图只消费结果（OPT-036 Task 12）。
  const input = await resolveBuildingSearchInput(city.slug, toUrlSearchParams(raw))
  const result = await getCachedSearchBuildingsFiltered(city.slug, input)
  return <CityBuildingsView city={city} result={result} input={input} basePath={`/${city.slug}/buildings`} routeMode="prefixed" view={parseListingViewMode(raw.view)} />
}
