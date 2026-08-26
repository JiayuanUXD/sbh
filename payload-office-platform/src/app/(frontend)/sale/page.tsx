import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import React from 'react'
import CityListingsView from '@/components/frontend/city/CityListingsView'
import { resolveCityContext } from '@/app/(frontend)/_lib/city-context'
import { getCachedListingDistrictOptions, getCachedSearchListings } from '@/lib/frontend/cached-queries'
import { buildCanonicalSearchParams, parseListingSearchInput } from '@/domain/public-catalog'
import { buildPageMetadata } from '@/lib/frontend/metadata'
import { parseListingViewMode } from '@/lib/frontend/listing-url'
import { saleChannelPath, shouldIndexSaleChannel } from '@/lib/frontend/sale-channel'
import { getMultiCityRoutingEnabled, siteConfig } from '@/lib/frontend/site-config'
import { prefixedCanonicalPath } from '@/lib/frontend/city-routes'

/**
 * 全站出售频道（无城市前缀）。
 *
 * 与 `/listings` 同构：多城路由开启时 302 到 `/[city]/sale`，关闭时按默认城市直接
 * 渲染。存在意义是保住无前缀 URL 不 404，并给单城形态留退路。
 */
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
  const input = parseListingSearchInput(toUrlSearchParams(await searchParams))
  const query = buildCanonicalSearchParams(input).toString()
  const base = buildPageMetadata({
    title: '写字楼出售',
    canonicalPath: query ? `/sale?${query}` : '/sale',
  })
  const city = await resolveCityContext(siteConfig.defaultCity)
  if (!city || city.serviceStatus !== 'live') {
    return { ...base, robots: { index: false, follow: true } }
  }
  const result = await getCachedSearchListings(city.slug, query, input, 'sale')
  const indexable = shouldIndexSaleChannel(result.pagination.totalDocs)
  return { ...base, ...(indexable ? {} : { robots: { index: false, follow: true } }) }
}

export default async function SalePage({ searchParams }: Props) {
  const raw = await searchParams
  const city = await resolveCityContext(siteConfig.defaultCity)
  if (!city || city.serviceStatus !== 'live') notFound()
  if (getMultiCityRoutingEnabled()) {
    const destination = prefixedCanonicalPath(sourceUrl(saleChannelPath(), raw), city.slug)
    if (!destination) notFound()
    redirect(destination)
  }
  const input = parseListingSearchInput(toUrlSearchParams(raw))
  const canonical = buildCanonicalSearchParams(input).toString()
  const [result, districts] = await Promise.all([
    getCachedSearchListings(city.slug, canonical, input, 'sale'),
    getCachedListingDistrictOptions(city.slug),
  ])
  return (
    <CityListingsView
      city={city}
      result={result}
      districts={districts}
      input={input}
      basePath={saleChannelPath()}
      routeMode="legacy"
      businessType="sale"
      view={parseListingViewMode(raw.view)}
    />
  )
}
