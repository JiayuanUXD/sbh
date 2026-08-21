/**
 * F1.5 / OPT-037 Task 7 单测：楼盘详情供给汇总助手（密度表「月租/总价」列）
 *
 * 设计依据：plans/2026-08-04-building-detail-58-style-refactor.md
 * OPT-037 Task 7 把旧版单一表格改造为按业务组切换的密度表，`estimateMonthlyTotal`
 * / `formatMonthlyTotal` 随之改造为 `estimateRowTotal` / `formatGroupTotal`：
 *   - 旧版把面积当工位数传给 basis=seat 计价（本文件旧版单测的注释「按面积
 *     （工位数）折算」就是这处误用的证据），改造后 `seats` 是独立维度；
 *   - 总价单位不再是固定的「万/月」阈值格式，而是按业务组决定（出售=万元 /
 *     租赁与联合办公=元），单位交给表头，值只出数字。
 *
 * 守护不变量：
 *   - estimateRowTotal 只对可折算的计价方式给出估算；
 *   - 价格缺失 / 所需维度（面积或工位数）缺失 / 无法折算的计价方式一律返回
 *     null（表格显示「—」）；
 *   - 元/㎡/天 → 按 30 天折算月租金；元/㎡/月 → 直接乘面积；
 *     元/工位/月 → 直接乘工位数；元/工位/天 → 按 30 天折算；
 *   - 总价直接给出的计价方式（basis=total）返回原值；
 *   - formatGroupTotal 出售组 /10000（万元），其余组原样取整，均为千分位数字。
 */

import { describe, expect, it } from 'vitest'
import type { PriceViewModel } from '@/domain/public-catalog'
import { estimateRowTotal, formatGroupTotal } from '@/components/frontend/building-detail/supply-summary'

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

describe('estimateRowTotal', () => {
  it('元/㎡/天 按 30 天折算月租金', () => {
    expect(estimateRowTotal(price({ amount: 8.5 }), { area: 220, seats: null })).toBe(8.5 * 220 * 30)
  })

  it('元/㎡/月 直接乘面积', () => {
    expect(
      estimateRowTotal(price({ period: 'month', displayUnit: 'rmb-month' }), { area: 100, seats: null }),
    ).toBe(850)
  })

  it('basis=total 返回原值，不乘面积也不乘工位数', () => {
    expect(
      estimateRowTotal(price({ basis: 'total', displayUnit: 'rmb-total', amount: 50000 }), {
        area: 100,
        seats: 20,
      }),
    ).toBe(50000)
  })

  it('basis=seat 按工位数折算，不能用面积代替', () => {
    expect(
      estimateRowTotal(price({ basis: 'seat', period: 'month', displayUnit: 'rmb-seat-month', amount: 1200 }), {
        area: 999,
        seats: 20,
      }),
    ).toBe(24000)
  })

  it('basis=seat 且 period=day 按 30 天折算', () => {
    expect(
      estimateRowTotal(price({ basis: 'seat', period: 'day', displayUnit: 'rmb-seat-day', amount: 80 }), {
        area: null,
        seats: 12,
      }),
    ).toBe(80 * 12 * 30)
  })

  it('basis=seat 但工位数缺失返回 null（不用面积顶替）', () => {
    expect(
      estimateRowTotal(price({ basis: 'seat', displayUnit: 'rmb-seat-month', amount: 1200 }), {
        area: 20,
        seats: null,
      }),
    ).toBeNull()
  })

  it('价格缺失返回 null', () => {
    expect(estimateRowTotal(null, { area: 100, seats: null })).toBeNull()
  })

  it('面积缺失返回 null', () => {
    expect(estimateRowTotal(price(), { area: null, seats: null })).toBeNull()
  })

  it('无法折算的计价方式（按年/一次性）返回 null', () => {
    expect(
      estimateRowTotal(price({ period: 'year', displayUnit: 'rmb-month' }), { area: 100, seats: null }),
    ).toBeNull()
  })
})

describe('formatGroupTotal', () => {
  it('出售组按万元折算并取整', () => {
    expect(formatGroupTotal(114_080_000, 'sale')).toBe('11,408')
  })

  it('租赁组原样取整为元，千分位分组', () => {
    expect(formatGroupTotal(211_560, 'lease')).toBe('211,560')
  })

  it('联合办公组原样取整为元', () => {
    expect(formatGroupTotal(34_560, 'coworking')).toBe('34,560')
  })
})
