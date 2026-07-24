import { describe, expect, it } from 'vitest'
import { formatRent, formatArea, rentUnitLabel } from '@/lib/frontend/format'

describe('formatRent', () => {
  it('renders 元/㎡/天 with 1 decimal for rmb-sqm-day', () => {
    expect(formatRent(9.8, 'rmb-sqm-day')).toBe('9.8 元/㎡/天')
  })
  it('renders 元/月 for rmb-month', () => {
    expect(formatRent(25000, 'rmb-month')).toBe('25000 元/月')
  })
  it('renders 元/工位/月 for rmb-seat-month', () => {
    expect(formatRent(2800, 'rmb-seat-month')).toBe('2800 元/工位/月')
  })
  it('returns 待面议 when rent is undefined', () => {
    expect(formatRent(undefined, 'rmb-sqm-day')).toBe('待面议')
  })
})

describe('rentUnitLabel', () => {
  it('returns short label per unit', () => {
    expect(rentUnitLabel('rmb-sqm-day')).toBe('元/㎡/天')
    expect(rentUnitLabel('rmb-month')).toBe('元/月')
    expect(rentUnitLabel('rmb-seat-month')).toBe('元/工位/月')
  })
})

describe('formatArea', () => {
  it('appends ㎡', () => {
    expect(formatArea(360)).toBe('360 ㎡')
  })
  it('returns 面议 when undefined', () => {
    expect(formatArea(undefined)).toBe('面议')
  })
})