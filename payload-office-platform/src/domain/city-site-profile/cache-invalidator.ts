import { SITEMAP_TAG, facetsTag, homeTag } from '@/domain/public-catalog/cache-tags'

import { normalizeCitySlug } from './resolver'

type Identifier = number | string

export type CityCacheInvalidationRecord = Readonly<{
  id: Identifier
  city?: unknown
  citySlug?: unknown
  slug?: unknown
  type?: unknown
}>

export const CITY_PROFILES_TAG = 'public:city-profiles' as const

export function cityProfileTag(citySlug: string): string {
  return `public:city-profile:${citySlug}`
}

function slugFromRelationship(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || !('slug' in value)) return null
  return normalizeCitySlug(value.slug)
}

function citySlugFromRecord(record: CityCacheInvalidationRecord): string | null {
  const explicitSlug = normalizeCitySlug(record.citySlug)
  if (explicitSlug) return explicitSlug

  if (record.type === 'city') return normalizeCitySlug(record.slug)

  return slugFromRelationship(record.city)
}

function cityProfileCategoryTags(): readonly string[] {
  return [CITY_PROFILES_TAG, homeTag('all'), facetsTag('all'), SITEMAP_TAG]
}

export function tagsForProfileChange(record: CityCacheInvalidationRecord): readonly string[] {
  const citySlug = citySlugFromRecord(record)
  if (!citySlug) return cityProfileCategoryTags()

  return [
    cityProfileTag(citySlug),
    CITY_PROFILES_TAG,
    homeTag(citySlug),
    SITEMAP_TAG,
  ]
}

export function tagsForLocationVisibilityChange(
  record: CityCacheInvalidationRecord,
): readonly string[] {
  const citySlug = citySlugFromRecord(record)
  if (!citySlug) return cityProfileCategoryTags()

  return [
    cityProfileTag(citySlug),
    CITY_PROFILES_TAG,
    homeTag(citySlug),
    facetsTag(citySlug),
    SITEMAP_TAG,
  ]
}
