import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'

import { parseWorkbook } from '@/domain/supply-import/workbook'
import { BUILDING_COLUMNS, REQUIRED_BUILDING_COLUMNS } from '@/domain/supply-import/building-row'
import { LISTING_COLUMNS, REQUIRED_LISTING_COLUMNS } from '@/domain/supply-import/listing-row'

/**
 * `parseWorkbook` 的两个列参数（必需列 / 读取列）。
 *
 * ## 为什么必须用真实 xlsx 而不是断言列表内容
 *
 * 2026-08-24 生产验收踩到的真实缺陷：OPT-045 加了 11 个新列后，
 *
 *   1. 先把新列算作**必需**  → 运营手上的旧表格被整份拒收（MISSING_COLUMNS）；
 *   2. 修的时候把两处都改成「只有原始列」→ 新列的值**全部读不出来**，
 *      楼盘的等级/竣工/在售单价落库全 null，出售房源直接进不来。
 *
 * 修 (1) 时我加了三条测试——「必需列恰好是原八列」「必需列是模板列的前缀」
 * 「新列不在必需列里」——**三条全过，却一条都没发现 (2)**。因为它们断言的是
 * 列表的内容，而缺陷在于「列表被用在了哪里」。
 *
 * 所以这个文件走真实 exceljs 工作簿，验的是**行为**：值到底读没读出来。
 */

async function makeXlsx(headers: readonly string[], rows: string[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Sheet1')
  ws.addRow([...headers])
  rows.forEach((r) => ws.addRow(r))
  // exceljs 返回的是 ExcelJS.Buffer（ArrayBuffer 的结构化别名），与 Node Buffer
  // 不直接兼容，先过 unknown 再收窄——这里只是把字节交给 parseWorkbook，无运行时差异。
  return Buffer.from((await wb.xlsx.writeBuffer()) as unknown as ArrayBuffer)
}

/** 按列名构造整行，避免手数位置数错。 */
function rowOf(columns: readonly string[], values: Record<string, string>): string[] {
  return columns.map((c) => values[c] ?? '')
}

describe('parseWorkbook 的必需列 / 读取列', () => {
  it('新格式表格：新列的值必须读得出来（这条守的就是「值凭空消失」）', async () => {
    const buf = await makeXlsx(BUILDING_COLUMNS, [
      rowOf(BUILDING_COLUMNS, {
        楼盘编号: 'B-1',
        楼盘名称: '测试楼盘',
        城市: '上海',
        行政区: '黄浦区',
        等级: '甲级',
        竣工年份: '2015',
        在售单价: '5.2万',
        供给商户: '官网',
      }),
    ])
    const parsed = await parseWorkbook(buf, 'b.xlsx', REQUIRED_BUILDING_COLUMNS, BUILDING_COLUMNS)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.rows[0]['等级']).toBe('甲级')
    expect(parsed.rows[0]['竣工年份']).toBe('2015')
    expect(parsed.rows[0]['在售单价']).toBe('5.2万')
    expect(parsed.rows[0]['供给商户']).toBe('官网')
  })

  it('房源新列同理（出售那几列读不出来 = 出售房源压根导不进）', async () => {
    const buf = await makeXlsx(LISTING_COLUMNS, [
      rowOf(LISTING_COLUMNS, {
        房源编号: 'L-1',
        房源标题: '测试房源',
        房源类型: '传统办公室',
        楼盘编号或标识: 'B-1',
        面积: '300',
        售价: '800万',
        产权年限: '50年',
        满五唯一: '是',
        车位: '2',
        税费承担: '买方承担',
      }),
    ])
    const parsed = await parseWorkbook(buf, 'l.xlsx', REQUIRED_LISTING_COLUMNS, LISTING_COLUMNS)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.rows[0]['售价']).toBe('800万')
    expect(parsed.rows[0]['产权年限']).toBe('50年')
    expect(parsed.rows[0]['满五唯一']).toBe('是')
    expect(parsed.rows[0]['税费承担']).toBe('买方承担')
  })

  it('旧格式表格（只有原始列）仍能解析，新列读到空串而不是报错', async () => {
    const buf = await makeXlsx(REQUIRED_BUILDING_COLUMNS, [
      rowOf(REQUIRED_BUILDING_COLUMNS, {
        楼盘编号: 'B-OLD',
        楼盘名称: '旧格式楼盘',
        城市: '上海',
        行政区: '黄浦区',
      }),
    ])
    const parsed = await parseWorkbook(buf, 'old.xlsx', REQUIRED_BUILDING_COLUMNS, BUILDING_COLUMNS)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.rows[0]['楼盘名称']).toBe('旧格式楼盘')
    expect(parsed.rows[0]['等级']).toBe('')
    expect(parsed.rows[0]['在售单价']).toBe('')
  })

  it('缺必需列仍然整份拒收', async () => {
    const withoutCity = REQUIRED_BUILDING_COLUMNS.filter((c) => c !== '城市')
    const buf = await makeXlsx(withoutCity, [rowOf(withoutCity, { 楼盘编号: 'B-2', 楼盘名称: 'X' })])
    const parsed = await parseWorkbook(buf, 'bad.xlsx', REQUIRED_BUILDING_COLUMNS, BUILDING_COLUMNS)
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.code).toBe('MISSING_COLUMNS')
    expect(parsed.message).toContain('城市')
  })

  it('缺的只是新列则不拒收——新列永远不该出现在 MISSING_COLUMNS 里', async () => {
    const buf = await makeXlsx(REQUIRED_LISTING_COLUMNS, [
      rowOf(REQUIRED_LISTING_COLUMNS, {
        房源编号: 'L-OLD',
        房源标题: '旧格式房源',
        房源类型: '传统办公室',
        楼盘编号或标识: 'B-1',
        面积: '280',
        租金: '4.5元/㎡/天',
      }),
    ])
    const parsed = await parseWorkbook(buf, 'old.xlsx', REQUIRED_LISTING_COLUMNS, LISTING_COLUMNS)
    expect(parsed.ok).toBe(true)
  })

  it('只传一个列参数时两者相同（向后兼容既有调用点）', async () => {
    const buf = await makeXlsx(BUILDING_COLUMNS, [
      rowOf(BUILDING_COLUMNS, { 楼盘编号: 'B-3', 楼盘名称: 'Y', 城市: '上海', 行政区: '黄浦区', 等级: '甲级' }),
    ])
    const parsed = await parseWorkbook(buf, 'b.xlsx', BUILDING_COLUMNS)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.rows[0]['等级']).toBe('甲级')
  })
})
