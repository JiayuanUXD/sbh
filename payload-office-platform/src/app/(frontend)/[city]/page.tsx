import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import React from 'react'
import { cityHomeMetadata, renderCityHomeRoute } from '@/app/(frontend)/_lib/city-home'
import { listPublicCityProfiles, resolveCityContext } from '@/app/(frontend)/_lib/city-context'
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
  return cityHomeMetadata(city)
}

export default async function CityHomePage({ params }: Readonly<{ params: Promise<{ city: string }> }>) {
  const { city: slug } = await params
  const city = await resolveCityContext(slug)
  if (!city) notFound()
  // OPT-068：取数与渲染都在 _lib/city-home.tsx，与根路径 `/` 共用同一处定义。
  return renderCityHomeRoute(city)
}
