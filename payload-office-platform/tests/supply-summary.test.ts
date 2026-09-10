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
 *   - **basis=total 也必须过 period 闸门**（终审 C3 修复）：只有 period=one-time
 *     才是「amount 就是总价」原样返回；租赁语境的整套计价（元/天 · 元/月 ·
 *     元/年）与另两条 basis 走同一套折算，元/年返回 null；
 *   - **basis=sqm + period=one-time 是出售单价**（`rmb-sqm-total`，表头「单价
 *     元/㎡」），总价 = 单价 × 面积。这条分支曾整个缺席，落到函数末尾的
 *     `return null`，导致所有按㎡报价的出售房源总价列恒为「—」；basis=seat 则
 *     刻意**不设** one-time 分支（一次性计价配工位没有业务含义）。
 *   - formatGroupTotal 出售组 /10000（万元），其余组原样取整，均为千分位数字。
 *   - findLowestPrice 只在**单一计价单位内**取 min（终审 I3 修复）：三种租金
 *     单位不可通约，跨单位比 min 会把工位价当成整栋楼的起价。
 */

import { describe, expect, it } from 'vitest'
import type { PriceViewModel } from '@/domain/public-catalog'
import type { BuildingSupplyGroupAvailability } from '@/domain/public-catalog'
import { estimateRowTotal, findLowestPrice, formatGroupTotal } from '@/components/frontend/building-detail/supply-summary'

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

  it('basis=total 且 period=one-time（出售一口价）返回原值，不乘面积也不乘工位数', () => {
    expect(
      estimateRowTotal(
        price({ basis: 'total', period: 'one-time', displayUnit: 'rmb-total', amount: 50000 }),
        { area: 100, seats: 20 },
      ),
    ).toBe(50000)
  })

  /**
   * 终审 C3：`basis === 'total'` 曾经直接 `return amount`，**跳过 period 检查**。
   * `PRICING_PERIODS` 的 year 与 `PRICING_UNITS` 的 suite（→ basis total）组合
   * 合法且后台可填：整套计价 + 周期「每年」+ 120 万的租赁房源，决策卡主价行
   * 显示「1200000 元/年」，正下方摘要行却输出「月租 1,200,000 元/月」——同一
   * 张卡自相矛盾，且高的那个错了 12 倍。period=day 则反向低估 30 倍。
   * 这三条用例把 total 分支钉在与 seat/sqm 一致的折算口径上。
   */
  it('basis=total 且 period=year（整套年租）返回 null，不冒充月租', () => {
    expect(
      estimateRowTotal(
        price({ basis: 'total', period: 'year', displayUnit: 'rmb-year', amount: 1_200_000 }),
        { area: 1000, seats: null },
      ),
    ).toBeNull()
  })

  it('basis=total 且 period=month（整套月租）原样返回，不乘面积', () => {
    expect(
      estimateRowTotal(
        price({ basis: 'total', period: 'month', displayUnit: 'rmb-month', amount: 12_000 }),
        { area: 1000, seats: null },
      ),
    ).toBe(12_000)
  })

  it('basis=total 且 period=day（整套日租）按 30 天折算月租，不原样返回', () => {
    expect(
      estimateRowTotal(
        price({ basis: 'total', period: 'day', displayUnit: 'rmb-day', amount: 400 }),
        { area: 1000, seats: null },
      ),
    ).toBe(400 * 30)
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

  it('basis=sqm 且 period=year（按㎡年租）返回 null', () => {
    expect(
      estimateRowTotal(price({ period: 'year', displayUnit: 'rmb-month' }), { area: 100, seats: null }),
    ).toBeNull()
  })

  /**
   * 出售单价（`one-time` + `sqm` → `rmb-sqm-total`）。sqm 分支原本只认 day/month，
   * one-time 落到末尾的 `return null`——`basis='total'` 早在终审 C3 就为 one-time
   * 开了口子，同一件事的另一半漏做，于是「出售 + 按㎡报单价」的总价列恒为「—」。
   * 生产实证（2026-09-10，上河商务园 `/shanghai/buildings/shangheshangwuyuan`）：
   * 三套房源面积与单价俱全，总价列仍是「—」。下面第三条用的就是那一行的真实数字。
   */
  it('basis=sqm 且 period=one-time（出售单价）总价 = 单价 × 面积', () => {
    expect(
      estimateRowTotal(
        price({ businessType: 'sale', basis: 'sqm', period: 'one-time', displayUnit: 'rmb-sqm-total', amount: 20_000 }),
        { area: 990.76, seats: null },
      ),
    ).toBe(20_000 * 990.76)
  })

  it('basis=sqm 且 period=one-time 但面积缺失返回 null，不把单价当总价', () => {
    expect(
      estimateRowTotal(
        price({ businessType: 'sale', basis: 'sqm', period: 'one-time', displayUnit: 'rmb-sqm-total', amount: 20_000 }),
        { area: null, seats: null },
      ),
    ).toBeNull()
  })

  it('出售单价折算后经 formatGroupTotal 得到万元口径（上河商务园首行回归）', () => {
    const total = estimateRowTotal(
      price({ businessType: 'sale', basis: 'sqm', period: 'one-time', displayUnit: 'rmb-sqm-total', amount: 10_000 }),
      { area: 618.42, seats: null },
    )
    expect(total).toBe(6_184_200)
    expect(formatGroupTotal(total as number, 'sale')).toBe('618')
  })

  /**
   * 与 sqm 相反：seat 分支**故意**不认 one-time。一次性计价配「按工位」没有业务
   * 含义（联合办公按工位月付），真出现这个组合应当在录入侧拦，而不是在这里替它
   * 编一个总价出来。这条用例把「不做」这个决定钉住，避免后来者顺手补齐。
   */
  it('basis=seat 且 period=one-time 返回 null（刻意不折算）', () => {
    expect(
      estimateRowTotal(
        price({ basis: 'seat', period: 'one-time', displayUnit: 'rmb-seat-month', amount: 1200 }),
        { area: 999, seats: 20 },
      ),
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

/**
 * 终审 I3：`findLowestPrice` 曾经跨 `displayUnit` 直接取 min。
 *
 * 「三种租金单位不可通约，绝不允许跨单位比价」是本项目的硬约束——价格分桶
 * （`PRICE_BUCKET_UNIT` + 域层 `matchesInput` 的单位闸门）与 `priceRanges`
 * （按 `priceKeyOf` 分桶）两处都做对了，唯独首屏「X 起」这处漏了：租赁
 * 300 元/㎡/月 + 联合办公 200 元/工位/月 → 输出「200 元/工位/月 起」，
 * 把一个工位价当成整栋楼的起价。
 */
function priceRange(
  overrides: Partial<BuildingSupplyGroupAvailability['priceRanges'][number]> = {},
): BuildingSupplyGroupAvailability['priceRanges'][number] {
  return {
    key: 'lease:CNY:month:sqm:rmb-sqm-month',
    businessType: 'lease',
    currency: 'CNY',
    period: 'month',
    basis: 'sqm',
    displayUnit: 'rmb-sqm-month',
    min: 300,
    max: 400,
    count: 5,
    ...overrides,
  }
}

function availability(
  overrides: Partial<BuildingSupplyGroupAvailability> = {},
): BuildingSupplyGroupAvailability {
  return {
    key: 'lease',
    totalEffectiveListings: 5,
    areaRange: null,
    seatRange: null,
    immediateAvailabilityCount: 0,
    priceRanges: [priceRange()],
    ...overrides,
  }
}

describe('findLowestPrice', () => {
  it('不跨业务组比价：联合办公的工位价再低也不会冒充整栋楼的起价', () => {
    const lowest = findLowestPrice([
      availability(),
      availability({
        key: 'coworking',
        priceRanges: [
          priceRange({
            key: 'coworking:CNY:month:seat:rmb-seat-month',
            basis: 'seat',
            displayUnit: 'rmb-seat-month',
            min: 200,
            max: 900,
            count: 3,
          }),
        ],
      }),
    ])
    expect(lowest).toEqual({ min: 300, displayUnit: 'rmb-sqm-month' })
  })

  it('同组内多种单位时取房源数最多的那个单位，再在该单位内取 min', () => {
    const lowest = findLowestPrice([
      availability({
        priceRanges: [
          // 数量少的单位数值更低——旧实现会选它
          priceRange({
            key: 'lease:CNY:day:sqm:rmb-sqm-day',
            period: 'day',
            displayUnit: 'rmb-sqm-day',
            min: 8,
            max: 9,
            count: 1,
          }),
          priceRange({ min: 300, max: 400, count: 9 }),
        ],
      }),
    ])
    expect(lowest).toEqual({ min: 300, displayUnit: 'rmb-sqm-month' })
  })

  it('首个组整组价格面议时顺延到下一个有公开报价的组，不退化成「价格面议」', () => {
    const lowest = findLowestPrice([
      availability({ priceRanges: [] }),
      availability({
        key: 'sale',
        priceRanges: [
          priceRange({
            key: 'sale:CNY:one-time:total:rmb-total',
            businessType: 'sale',
            period: 'one-time',
            basis: 'total',
            displayUnit: 'rmb-total',
            min: 38_000_000,
            max: 52_000_000,
            count: 2,
          }),
        ],
      }),
    ])
    expect(lowest).toEqual({ min: 38_000_000, displayUnit: 'rmb-total' })
  })

  it('全部组都没有公开报价时返回 null', () => {
    expect(findLowestPrice([availability({ priceRanges: [] })])).toBeNull()
  })
})
