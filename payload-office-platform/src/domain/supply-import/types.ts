/** 一行原始表格数据：表头 → 单元格文本（exceljs 侧已统一转成字符串）。 */
export type RawRow = Readonly<Record<string, string>>

/** 一条行级错误。`suggestion` 只给人看，系统绝不自动采用（规格 D5）。 */
export interface RowError {
  /** Excel 里的真实行号（含表头，从 2 开始），运营按它去改第几行 */
  readonly rowNumber: number
  readonly column: string
  readonly rawValue: string
  readonly code: string
  readonly message: string
  readonly suggestion?: string
}

export interface PreflightReport {
  readonly rowCount: number
  readonly validCount: number
  readonly errorCount: number
  readonly rowErrors: readonly RowError[]
}

import type { BuildingCandidate, ResolveTables } from './resolve-refs'
import type { BuildingMerchantRelationInput } from './resolve-merchant'

/**
 * 单行校验所需的只读上下文：地理解析表 + 候选楼盘 + 当前操作者的城市权限范围 +
 * 楼盘商户关系（D10：房源行要靠它推出 listings.merchant） + 判定基准时刻。
 * building-row.ts / listing-row.ts 共用同一份定义，不各自重复。building-row.ts
 * 不需要商户，但仍持有 buildingMerchantRelations / now 两个字段——两个校验函数
 * 共用同一个 RowContext 类型，不为楼盘单独裁一份。
 */
export interface RowContext {
  readonly tables: ResolveTables
  readonly buildings: readonly BuildingCandidate[]
  readonly allowedCityIds: 'all' | ReadonlySet<number | string>
  readonly buildingMerchantRelations: readonly BuildingMerchantRelationInput[]
  readonly now: Date
}
