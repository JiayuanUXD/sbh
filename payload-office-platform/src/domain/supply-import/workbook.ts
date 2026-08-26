/**
 * 工作簿读写层（OPT-041 Task 5）。
 *
 * 唯一碰文件 IO 的一层：解析运营上传的 .xlsx/.csv，以及生成空模板、错误表、楼盘对照表。
 * 单元格一律转成 trim 过的字符串，数字/日期/公式结果一概不在这里解释，交给 normalize 层。
 *
 * `rows` 与 `rowNumbers` 是并行数组：`rowNumbers[i]` 是 `rows[i]` 在 Excel 里的真实行号
 * （含表头，从 2 开始）。全空行会被跳过，但不影响后续行的行号——行号绝不塞进 `RawRow`
 * 的普通键，否则会被当成一列写进错误表。
 */

import { Readable } from 'node:stream'

import ExcelJS from 'exceljs'

import type { RawRow, RowError } from './types'

/** 单个文件的最大字节数（5MB）。本层不判定，由端点层读 body 时判定。 */
export const MAX_FILE_BYTES = 5 * 1024 * 1024

/** 单个文件允许的最大数据行数（不含表头）。 */
export const MAX_ROWS = 1000

export type ParseResult =
  | { ok: true; rows: RawRow[]; rowNumbers: number[] }
  | { ok: false; code: string; message: string }

/** 楼盘对照表（供运营核对房源行该填哪个楼盘编号/slug）的列头。 */
const BUILDING_REFERENCE_COLUMNS = ['楼盘编号', '楼盘名称', 'slug', '城市'] as const

function cellText(cell: ExcelJS.Cell): string {
  return String(cell.text ?? '').trim()
}

function readHeaderRow(worksheet: ExcelJS.Worksheet): string[] {
  const headers: string[] = []
  worksheet.getRow(1).eachCell({ includeEmpty: true }, (cell) => {
    headers.push(cellText(cell))
  })
  return headers
}

/** 表头文本 → 列号（1-based）。空白表头单元格与重名列一律取第一次出现。 */
function buildColumnIndex(headers: readonly string[]): Map<string, number> {
  const index = new Map<string, number>()
  headers.forEach((header, i) => {
    if (header !== '' && !index.has(header)) index.set(header, i + 1)
  })
  return index
}

type LoadWorksheetResult = { ok: true; worksheet: ExcelJS.Worksheet } | { ok: false; code: string; message: string }

/** 只按扩展名分派：.xlsx 走 xlsx.load，.csv 走 csv.read 且显式指定 UTF-8，其它一律拒绝。 */
async function loadWorksheet(buffer: Buffer, fileName: string): Promise<LoadWorksheetResult> {
  const lower = fileName.toLowerCase()

  if (lower.endsWith('.xlsx')) {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer)
    const worksheet = workbook.worksheets[0]
    if (!worksheet) return { ok: false, code: 'UNSUPPORTED_FORMAT', message: '文件中没有工作表' }
    return { ok: true, worksheet }
  }

  if (lower.endsWith('.csv')) {
    const workbook = new ExcelJS.Workbook()
    // 显式把 buffer 按 UTF-8 解码成一整块字符串再喂进流，不依赖 fast-csv 对 Buffer 的默认解码。
    const text = buffer.toString('utf-8')
    const stream = Readable.from([text])
    const worksheet = await workbook.csv.read(stream, {
      parserOptions: { encoding: 'utf-8' },
      // 覆盖 exceljs 的默认 map：默认会把纯数字/日期格式的字符串转成 number/Date，
      // 这一层不做类型推断，一律保留原始字符串交给上层 normalize 解释。
      map: (value) => value,
    })
    return { ok: true, worksheet }
  }

  return { ok: false, code: 'UNSUPPORTED_FORMAT', message: `不支持的文件格式：${fileName}` }
}

/**
 * 解析上传的工作簿。
 *
 * ## 为什么是两个列参数
 *
 * `requiredColumns` 与 `readColumns` 职责完全不同，合成一个必然出错——**已经出过**：
 *
 * - `requiredColumns` 用于「一个都不能少」的**存在性校验**。把新增列算进来，
 *   运营手上所有旧表格会被整份拒收（`MISSING_COLUMNS`）。
 * - `readColumns` 用于**行映射**。少传一列，那一列的值就被静默丢弃——
 *   文件里明明填了，导入"成功"，值却凭空消失，没有任何报错。
 *
 * 真实教训（2026-08-24）：OPT-045 加了 11 个新列后先是把它们算作必需（旧表格被拒），
 * 修的时候把两处都改成了「只有原始列」，于是新列的值全部读不出来——
 * 楼盘的等级/竣工/在售单价落库全 null，出售房源直接进不来。修 A 造出了 B。
 * 拆成两个参数才是把这两件事分开。
 *
 * `readColumns` 里文件中不存在的列会读到空串（`colNumber === undefined`），
 * 所以传完整列对旧表格是安全的。
 */
export async function parseWorkbook(
  buffer: Buffer,
  fileName: string,
  requiredColumns: readonly string[],
  readColumns: readonly string[] = requiredColumns,
): Promise<ParseResult> {
  const loaded = await loadWorksheet(buffer, fileName)
  if (!loaded.ok) return { ok: false, code: loaded.code, message: loaded.message }
  const { worksheet } = loaded

  const headers = readHeaderRow(worksheet)
  const columnIndex = buildColumnIndex(headers)

  const missing = requiredColumns.filter((column) => !columnIndex.has(column))
  if (missing.length > 0) {
    return { ok: false, code: 'MISSING_COLUMNS', message: `缺少必需列：${missing.join('、')}` }
  }

  // 行数上限判定在读取后、映射前——先知道到底有多少数据行，再决定要不要逐行映射。
  const dataRowCount = Math.max(0, worksheet.rowCount - 1)
  if (dataRowCount > MAX_ROWS) {
    return { ok: false, code: 'TOO_MANY_ROWS', message: `数据行数 ${dataRowCount} 超过上限 ${MAX_ROWS} 行` }
  }

  const rows: RawRow[] = []
  const rowNumbers: number[] = []

  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
    const row = worksheet.getRow(rowNumber)
    const values: Record<string, string> = {}
    let allEmpty = true

    // 按 readColumns 映射（完整列）；文件里没有的列读到空串，对旧表格安全。
    for (const column of readColumns) {
      const colNumber = columnIndex.get(column)
      const text = colNumber === undefined ? '' : cellText(row.getCell(colNumber))
      values[column] = text
      if (text !== '') allEmpty = false
    }

    if (allEmpty) continue // 全空行跳过，但下一次循环的 rowNumber 照常自增，不重算
    rows.push(values)
    rowNumbers.push(rowNumber)
  }

  return { ok: true, rows, rowNumbers }
}

export async function buildTemplateWorkbook(columns: readonly string[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet('Sheet1')
  worksheet.addRow([...columns])
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

export async function buildErrorWorkbook(
  columns: readonly string[],
  rows: readonly RawRow[],
  rowNumbers: readonly number[],
  errors: readonly RowError[],
): Promise<Buffer> {
  const errorsByRow = new Map<number, RowError[]>()
  for (const error of errors) {
    const existing = errorsByRow.get(error.rowNumber)
    if (existing) existing.push(error)
    else errorsByRow.set(error.rowNumber, [error])
  }

  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet('Sheet1')
  worksheet.addRow([...columns, '错误原因'])

  rows.forEach((row, i) => {
    const rowNumber = rowNumbers[i]
    const rowErrors = errorsByRow.get(rowNumber) ?? []
    const reason = rowErrors
      .map((error) => (error.suggestion ? `${error.message}（建议：${error.suggestion}）` : error.message))
      .join('；')
    const values = columns.map((column) => row[column] ?? '')
    worksheet.addRow([...values, reason])
  })

  return Buffer.from(await workbook.xlsx.writeBuffer())
}

export async function buildBuildingReferenceWorkbook(
  rows: ReadonlyArray<{ externalId: string | null; name: string; slug: string; city: string }>,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet('Sheet1')
  worksheet.addRow([...BUILDING_REFERENCE_COLUMNS])
  for (const row of rows) {
    worksheet.addRow([row.externalId ?? '', row.name, row.slug, row.city])
  }
  return Buffer.from(await workbook.xlsx.writeBuffer())
}
