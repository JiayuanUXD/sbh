'use client'

import React from 'react'

import { Field, Select } from '@/components/frontend/ui'
import { buildCityPath } from '@/lib/frontend/city-routes'

export type LeadCityOption = Readonly<{ slug: string; name: string }>

export default function LeadCitySelect({
  pageType,
  cities,
  selectedCity,
  error,
  onChange,
}: Readonly<{
  pageType: 'entrust' | 'publish'
  cities: readonly LeadCityOption[]
  selectedCity: string
  error?: string
  onChange: (citySlug: string) => void
}>) {
  return (
    <Field label="服务城市" id={`${pageType}-city`} error={error} required>
      <Select
        id={`${pageType}-city`}
        name="city"
        value={selectedCity}
        aria-invalid={error ? true : undefined}
        onChange={(event) => {
          const citySlug = event.target.value
          if (!cities.some((city) => city.slug === citySlug)) return
          onChange(citySlug)
          const destination = buildCityPath(citySlug, pageType)
          if (destination && typeof window !== 'undefined') {
            window.history.replaceState(window.history.state, '', destination)
          }
        }}
      >
        {!selectedCity ? <option value="">请选择城市</option> : null}
        {cities.map((city) => (
          <option key={city.slug} value={city.slug}>{city.name}</option>
        ))}
      </Select>
    </Field>
  )
}
