import { getPayload, type Where } from 'payload'
import config from '@/payload.config'
import { buildListingWhere, type ListingFilters } from '@/lib/frontend/filters'

const PAGE_SIZE = 12

export async function getListings(filters: ListingFilters) {
  const payload = await getPayload({ config })

  // Resolve district → building IDs, then filter listings by building.
  let buildingIds: (string | number)[] | undefined
  if (filters.district) {
    const buildings = await payload.find({
      collection: 'buildings',
      where: { 'district.slug': { equals: filters.district } },
      limit: 200,
    })
    buildingIds = buildings.docs.map((d: any) => d.id)
    if (buildingIds.length === 0) {
      // No buildings in that district → return empty without querying listings.
      return { docs: [], totalDocs: 0, totalPages: 0, page: filters.page }
    }
  }

  const where: Record<string, unknown> = buildListingWhere(filters)
  if (buildingIds) where.building = { in: buildingIds }

  const result = await payload.find({
    collection: 'listings',
    where: where as Where,
    page: filters.page,
    limit: PAGE_SIZE,
    sort: '-isFeatured -updatedAt',
    depth: 2, // populate building + its district + coverImage
  })
  return {
    docs: result.docs,
    totalDocs: result.totalDocs,
    totalPages: result.totalPages,
    page: filters.page,
  }
}

export async function getListingBySlug(slug: string) {
  const payload = await getPayload({ config })
  const result = await payload.find({
    collection: 'listings',
    where: { slug: { equals: slug } },
    limit: 1,
    depth: 3, // building + gallery + amenities
  })
  return result.docs[0] ?? null
}

export async function getBuildingBySlug(slug: string) {
  const payload = await getPayload({ config })
  const result = await payload.find({
    collection: 'buildings',
    where: { slug: { equals: slug } },
    limit: 1,
    depth: 2, // district, coverImage, gallery, amenities
  })
  return result.docs[0] ?? null
}

export async function getFeaturedListings(limit = 6) {
  const payload = await getPayload({ config })
  const result = await payload.find({
    collection: 'listings',
    where: { status: { equals: 'available' }, isFeatured: { equals: true } },
    limit,
    depth: 2,
    sort: '-updatedAt',
  })
  return result.docs
}

export async function getDistricts() {
  const payload = await getPayload({ config })
  const result = await payload.find({
    collection: 'locations',
    where: { type: { equals: 'district' } },
    limit: 100,
    sort: 'sortOrder',
  })
  return result.docs
}

export async function getListingsByBuilding(buildingId: string | number, limit = 6) {
  const payload = await getPayload({ config })
  const result = await payload.find({
    collection: 'listings',
    where: { building: { equals: buildingId }, status: { equals: 'available' } },
    limit,
    depth: 1,
    sort: '-updatedAt',
  })
  return result.docs
}
