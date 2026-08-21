import type {
  BuildingSupplyGroup,
  BuildingSupplyGroupAvailability,
  BuildingSupplyPriceRange,
  PriceViewModel,
} from '@/domain/public-catalog'

type PriceDisplayUnit = BuildingSupplyPriceRange['displayUnit']

export const DISPLAY_UNIT_LABELS: Readonly<Record<PriceDisplayUnit, string>> = {
  // 按面积
  'rmb-sqm-day': '元/㎡/天',
  'rmb-sqm-month': '元/㎡/月',
  'rmb-sqm-year': '元/㎡/年',
  'rmb-sqm-total': '元/㎡',
  // 按工位
  'rmb-seat-day': '元/工位/天',
  'rmb-seat-month': '元/工位/月',
  'rmb-seat-year': '元/工位/年',
  'rmb-seat-total': '元/工位',
  // 按整体
  'rmb-day': '元/天',
  'rmb-month': '元/月',
  'rmb-year': '元/年',
  'rmb-total': '元',
}

export function findLowestPrice(
  groups: readonly BuildingSupplyGroupAvailability[],
): { min: number; displayUnit: PriceDisplayUnit } | null {
  let result: { min: number; displayUnit: PriceDisplayUnit } | null = null
  for (const group of groups) {
    for (const range of group.priceRanges) {
      if (!result || range.min < result.min) {
        result = { min: range.min, displayUnit: range.displayUnit }
      }
    }
  }
  return result
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
 * 三种计价 basis 对应三种折算方式：
 *   - basis='total'：amount 本身就是总价（出售一口价 / 一次性计价），原样返回；
 *   - basis='seat'：按工位计价（联合办公），必须用 seats（工位数）折算——
 *     不能用面积代替。旧版实现曾把调用方唯一持有的 `area` 直接当 seats 传入
 *     （此文件曾经的单测注释「按面积（工位数）折算」就是这处误用留下的痕迹），
 *     随 ListingCardViewModel 补齐 `seats` 字段（OPT-037 Task 7）一并订正；
 *   - basis='sqm'：按面积计价（租赁 / 出售单价），用 area；day 按 30 天折算月租。
 * 任一必需维度缺失都返回 null（表格显示「—」），不做静默 0 填充。
 */
export function estimateRowTotal(
  price: PriceViewModel | null,
  dims: Readonly<{ area: number | null; seats: number | null }>,
): number | null {
  if (!price) return null
  const { amount, basis, period } = price
  if (basis === 'total') return amount
  if (basis === 'seat') {
    if (dims.seats == null) return null
    if (period === 'day') return amount * dims.seats * 30
    if (period === 'month') return amount * dims.seats
    return null
  }
  if (dims.area == null) return null
  if (period === 'day') return amount * dims.area * 30
  if (period === 'month') return amount * dims.area
  return null
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
