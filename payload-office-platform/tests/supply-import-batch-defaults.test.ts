import { describe, expect, it } from 'vitest'

import {
  applyBatchDefaults,
  parseBatchDefaults,
  sanitizeBatchDefaults,
  BUILDING_DEFAULTABLE_COLUMNS,
  LISTING_DEFAULTABLE_COLUMNS,
} from '@/domain/supply-import/batch-defaults'

/**
 * 批次级默认值（OPT-045 §4.3）。
 *
 * 三条不变量，任何一条破了都会造成静默的数据错误：
 *   1. **只填空、不覆盖**——能覆盖就等于允许一次操作静默改写整批已填数据；
 *   2. **白名单硬约束**——不收窄的话传个「房源编号」就能让整批共用一个编号，
 *      而编号是去重与幂等重传的依据；
 *   3. **坏 JSON 不炸整批**——默认值是省事功能，不该让一个格式错误毁掉整次导入。
 */

describe('sanitizeBatchDefaults', () => {
  it('只保留白名单内的列', () => {
    const out = sanitizeBatchDefaults(
      { 城市: '上海', 房源编号: 'X-1', 楼盘名称: '不该进来' },
      BUILDING_DEFAULTABLE_COLUMNS,
    )
    expect(out).toEqual({ 城市: '上海' })
  })

  it('房源编号绝不可作为批次默认值——它是去重与幂等重传的依据', () => {
    const out = sanitizeBatchDefaults({ 房源编号: 'L-1' }, LISTING_DEFAULTABLE_COLUMNS)
    expect(out).toEqual({})
  })

  it('空串与纯空白视为未设置', () => {
    expect(sanitizeBatchDefaults({ 城市: '', 行政区: '   ' }, BUILDING_DEFAULTABLE_COLUMNS)).toEqual({})
  })

  it('值两端空白被去掉', () => {
    expect(sanitizeBatchDefaults({ 城市: '  上海  ' }, BUILDING_DEFAULTABLE_COLUMNS)).toEqual({ 城市: '上海' })
  })

  it('非字符串值一律丢弃', () => {
    expect(sanitizeBatchDefaults({ 城市: 123, 行政区: null }, BUILDING_DEFAULTABLE_COLUMNS)).toEqual({})
  })

  it('非对象输入返回空', () => {
    expect(sanitizeBatchDefaults(null, BUILDING_DEFAULTABLE_COLUMNS)).toEqual({})
    expect(sanitizeBatchDefaults('城市=上海', BUILDING_DEFAULTABLE_COLUMNS)).toEqual({})
  })
})

describe('applyBatchDefaults', () => {
  const rows = [
    { 楼盘编号: 'B-1', 城市: '', 行政区: '黄浦区' },
    { 楼盘编号: 'B-2', 城市: '杭州', 行政区: '' },
  ]

  it('只填空单元格', () => {
    const out = applyBatchDefaults(rows, { 城市: '上海' })
    expect(out[0].城市).toBe('上海')
    expect(out[1].城市).toBe('杭州')
  })

  it('行内有值一律不覆盖——默认值是省事，不是批量改写', () => {
    const out = applyBatchDefaults(rows, { 行政区: '徐汇区' })
    expect(out[0].行政区).toBe('黄浦区')
    expect(out[1].行政区).toBe('徐汇区')
  })

  it('纯空白的单元格视为空，会被填充', () => {
    const out = applyBatchDefaults([{ 城市: '   ' }], { 城市: '上海' })
    expect(out[0].城市).toBe('上海')
  })

  it('缺键的单元格也会被填充', () => {
    const out = applyBatchDefaults([{ 楼盘编号: 'B-9' }], { 城市: '上海' })
    expect(out[0].城市).toBe('上海')
  })

  it('不改动入参——调用方还要拿原始行做错误报告的 rawValue 回显', () => {
    const original = [{ 城市: '' }]
    applyBatchDefaults(original, { 城市: '上海' })
    expect(original[0].城市).toBe('')
  })

  it('没有默认值时原样返回（但仍是新对象）', () => {
    const out = applyBatchDefaults(rows, {})
    expect(out).toEqual(rows)
    expect(out[0]).not.toBe(rows[0])
  })
})

describe('parseBatchDefaults', () => {
  it('解析 JSON 并按白名单收窄', () => {
    const out = parseBatchDefaults('{"城市":"上海","房源编号":"X"}', BUILDING_DEFAULTABLE_COLUMNS)
    expect(out).toEqual({ 城市: '上海' })
  })

  it('坏 JSON 当成「没设默认值」，不让整批失败', () => {
    expect(parseBatchDefaults('{不是JSON', BUILDING_DEFAULTABLE_COLUMNS)).toEqual({})
  })

  it('空串与非字符串返回空', () => {
    expect(parseBatchDefaults('', BUILDING_DEFAULTABLE_COLUMNS)).toEqual({})
    expect(parseBatchDefaults(undefined, BUILDING_DEFAULTABLE_COLUMNS)).toEqual({})
  })
})

describe('向后兼容：新增模板列不得让旧表格被拒收', () => {
  /**
   * `parseWorkbook` 对期望列做「一个都不能少」的硬校验。OPT-045 往两张模板各加了
   * 五、六列，如果解析时也要求它们，**运营手上所有已有表格会被整份拒收**
   *（MISSING_COLUMNS），而那些表格本身完全合法。
   *
   * 这条不是假想：本工作项最初就是直接往 XXX_COLUMNS 加列，e2e 的 bulk-import.spec
   * 立刻红了（夹具就是一份旧格式表）。当时注释、提交信息、单测里都写着
   * 「旧表格原样继续可用」——那是没验证过的断言。这条测试把它变成可执行的约束。
   */
  it('楼盘必需列恰好是 OPT-041 的原八列', async () => {
    const { REQUIRED_BUILDING_COLUMNS, BUILDING_COLUMNS } = await import(
      '@/domain/supply-import/building-row'
    )
    expect(REQUIRED_BUILDING_COLUMNS).toEqual([
      '楼盘编号', '楼盘名称', '城市', '行政区', '商圈', '地址', '总楼层', '总建筑面积',
    ])
    // 必需列必须是模板列的前缀——顺序也要一致，否则模板下载与解析对不上
    expect(BUILDING_COLUMNS.slice(0, REQUIRED_BUILDING_COLUMNS.length)).toEqual(
      REQUIRED_BUILDING_COLUMNS,
    )
  })

  it('房源必需列恰好是 OPT-041 的原九列', async () => {
    const { REQUIRED_LISTING_COLUMNS, LISTING_COLUMNS } = await import(
      '@/domain/supply-import/listing-row'
    )
    expect(REQUIRED_LISTING_COLUMNS).toEqual([
      '房源编号', '房源标题', '房源类型', '楼盘编号或标识', '面积', '租金', '楼层', '装修', '可租日期',
    ])
    expect(LISTING_COLUMNS.slice(0, REQUIRED_LISTING_COLUMNS.length)).toEqual(
      REQUIRED_LISTING_COLUMNS,
    )
  })

  it('OPT-045 新增的列一律不在必需列里', async () => {
    const { REQUIRED_BUILDING_COLUMNS } = await import('@/domain/supply-import/building-row')
    const { REQUIRED_LISTING_COLUMNS } = await import('@/domain/supply-import/listing-row')
    for (const col of ['供给商户', '等级', '竣工年份', '最近地铁', '在售单价']) {
      expect(REQUIRED_BUILDING_COLUMNS, `「${col}」不该是必需列`).not.toContain(col)
    }
    for (const col of ['供给商户', '售价', '产权年限', '满五唯一', '车位', '税费承担']) {
      expect(REQUIRED_LISTING_COLUMNS, `「${col}」不该是必需列`).not.toContain(col)
    }
  })
})

describe('可设默认值的列必须是模板列的子集', () => {
  // 不是形式主义：白名单里写了一个模板没有的列，运营填了也永远没人读，
  // 而界面上它看起来完全正常——这类「填了没用」的功能最消耗信任。
  it('楼盘', async () => {
    const { BUILDING_COLUMNS } = await import('@/domain/supply-import/building-row')
    for (const col of BUILDING_DEFAULTABLE_COLUMNS) {
      expect(BUILDING_COLUMNS, `「${col}」不在楼盘模板列里`).toContain(col)
    }
  })

  it('房源', async () => {
    const { LISTING_COLUMNS } = await import('@/domain/supply-import/listing-row')
    for (const col of LISTING_DEFAULTABLE_COLUMNS) {
      expect(LISTING_COLUMNS, `「${col}」不在房源模板列里`).toContain(col)
    }
  })
})
