import { resolveCityContext } from '@/app/(frontend)/_lib/city-context'
import type {
  MiniBuildingDetailResolution,
  MiniBuildingsData,
  MiniDetailResolution,
  MiniHomeData,
  MiniListingsData,
  MiniSnapshot,
} from '@/domain/mini-program/contracts'
import {
  mapMiniBuildingDetail,
  mapMiniBuildings,
  mapMiniHome,
  mapMiniListingDetail,
  mapMiniListings,
} from '@/domain/mini-program/mappers'
import { parseBuildingSearchInput, parseSearchInput } from '@/domain/public-catalog'
import { getSiteConfig } from '@/lib/frontend/site-config'
import {
  getCachedMiniBuildingDetail,
  getCachedMiniBuildings,
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
  const siteConfig = getSiteConfig()
  return {
    asOf: snapshot.asOf,
    data: mapMiniHome(
      snapshot.data.home,
      snapshot.data.facets,
      siteConfig.siteOrigin,
      siteConfig.privacyPolicyVersion,
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

export async function getMiniBuildings(
  url: URL,
): Promise<MiniSnapshot<MiniBuildingsData> | null> {
  const city = url.searchParams.get('city') ?? ''
  const trustedCity = await liveCity(city)
  if (!trustedCity) return null

  const input = parseBuildingSearchInput(url.searchParams)
  const snapshot = await getCachedMiniBuildings(trustedCity, input)
  const siteConfig = getSiteConfig()
  return {
    asOf: snapshot.asOf,
    data: mapMiniBuildings(
      snapshot.data.result,
      snapshot.data.input.pageSize,
      siteConfig.siteOrigin,
      siteConfig.privacyPolicyVersion,
    ),
  }
}

export async function getMiniBuildingDetail(
  city: string,
  slug: string,
): Promise<MiniBuildingDetailResolution> {
  const trustedCity = await liveCity(city)
  if (!trustedCity) return { status: 'city_not_found' }
  if (!SAFE_SLUG_PATTERN.test(slug)) return { status: 'building_not_found' }

  const snapshot = await getCachedMiniBuildingDetail(trustedCity, slug)
  if (!snapshot.data) return { status: 'building_not_found' }
  const building = snapshot.data.detail.building
  if (!building) return { status: 'building_not_found' }
  const siteConfig = getSiteConfig()

  return {
    status: 'ok',
    snapshot: {
      asOf: snapshot.asOf,
      data: mapMiniBuildingDetail(
        building,
        snapshot.data.detail.supply,
        snapshot.data.comparable,
        siteConfig.siteOrigin,
        siteConfig.privacyPolicyVersion,
      ),
    },
  }
}
