/**
 * 批次级默认值（OPT-045 §4.3）。
 *
 * 运营在导入向导里为**这一批**设一次默认值，行内留空即用它。
 * 典型场景：一批表格通常只涉及一个城市、一个供给商户，逐行重复填是纯粹的浪费。
 *
 * ## 为什么在「原始行」层面填充，而不是校验之后
 *
 * 默认值填进 `RawRow` 之后，走的是与手填值**完全相同**的校验路径——
 * 城市要解析、商户要判合格性与 §10、等级要在枚举里。不产生第二条验证分支。
 *
 * 反过来做（校验通过后再往 `ValidXxxRow` 上补默认值）会绕开校验：
 * 一个拼错的默认城市名会静默变成 null 或抛在写入层，而预检报告显示「全部通过」。
 * 那正是本工作项反复要避免的失败形态——「导入成功了，前台却看不见」。
 *
 * ## 只填「空」，不覆盖
 *
 * 单元格有值就原样保留。默认值是省事，不是批量改写——
 * 若它能覆盖已填值，运营会在毫无提示的情况下把一整批数据改掉。
 *
 * 纯函数，无 IO。
 */

import type { RawRow } from '@/domain/supply-import/types'

/** 允许设批次默认值的列。**必须是模板列的子集**，否则填了也没人读。 */
export const BUILDING_DEFAULTABLE_COLUMNS = ['城市', '行政区', '供给商户', '等级'] as const
export const LISTING_DEFAULTABLE_COLUMNS = ['供给商户', '房源类型', '装修'] as const

export type BatchDefaults = Readonly<Record<string, string>>

/**
 * 收窄外部传入的默认值：只保留白名单内、且值非空的列。
 *
 * 白名单是硬约束而不是提示——不收窄的话，前端传个 `{'房源编号': 'X'}` 就能让
 * 整批房源共用一个编号，而编号是去重与幂等重传的依据。
 */
export function sanitizeBatchDefaults(
  raw: unknown,
  allowedColumns: readonly string[],
): BatchDefaults {
  if (typeof raw !== 'object' || raw === null) return {}
  const allowed = new Set(allowedColumns)
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!allowed.has(key)) continue
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (trimmed === '') continue
    out[key] = trimmed
  }
  return out
}

/**
 * 把默认值填进原始行的空单元格。
 *
 * 「空」= 缺键、或去空白后为空串。返回新对象，不改动入参
 * ——调用方可能还要拿原始行做别的事（比如错误报告里回显 rawValue）。
 */
export function applyBatchDefaults(
  rows: readonly RawRow[],
  defaults: BatchDefaults,
): RawRow[] {
  const entries = Object.entries(defaults)
  if (entries.length === 0) return rows.map((row) => ({ ...row }))

  return rows.map((row) => {
    const next: Record<string, string> = { ...row }
    for (const [column, value] of entries) {
      const current = next[column]
      if (current === undefined || String(current).trim() === '') {
        next[column] = value
      }
    }
    return next
  })
}

/** 解析前端传来的 JSON 字符串；坏数据一律当成「没设默认值」，不让整批失败。 */
export function parseBatchDefaults(
  raw: unknown,
  allowedColumns: readonly string[],
): BatchDefaults {
  if (typeof raw !== 'string' || raw.trim() === '') return {}
  try {
    return sanitizeBatchDefaults(JSON.parse(raw), allowedColumns)
  } catch {
    return {}
  }
}
