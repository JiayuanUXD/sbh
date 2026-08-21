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

// RowContext 定义在这里（Task 3、Task 4 使用），现在不实现
// 它依赖 Task 3 的类型，Task 4 实施时再补：
//
// import type { BuildingCandidate, ResolveTables } from './resolve-refs'
//
// export interface RowContext {
//   readonly tables: ResolveTables
//   readonly buildings: readonly BuildingCandidate[]
//   readonly allowedCityIds: 'all' | ReadonlySet<number | string>
// }
