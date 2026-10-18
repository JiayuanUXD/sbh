import { LEGACY_BUILDING_GRADES } from '@/domain/supply/building-grade'
import type {
  MiniBuildingDetailData, MiniBuildingGrade, MiniBuildingsData, MiniHomeData, MiniListingDetailData,
} from './contracts'
import type { MiniMeData } from './user-assets'

/** 明确 URL 能力协商，让旧客户端与新客户端在 HTTP/CDN 层天然使用不同地址。 */
export const MINI_QUALITY_GRADE_SCHEMA = 'quality-v1'

function responseGrade(grade: MiniBuildingGrade | null, url: URL): MiniBuildingGrade | null {
  if (url.searchParams.get('gradeSchema') === MINI_QUALITY_GRADE_SCHEMA) return grade
  return grade === 'super-grade-a' || grade === 'grade-a' ? grade : null
}

function responseCard<T extends { readonly grade: MiniBuildingGrade | null }>(card: T, url: URL): Omit<T, 'grade'> & { grade: MiniBuildingGrade | null } {
  const { grade, ...rest } = card
  return { ...rest, grade: responseGrade(grade, url) }
}

/** 所有适配均在共享 canonical 缓存外复制，不能改写缓存对象。 */
export function miniHomeGradeResponse(data: MiniHomeData, url: URL): MiniHomeData {
  return { ...data, featuredBuildings: data.featuredBuildings.map(card => responseCard(card, url)) }
}
export function miniBuildingsGradeResponse(data: MiniBuildingsData, url: URL): MiniBuildingsData {
  return { ...data, items: data.items.map(card => responseCard(card, url)), inactiveItems: data.inactiveItems.map(card => responseCard(card, url)) }
}
export function miniBuildingDetailGradeResponse(data: MiniBuildingDetailData, url: URL): MiniBuildingDetailData {
  return { ...responseCard(data, url), comparableBuildings: data.comparableBuildings.map(card => responseCard(card, url)) }
}
export function miniListingDetailGradeResponse(data: MiniListingDetailData, url: URL): MiniListingDetailData {
  return { ...data, buildingInfo: data.buildingInfo ? responseCard(data.buildingInfo, url) : null }
}
export function miniMeGradeResponse(data: MiniMeData, url: URL): MiniMeData {
  return { ...data, favorites: { ...data.favorites, buildings: data.favorites.buildings.map(card => responseCard(card, url)) } }
}

/** 旧客户端保留的业态筛选按新口径查未评级；未知筛选仍由规范解析器拒绝。 */
export function miniBuildingGradeSearchParams(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params)
  const grades = next.getAll('grade')
  next.delete('grade')
  for (const grade of grades) {
    next.append('grade', (LEGACY_BUILDING_GRADES as readonly string[]).includes(grade) ? 'ungraded' : grade)
  }
  return next
}
