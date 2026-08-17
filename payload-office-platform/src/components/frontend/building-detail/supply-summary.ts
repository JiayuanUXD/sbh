import type {
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
 * 估算月租金总额（58 式表格「总价」列）。
 * 仅对可按面积折算的计价方式给出估算；其余返回 null（显示「—」）。
 */
export function estimateMonthlyTotal(price: PriceViewModel | null, area: number | null): number | null {
  if (!price || area == null) return null
  const { amount, basis, period } = price
  if (basis === 'total') return amount
  if (basis === 'seat') return amount * area
  if (period === 'day') return amount * area * 30
  if (period === 'month') return amount * area
  return null
}

/** 月租金总额 → 可读文本（万元/月，小值用元/月）。 */
export function formatMonthlyTotal(total: number): string {
  if (total >= 10000) return `${(total / 10000).toFixed(1)}万/月`
  return `${Math.round(total)}元/月`
}
