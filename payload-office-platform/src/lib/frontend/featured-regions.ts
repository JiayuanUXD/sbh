/**
 * OPT-053：按运营配置的「精选区域」重排首页的商圈卡与首屏 chips。
 *
 * ## 为什么需要它
 *
 * 首页热门商圈此前是**间接排序**的：卡片按 `recommendedOrder` 排，而那是
 * `Buildings` 上的字段——商圈按其下楼盘聚合排序（见 `facade.ts` 的商圈卡注释）。
 * 运营想这个月主推陆家嘴，只能去挨个调楼盘的排序值。首屏 chips 更直接：
 * `districts.slice(0, 4)`，自动取前四，完全不可干预。
 *
 * 而 `CitySiteProfiles.featuredRegions`（关联 locations）**字段早就存在**，
 * 只被 `/city-partner` 与未开城页消费，首页从没接过。本模块就是那根线。
 *
 * ## 为什么是重排而不是过滤
 *
 * 过滤会让「没被选中的商圈」从首页消失——那是运营配了三个精选区域就把其余
 * 全部藏起来，属于**悄悄减少库存曝光**，与本仓库在 `ExcludedUnitsBar` 上
 * 坚持的诚实口径相反。重排只改顺序：选中的置顶，其余保持原有相对次序。
 *
 * ## 空配置 = 完全不改变现状
 *
 * 七城 profile 目前全空（见 `ComingSoonCityView` 的注释）。空数组必须原样返回，
 * 否则这一项上线当天就会改变所有城市的首页排序，而没人配置过任何东西。
 */

/** 能按 slug 排序的最小形状。商圈卡与 chips 都满足。 */
type HasSlug = Readonly<{ slug: string }>

/**
 * 把 `featured` 里出现过的项按其给定顺序提到前面，其余保持原相对次序。
 *
 * @param items 待排序项（商圈卡 / 区域 chips）
 * @param featured 运营配置的精选区域，顺序即优先级
 */
export function orderByFeaturedRegions<T extends HasSlug>(
  items: readonly T[],
  featured: readonly HasSlug[],
): readonly T[] {
  if (featured.length === 0 || items.length === 0) return items

  // slug → 运营给定的优先级。重复 slug 取首次出现的位置。
  const priority = new Map<string, number>()
  featured.forEach((region, index) => {
    if (!priority.has(region.slug)) priority.set(region.slug, index)
  })

  // 命中的按运营顺序，未命中的按原顺序缀在后面。
  // 不用 Array.sort：它对「未命中」之间的相对次序不做保证（V8 的 sort 虽已稳定，
  // 但这里的意图是「两段拼接」，写成拼接比依赖排序稳定性更难被后来者改坏）。
  const picked: Array<{ order: number; item: T }> = []
  const rest: T[] = []
  for (const item of items) {
    const order = priority.get(item.slug)
    if (order === undefined) rest.push(item)
    else picked.push({ order, item })
  }
  picked.sort((a, b) => a.order - b.order)
  return [...picked.map((p) => p.item), ...rest]
}
