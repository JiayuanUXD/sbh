import type { PriceViewModel } from './contracts'

export type EstimatedNumber = Readonly<{ amount: number; estimated: true }>

export function computeUsableArea(
  area: number | null,
  efficiencyRate: number | null,
): EstimatedNumber | null {
  if (!isNonNegativeFinite(area) || !isNonNegativeFinite(efficiencyRate)) return null
  if (efficiencyRate > 100) return null
  return { amount: roundToOneDecimal(area * efficiencyRate / 100), estimated: true }
}

export function deriveSeatRange(input: Readonly<{
  seatMin: number | null
  seatMax: number | null
  suggestedSeats: number | null
  area: number | null
}>): Readonly<{ min: number; max: number; estimated: boolean }> | null {
  const min = positiveInteger(input.seatMin)
  const max = positiveInteger(input.seatMax)
  if (min != null && max != null && min <= max) {
    return { min, max, estimated: false }
  }

  const suggested = positiveInteger(input.suggestedSeats)
  if (suggested != null) return { min: suggested, max: suggested, estimated: false }

  if (!isNonNegativeFinite(input.area) || input.area <= 0) return null
  const estimated = Math.max(1, Math.round(input.area / 8))
  return { min: estimated, max: estimated, estimated: true }
}

export function convertPrice(input: Readonly<{
  amount: number
  currency: 'CNY'
  period: 'day' | 'month' | 'year' | 'one-time'
  unit: 'sqm' | 'seat' | 'total'
  area: number | null
  seats: number | null
}>): readonly PriceViewModel[] {
  if (!isNonNegativeFinite(input.amount)) return []
  if (input.unit === 'seat') return []
  if (!isNonNegativeFinite(input.area) || input.area <= 0) return []

  if (input.unit === 'total' && input.period === 'month') {
    const amount = roundToOneDecimal(input.amount / input.area / 30)
    if (!isNonNegativeFinite(amount)) return []
    return [price(amount, 'lease', 'day', 'sqm', 'rmb-sqm-day', '元/㎡/天')]
  }
  if (input.unit === 'sqm' && input.period === 'day') {
    const amount = roundToOneDecimal(input.amount * input.area * 30)
    if (!isNonNegativeFinite(amount)) return []
    return [price(amount, 'lease', 'month', 'total', 'rmb-month', '元/月')]
  }
  return []
}

function price(
  amount: number,
  businessType: PriceViewModel['businessType'],
  period: PriceViewModel['period'],
  basis: PriceViewModel['basis'],
  displayUnit: PriceViewModel['displayUnit'],
  label: string,
): PriceViewModel {
  return { amount, currency: 'CNY', businessType, period, basis, displayUnit, text: `${amount} ${label}` }
}

function isNonNegativeFinite(value: number | null): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function positiveInteger(value: number | null): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

function roundToOneDecimal(value: number): number {
  return Math.round((value + Number.EPSILON) * 10) / 10
}
