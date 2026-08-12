import { cache } from 'react'
import { unstable_cache } from 'next/cache'
import { getPayload } from 'payload'

import config from '@/payload.config'
import type { CitySiteProfile, Location, Media } from '@/payload-types'
import {
  createCityContextResolver,
  normalizeCitySlug,
  type CityContext,
} from '@/domain/city-site-profile/resolver'
import type { PublicCitySiteProfile } from '@/domain/city-site-profile/public-contract'

export type PublicCityOption = Readonly<{
  slug: string
  name: string
  serviceStatus: 'live' | 'coming-soon'
  sortOrder: number
}>

type CachedResolver = () => Promise<CityContext | null>

const cityResolvers = new Map<string, CachedResolver>()

function asLocation(value: number | Location): Location | null {
  return typeof value === 'object' ? value : null
}

function mapHeroMedia(value: CitySiteProfile['heroMedia']): PublicCitySiteProfile['hero']['media'] {
  if (value === null || value === undefined || typeof value !== 'object') return null
  const media: Media = value
  if (typeof media.url !== 'string' || media.url.length === 0 || typeof media.alt !== 'string') {
    return null
  }
  return {
    src: media.url,
    ...(typeof media.width === 'number' ? { width: media.width } : {}),
    ...(typeof media.height === 'number' ? { height: media.height } : {}),
    alt: media.alt,
  }
}

function mapFeaturedRegions(value: CitySiteProfile['featuredRegions']): PublicCitySiteProfile['featuredRegions'] | null {
  if (!value) return []
  const regions: PublicCitySiteProfile['featuredRegions'][number][] = []
  for (const relation of value) {
    const region = asLocation(relation)
    const slug = region ? normalizeCitySlug(region.slug) : null
    if (
      !region ||
      !slug ||
      (region.type !== 'district' && region.type !== 'business_area') ||
      typeof region.name !== 'string' ||
      region.name.length === 0
    ) {
      return null
    }
    regions.push({ id: region.id, slug, name: region.name, type: region.type })
  }
  return regions
}

function mapPublicCityProfile(value: CitySiteProfile): PublicCitySiteProfile | null {
  const city = asLocation(value.city)
  const citySlug = city ? normalizeCitySlug(city.slug) : null
  const featuredRegions = mapFeaturedRegions(value.featuredRegions)
  if (
    !city ||
    !citySlug ||
    city.type !== 'city' ||
    typeof city.name !== 'string' ||
    city.name.length === 0 ||
    (value.serviceStatus !== 'live' && value.serviceStatus !== 'coming-soon') ||
    featuredRegions === null
  ) {
    return null
  }

  return {
    cityId: city.id,
    citySlug,
    cityName: city.name,
    serviceStatus: value.serviceStatus,
    switcherVisible: value.switcherVisible === true,
    sortOrder: value.sortOrder,
    seoTitle: value.seoTitle,
    seoDescription: value.seoDescription,
    hero: {
      eyebrow: value.heroEyebrow ?? '',
      heading: value.heroHeading ?? '',
      body: value.heroBody ?? '',
      media: mapHeroMedia(value.heroMedia),
    },
    intro: { heading: value.introHeading ?? '', body: value.introBody ?? '' },
    contact: { heading: value.contactHeading ?? '', body: value.contactBody ?? '' },
    featuredRegions,
  }
}

async function findPublicCityProfile(slug: string): Promise<PublicCitySiteProfile | null> {
  const payload = await getPayload({ config })
  const result = await payload.find({
    collection: 'city-site-profiles',
    depth: 2,
    limit: 1,
    where: { 'city.slug': { equals: slug } },
  })
  const profile = result.docs[0]
  return profile ? mapPublicCityProfile(profile) : null
}

async function findPublicCityProfiles(): Promise<readonly PublicCitySiteProfile[]> {
  const payload = await getPayload({ config })
  const result = await payload.find({
    collection: 'city-site-profiles',
    depth: 2,
    limit: 500,
    sort: ['sortOrder', 'id'],
  })
  return result.docs
    .map(mapPublicCityProfile)
    .filter((profile): profile is PublicCitySiteProfile => profile !== null)
}

function cityProfileTag(citySlug: string): string {
  return `public:city-profile:${citySlug}`
}

function getCachedResolver(citySlug: string): CachedResolver {
  const existing = cityResolvers.get(citySlug)
  if (existing) return existing

  const resolver = createCityContextResolver(findPublicCityProfile)
  const cachedResolver = unstable_cache(
    async () => resolver(citySlug),
    ['public-city-profile', citySlug],
    { tags: [cityProfileTag(citySlug)] },
  )
  cityResolvers.set(citySlug, cachedResolver)
  return cachedResolver
}

export const resolveCityContext = cache(async (slug: unknown): Promise<CityContext | null> => {
  const normalizedSlug = normalizeCitySlug(slug)
  if (!normalizedSlug) return null
  return getCachedResolver(normalizedSlug)()
})

export const listPublicCityProfiles = unstable_cache(
  async (): Promise<readonly PublicCitySiteProfile[]> => findPublicCityProfiles(),
  ['public-city-profiles'],
  { tags: ['public:city-profiles'] },
)

export async function listPublicCityOptions(): Promise<readonly PublicCityOption[]> {
  const profiles = await listPublicCityProfiles()
  return profiles
    .filter((profile) => profile.switcherVisible)
    .map((profile) => ({
      slug: profile.citySlug,
      name: profile.cityName,
      serviceStatus: profile.serviceStatus,
      sortOrder: profile.sortOrder,
    }))
    .sort((left, right) => left.sortOrder - right.sortOrder || left.slug.localeCompare(right.slug))
}
