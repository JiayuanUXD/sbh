/**
 * 批内编号查重（OPT-041 规格 §6）。
 *
 * "编号在同一次导入内必须唯一，重复即错误行"。放在共享处，楼盘导入与房源导入都用
 * 同一份逻辑，端点层不要各自复制一份。
 */

import type { RowError } from '@/domain/supply-import/types'

export interface MarkDuplicateResult<T> {
  readonly kept: T[]
  readonly keptRowNumbers: number[]
  readonly errors: RowError[]
}

export function markDuplicateExternalIds<T extends { externalId: string }>(
  rows: readonly T[],
  rowNumbers: readonly number[],
  column: string,
): MarkDuplicateResult<T> {
  const firstSeenRow = new Map<string, number>()
  const kept: T[] = []
  const keptRowNumbers: number[] = []
  const errors: RowError[] = []

  rows.forEach((row, index) => {
    const rowNumber = rowNumbers[index]
    const firstRow = firstSeenRow.get(row.externalId)

    if (firstRow === undefined) {
      firstSeenRow.set(row.externalId, rowNumber)
      kept.push(row)
      keptRowNumbers.push(rowNumber)
      return
    }

    errors.push({
      rowNumber,
      column,
      rawValue: row.externalId,
      code: 'DUPLICATE_EXTERNAL_ID',
      message: `编号「${row.externalId}」与第 ${firstRow} 行重复，同一次导入内必须唯一`,
    })
  })

  return { kept, keptRowNumbers, errors }
}
