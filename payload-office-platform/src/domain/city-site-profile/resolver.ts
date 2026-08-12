import type { PublicCitySiteProfile } from './public-contract'

export type CityContext = Readonly<{
  id: number | string
  slug: string
  name: string
  serviceStatus: 'live' | 'coming-soon'
  profile: PublicCitySiteProfile
}>

export type CityProfileLookup = (slug: string) => Promise<PublicCitySiteProfile | null>

const CITY_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function normalizeCitySlug(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  return CITY_SLUG_PATTERN.test(normalized) ? normalized : null
}

function isCityProfile(value: PublicCitySiteProfile): boolean {
  return (
    normalizeCitySlug(value.citySlug) !== null &&
    typeof value.cityName === 'string' &&
    value.cityName.trim().length > 0 &&
    (value.serviceStatus === 'live' || value.serviceStatus === 'coming-soon')
  )
}

export function createCityContextResolver(
  lookup: CityProfileLookup,
): (slug: unknown) => Promise<CityContext | null> {
  return async (slug: unknown): Promise<CityContext | null> => {
    const normalizedSlug = normalizeCitySlug(slug)
    if (!normalizedSlug) return null

    let profile: PublicCitySiteProfile | null
    try {
      profile = await lookup(normalizedSlug)
    } catch {
      return null
    }
    if (!profile || !isCityProfile(profile) || profile.citySlug !== normalizedSlug) return null

    return {
      id: profile.cityId,
      slug: normalizedSlug,
      name: profile.cityName,
      serviceStatus: profile.serviceStatus,
      profile,
    }
  }
}
