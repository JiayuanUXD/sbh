import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import React from 'react'
import CityBuildingsView from '@/components/frontend/city/CityBuildingsView'
import { resolveCityContext } from '@/app/(frontend)/_lib/city-context'
import { getCachedSearchBuildings } from '@/lib/frontend/cached-queries'
import { buildPageMetadata } from '@/lib/frontend/metadata'
import { getMultiCityRoutingEnabled, siteConfig } from '@/lib/frontend/site-config'
import { prefixedCanonicalPath } from '@/lib/frontend/city-routes'

export const dynamic = 'force-dynamic'
type Props = Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>
function sourceUrl(pathname: string, value: Record<string, string | string[] | undefined>): string {
  const params = new URLSearchParams()
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === 'string') params.append(key, raw)
    else for (const item of raw ?? []) params.append(key, item)
  }
  const query = params.toString()
  return query ? `${pathname}?${query}` : pathname
}
export async function generateMetadata(): Promise<Metadata> { return buildPageMetadata({ title: '找写字楼', canonicalPath: '/buildings' }) }
export default async function BuildingsPage({ searchParams }: Props) {
  const raw = await searchParams
  const city = await resolveCityContext(siteConfig.defaultCity)
  if (!city || city.serviceStatus !== 'live') notFound()
  if (getMultiCityRoutingEnabled()) {
    const destination = prefixedCanonicalPath(sourceUrl('/buildings', raw), city.slug)
    if (!destination) notFound()
    redirect(destination)
  }
  const result = await getCachedSearchBuildings(city.slug)
  return <CityBuildingsView city={city} result={result} searchParams={raw} basePath="/buildings" routeMode="legacy" />
}
