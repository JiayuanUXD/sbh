import { resolveCityContext } from '@/app/(frontend)/_lib/city-context'
import type {
  MiniDetailResolution,
  MiniHomeData,
  MiniListingsData,
  MiniSnapshot,
} from '@/domain/mini-program/contracts'
import {
  mapMiniHome,
  mapMiniListingDetail,
  mapMiniListings,
} from '@/domain/mini-program/mappers'
import { parseSearchInput } from '@/domain/public-catalog'
import { getSiteConfig } from '@/lib/frontend/site-config'
import {
  getCachedMiniHome,
  getCachedMiniListingDetail,
  getCachedMiniListings,
} from './cached-queries'

const SAFE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

async function liveCity(value: string): Promise<string | null> {
  if (!SAFE_SLUG_PATTERN.test(value)) return null
  const city = await resolveCityContext(value)
  return city?.serviceStatus === 'live' && city.slug === value ? city.slug : null
}

export async function getMiniHome(
  city: string,
): Promise<MiniSnapshot<MiniHomeData> | null> {
  const trustedCity = await liveCity(city)
  if (!trustedCity) return null

  const snapshot = await getCachedMiniHome(trustedCity)
  return {
    asOf: snapshot.asOf,
    data: mapMiniHome(
      snapshot.data.home,
      snapshot.data.facets,
      getSiteConfig().siteOrigin,
    ),
  }
}

export async function getMiniListings(
  url: URL,
): Promise<MiniSnapshot<MiniListingsData> | null> {
  const city = url.searchParams.get('city') ?? ''
  const trustedCity = await liveCity(city)
  if (!trustedCity) return null

  const input = parseSearchInput(url.searchParams)
  const snapshot = await getCachedMiniListings(trustedCity, input)
  return {
    asOf: snapshot.asOf,
    data: mapMiniListings(
      snapshot.data.result,
      snapshot.data.facets,
      input.priceUnit ?? null,
      getSiteConfig().siteOrigin,
    ),
  }
}

export async function getMiniListingDetail(
  city: string,
  slug: string,
): Promise<MiniDetailResolution> {
  const trustedCity = await liveCity(city)
  if (!trustedCity) return { status: 'city-not-found' }
  if (!SAFE_SLUG_PATTERN.test(slug)) return { status: 'listing-not-found' }

  const snapshot = await getCachedMiniListingDetail(trustedCity, slug)
  if (!snapshot.data) return { status: 'listing-not-found' }

  const siteConfig = getSiteConfig()

  return {
    status: 'ok',
    snapshot: {
      asOf: snapshot.asOf,
      data: mapMiniListingDetail(
        snapshot.data.detail,
        snapshot.data.related,
        siteConfig.siteOrigin,
        siteConfig.privacyPolicyVersion,
      ),
    },
  }
}
