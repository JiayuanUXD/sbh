/**
 * 金额类型与校验
 *
 * 业务不变量（AGENTS.md §5.6）：
 *   - 金额必须保存数值、币种、计价周期和单位，禁止只保存拼接文本
 *   - 面积基础单位为平方米，支持一位小数
 */

/** 货币代码（ISO 4217 子集；当前仅人民币） */
export type Currency = 'CNY'

/**
 * 计价周期（单一真源）
 *
 * `one-time` 表示一次性计价（出售总价 / 出售单价），没有周期性含义。
 * 与租赁周期不可比：`normalizeSort` 与价格聚合 key 已保证不会跨周期排序或聚合。
 *
 * 本数组是**唯一**的取值来源：后台下拉选项（`review/pricing-options.ts`）与上架
 * 校验守卫（`review/listing-completeness.ts`）都从这里派生。历史上这三处各写一份
 * 字面量，加一个周期要改三个地方，任一处漏改就是「后台能选但保存被拒」这类静默
 * 不一致。同时它必须与 DB 的 `enum_listings_price_period` 逐字一致。
 */
export const PRICING_PERIODS = ['month', 'day', 'year', 'one-time'] as const
export type PricingPeriod = (typeof PRICING_PERIODS)[number]

/** 计价单位（按面积 / 按套 / 按工位）。与 DB `enum_listings_price_unit` 一致。 */
export const PRICING_UNITS = ['sqm', 'suite', 'seat'] as const
export type PricingUnit = (typeof PRICING_UNITS)[number]

export type Money = {
  /** 金额数值（人民币以元为单位，保留 2 位小数） */
  amount: number
  currency: Currency
  period: PricingPeriod
  unit: PricingUnit
}

/** 是否为有效金额：amount ≥ 0，最多 2 位小数 */
export function isValidMoney(m: Money): boolean {
  if (typeof m.amount !== 'number' || !Number.isFinite(m.amount)) return false
  if (m.amount < 0) return false
  // 浮点精度容差
  const rounded = Math.round(m.amount * 100) / 100
  if (Math.abs(rounded - m.amount) > 1e-9) return false
  return true
}

/** 平方米面积：≥ 0，1 位小数 */
export function isValidSqmArea(value: number): boolean {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false
  if (value < 0) return false
  const rounded = Math.round(value * 10) / 10
  return Math.abs(rounded - value) < 1e-9
}

/** 单价（元/平方米/月）→ 月租金总额（元）。校验面积非法时返回 null。 */
export function monthlyRentFromUnitPrice(
  unitPricePerSqmPerMonth: number,
  areaSqm: number,
): number | null {
  if (!isValidSqmArea(areaSqm)) return null
  if (typeof unitPricePerSqmPerMonth !== 'number' || !Number.isFinite(unitPricePerSqmPerMonth)) {
    return null
  }
  if (unitPricePerSqmPerMonth < 0) return null
  return Math.round(unitPricePerSqmPerMonth * areaSqm * 100) / 100
}
