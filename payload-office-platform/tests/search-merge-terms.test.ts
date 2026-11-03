/**
 * 相邻词项合并：空格把一个名字拆成了几个词项（「shanghai 中心」「上海 中心」「shang hai zhongxin」）。
 *
 * 各词项独立处理时，shanghai 被解析成城市「上海」，楼盘检索只拿「上海」去搜，「中心」被忽略。
 * 这里把相邻词项拼起来，整体对上某个实体的**完整名字**（名称 / 别名 / 整词全拼 / 首字母 / 整名对齐的
 * 拼音与混输）才合并；只对上名字的一部分（招商局上海中心 ⊃ 上海中心）不合并。
 */

import { describe, expect, it } from 'vitest'

import { mergeAdjacentTerms } from '@/domain/search/merge-terms'
import { buildSearchVocabulary } from '@/domain/search/vocabulary-build'

const vocab = buildSearchVocabulary(
  [
    { kind: 'city', id: 1, slug: 'shanghai', name: '上海', parent_name: null },
    { kind: 'building', id: 10, slug: 'shanghai-tower', name: '上海中心', parent_name: '陆家嘴' },
    { kind: 'building', id: 11, slug: 'zsj', name: '招商局上海中心', parent_name: '浦东新区' },
    { kind: 'building', id: 12, slug: 'ifc', name: '上海国金中心', parent_name: '陆家嘴' },
    { kind: 'metro', id: 31, slug: 'jingansi', name: '静安寺', parent_name: '2号线' },
    { kind: 'businessArea', id: 32, slug: 'nanjingxilu', name: '南京西路', parent_name: '静安区' },
    { kind: 'businessArea', id: 33, slug: 'lujiazui', name: '陆家嘴', parent_name: '浦东新区' },
  ],
  'shanghai',
)

const merge = (terms: string[]) => mergeAdjacentTerms(terms, vocab)

describe('mergeAdjacentTerms', () => {
  it('拼音 + 汉字：「shanghai 中心」→ 上海中心', () => {
    const result = merge(['shanghai', '中心'])
    expect(result.terms).toEqual(['上海中心'])
    expect(result.entityTerms).toEqual(['上海中心'])
    expect(result.entries.map((entry) => entry.name)).toEqual(['上海中心'])
  })

  it('全拼拆成两词：「shanghai zhongxin」「shang hai zhongxin」', () => {
    expect(merge(['shanghai', 'zhongxin']).terms).toEqual(['上海中心'])
    expect(merge(['shang', 'hai', 'zhongxin']).terms).toEqual(['上海中心'])
  })

  it('纯汉字名称被空格拆开：「上海 中心」「静安 寺」「南京 西路」', () => {
    expect(merge(['上海', '中心']).terms).toEqual(['上海中心'])
    expect(merge(['静安', '寺']).terms).toEqual(['静安寺'])
    expect(merge(['南京', '西路']).terms).toEqual(['南京西路'])
  })

  it('别名 / 首字母也行：「sh zx」', () => {
    expect(merge(['sh', 'zx']).terms).toEqual(['上海中心'])
  })

  it('只合并相邻的那一段，其它词项保持位置', () => {
    expect(merge(['shanghai', '中心', '整层']).terms).toEqual(['上海中心', '整层'])
    expect(merge(['整层', 'shanghai', '中心']).terms).toEqual(['整层', '上海中心'])
    expect(merge(['陆家嘴', 'shanghai', '中心']).terms).toEqual(['陆家嘴', '上海中心'])
  })

  it('顺序反了不合并：「zhongxin 上海」', () => {
    expect(merge(['zhongxin', '上海']).terms).toEqual(['zhongxin', '上海'])
  })

  it('只对上名字的一部分（实体词不合并）：纯汉字片段拼回去按片段匹配，不当成实体', () => {
    // 「上海国金」是「上海国金中心」的连续片段：拼成一个词项交给 ILIKE，而不是「上海」AND「国金」
    const result = merge(['上海', '国金'])
    expect(result.terms).toEqual(['上海国金'])
    expect(result.entityTerms).toEqual([])
    expect(result.entries).toEqual([])
  })

  it('片段至少 3 个字、且必须是某个名称的连续子串；不是连续子串的保持分开', () => {
    expect(merge(['上海', '大厦']).terms).toEqual(['上海', '大厦'])
    expect(merge(['陆家嘴', '整层']).terms).toEqual(['陆家嘴', '整层'])
  })

  it('拉丁片段（只对上名字一部分的拼音）不拼接：「shanghai guojin」', () => {
    expect(merge(['shanghai', 'guojin']).terms).toEqual(['shanghai', 'guojin'])
  })

  it('不相干的词项原样返回，没有实体 / 候选', () => {
    const result = merge(['陆家嘴', '整层'])
    expect(result.terms).toEqual(['陆家嘴', '整层'])
    expect(result.entityTerms).toEqual([])
    expect(result.entries).toEqual([])
  })

  it('单个词项原样返回（单词的处理不归这里）', () => {
    expect(merge(['shzx']).terms).toEqual(['shzx'])
    expect(merge(['上海中心']).terms).toEqual(['上海中心'])
  })

  it('不修改输入数组', () => {
    const terms = ['shanghai', '中心']
    merge(terms)
    expect(terms).toEqual(['shanghai', '中心'])
  })
})
