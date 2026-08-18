/**
 * 结构化价格的计价周期 / 单位可选项（tasks.md M4.1 / design §3.4 价格结构化 / R4）
 *
 * 价格必须保存 amount + currency + billing_period + unit 结构化字段，禁止仅存展示文本
 * （money.ts 定义 PricingPeriod / PricingUnit 类型与取值数组）。本模块只负责把取值
 * 映射成界面用的中文标签，取值本身一律从 money.ts 派生——标签表用 Record 收口，
 * money.ts 里新增一个取值而这里没补标签，TypeScript 会直接报错。
 */

import {
  PRICING_PERIODS,
  PRICING_UNITS,
  type PricingPeriod,
  type PricingUnit,
} from '@/domain/shared/money'

/** 计价周期中文标签。 */
const PRICING_PERIOD_LABELS: Record<PricingPeriod, string> = {
  month: '每月',
  day: '每天',
  year: '每年',
  'one-time': '一次性（出售）',
}

/** 计价单位中文标签。 */
const PRICING_UNIT_LABELS: Record<PricingUnit, string> = {
  sqm: '按平方米',
  suite: '按套',
  seat: '按工位',
}

/**
 * 计价周期可选项（money.ts PricingPeriod）。
 *
 * `one-time` 是出售用的一次性计价：配「按套」得总价（3800 万元），配「按平方米」
 * 得单价（5.2 万元/㎡）。与租赁周期不可比，价格排序与聚合已由
 * `businessType:currency:period:basis` 聚合 key 和 `normalizeSort` 隔开。
 */
export const PRICING_PERIODS_UI: ReadonlyArray<{ label: string; value: PricingPeriod }> =
  PRICING_PERIODS.map((value) => ({ label: PRICING_PERIOD_LABELS[value], value }))

/** 计价单位可选项（money.ts PricingUnit）。 */
export const PRICING_UNITS_UI: ReadonlyArray<{ label: string; value: PricingUnit }> =
  PRICING_UNITS.map((value) => ({ label: PRICING_UNIT_LABELS[value], value }))
