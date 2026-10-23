/**
 * 回填：把 `CitySiteProfiles.featuredRegions`（旧）搬进商圈扩展的 `featuredOrder`（新）。
 * 纯函数层，迁移脚本只负责取数与落库。
 *
 * 口径：只搬「同城、启用、前台可见的商圈」，按旧顺序从 1 连续编号；行政区放弃
 * （已定稿）。跳过的项带原因，由迁移打日志，供人工复核。
 *
 * 上限 12 在这里**自带一份**而不引 `business-area-extension` 的常量：这个文件被一次性迁移
 * 依赖，迁移的行为必须冻结，不能随运行时常量日后调整而变。
 */

const BACKFILL_MAX_PER_CITY = 12

export type FeaturedRegionRow = Readonly<{
  /** 配置这条精选的 profile 所属城市 */
  profileCityId: number
  locationId: number
  type: string
  status: string
  frontendVisible: boolean
  /** 被选中节点自己的城市 */
  locationCityId: number | null
}>

export type FeaturedBackfillSkipReason =
  | 'not_business_area'
  | 'inactive'
  | 'not_visible'
  | 'cross_city'
  | 'duplicate'
  | 'over_limit'

export type FeaturedBackfillPlan = Readonly<{
  assignments: readonly Readonly<{ locationId: number; featuredOrder: number }>[]
  skipped: readonly Readonly<{ locationId: number; reason: FeaturedBackfillSkipReason }>[]
}>

/** 入参须已按「城市内原顺序」排好（迁移里按 rels 的 order, id 取出） */
export function planFeaturedAreasBackfill(rows: readonly FeaturedRegionRow[]): FeaturedBackfillPlan {
  const assignments: Array<{ locationId: number; featuredOrder: number }> = []
  const skipped: Array<{ locationId: number; reason: FeaturedBackfillSkipReason }> = []
  const countByCity = new Map<number, number>()
  const seen = new Set<number>()

  for (const r of rows) {
    const skip = (reason: FeaturedBackfillSkipReason) => skipped.push({ locationId: r.locationId, reason })
    if (r.type !== 'business_area') {
      skip('not_business_area')
      continue
    }
    if (seen.has(r.locationId)) {
      skip('duplicate')
      continue
    }
    if (r.status !== 'active') {
      skip('inactive')
      continue
    }
    if (!r.frontendVisible) {
      skip('not_visible')
      continue
    }
    if (r.locationCityId !== r.profileCityId) {
      skip('cross_city')
      continue
    }
    const used = countByCity.get(r.profileCityId) ?? 0
    if (used >= BACKFILL_MAX_PER_CITY) {
      skip('over_limit')
      continue
    }
    seen.add(r.locationId)
    countByCity.set(r.profileCityId, used + 1)
    assignments.push({ locationId: r.locationId, featuredOrder: used + 1 })
  }
  return { assignments, skipped }
}
