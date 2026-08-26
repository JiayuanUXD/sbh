import type { PriceViewModel } from './contracts'

function roundCny(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function estimateMonthlyRent(
  price: PriceViewModel | null,
  dimensions: Readonly<{ area: number | null; seats: number | null }>,
): number | null {
  if (!price || price.businessType !== 'lease') return null
  const multiplier = price.basis === 'sqm'
    ? dimensions.area
    : price.basis === 'seat'
      ? dimensions.seats
      : 1
  if (multiplier == null || !Number.isFinite(multiplier) || multiplier < 0) return null
  if (price.period === 'month') return roundCny(price.amount * multiplier)
  if (price.period === 'day') return roundCny(price.amount * multiplier * 30)
  return null
}
