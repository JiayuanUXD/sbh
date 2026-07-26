/**
 * 结构化价格的计价周期 / 单位可选项（tasks.md M4.1 / design §3.4 价格结构化 / R4）
 *
 * 价格必须保存 amount + currency + billing_period + unit 结构化字段，禁止仅存展示文本
 * （money.ts 定义 PricingPeriod / PricingUnit 类型）。本模块提供 admin select 用的
 * 值数组 + 中文标签，作为界面层单一真源，避免在 collection 里散落硬编码。
 */

import type { PricingPeriod, PricingUnit } from '@/domain/shared/money'

/** 计价周期可选项（money.ts PricingPeriod）。 */
export const PRICING_PERIODS_UI: ReadonlyArray<{ label: string; value: PricingPeriod }> = [
  { label: '每月', value: 'month' },
  { label: '每天', value: 'day' },
  { label: '每年', value: 'year' },
]

/** 计价单位可选项（money.ts PricingUnit）。 */
export const PRICING_UNITS_UI: ReadonlyArray<{ label: string; value: PricingUnit }> = [
  { label: '按平方米', value: 'sqm' },
  { label: '按套', value: 'suite' },
  { label: '按工位', value: 'seat' },
]
