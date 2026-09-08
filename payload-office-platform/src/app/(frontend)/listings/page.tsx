import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import React from 'react'
import CityListingsView from '@/components/frontend/city/CityListingsView'
import { resolveCityContext } from '@/app/(frontend)/_lib/city-context'
import { getCachedListingDistrictOptions, getCachedSearchListings } from '@/lib/frontend/cached-queries'
import { buildCanonicalSearchParams } from '@/domain/public-catalog'
import { resolveListingSearchInput } from '@/app/(frontend)/_lib/listing-search-input'
import { buildPageMetadata } from '@/lib/frontend/metadata'
import { getMultiCityRoutingEnabled, siteConfig } from '@/lib/frontend/site-config'
import { prefixedCanonicalPath } from '@/lib/frontend/city-routes'
import { parseListingViewMode } from '@/lib/frontend/listing-url'

export const dynamic = 'force-dynamic'
type SearchParams = Record<string, string | string[] | undefined>
type Props = Readonly<{ searchParams: Promise<SearchParams> }>
function toUrlSearchParams(value: SearchParams): URLSearchParams {
  const params = new URLSearchParams()
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === 'string') params.set(key, raw)
    else if (typeof raw?.[0] === 'string') params.set(key, raw[0])
  }
  return params
}
function sourceUrl(pathname: string, value: SearchParams): string {
  const params = new URLSearchParams()
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === 'string') params.append(key, raw)
    else for (const item of raw ?? []) params.append(key, item)
  }
  const query = params.toString()
  return query ? `${pathname}?${query}` : pathname
}
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  // 无前缀路由只服务默认城市（多城开启时页面会 307 到带前缀的那条），区域词表
  // 因此取默认城市的那一份，与下方页面同一口径。
  const input = await resolveListingSearchInput(siteConfig.defaultCity, toUrlSearchParams(await searchParams))
  const query = buildCanonicalSearchParams(input).toString()
  return buildPageMetadata({ title: '在租房源', canonicalPath: query ? `/listings?${query}` : '/listings' })
}
export default async function ListingsPage({ searchParams }: Props) {
  const raw = await searchParams
  const city = await resolveCityContext(siteConfig.defaultCity)
  if (!city || city.serviceStatus !== 'live') notFound()
  if (getMultiCityRoutingEnabled()) {
    const destination = prefixedCanonicalPath(sourceUrl('/listings', raw), city.slug)
    if (!destination) notFound()
    redirect(destination)
  }
  const input = await resolveListingSearchInput(city.slug, toUrlSearchParams(raw))
  const canonical = buildCanonicalSearchParams(input).toString()
  const [result, districts] = await Promise.all([
    getCachedSearchListings(city.slug, canonical, input),
    getCachedListingDistrictOptions(city.slug),
  ])
  return <CityListingsView city={city} result={result} districts={districts} input={input} basePath="/listings" routeMode="legacy" view={parseListingViewMode(raw.view)} />
}
