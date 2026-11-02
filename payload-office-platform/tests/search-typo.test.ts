/**
 * 错字纠错：对封闭词表（楼盘 / 商圈 / 地铁 / 行政区及其别名）做编辑距离匹配，
 * 只用于零结果时的「你是不是想找」，不自动改写查询。
 *
 * 不用 pg_trgm：TencentDB 是否允许装扩展没有闭环；词表是封闭的、量级小，内存里做完全够用。
 * 不用拼音：请求期不做 pinyin-pro 转换（见 vocabulary-build.ts），单字替换的错字已被编辑距离 1 覆盖。
 */

import { describe, expect, it } from 'vitest'

import { editDistance, suggestTypoCorrections } from '@/domain/search/typo'

import { testVocabulary } from './search-fixtures'

const names = (terms: string[]) => suggestTypoCorrections(terms, testVocabulary).map((entry) => entry.name)

describe('editDistance', () => {
  it('按码点计算，支持替换 / 插入 / 删除', () => {
    expect(editDistance('陆家嘴', '陆家嘴', 3)).toBe(0)
    expect(editDistance('陆加嘴', '陆家嘴', 3)).toBe(1)
    expect(editDistance('陆嘴', '陆家嘴', 3)).toBe(1)
    expect(editDistance('陆家家嘴', '陆家嘴', 3)).toBe(1)
    expect(editDistance('😀家', '😁家', 3)).toBe(1)
  })

  it('超过上限就返回 上限+1，不再继续算', () => {
    expect(editDistance('abcdef', 'uvwxyz', 1)).toBe(2)
  })
})

describe('suggestTypoCorrections', () => {
  it('单字错字：陆加嘴 → 陆家嘴', () => {
    expect(names(['陆加嘴'])).toEqual(['陆家嘴'])
  })

  it('两字名称也能纠：静按 → 静安', () => {
    expect(names(['静按'])).toEqual(['静安'])
  })

  it('漏字 / 多字', () => {
    expect(names(['陆嘴'])).toEqual(['陆家嘴'])
    expect(names(['上海中心心'])).toEqual(['上海中心'])
  })

  it('别名也参与匹配，返回规范实体', () => {
    expect(names(['国金中新'])).toEqual(['上海国金中心'])
  })

  it('已经是名称或别名的不算错字', () => {
    expect(names(['陆家嘴'])).toEqual([])
    expect(names(['国金中心'])).toEqual([])
  })

  it('3 字以内只容 1 处差异，6 字及以上容 2 处', () => {
    expect(names(['陆加最'])).toEqual([])
    expect(names(['上海国今中新'])).toEqual(['上海国金中心'])
  })

  it('含拉丁字母 / 数字、过短或过长的词项不处理', () => {
    expect(names(['ifc'])).toEqual([])
    expect(names(['陆'])).toEqual([])
    expect(names(['陆加嘴陆加嘴陆加嘴陆加嘴'])).toEqual([])
  })

  it('离得太远的词项没有建议', () => {
    expect(names(['整层办公室'])).toEqual([])
  })

  it('多个词项逐个纠，结果去重，最多 3 条', () => {
    expect(names(['陆加嘴', '陆加嘴'])).toEqual(['陆家嘴'])
    expect(names(['陆加嘴', '静按', '上海中新', '长守']).length).toBeLessThanOrEqual(3)
  })

  it('距离近的排前面；同距离按 楼盘 > 行政区 > 商圈 > 地铁', () => {
    // 「静安站」距 静安站 为 1（静按站）；距 静安 为 2，超过 3 字上限，不出
    expect(names(['静按站'])).toEqual(['静安站'])
  })

  it('不修改输入数组', () => {
    const terms = ['陆加嘴']
    suggestTypoCorrections(terms, testVocabulary)
    expect(terms).toEqual(['陆加嘴'])
  })
})
