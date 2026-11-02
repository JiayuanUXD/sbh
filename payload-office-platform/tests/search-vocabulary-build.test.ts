import { describe, expect, it } from 'vitest'

import { buildSearchVocabulary, groupAliasRows, initialsOf, pinyinOf } from '@/domain/search/vocabulary-build'

describe('pinyinOf / initialsOf', () => {
  it('常见楼盘名', () => {
    expect(pinyinOf('上海中心')).toBe('shanghaizhongxin')
    expect(initialsOf('上海中心')).toBe('shzx')
    expect(pinyinOf('陆家嘴')).toBe('lujiazui')
    expect(initialsOf('静安寺')).toBe('jas')
  })

  it('多音字回归：长宁 / 银行 / 重庆 / 厦门 / 蚌埠', () => {
    expect(pinyinOf('长宁')).toBe('changning')
    expect(initialsOf('长宁')).toBe('cn')
    expect(pinyinOf('银行')).toBe('yinhang')
    expect(pinyinOf('重庆')).toBe('chongqing')
    expect(pinyinOf('厦门')).toBe('xiamen')
    expect(pinyinOf('蚌埠')).toBe('bengbu')
  })
})

describe('buildSearchVocabulary', () => {
  it('附加别名并去重', () => {
    const vocab = buildSearchVocabulary([
      { kind: 'building', id: 1, slug: 'shanghai-tower', name: '上海中心', parent_name: '陆家嘴' },
      { kind: 'building', id: 1, slug: 'shanghai-tower', name: '上海中心', parent_name: '陆家嘴' },
      { kind: 'district', id: 2, slug: 'jingan', name: '静安', parent_name: '上海' },
    ], 'shanghai')

    expect(vocab.city).toBe('shanghai')
    expect(vocab.entries).toHaveLength(2)
    expect(vocab.entries[0]).toMatchObject({
      kind: 'building',
      name: '上海中心',
      parentName: '陆家嘴',
      pinyin: 'shanghaizhongxin',
      initials: 'shzx',
    })
    expect(vocab.entries[0]?.aliases).toContain('上海中心大厦')
    expect(vocab.entries[1]?.aliases).toEqual([])
  })

  describe('运营维护的别名（search-aliases 集合）', () => {
    const rows = [
      { kind: 'building', id: 1, slug: 'ifc', name: '上海国金中心', parent_name: '陆家嘴' },
      { kind: 'district', id: 2, slug: 'jingan', name: '静安', parent_name: '上海' },
    ] as const

    it('按规范名并入，排在代码里的别名之后', () => {
      const vocab = buildSearchVocabulary(rows, 'shanghai', { 上海国金中心: ['国金', '浦东国金'] })
      expect(vocab.entries[0]?.aliases).toEqual(['国金中心', 'IFC', '国金', '浦东国金'])
      expect(vocab.entries[1]?.aliases).toEqual([])
    })

    it('与代码别名重复的、与规范名相同的、空白的都丢掉；重复只留一个', () => {
      const vocab = buildSearchVocabulary(rows, 'shanghai', {
        上海国金中心: ['IFC', 'ifc', '上海国金中心', '  ', '国金', '国金'],
      })
      // IFC / ifc 比较键相同（nameKey 小写去空白）
      expect(vocab.entries[0]?.aliases).toEqual(['国金中心', 'IFC', '国金'])
    })

    it('没有对应实体的规范名被忽略，不报错', () => {
      const vocab = buildSearchVocabulary(rows, 'shanghai', { 不存在的楼: ['别名'] })
      expect(vocab.entries.map((entry) => entry.aliases.length)).toEqual([2, 0])
    })

    it('不传第三个参数时行为不变', () => {
      expect(buildSearchVocabulary(rows, 'shanghai').entries[0]?.aliases).toEqual(['国金中心', 'IFC'])
    })

    it('不修改传入的别名表', () => {
      const extra = { 上海国金中心: ['国金'] }
      buildSearchVocabulary(rows, 'shanghai', extra)
      expect(extra).toEqual({ 上海国金中心: ['国金'] })
    })
  })
})

describe('groupAliasRows', () => {
  it('按规范名分组，保持行顺序', () => {
    expect(
      groupAliasRows([
        { canonical_name: '上海国金中心', alias: '国金' },
        { canonical_name: '陆家嘴', alias: '小陆' },
        { canonical_name: '上海国金中心', alias: '浦东国金' },
      ]),
    ).toEqual({ 上海国金中心: ['国金', '浦东国金'], 陆家嘴: ['小陆'] })
  })

  it('空表得到空对象；缺字段 / 非字符串的行被忽略', () => {
    expect(groupAliasRows([])).toEqual({})
    expect(
      groupAliasRows([
        { canonical_name: '陆家嘴', alias: null },
        { canonical_name: null, alias: '别名' },
        { canonical_name: '陆家嘴', alias: '小陆' },
      ] as never),
    ).toEqual({ 陆家嘴: ['小陆'] })
  })
})

