import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import React from 'react'
import CityListingsView from '@/components/frontend/city/CityListingsView'
import ComingSoonCityView from '@/components/frontend/city/ComingSoonCityView'
import { listPublicCityOptions, resolveCityContext } from '@/app/(frontend)/_lib/city-context'
import { getCachedListingDistrictOptions, getCachedSearchListings } from '@/lib/frontend/cached-queries'
import { buildCanonicalSearchParams, parseListingSearchInput } from '@/domain/public-catalog'
import { resolveListingSearchInput } from '@/app/(frontend)/_lib/listing-search-input'
import { parseListingViewMode } from '@/lib/frontend/listing-url'
import { buildCityPageMetadata } from '@/lib/frontend/metadata'
import { getMultiCityRoutingEnabled } from '@/lib/frontend/site-config'

export const dynamic = 'force-dynamic'

type SearchParams = Record<string, string | string[] | undefined>
type Props = Readonly<{ params: Promise<{ city: string }>; searchParams: Promise<SearchParams> }>

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
  // canonical 与页面必须解析出同一份 input：区域取值的合法性也要在这里判一次，
  // 否则 `?district=<不存在的区>` 会被 canonical 当成一个有效筛选收录进索引
  // （这类 URL 是可索引的，见 buildCityPageMetadata 的 noindex 判据），而页面上它
  // 根本没生效。未开城的城市除外：那一页渲染 ComingSoonCityView、不消费筛选参数、
  // 且一律 noindex，不该为了校正 canonical 去取区域词表（「未开城不查库」，
  // 见 tests/city-route-pages.test.ts）。
  const input = city.serviceStatus === 'coming-soon'
    ? parseListingSearchInput(toUrlSearchParams(raw))
    : await resolveListingSearchInput(city.slug, toUrlSearchParams(raw))
  const query = buildCanonicalSearchParams(input).toString()
  return buildCityPageMetadata({
    city,
    pageType: 'listings',
    canonicalQuery: query || undefined,
    multiCityRoutingEnabled: getMultiCityRoutingEnabled(),
  })
}

export default async function CityListingsPage({ params, searchParams }: Props) {
  const [{ city: slug }, raw] = await Promise.all([params, searchParams])
  const city = await resolveCityContext(slug)
  if (!city) notFound()
  if (city.serviceStatus === 'coming-soon') {
    return <ComingSoonCityView city={city} />
  }
  const input = await resolveListingSearchInput(city.slug, toUrlSearchParams(raw))
  const canonical = buildCanonicalSearchParams(input).toString()
  const [result, districts] = await Promise.all([
    getCachedSearchListings(city.slug, canonical, input),
    getCachedListingDistrictOptions(city.slug),
  ])
  // view 不进 ListingSearchInput、不进 canonical（只改渲染不改结果集），因此在
  // 路由层单独解析后作为 prop 传入，见 lib/frontend/listing-url.ts 的注释。
  return <CityListingsView city={city} result={result} districts={districts} input={input} basePath={`/${city.slug}/listings`} routeMode="prefixed" view={parseListingViewMode(raw.view)} />
}
