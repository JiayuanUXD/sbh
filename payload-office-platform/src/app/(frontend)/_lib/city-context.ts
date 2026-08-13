import { cache } from 'react'
import { unstable_cache } from 'next/cache'
import { getPayload } from 'payload'

import config from '@/payload.config'
import {
  createCityContextResolver,
  normalizeCitySlug,
  type CityContext,
} from '@/domain/city-site-profile/resolver'
import type { PublicCitySiteProfile } from '@/domain/city-site-profile/public-contract'
import {
  CITY_PROFILES_TAG,
  cityProfileTag,
} from '@/domain/city-site-profile/cache-invalidator'
import {
  isValidCityProfileSeoText,
  normalizeCityDisplayName,
} from '@/domain/city-site-profile/schema'
import { isPublicCitySlug } from '@/lib/frontend/city-routes'

export type PublicCityOption = Readonly<{
  slug: string
  name: string
  serviceStatus: 'live' | 'coming-soon'
  sortOrder: number
}>

type CachedResolver = () => Promise<CityContext | null>

const cityResolvers = new Map<string, CachedResolver>()
const CITY_RESOLVER_CACHE_CAPACITY = 64
const CITY_PROFILE_REVALIDATE_SECONDS = 300

type MappingResult<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false }>

function valid<T>(value: T): MappingResult<T> {
  return { ok: true, value }
}

function invalid(): MappingResult<never> {
  return { ok: false }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isIdentifier(value: unknown): value is number | string {
  return (
    (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) ||
    (typeof value === 'string' && value.trim().length > 0)
  )
}

function relationshipId(value: unknown): number | string | null {
  if (isIdentifier(value)) return value
  if (!isRecord(value)) return null
  return isIdentifier(value.id) ? value.id : null
}

function isRequiredString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function mapOptionalString(value: unknown): MappingResult<string> {
  if (value === null || value === undefined) return valid('')
  return typeof value === 'string' ? valid(value) : invalid()
}

function isValidDimension(value: unknown): value is number | null | undefined {
  return (
    value === null ||
    value === undefined ||
    (typeof value === 'number' && Number.isFinite(value) && value > 0)
  )
}

function mapHeroMedia(value: unknown): MappingResult<PublicCitySiteProfile['hero']['media']> {
  if (value === null || value === undefined) return valid(null)
  if (!isRecord(value) || !isRequiredString(value.url) || typeof value.alt !== 'string') {
    return invalid()
  }
  if (!isValidDimension(value.width) || !isValidDimension(value.height)) {
    return invalid()
  }
  return valid({
    src: value.url,
    ...(typeof value.width === 'number' ? { width: value.width } : {}),
    ...(typeof value.height === 'number' ? { height: value.height } : {}),
    alt: value.alt,
  })
}

function mapFeaturedRegions(
  value: unknown,
  cityId: number | string,
): MappingResult<PublicCitySiteProfile['featuredRegions']> {
  if (value === null || value === undefined) return valid([])
  if (!Array.isArray(value)) return invalid()
  const regions: PublicCitySiteProfile['featuredRegions'][number][] = []
  for (const relation of value) {
    const rawSlug = isRecord(relation) ? relation.slug : null
    const slug = normalizeCitySlug(rawSlug)
    const owningCityId = isRecord(relation) ? relationshipId(relation.city) : null
    if (
      !isRecord(relation) ||
      !isIdentifier(relation.id) ||
      !slug ||
      rawSlug !== slug ||
      (relation.type !== 'district' && relation.type !== 'business_area') ||
      relation.status !== 'active' ||
      relation.frontendVisible !== true ||
      owningCityId === null ||
      String(owningCityId) !== String(cityId) ||
      !isRequiredString(relation.name)
    ) {
      return invalid()
    }
    regions.push({ id: relation.id, slug, name: relation.name, type: relation.type })
  }
  return valid(regions)
}

function mapPublicCityProfile(value: unknown): PublicCitySiteProfile | null {
  if (!isRecord(value) || !isRecord(value.city)) return null
  const city = value.city
  const rawCitySlug = city.slug
  const citySlug = normalizeCitySlug(rawCitySlug)
  const cityName = normalizeCityDisplayName(city.name)
  const eyebrow = mapOptionalString(value.heroEyebrow)
  const heading = mapOptionalString(value.heroHeading)
  const heroBody = mapOptionalString(value.heroBody)
  const introHeading = mapOptionalString(value.introHeading)
  const introBody = mapOptionalString(value.introBody)
  const contactHeading = mapOptionalString(value.contactHeading)
  const contactBody = mapOptionalString(value.contactBody)
  const media = mapHeroMedia(value.heroMedia)
  const featuredRegions = isIdentifier(city.id)
    ? mapFeaturedRegions(value.featuredRegions, city.id)
    : invalid()
  if (
    !isIdentifier(city.id) ||
    !citySlug ||
    rawCitySlug !== citySlug ||
    city.type !== 'city' ||
    city.status !== 'active' ||
    !cityName ||
    (value.serviceStatus !== 'live' && value.serviceStatus !== 'coming-soon') ||
    typeof value.switcherVisible !== 'boolean' ||
    typeof value.sortOrder !== 'number' ||
    !Number.isFinite(value.sortOrder) ||
    value.sortOrder < 0 ||
    !isValidCityProfileSeoText(value.seoTitle, 'title', cityName) ||
    !isValidCityProfileSeoText(value.seoDescription, 'description', cityName) ||
    !eyebrow.ok ||
    !heading.ok ||
    !heroBody.ok ||
    !introHeading.ok ||
    !introBody.ok ||
    !contactHeading.ok ||
    !contactBody.ok ||
    !media.ok ||
    !featuredRegions.ok
  ) {
    return null
  }

  return {
    cityId: city.id,
    citySlug,
    cityName,
    serviceStatus: value.serviceStatus,
    switcherVisible: value.switcherVisible,
    sortOrder: value.sortOrder,
    seoTitle: value.seoTitle,
    seoDescription: value.seoDescription,
    hero: {
      eyebrow: eyebrow.value,
      heading: heading.value,
      body: heroBody.value,
      media: media.value,
    },
    intro: { heading: introHeading.value, body: introBody.value },
    contact: { heading: contactHeading.value, body: contactBody.value },
    featuredRegions: featuredRegions.value,
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

function getCachedResolver(citySlug: string): CachedResolver {
  const existing = cityResolvers.get(citySlug)
  if (existing) {
    cityResolvers.delete(citySlug)
    cityResolvers.set(citySlug, existing)
    return existing
  }

  const resolver = createCityContextResolver(findPublicCityProfile)
  const cachedResolver = unstable_cache(
    async () => resolver(citySlug),
    ['public-city-profile', citySlug],
    {
      revalidate: CITY_PROFILE_REVALIDATE_SECONDS,
      tags: [cityProfileTag(citySlug), CITY_PROFILES_TAG],
    },
  )
  cityResolvers.set(citySlug, cachedResolver)
  if (cityResolvers.size > CITY_RESOLVER_CACHE_CAPACITY) {
    const leastRecentlyUsedSlug = cityResolvers.keys().next().value
    if (leastRecentlyUsedSlug !== undefined) cityResolvers.delete(leastRecentlyUsedSlug)
  }
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
  { revalidate: CITY_PROFILE_REVALIDATE_SECONDS, tags: [CITY_PROFILES_TAG] },
)

export async function listPublicCityOptions(): Promise<readonly PublicCityOption[]> {
  const profiles = await listPublicCityProfiles()
  return profiles
    .filter((profile) => profile.switcherVisible && isPublicCitySlug(profile.citySlug))
    .map((profile) => ({
      slug: profile.citySlug,
      name: profile.cityName,
      serviceStatus: profile.serviceStatus,
      sortOrder: profile.sortOrder,
    }))
    .sort((left, right) => left.sortOrder - right.sortOrder || left.slug.localeCompare(right.slug))
}
