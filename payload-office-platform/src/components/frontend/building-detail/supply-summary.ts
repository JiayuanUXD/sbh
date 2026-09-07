import type {
  BuildingSupplyGroup,
  BuildingSupplyGroupAvailability,
  BuildingSupplyPriceRange,
  PriceViewModel,
} from '@/domain/public-catalog'
import { estimateMonthlyRent } from '@/domain/public-catalog/monthly-estimate'

type PriceDisplayUnit = BuildingSupplyPriceRange['displayUnit']

/*
 * 计价单位 → 中文标签的表**不在本文件**：唯一事实源是
 * `lib/frontend/format.ts` 的 `PRICE_UNIT_LABEL` / `priceUnitLabel()`
 * （12 个取值全集，由 `Record<PriceDisplayUnit, string>` 在编译期保证不漏）。
 * 这里曾有一份逐字节相同的 `DISPLAY_UNIT_LABELS` 副本，本页三个调用点
 * （`HeroSummaryPanel` 起价单位、`BuildingSupplyBrowser` 聚合区单价单位与
 * 排序区单位）已全部改调 `priceUnitLabel()`，副本删除。
 * 判据是「职责是否相同」而不是「API 是否相同」：两处都是同一个
 * `PriceDisplayUnit → 中文` 的映射，没有任何本页专属的口径差异。
 */

/**
 * 信息面板首屏「X 元/… 起」的起价。
 *
 * **单位闸门**：元/㎡/天、元/月、元/工位/月 三者不可通约，跨单位取 min 是本项目
 * 的硬禁区。旧实现直接遍历所有组的所有 `priceRanges` 比 `range.min`——「租赁
 * 300 元/㎡/月 + 联合办公 200 元/工位/月」会输出「200 元/工位/月 起」，把一个
 * 工位价当成整栋楼的起价。价格分桶（`PRICE_BUCKET_UNIT`）与 `priceRanges`
 * （按 `priceKeyOf` 分桶）两处都做对了，这里是本页最后一处漏网的价格聚合。
 *
 * 现在的口径：**先定组、再定单位、最后才取 min**。
 *   1. 组 = `availableGroups` 里第一个有公开报价的组。`availableGroups` 已按
 *      GROUP_ORDER（租赁 → 出售 → 联合办公）排好，而供给区默认打开的也是
 *      `availableGroups[0]`——同一页上的「首屏起价」与「默认组聚合区的单价区间」
 *      因此指向同一批房源，不会互相打架。整组价格面议（priceRanges 为空）时
 *      顺延到下一组，而不是直接退化成「价格面议」把已有的报价藏起来。
 *   2. 单位 = 该组内**房源数最多**的那个计价单位（`count`），并列时按 `key`
 *      字典序取定，保证同一份数据每次渲染都是同一个结果。
 *   3. min = 该单位区间自己的下界（`buildPriceRanges` 已按单位分桶算好）。
 * 返回值带着 `displayUnit`，调用方必须把单位渲染出来——脱离单位的数字在这里
 * 没有意义。
 */
export function findLowestPrice(
  groups: readonly BuildingSupplyGroupAvailability[],
): { min: number; displayUnit: PriceDisplayUnit } | null {
  const primary = groups.find((group) => group.priceRanges.length > 0)
  if (!primary) return null
  let picked: BuildingSupplyPriceRange | null = null
  for (const range of primary.priceRanges) {
    const wins =
      picked == null
      || range.count > picked.count
      || (range.count === picked.count && range.key.localeCompare(picked.key) < 0)
    if (wins) picked = range
  }
  return picked ? { min: picked.min, displayUnit: picked.displayUnit } : null
}

export function aggregateAreaRange(
  groups: readonly BuildingSupplyGroupAvailability[],
): { min: number; max: number } | null {
  let min = Infinity
  let max = -Infinity
  for (const group of groups) {
    if (!group.areaRange) continue
    min = Math.min(min, group.areaRange.min)
    max = Math.max(max, group.areaRange.max)
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null
  return { min, max }
}

export function formatAreaRange(range: { min: number; max: number }): string {
  if (range.min === range.max) return `${range.min} ㎡`
  return `${range.min}–${range.max} ㎡`
}

/**
 * 估算供给密度表「月租 / 总价」列的行总价。
 *
 * 三种计价 basis 对应三种折算方式，**三条都必须先过 period 闸门**：
 *   - basis='total'：整套计价。`period='one-time'` 才是「amount 本身就是总价」
 *     （出售一口价，`rmb-total`）；租赁语境下 `PRICING_PERIODS` 的
 *     day/month/year 与 `PRICING_UNITS` 的 suite 组合同样合法且后台可填，
 *     此时 amount 是**周期租金**不是总价，必须与另两条分支同样折算。
 *     旧实现 `if (basis === 'total') return amount` 跳过了这道检查：整套计价 +
 *     周期「每年」+ 120 万的租赁房源，决策卡主价行正确显示「1200000 元/年」，
 *     正下方摘要行却输出「月租 1,200,000 元/月」——同一张卡自相矛盾，且高的
 *     那个是错的（差 12 倍）；周期「每天」则反向低估 30 倍。
 *   - basis='seat'：按工位计价（联合办公），必须用 seats（工位数）折算——
 *     不能用面积代替。旧版实现曾把调用方唯一持有的 `area` 直接当 seats 传入
 *     （此文件曾经的单测注释「按面积（工位数）折算」就是这处误用留下的痕迹），
 *     随 ListingCardViewModel 补齐 `seats` 字段（OPT-037 Task 7）一并订正；
 *   - basis='sqm'：租赁按面积计价，用 area；day 按 30 天折算月租。出售价格不进入本月租折算函数。
 * 任一必需维度缺失都返回 null（表格显示「—」），不做静默 0 填充。
 */
export function estimateRowTotal(
  price: PriceViewModel | null,
  dims: Readonly<{ area: number | null; seats: number | null }>,
): number | null {
  if (price?.businessType === 'sale' && price.period === 'one-time' && price.basis === 'total') {
    return price.amount
  }
  return estimateMonthlyRent(price, dims)
}

/**
 * 供给行总价 → 可读文本，按业务组决定单位口径（不带单位后缀，单位已在表头）：
 *   - 出售：comp specRows「总价 万元」，amount 单位是元，需 /10000；
 *   - 租赁 / 联合办公：comp「月租 元/月」，amount 本身是元，原样取整。
 * 千分位数字用 zh-CN 分组，和表格其余数值列一致。
 */
export function formatGroupTotal(total: number, group: BuildingSupplyGroup): string {
  const value = group === 'sale' ? total / 10000 : total
  return Math.round(value).toLocaleString('zh-CN')
}
