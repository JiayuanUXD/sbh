export const CITY_SERVICE_STATUSES = ['live', 'coming-soon'] as const

export type CityServiceStatus = (typeof CITY_SERVICE_STATUSES)[number]

export type CityProfileSeoField = 'description' | 'title'

const CITY_PROFILE_SEO_LENGTHS = {
  description: { minimum: 70, maximum: 160 },
  title: { minimum: 1, maximum: 60 },
} as const

export function isCityServiceStatus(value: unknown): value is CityServiceStatus {
  return value === 'live' || value === 'coming-soon'
}

/**
 * Public Chinese city copy uses the short display name. A single terminal 市 is
 * removed deterministically; other names, including 上海, remain unchanged.
 */
export function normalizeCityDisplayName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (normalized.length === 0) return null
  if (!normalized.endsWith('市')) return normalized
  const withoutCitySuffix = normalized.slice(0, -1).trim()
  return withoutCitySuffix.length > 0 ? withoutCitySuffix : null
}

export function hasValidCityProfileSeoLength(
  value: unknown,
  field: CityProfileSeoField,
): value is string {
  if (typeof value !== 'string') return false
  const limits = CITY_PROFILE_SEO_LENGTHS[field]
  return value.length >= limits.minimum && value.length <= limits.maximum
}

export function isValidCityProfileSeoText(
  value: unknown,
  field: CityProfileSeoField,
  cityDisplayName: string,
): value is string {
  return hasValidCityProfileSeoLength(value, field) && value.includes(cityDisplayName)
}
