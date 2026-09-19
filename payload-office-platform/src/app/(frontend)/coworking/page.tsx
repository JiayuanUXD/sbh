import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import React from 'react'
import CityListingsView from '@/components/frontend/city/CityListingsView'
import { resolveCityContext } from '@/app/(frontend)/_lib/city-context'
import { getCachedListingDistrictOptions, getCachedSearchListings } from '@/lib/frontend/cached-queries'
import { resolveListingSearchInput } from '@/app/(frontend)/_lib/search-input'
import { buildPageMetadata } from '@/lib/frontend/metadata'
import { parseListingViewMode } from '@/lib/frontend/listing-url'
import {
  buildCoworkingCanonicalParams,
  coworkingChannelPath,
  lockCoworkingInput,
} from '@/lib/frontend/coworking-channel'
import { getMultiCityRoutingEnabled, siteConfig } from '@/lib/frontend/site-config'
import { prefixedCanonicalPath } from '@/lib/frontend/city-routes'

/** legacy `/coworking`（OPT-103）：与 `sale/page.tsx` 同形——多城市开关开启时 307 到带前缀 URL，否则按默认城市渲染。 */
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
  const input = lockCoworkingInput(
    await resolveListingSearchInput(siteConfig.defaultCity, toUrlSearchParams(await searchParams)),
  )
  const query = buildCoworkingCanonicalParams(input).toString()
  return buildPageMetadata({
    title: '共享办公',
    canonicalPath: query ? `/coworking?${query}` : '/coworking',
  })
}

export default async function CoworkingPage({ searchParams }: Props) {
  const raw = await searchParams
  const city = await resolveCityContext(siteConfig.defaultCity)
  if (!city || city.serviceStatus !== 'live') notFound()
  if (getMultiCityRoutingEnabled()) {
    const destination = prefixedCanonicalPath(sourceUrl(coworkingChannelPath(), raw), city.slug)
    if (!destination) notFound()
    redirect(destination)
  }
  const input = lockCoworkingInput(await resolveListingSearchInput(city.slug, toUrlSearchParams(raw)))
  const canonical = buildCoworkingCanonicalParams(input).toString()
  const [result, districts] = await Promise.all([
    getCachedSearchListings(city.slug, canonical, input),
    getCachedListingDistrictOptions(city.slug),
  ])
  return (
    <CityListingsView
      city={city}
      result={result}
      districts={districts}
      input={input}
      basePath={coworkingChannelPath()}
      routeMode="legacy"
      channel="coworking"
      view={parseListingViewMode(raw.view)}
    />
  )
}
