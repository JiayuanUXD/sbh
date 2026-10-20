import { describe, expect, it } from 'vitest'

import { buildSearchVocabulary, initialsOf, pinyinOf } from '@/domain/search/vocabulary-build'

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
})
