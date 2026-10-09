import { describe, expect, it } from 'vitest'
import { estimateMonthlyRent } from '@/domain/public-catalog'

describe('estimateMonthlyRent', () => {
  it('uses the existing 30-day business convention for sqm/day rent', () => {
    expect(estimateMonthlyRent({
      amount: 8.5, currency: 'CNY', businessType: 'lease', period: 'day', basis: 'sqm',
      displayUnit: 'rmb-sqm-day', text: '8.5 元/㎡/天',
    }, { area: 100, seats: null })).toBe(25_500)
  })

  it('rounds the shared monthly estimate to CNY cents', () => {
    expect(estimateMonthlyRent({
      amount: 0.1, currency: 'CNY', businessType: 'lease', period: 'day', basis: 'sqm',
      displayUnit: 'rmb-sqm-day', text: '0.1 元/㎡/天',
    }, { area: 3, seats: null })).toBe(9)
  })

  it('does not invent a total when a required dimension is missing', () => {
    expect(estimateMonthlyRent({
      amount: 1_800, currency: 'CNY', businessType: 'lease', period: 'month', basis: 'seat',
      displayUnit: 'rmb-seat-month', text: '1,800 元/工位/月',
    }, { area: 100, seats: null })).toBeNull()
  })

  it('does not turn annual or one-time prices into monthly rent', () => {
    expect(estimateMonthlyRent({
      amount: 120_000, currency: 'CNY', businessType: 'lease', period: 'year', basis: 'total',
      displayUnit: 'rmb-year', text: '120,000 元/年',
    }, { area: 100, seats: null })).toBeNull()
    expect(estimateMonthlyRent({
      amount: 12_000_000, currency: 'CNY', businessType: 'sale', period: 'one-time', basis: 'total',
      displayUnit: 'rmb-total', text: '12,000,000 元',
    }, { area: 100, seats: null })).toBeNull()
  })
})
