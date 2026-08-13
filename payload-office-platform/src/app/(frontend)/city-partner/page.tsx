import type { Metadata } from 'next'
import React from 'react'

import {
  listPublicCityOptions,
  resolveCityContext,
  type PublicCityOption,
} from '@/app/(frontend)/_lib/city-context'
import { normalizeCitySlug } from '@/domain/city-site-profile/resolver'
import CityPartnerApplicationForm from '@/components/frontend/city-partner/CityPartnerApplicationForm'
import { CITY_PARTNER_COPY } from '@/lib/frontend/city-partner-config'
import { buildPageMetadata, cityPartnerCanonical } from '@/lib/frontend/metadata'
import { siteConfig } from '@/lib/frontend/site-config'

export const metadata: Metadata = buildPageMetadata({
  title: '城市合作伙伴申请',
  description: '提交城市合作伙伴申请，与我们沟通本地商业办公服务资源与合作方向。',
  canonicalPath: cityPartnerCanonical(),
})

export default async function CityPartnerPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ city?: string | string[] }> }>) {
  const [cities, query] = await Promise.all([listPublicCityOptions(), searchParams])
  const explicitCity = typeof query.city === 'string' ? query.city : query.city === undefined ? undefined : ''
  const candidate = explicitCity ?? siteConfig.defaultCity
  const normalized = normalizeCitySlug(candidate)
  const isCanonical = normalized !== null && normalized === candidate
  const context = isCanonical ? await resolveCityContext(candidate) : null
  const selection = context
    ? { selectedCity: context.slug, invalidExplicitCity: false }
    : {
        selectedCity: '',
        invalidExplicitCity: explicitCity !== undefined,
      }
  const selectedOption: PublicCityOption | null = context && !cities.some((city) => city.slug === context.slug)
    ? {
        slug: context.slug,
        name: context.name,
        serviceStatus: context.serviceStatus,
        sortOrder: context.profile.sortOrder,
      }
    : null
  const selectableCities = selectedOption ? [...cities, selectedOption] : cities
  const cityUnavailableMessage = !context && explicitCity === undefined
    ? '当前默认城市暂不可申请，请稍后再试'
    : undefined

  return (
    <main className="city-partner-page">
      <section className="city-partner-page__intro" aria-labelledby="city-partner-title">
        <div className="city-partner-page__copy">
          <p className="city-partner-page__eyebrow">{CITY_PARTNER_COPY.eyebrow}</p>
          <h1 id="city-partner-title">{CITY_PARTNER_COPY.title}</h1>
          <p className="city-partner-page__lead">{CITY_PARTNER_COPY.intro}</p>
          <p className="city-partner-page__note">{CITY_PARTNER_COPY.note}</p>
        </div>
        <CityPartnerApplicationForm
          cities={selectableCities}
          initialCity={selection.selectedCity}
          invalidExplicitCity={selection.invalidExplicitCity}
          cityUnavailableMessage={cityUnavailableMessage}
        />
      </section>
    </main>
  )
}
