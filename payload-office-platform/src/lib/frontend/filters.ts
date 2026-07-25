export type ListingFilters = {
  district?: string
  listingType?: string
  rentMin?: number
  rentMax?: number
  q?: string
  page: number
}

function toInt(v: string | null): number | undefined {
  if (v == null || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

export function parseListingFilters(sp: URLSearchParams): ListingFilters {
  const listingType = sp.get('type') || undefined
  const district = sp.get('district') || undefined
  const rentMin = toInt(sp.get('rentMin'))
  const rentMax = toInt(sp.get('rentMax'))
  const q = sp.get('q') || undefined
  let page = toInt(sp.get('page')) ?? 1
  if (!Number.isFinite(page) || page < 1) page = 1
  return { district, listingType, rentMin, rentMax, q, page }
}

/**
 * Build the Payload `where` for the listings query EXCLUDING district.
 * District filtering requires resolving building IDs first (a relationship
 * on `building`); that's done in queries.ts because it needs an extra query.
 *
 * TODO(F1.6): 此处 `status=available` 是过渡性降级，待 M4.7 统一有效供给
 * 服务接入后删除。见 specs/frontend-mvp/tasks.md F1.6 与 design.md §8。
 */
export function buildListingWhere(f: ListingFilters): Record<string, unknown> {
  const where: Record<string, unknown> = {
    status: { equals: 'available' },
  }
  if (f.listingType) where.listingType = { equals: f.listingType }
  if (f.rentMin != null || f.rentMax != null) {
    const rentWhere: Record<string, number> = {}
    if (f.rentMin != null) rentWhere.greater_than_equal = f.rentMin
    if (f.rentMax != null) rentWhere.less_than_equal = f.rentMax
    where.rent = rentWhere
  }
  if (f.q) where.title = { contains: f.q }
  return where
}
