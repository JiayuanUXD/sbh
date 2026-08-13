import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import React from 'react'
import CityHomeView from '@/components/frontend/city/CityHomeView'
import { resolveCityContext } from '@/app/(frontend)/_lib/city-context'
import { getCachedHomepage } from '@/lib/frontend/cached-queries'
import { buildPageMetadata } from '@/lib/frontend/metadata'
import { getMultiCityRoutingEnabled, siteConfig } from '@/lib/frontend/site-config'
import { prefixedCanonicalPath } from '@/lib/frontend/city-routes'
import './styles.css'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = buildPageMetadata({
  title: '上海中高端商务办公租赁平台',
  description: '覆盖核心商务区、总部型整层、精装办公与高规格写字楼资源，帮企业更快完成选址决策。',
  canonicalPath: '/',
})

/** Legacy canonical view while the server-side migration flag remains off. */
export default async function HomePage() {
  const city = await resolveCityContext(siteConfig.defaultCity)
  if (!city || city.serviceStatus !== 'live') notFound()
  if (getMultiCityRoutingEnabled()) {
    const destination = prefixedCanonicalPath('/', city.slug)
    if (!destination) notFound()
    redirect(destination)
  }
  const homepage = await getCachedHomepage(city.slug)
  return <CityHomeView city={city} homepage={homepage} routeMode="legacy" />
}
