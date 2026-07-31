import type { Building, Location } from '@/payload-types'

type PositivePredicate = Readonly<{ equals: string }> | Readonly<{ exists: false }>

function withPrefix(prefix: string, field: string): string {
  return prefix.length > 0 ? `${prefix}.${field}` : field
}

/**
 * Fail-closed query predicate for a public building and its required locations.
 *
 * Keep this as the single source used by direct building detail, related-building
 * and sitemap queries. Listing queries use the same fields with a `building.`
 * prefix via `getListingPublicBuildingWhere`.
 */
function publicBuildingWhere(prefix: string): Record<string, PositivePredicate> {
  return {
    [withPrefix(prefix, 'status')]: { equals: 'published' },
    [withPrefix(prefix, 'operationalStatus')]: { equals: 'active' },
    [withPrefix(prefix, 'deletedAt')]: { exists: false },
    [withPrefix(prefix, 'city.status')]: { equals: 'active' },
    [withPrefix(prefix, 'district.status')]: { equals: 'active' },
  }
}

export function getPublicBuildingWhere(): Record<string, PositivePredicate> {
  return publicBuildingWhere('')
}

export function getListingPublicBuildingWhere(): Record<string, PositivePredicate> {
  return publicBuildingWhere('building')
}

function isActiveLocation(value: Building['city'] | Building['district']): value is Location {
  return typeof value === 'object' && value !== null && value.status === 'active'
}

/** Read-time guard for depth-populated building documents. */
export function isPublicBuilding(
  building: Building | null | undefined,
): building is Building {
  return Boolean(
    building &&
    building.status === 'published' &&
    building.operationalStatus === 'active' &&
    !building.deletedAt &&
    isActiveLocation(building.city) &&
    isActiveLocation(building.district),
  )
}
