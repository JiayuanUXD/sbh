import { describe, expect, it } from 'vitest'

import { resolveVocabularyTerm } from '@/domain/search/vocabulary'
import { testVocabulary } from './search-fixtures'

const names = (term: string) => resolveVocabularyTerm(testVocabulary, term).map((entry) => entry.name)

describe('resolveVocabularyTerm', () => {
  it('名称全等', () => {
    expect(names('上海中心')).toEqual(['上海中心'])
  })

  it('全拼全等', () => {
    expect(names('lujiazui')).toEqual(['陆家嘴'])
  })

  it('首字母全等', () => {
    expect(names('shzx')).toEqual(['上海中心'])
  })

  it('别名全等，大小写不敏感', () => {
    expect(names('IFC')).toEqual(['上海国金中心'])
    expect(names('ifc')).toEqual(['上海国金中心'])
    expect(names('国金中心')).toEqual(['上海国金中心'])
  })

  it('名称前缀命中多个时按类型与名称长度排序', () => {
    expect(names('上海')).toEqual(['上海中心', '上海国金中心'])
  })

  it('同音歧义返回全部，不静默取第一个', () => {
    expect(names('jingan')).toEqual(['静安', '静安站'])
  })

  it('只返回当前城市词表里的实体', () => {
    expect(names('changning')).toEqual(['长宁'])
    expect(names('changning')).not.toContain('常宁')
  })

  it('空词与未知词返回空数组', () => {
    expect(names('')).toEqual([])
    expect(names('不存在的地方')).toEqual([])
  })

  it('单字不做首字母/前缀匹配，避免噪音', () => {
    expect(names('s')).toEqual([])
  })
})
