/**
 * F1.5 单测：楼盘详情供给汇总助手（58 式表格「总价」列）
 *
 * 设计依据：plans/2026-08-04-building-detail-58-style-refactor.md
 *
 * 守护不变量：
 *   - estimateMonthlyTotal 只对可按面积折算的计价方式给出估算；
 *   - 价格缺失 / 面积缺失 / 无法折算的计价方式一律返回 null（表格显示「—」）；
 *   - 元/㎡/天 → 按 30 天折算月租金；元/㎡/月 → 直接乘面积；
 *   - 总价直接给出的计价方式（basis=total）返回原值；
 *   - formatMonthlyTotal 万元级用「x.x万/月」，小额用「N元/月」。
 */

import { describe, expect, it } from 'vitest'
import type { PriceViewModel } from '@/domain/public-catalog'
import { estimateMonthlyTotal, formatMonthlyTotal } from '@/components/frontend/building-detail/supply-summary'

function price(overrides: Partial<PriceViewModel> = {}): PriceViewModel {
  return {
    amount: 8.5,
    currency: 'CNY',
    businessType: 'lease',
    period: 'day',
    basis: 'sqm',
    displayUnit: 'rmb-sqm-day',
    text: '8.5 元/㎡/天',
    ...overrides,
  }
}

describe('estimateMonthlyTotal', () => {
  it('元/㎡/天 按 30 天折算月租金', () => {
    expect(estimateMonthlyTotal(price({ amount: 8.5 }), 220)).toBe(8.5 * 220 * 30)
  })

  it('元/㎡/月 直接乘面积', () => {
    expect(estimateMonthlyTotal(price({ period: 'month', displayUnit: 'rmb-month' }), 100)).toBe(850)
  })

  it('basis=total 返回原值，不乘面积', () => {
    expect(estimateMonthlyTotal(price({ basis: 'total', displayUnit: 'rmb-total', amount: 50000 }), 100)).toBe(50000)
  })

  it('basis=seat 按面积（工位数）折算', () => {
    expect(estimateMonthlyTotal(price({ basis: 'seat', displayUnit: 'rmb-seat-month', amount: 1200 }), 20)).toBe(24000)
  })

  it('价格缺失返回 null', () => {
    expect(estimateMonthlyTotal(null, 100)).toBeNull()
  })

  it('面积缺失返回 null', () => {
    expect(estimateMonthlyTotal(price(), null)).toBeNull()
  })

  it('无法折算的计价方式（按年/一次性）返回 null', () => {
    expect(estimateMonthlyTotal(price({ period: 'year', displayUnit: 'rmb-month' }), 100)).toBeNull()
  })
})

describe('formatMonthlyTotal', () => {
  it('万元级用 x.x万/月', () => {
    expect(formatMonthlyTotal(56100)).toBe('5.6万/月')
  })

  it('小额用 N元/月', () => {
    expect(formatMonthlyTotal(800)).toBe('800元/月')
  })
})