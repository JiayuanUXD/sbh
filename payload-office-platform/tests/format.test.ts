import { describe, expect, it } from 'vitest'
import { formatAvailableDate, formatRent, formatArea, rentUnitLabel } from '@/lib/frontend/format'

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

describe('formatAvailableDate', () => {
  it('returns 面议 when null / empty / undefined', () => {
    expect(formatAvailableDate(null)).toBe('面议')
    expect(formatAvailableDate('')).toBe('面议')
    expect(formatAvailableDate(undefined)).toBe('面议')
  })
  it('returns 面议 for invalid ISO string', () => {
    expect(formatAvailableDate('not-a-date')).toBe('面议')
  })
  it('formats ISO to zh-CN date in Asia/Shanghai timezone', () => {
    // UTC 2026-08-01 00:00 = 上海 2026-08-01 08:00 -> 同日
    expect(formatAvailableDate('2026-08-01T00:00:00.000Z')).toBe('2026年8月1日')
  })
  it('applies Asia/Shanghai timezone at UTC cross-day boundary', () => {
    // UTC 2026-07-31 16:00 = 上海 2026-08-01 00:00 -> 次日（验证不直接输出 ISO）
    expect(formatAvailableDate('2026-07-31T16:00:00.000Z')).toBe('2026年8月1日')
  })
})