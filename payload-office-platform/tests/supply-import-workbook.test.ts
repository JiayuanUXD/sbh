import { describe, expect, it } from 'vitest'

import {
  parseWorkbook,
  buildTemplateWorkbook,
  buildErrorWorkbook,
  MAX_ROWS,
} from '@/domain/supply-import/workbook'

const COLUMNS = ['房源编号', '房源标题'] as const

async function makeXlsx(rows: string[][]): Promise<Buffer> {
  const ExcelJS = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Sheet1')
  for (const row of rows) ws.addRow(row)
  return Buffer.from(await wb.xlsx.writeBuffer())
}

describe('parseWorkbook', () => {
  it('解析 xlsx，表头映射为对象', async () => {
    const buf = await makeXlsx([[...COLUMNS], ['L-001', '测试房源']])
    const result = await parseWorkbook(buf, 'a.xlsx', COLUMNS)
    expect(result.ok).toBe(true)
    expect(result.ok && result.rows).toEqual([{ 房源编号: 'L-001', 房源标题: '测试房源' }])
    expect(result.ok && result.rowNumbers).toEqual([2])
  })

  it('缺必需列 → 整个文件拒绝，一行都不解析', async () => {
    const buf = await makeXlsx([['房源编号'], ['L-001']])
    const result = await parseWorkbook(buf, 'a.xlsx', COLUMNS)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.code).toBe('MISSING_COLUMNS')
    expect(result.ok === false && result.message).toContain('房源标题')
  })

  it('超行数上限 → 拒绝', async () => {
    const rows = [[...COLUMNS], ...Array.from({ length: MAX_ROWS + 1 }, (_, i) => [`L-${i}`, 'x'])]
    const buf = await makeXlsx(rows)
    const result = await parseWorkbook(buf, 'a.xlsx', COLUMNS)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.code).toBe('TOO_MANY_ROWS')
  })

  it('不认识的扩展名 → 拒绝', async () => {
    const result = await parseWorkbook(Buffer.from('x'), 'a.txt', COLUMNS)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.code).toBe('UNSUPPORTED_FORMAT')
  })

  it('全空行被跳过，但后续行的行号不重算', async () => {
    const buf = await makeXlsx([[...COLUMNS], ['L-001', 'x'], ['', ''], ['L-002', 'y']])
    const result = await parseWorkbook(buf, 'a.xlsx', COLUMNS)
    expect(result.ok && result.rows.length).toBe(2)
    // 第 3 行是空行被跳过，第 4 行的行号必须还是 4
    expect(result.ok && result.rowNumbers).toEqual([2, 4])
  })
})

describe('buildTemplateWorkbook / buildErrorWorkbook', () => {
  it('模板只有表头一行', async () => {
    const buf = await buildTemplateWorkbook(COLUMNS)
    const parsed = await parseWorkbook(buf, 't.xlsx', COLUMNS)
    expect(parsed.ok && parsed.rows).toEqual([])
  })

  it('错误表在原列后追加「错误原因」列', async () => {
    const buf = await buildErrorWorkbook(
      COLUMNS,
      [{ 房源编号: 'L-001', 房源标题: '' }],
      [2],
      [{ rowNumber: 2, column: '房源标题', rawValue: '', code: 'REQUIRED', message: '房源标题必填' }],
    )
    const parsed = await parseWorkbook(buf, 'e.xlsx', [...COLUMNS, '错误原因'])
    expect(parsed.ok && parsed.rows[0]['错误原因']).toContain('房源标题必填')
  })

  it('同一行的多条错误合并进一个单元格', async () => {
    const buf = await buildErrorWorkbook(
      COLUMNS,
      [{ 房源编号: '', 房源标题: '' }],
      [2],
      [
        { rowNumber: 2, column: '房源编号', rawValue: '', code: 'REQUIRED', message: '房源编号必填' },
        { rowNumber: 2, column: '房源标题', rawValue: '', code: 'REQUIRED', message: '房源标题必填' },
      ],
    )
    const parsed = await parseWorkbook(buf, 'e.xlsx', [...COLUMNS, '错误原因'])
    expect(parsed.ok && parsed.rows[0]['错误原因']).toContain('房源编号必填')
    expect(parsed.ok && parsed.rows[0]['错误原因']).toContain('房源标题必填')
  })
})
