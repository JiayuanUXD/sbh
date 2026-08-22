import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import React from 'react'
import CityBuildingsView from '@/components/frontend/city/CityBuildingsView'
import ComingSoonCityView from '@/components/frontend/city/ComingSoonCityView'
import { resolveCityContext } from '@/app/(frontend)/_lib/city-context'
import { getCachedSearchBuildingsFiltered } from '@/lib/frontend/cached-queries'
import { buildBuildingCanonicalParams, parseBuildingSearchInput } from '@/domain/public-catalog'
import { buildCityPageMetadata } from '@/lib/frontend/metadata'
import { getMultiCityRoutingEnabled } from '@/lib/frontend/site-config'

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
  const query = buildBuildingCanonicalParams(parseBuildingSearchInput(toUrlSearchParams(raw))).toString()
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
  const input = parseBuildingSearchInput(toUrlSearchParams(raw))
  const result = await getCachedSearchBuildingsFiltered(city.slug, input)
  return <CityBuildingsView city={city} result={result} input={input} basePath={`/${city.slug}/buildings`} routeMode="prefixed" />
}
