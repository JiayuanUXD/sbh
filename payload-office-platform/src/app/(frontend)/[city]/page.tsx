import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import React from 'react'
import CityHomeView from '@/components/frontend/city/CityHomeView'
import ComingSoonCityView from '@/components/frontend/city/ComingSoonCityView'
import { listPublicCityProfiles, resolveCityContext } from '@/app/(frontend)/_lib/city-context'
import { getCachedHomepage } from '@/lib/frontend/cached-queries'
import { buildPageMetadata } from '@/lib/frontend/metadata'
import { getMultiCityRoutingEnabled } from '@/lib/frontend/site-config'
import { isPublicCitySlug } from '@/lib/frontend/city-routes'

export const dynamicParams = true
export const revalidate = 300

export async function generateStaticParams(): Promise<{ city: string }[]> {
  let profiles: Awaited<ReturnType<typeof listPublicCityProfiles>>
  try {
    profiles = await listPublicCityProfiles()
  } catch {
    console.error('city_static_params_unavailable')
    return []
  }
  return profiles
    .filter((profile) => isPublicCitySlug(profile.citySlug))
    .map((profile) => ({ city: profile.citySlug }))
}

export async function generateMetadata({ params }: Readonly<{ params: Promise<{ city: string }> }>): Promise<Metadata> {
  const { city: slug } = await params
  const city = await resolveCityContext(slug)
  if (!city) return { title: '页面未找到', robots: { index: false, follow: false } }
  return buildPageMetadata({
    title: city.profile.seoTitle,
    description: city.profile.seoDescription,
    canonicalPath: `/${city.slug}`,
    robots: city.serviceStatus === 'coming-soon' || !getMultiCityRoutingEnabled() ? 'noindex' : 'index',
  })
}

export default async function CityHomePage({ params }: Readonly<{ params: Promise<{ city: string }> }>) {
  const { city: slug } = await params
  const city = await resolveCityContext(slug)
  if (!city) notFound()
  if (city.serviceStatus === 'coming-soon') return <ComingSoonCityView city={city} />
  const homepage = await getCachedHomepage(city.slug)
  return <CityHomeView city={city} homepage={homepage} routeMode="prefixed" />
}
