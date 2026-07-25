import { getPayload, type Where } from 'payload'
import config from '@/payload.config'
import { buildListingWhere, type ListingFilters } from '@/lib/frontend/filters'
import {
  buildingOperationalWhere,
  listingBuildingOperationalWhere,
} from '@/domain/supply/building'
import {
  mapDistrict,
  mapListingCard,
  mapListingDetail,
  mapBuildingDetail,
  type BuildingDetailViewModel,
  type DistrictViewModel,
  type ListingCardViewModel,
  type ListingDetailViewModel,
} from '@/domain/public-catalog'

const PAGE_SIZE = 12

export type ListingsResult = {
  docs: ListingCardViewModel[]
  totalDocs: number
  totalPages: number
  page: number
}

export async function getListings(filters: ListingFilters): Promise<ListingsResult> {
  const payload = await getPayload({ config })

  // Resolve district → building IDs, then filter listings by building.
  let buildingIds: (string | number)[] | undefined
  if (filters.district) {
    const buildings = await payload.find({
      collection: 'buildings',
      where: { 'district.slug': { equals: filters.district } },
      limit: 200,
    })
    buildingIds = buildings.docs.map((d) => d.id)
    if (buildingIds.length === 0) {
      // No buildings in that district → return empty without querying listings.
      return { docs: [], totalDocs: 0, totalPages: 0, page: filters.page }
    }
  }

  const where: Record<string, unknown> = {
    ...buildListingWhere(filters),
    // 停用楼盘从有效供给中剔除（M3.5，不改写 Listing 状态）
    ...listingBuildingOperationalWhere(),
  }
  if (buildingIds) where.building = { in: buildingIds }

  const result = await payload.find({
    collection: 'listings',
    where: where as Where,
    page: filters.page,
    limit: PAGE_SIZE,
    sort: '-isFeatured -updatedAt',
    depth: 2, // populate building + its district + coverImage
  })

  const docs: ListingCardViewModel[] = []
  for (const raw of result.docs) {
    const card = mapListingCard(raw)
    if (card) docs.push(card)
  }

  return {
    docs,
    totalDocs: result.totalDocs,
    totalPages: result.totalPages,
    page: filters.page,
  }
}

export async function getListingBySlug(slug: string): Promise<ListingDetailViewModel | null> {
  const payload = await getPayload({ config })
  const result = await payload.find({
    collection: 'listings',
    where: { slug: { equals: slug } },
    limit: 1,
    depth: 3, // building + gallery + amenities
  })
  return mapListingDetail(result.docs[0])
}

export async function getBuildingBySlug(slug: string): Promise<BuildingDetailViewModel | null> {
  const payload = await getPayload({ config })
  const result = await payload.find({
    collection: 'buildings',
    // 停用楼盘前台不可见（M3.5）
    where: { slug: { equals: slug }, ...buildingOperationalWhere() },
    limit: 1,
    depth: 2, // district, coverImage, gallery, amenities
  })
  return mapBuildingDetail(result.docs[0])
}

export async function getFeaturedListings(limit = 6): Promise<ListingCardViewModel[]> {
  const payload = await getPayload({ config })
  const result = await payload.find({
    collection: 'listings',
    where: {
      status: { equals: 'available' },
      isFeatured: { equals: true },
      // 停用楼盘的房源不进推荐（M3.5）
      ...listingBuildingOperationalWhere(),
    },
    limit,
    depth: 2,
    sort: '-updatedAt',
  })
  const docs: ListingCardViewModel[] = []
  for (const raw of result.docs) {
    const card = mapListingCard(raw)
    if (card) docs.push(card)
  }
  return docs
}

export async function getDistricts(): Promise<DistrictViewModel[]> {
  const payload = await getPayload({ config })
  const result = await payload.find({
    collection: 'locations',
    where: { type: { equals: 'district' } },
    limit: 100,
    sort: 'sortOrder',
  })
  const docs: DistrictViewModel[] = []
  for (const raw of result.docs) {
    const district = mapDistrict(raw)
    if (district) docs.push(district)
  }
  return docs
}

export async function getListingsByBuilding(
  buildingId: string | number,
  limit = 6,
): Promise<ListingCardViewModel[]> {
  const payload = await getPayload({ config })
  const result = await payload.find({
    collection: 'listings',
    where: {
      building: { equals: buildingId },
      status: { equals: 'available' },
      // 停用楼盘的关联房源不再对外展示（M3.5）
      ...listingBuildingOperationalWhere(),
    },
    limit,
    depth: 1,
    sort: '-updatedAt',
  })
  const docs: ListingCardViewModel[] = []
  for (const raw of result.docs) {
    const card = mapListingCard(raw)
    if (card) docs.push(card)
  }
  return docs
}
