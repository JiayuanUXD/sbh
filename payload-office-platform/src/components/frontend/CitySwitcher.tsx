'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import React, { useEffect, useRef, useState } from 'react'
import type { PublicCityOption } from '@/app/(frontend)/_lib/city-context'
import { buildCityPath, getCityPageType, switchCityUrl } from '@/lib/frontend/city-routes'

export type CitySwitcherProps = Readonly<{
  cities: readonly PublicCityOption[]
  defaultCity: string
}>

export function resolveTrustedCity(
  pathname: string,
  cities: readonly PublicCityOption[],
  defaultCity: string,
): PublicCityOption | null {
  const firstSegment = pathname.split('/').filter(Boolean)[0]
  const pathnameCity = firstSegment ? cities.find((city) => city.slug === firstSegment) : undefined
  if (pathnameCity) return pathnameCity
  return cities.find((city) => city.slug === defaultCity) ?? cities[0] ?? null
}

export function cityAwareHref(href: string, citySlug: string): string {
  const pageType = getCityPageType(href)
  if (pageType === 'home') return buildCityPath(citySlug, 'home') ?? href
  if (pageType === 'listings' || pageType === 'buildings') return switchCityUrl(href, citySlug) ?? href
  if (pageType === 'entrust' || pageType === 'publish' || pageType === 'city-partner') {
    return buildCityPath(citySlug, pageType) ?? href
  }
  return href
}

function serviceStatusLabel(status: PublicCityOption['serviceStatus']): string {
  return status === 'live' ? '已开通' : '正在开通'
}

export default function CitySwitcher({ cities, defaultCity }: CitySwitcherProps) {
  const pathname = usePathname() || '/'
  const searchParams = useSearchParams()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const activeCity = resolveTrustedCity(pathname, cities, defaultCity)
  const sourceUrl = searchParams.size > 0 ? `${pathname}?${searchParams.toString()}` : pathname

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  if (!activeCity) return null

  return (
    <div className="city-switcher">
      <button
        ref={triggerRef}
        type="button"
        className="city-switcher__trigger"
        aria-controls="city-switcher-menu"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
      >
        <span>{activeCity.name}</span>
        <span className="city-switcher__trigger-label">切换城市</span>
      </button>
      {open ? (
        <div id="city-switcher-menu" className="city-switcher__menu" role="menu" aria-label="切换城市">
          {cities.map((city) => {
            const href = switchCityUrl(sourceUrl, city.slug)
            if (!href) return null
            const current = city.slug === activeCity.slug
            return (
              <Link
                key={city.slug}
                href={href}
                role="menuitem"
                className="city-switcher__option"
                aria-current={current ? 'page' : undefined}
              >
                <span>{city.name}</span>
                <span className="city-switcher__status">{serviceStatusLabel(city.serviceStatus)}</span>
              </Link>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
