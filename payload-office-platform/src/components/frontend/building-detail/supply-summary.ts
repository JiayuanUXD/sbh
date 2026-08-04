import type {
  BuildingSupplyGroupAvailability,
  BuildingSupplyPriceRange,
} from '@/domain/public-catalog'

type PriceDisplayUnit = BuildingSupplyPriceRange['displayUnit']

export const DISPLAY_UNIT_LABELS: Readonly<Record<PriceDisplayUnit, string>> = {
  'rmb-sqm-day': '元/㎡/天',
  'rmb-month': '元/月',
  'rmb-seat-month': '元/工位/月',
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
