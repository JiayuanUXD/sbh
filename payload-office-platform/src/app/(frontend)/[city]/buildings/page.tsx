import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import React from 'react'
import CityBuildingsView from '@/components/frontend/city/CityBuildingsView'
import ComingSoonCityView from '@/components/frontend/city/ComingSoonCityView'
import { listPublicCityOptions, resolveCityContext } from '@/app/(frontend)/_lib/city-context'
import { getCachedSearchBuildings } from '@/lib/frontend/cached-queries'
import { buildCityPageMetadata } from '@/lib/frontend/metadata'
import { getMultiCityRoutingEnabled } from '@/lib/frontend/site-config'

export const dynamic = 'force-dynamic'

type Props = Readonly<{
  params: Promise<{ city: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}>

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { city: slug } = await params
  const city = await resolveCityContext(slug)
  if (!city) return { title: '页面未找到', robots: { index: false, follow: false } }
  return buildCityPageMetadata({
    city,
    pageType: 'buildings',
    multiCityRoutingEnabled: getMultiCityRoutingEnabled(),
  })
}

export default async function CityBuildingsPage({ params, searchParams }: Props) {
  const { city: slug } = await params
  const city = await resolveCityContext(slug)
  if (!city) notFound()
  if (city.serviceStatus === 'coming-soon') {
    return <ComingSoonCityView city={city} />
  }
  const result = await getCachedSearchBuildings(city.slug)
  return <CityBuildingsView city={city} result={result} searchParams={await searchParams} basePath={`/${city.slug}/buildings`} routeMode="prefixed" />
}
