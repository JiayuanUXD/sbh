import type { EffectiveSupplyExclusionCode } from './effective-supply'

/**
 * 有效供给精筛排除原因码 → 运营可读的中文（OPT-113）。
 *
 * 单独成文件、只做类型导入：列表的批量结果弹层是客户端组件，
 * 不该为两句文案把 effective-supply.ts 及其依赖拖进浏览器包。
 * 码表本身仍以 `EFFECTIVE_SUPPLY_EXCLUSION_CODES` 为准，这里 `Record` 键缺一个就编译不过。
 */
export const EFFECTIVE_SUPPLY_EXCLUSION_LABELS: Record<EffectiveSupplyExclusionCode, string> = {
  NO_SUPPLY_MERCHANT: '未设置供给商户',
  MERCHANT_INELIGIBLE: '商户不合格（已停用、资质无效或过期，或服务城市不覆盖楼盘城市）',
}

/** 未知码原样返回：宁可让运营看到一个码去问人，也不要吞掉一条原因。 */
export function effectiveSupplyExclusionLabel(code: string): string {
  return (EFFECTIVE_SUPPLY_EXCLUSION_LABELS as Record<string, string>)[code] ?? code
}
