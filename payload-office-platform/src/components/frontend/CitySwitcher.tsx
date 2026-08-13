'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import React, { useEffect, useRef, useState } from 'react'
import { safeTrackCityEvent, track } from '@/lib/frontend/analytics'
import type { PublicCityOption } from '@/app/(frontend)/_lib/city-context'
import {
  buildCityPath,
  citySwitchPreservedFilters,
  getCityPageType,
  isPublicCitySlug,
  resolveTrustedRouteCity,
  switchCityUrl,
} from '@/lib/frontend/city-routes'

export type CitySwitcherProps = Readonly<{
  cities: readonly PublicCityOption[]
  defaultCity: string
}>

/** Keeps all client city controls on the same Task 1 route trust boundary. */
export function filterPublicCityOptions(
  cities: readonly PublicCityOption[],
): readonly PublicCityOption[] {
  return cities.filter((city) => isPublicCitySlug(city.slug))
}

export function resolveTrustedCity(
  pathname: string,
  cities: readonly PublicCityOption[],
  defaultCity: string,
  searchParams: Pick<URLSearchParams, 'getAll'> = new URLSearchParams(),
): PublicCityOption | null {
  return resolveTrustedRouteCity(pathname, searchParams, cities, defaultCity)?.city ?? null
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
  const previousSourceUrlRef = useRef<string | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const activeCity = resolveTrustedCity(pathname, cities, defaultCity, searchParams)
  const trustedCities = filterPublicCityOptions(cities)
  const sourceUrl = searchParams.size > 0 ? `${pathname}?${searchParams.toString()}` : pathname
  const pageType = getCityPageType(pathname)

  useEffect(() => {
    const sourceChanged = previousSourceUrlRef.current !== null && previousSourceUrlRef.current !== sourceUrl
    previousSourceUrlRef.current = sourceUrl
    if (!sourceChanged) return
    const closeAfterNavigation = () => setOpen(false)
    closeAfterNavigation()
  }, [sourceUrl])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        triggerRef.current?.focus()
        return
      }
      if (event.key === 'Tab') {
        setOpen(false)
        return
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      const options = Array.from(menuRef.current?.querySelectorAll<HTMLAnchorElement>('a[role="menuitem"]') ?? [])
      if (options.length === 0) return
      const focusedIndex = options.indexOf(document.activeElement as HTMLAnchorElement)
      const currentIndex = focusedIndex >= 0 ? focusedIndex : 0
      const nextIndex = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? options.length - 1
          : event.key === 'ArrowDown'
            ? (currentIndex + 1) % options.length
            : (currentIndex - 1 + options.length) % options.length
      event.preventDefault()
      options[nextIndex]?.focus()
    }
    const onPointerDown = (event: PointerEvent) => {
      if (wrapperRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    menuRef.current?.querySelector<HTMLAnchorElement>('a[role="menuitem"]')?.focus()
  }, [open])

  if (!activeCity || trustedCities.length === 0) return null

  return (
    <div ref={wrapperRef} className="city-switcher">
      <button
        ref={triggerRef}
        type="button"
        className="city-switcher__trigger"
        aria-controls="city-switcher-menu"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => {
          const nextOpen = !open
          if (nextOpen) {
            safeTrackCityEvent(track, 'city_switcher_opened', {
              city: activeCity.slug,
              status: activeCity.serviceStatus,
              page_type: pageType,
            })
          }
          setOpen(nextOpen)
        }}
      >
        <span>{activeCity.name}</span>
        <span className="city-switcher__trigger-label">切换城市</span>
      </button>
      {open ? (
        <div ref={menuRef} id="city-switcher-menu" className="city-switcher__menu" role="menu" aria-label="切换城市">
          {trustedCities.map((city) => {
            const href = switchCityUrl(sourceUrl, city.slug)
            if (!href) return null
            const current = city.slug === activeCity.slug
            return (
              <Link
                key={city.slug}
                href={href}
                role="menuitem"
                tabIndex={-1}
                className="city-switcher__option"
                aria-current={current ? 'page' : undefined}
                onClick={() => {
                  if (!current) {
                    safeTrackCityEvent(track, 'city_switched', {
                      from_city: activeCity.slug,
                      to_city: city.slug,
                      status: city.serviceStatus,
                      page_type: pageType,
                      filters_preserved: citySwitchPreservedFilters(sourceUrl, href),
                    })
                  }
                  setOpen(false)
                }}
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
