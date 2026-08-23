import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import React from 'react'
import CityBuildingsView from '@/components/frontend/city/CityBuildingsView'
import { resolveCityContext } from '@/app/(frontend)/_lib/city-context'
import { getCachedSearchBuildingsFiltered } from '@/lib/frontend/cached-queries'
import { buildBuildingCanonicalParams, parseBuildingSearchInput } from '@/domain/public-catalog'
import { buildPageMetadata } from '@/lib/frontend/metadata'
import { getMultiCityRoutingEnabled, siteConfig } from '@/lib/frontend/site-config'
import { prefixedCanonicalPath } from '@/lib/frontend/city-routes'

export const dynamic = 'force-dynamic'
type SearchParams = Record<string, string | string[] | undefined>
type Props = Readonly<{ searchParams: Promise<SearchParams> }>
function sourceUrl(pathname: string, value: SearchParams): string {
  const params = new URLSearchParams()
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === 'string') params.append(key, raw)
    else for (const item of raw ?? []) params.append(key, item)
  }
  const query = params.toString()
  return query ? `${pathname}?${query}` : pathname
}
/** 与 `[city]/buildings/page.tsx` 同一口径：多值只取第一个（六个维度都是单选行）。 */
function toUrlSearchParams(value: SearchParams): URLSearchParams {
  const params = new URLSearchParams()
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === 'string') params.set(key, raw)
    else if (typeof raw?.[0] === 'string') params.set(key, raw[0])
  }
  return params
}
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const raw = await searchParams
  const query = buildBuildingCanonicalParams(parseBuildingSearchInput(toUrlSearchParams(raw))).toString()
  return buildPageMetadata({ title: '找写字楼', canonicalPath: query ? `/buildings?${query}` : '/buildings' })
}
export default async function BuildingsPage({ searchParams }: Props) {
  const raw = await searchParams
  const city = await resolveCityContext(siteConfig.defaultCity)
  if (!city || city.serviceStatus !== 'live') notFound()
  if (getMultiCityRoutingEnabled()) {
    const destination = prefixedCanonicalPath(sourceUrl('/buildings', raw), city.slug)
    if (!destination) notFound()
    redirect(destination)
  }
  // 与前缀路由同一条链路：解析 → 查询层筛选/排序/分页/分组 → 视图只消费结果。
  const input = parseBuildingSearchInput(toUrlSearchParams(raw))
  const result = await getCachedSearchBuildingsFiltered(city.slug, input)
  return <CityBuildingsView city={city} result={result} input={input} basePath="/buildings" routeMode="legacy" />
}
