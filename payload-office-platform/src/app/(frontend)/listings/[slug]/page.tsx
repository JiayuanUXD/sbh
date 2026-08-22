import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import React from 'react'
import { resolveCityContext } from '@/app/(frontend)/_lib/city-context'
import CityListingDetailView from '@/components/frontend/city/CityListingDetailView'
import { resolveListingRouteIdentity } from '@/domain/public-catalog'
import { getCachedDetailRecommendations, getCachedListingBySlug } from '@/lib/frontend/cached-queries'
import { buildListingMetadata } from '@/lib/frontend/detail-metadata'
import { fetchNearbyPois } from '@/lib/frontend/location-pois'
import { hasAmapJsKey } from '@/lib/frontend/amap-public-config'
import { getServiceSchedule } from '@/lib/frontend/service-schedule'
import { getMultiCityRoutingEnabled, siteConfig } from '@/lib/frontend/site-config'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  if (getMultiCityRoutingEnabled()) {
    const identity = await resolveListingRouteIdentity(slug)
    if (!identity) notFound()
    redirect(`/${identity.citySlug}/listings/${encodeURIComponent(identity.slug)}`)
  }
  const listing = await getCachedListingBySlug(siteConfig.defaultCity, slug)
  return listing
    ? buildListingMetadata(listing, siteConfig.siteOrigin)
    : { title: '房源未找到', robots: { index: false, follow: false } }
}

export default async function ListingDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  if (getMultiCityRoutingEnabled()) {
    const identity = await resolveListingRouteIdentity(slug)
    if (!identity) notFound()
    redirect(`/${identity.citySlug}/listings/${encodeURIComponent(identity.slug)}`)
  }

  const city = await resolveCityContext(siteConfig.defaultCity)
  if (!city || city.serviceStatus !== 'live') notFound()
  const listing = await getCachedListingBySlug(city.slug, slug)
  if (!listing) notFound()
  const building = listing.building
  // OPT-037 Task 9：楼盘详情文档（原本只为「配套设施」段取楼盘级配套）随该段
  // 一并移除，这里少一次详情查询，合并层仍是同一个 Promise.all，没有另起 await 段。
  const [recommendations, pois, serviceSchedule] = await Promise.all([
    getCachedDetailRecommendations(city.slug, slug, 6),
    fetchNearbyPois(building?.id ?? 0, building?.coordinates),
    getServiceSchedule(),
  ])

  return <CityListingDetailView city={city} listing={listing}
    recommendations={recommendations} pois={pois} serviceSchedule={serviceSchedule}
    mapEnabled={building?.coordinates != null && hasAmapJsKey()} routeMode="legacy" />
}
