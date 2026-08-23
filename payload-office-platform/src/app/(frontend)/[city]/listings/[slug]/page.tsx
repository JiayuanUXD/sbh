import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import React from 'react'
import CityListingDetailView from '@/components/frontend/city/CityListingDetailView'
import { resolveCityContext } from '@/app/(frontend)/_lib/city-context'
import { getCachedDetailRecommendations, getCachedListingBySlug } from '@/lib/frontend/cached-queries'
import { buildListingMetadata } from '@/lib/frontend/detail-metadata'
import { fetchNearbyPois } from '@/lib/frontend/location-pois'
import { hasAmapJsKey } from '@/lib/frontend/amap-public-config'
import { getServiceSchedule } from '@/lib/frontend/service-schedule'
import { getMultiCityRoutingEnabled, siteConfig } from '@/lib/frontend/site-config'
import { resolveListingRouteIdentity } from '@/domain/public-catalog'

export const dynamic = 'force-dynamic'

type Props = Readonly<{ params: Promise<{ city: string; slug: string }> }>

async function loadCityDetail({ city: routeCity, slug }: Awaited<Props['params']>) {
  const city = await resolveCityContext(routeCity)
  if (!city) return { city: null, listing: null }
  const identity = await resolveListingRouteIdentity(slug)
  if (!identity) return { city, listing: null }
  if (identity.citySlug !== city.slug) redirect(`/${identity.citySlug}/listings/${encodeURIComponent(identity.slug)}`)
  if (city.serviceStatus !== 'live') return { city, listing: null }
  const listing = await getCachedListingBySlug(city.slug, slug)
  return { city, listing }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const loaded = await loadCityDetail(await params)
  if (!loaded.city || !loaded.listing) return { title: '房源未找到', robots: { index: false, follow: false } }
  const routingEnabled = getMultiCityRoutingEnabled()
  const metadata = buildListingMetadata(
    loaded.listing,
    siteConfig.siteOrigin,
    routingEnabled ? { citySlug: loaded.city.slug } : undefined,
  )
  return routingEnabled ? metadata : { ...metadata, robots: { index: false, follow: true } }
}

export default async function CityListingDetailPage({ params }: Props) {
  const loaded = await loadCityDetail(await params)
  if (!loaded.city || !loaded.listing) notFound()
  const building = loaded.listing.building
  // OPT-037 Task 9：见 legacy 路由同款注释——楼盘详情文档不再需要。
  const [recommendations, pois, serviceSchedule] = await Promise.all([
    getCachedDetailRecommendations(loaded.city.slug, loaded.listing.slug, 6),
    fetchNearbyPois(building?.id ?? 0, building?.coordinates),
    getServiceSchedule(),
  ])
  return <CityListingDetailView city={loaded.city} listing={loaded.listing}
    recommendations={recommendations} pois={pois} serviceSchedule={serviceSchedule}
    mapEnabled={building?.coordinates != null && hasAmapJsKey()}
    routeMode={getMultiCityRoutingEnabled() ? 'prefixed' : 'legacy'} />
}
