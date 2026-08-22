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

/** 判定用到的城市/行政区最小形态：只要求 status，`Location` 与扁平化投影都结构兼容。 */
type LocationStatusLike = { status: Location['status'] }

function isActiveLocation(
  value: LocationStatusLike | number | null | undefined,
): value is LocationStatusLike {
  return typeof value === 'object' && value !== null && value.status === 'active'
}

/**
 * 结构最小的 §7 判定输入：只要求判定用到的 5 个字段，不要求完整 `Building` 形状——
 * `city` / `district` 只要求 `{ status }`，不要求完整 `Location`。
 *
 * 最终评审 Critical 2：批量导入的楼盘候选（`resolve-refs.ts` 的 `BuildingCandidate`）
 * 是扁平化投影，装不下完整 `Building` 类型，但判定逻辑必须是这**同一份**，不能在
 * 导入层另写一份结构不同、容易漂移的 §7 复制品。把判定核心抽成这个窄类型版本，
 * `isPublicBuilding` 改为薄包装，两处调用的是完全相同的条件——不是重写，是把已有
 * 判定按结构收窄成可在别处复用的形态。窄类型让调用方能传扁平化投影而不需要
 * `as` 断言凑出一个假的完整 `Location`。
 */
export type PublicBuildingLike = {
  // 可选（?:）而非必填——`Building` 上这几个字段本身就是可选的（`status?:` 等），
  // 必填会导致 `Building` 结构上不可赋值给这个类型（TS2345：optional vs required
  // key），那样 isPublicBuilding 就传不进去了。
  status?: Building['status']
  operationalStatus?: Building['operationalStatus']
  deletedAt?: Building['deletedAt']
  city?: LocationStatusLike | number | null
  district?: LocationStatusLike | number | null
}

export function isPublicBuildingLike(building: PublicBuildingLike | null | undefined): boolean {
  return Boolean(
    building &&
    building.status === 'published' &&
    building.operationalStatus === 'active' &&
    !building.deletedAt &&
    isActiveLocation(building.city) &&
    isActiveLocation(building.district),
  )
}

/** Read-time guard for depth-populated building documents. */
export function isPublicBuilding(
  building: Building | null | undefined,
): building is Building {
  return isPublicBuildingLike(building)
}
