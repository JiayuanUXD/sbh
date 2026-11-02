import { describe, expect, it } from 'vitest'

import { expandSearchTerms } from '@/domain/search/expand'
import type { SearchVocabulary } from '@/domain/search/vocabulary'
import { testVocabulary } from './search-fixtures'

describe('expandSearchTerms', () => {
  it('拼音扩展成中文实体名', () => {
    expect(expandSearchTerms(['lujiazui', '整层'], testVocabulary)).toEqual({
      listingTerms: ['陆家嘴', '整层'],
      buildingIds: [],
      resolved: [expect.objectContaining({ name: '陆家嘴', kind: 'businessArea' })],
    })
  })

  it('首字母与别名都能扩展，并带出楼盘 id', () => {
    const byInitials = expandSearchTerms(['shzx'], testVocabulary)
    expect(byInitials.listingTerms).toEqual(['上海中心'])
    expect(byInitials.buildingIds).toEqual([2])
    expect(byInitials.resolved[0]?.name).toBe('上海中心')

    const byAlias = expandSearchTerms(['IFC'], testVocabulary)
    expect(byAlias.listingTerms).toEqual(['上海国金中心'])
    expect(byAlias.buildingIds).toEqual([3])
  })

  it('中文词保持原词', () => {
    expect(expandSearchTerms(['陆家嘴'], testVocabulary).listingTerms).toEqual(['陆家嘴'])
  })

  it('扩展结果去重，不重复写入同一个词或 id', () => {
    const expanded = expandSearchTerms(['shzx', '上海中心'], testVocabulary)
    expect(expanded.listingTerms).toEqual(['上海中心'])
    expect(expanded.buildingIds).toEqual([2])
  })

  it('同音歧义只取排序第一的实体进查询，但保留全部候选供消歧', () => {
    const expanded = expandSearchTerms(['jingan'], testVocabulary)
    expect(expanded.listingTerms).toEqual(['静安'])
    expect(expanded.resolved.map((entry) => entry.name)).toEqual(['静安', '静安站'])
  })

  it('无法解析的词原样保留', () => {
    expect(expandSearchTerms(['不存在'], testVocabulary).listingTerms).toEqual(['不存在'])
  })

  it('不修改输入数组', () => {
    const terms = ['shzx']
    expandSearchTerms(terms, testVocabulary)
    expect(terms).toEqual(['shzx'])
  })
})

describe('expandSearchTerms：2–3 字中文别名（运营在后台加的「小陆」之类）', () => {
  // 别名不含在规范名里，原样 ILIKE 搜不到；必须在扩展阶段换成规范名
  const withAlias: SearchVocabulary = {
    city: 'shanghai',
    entries: testVocabulary.entries.map((entry) =>
      entry.name === '陆家嘴' ? { ...entry, aliases: [...entry.aliases, '小陆', '陆嘴区'] } : entry,
    ),
  }

  it('整词等于中文别名时换成规范名，并带出候选', () => {
    const expanded = expandSearchTerms(['小陆'], withAlias)
    expect(expanded.listingTerms).toEqual(['陆家嘴'])
    expect(expanded.resolved.map((entry) => entry.name)).toEqual(['陆家嘴'])
  })

  it('3 字别名同理，多词里逐词处理', () => {
    expect(expandSearchTerms(['陆嘴区', '整层'], withAlias).listingTerms).toEqual(['陆家嘴', '整层'])
  })

  it('名称本身、名称前缀不被当成别名替换（「上海」不能变成某个具体楼盘）', () => {
    expect(expandSearchTerms(['陆家嘴'], withAlias).listingTerms).toEqual(['陆家嘴'])
    expect(expandSearchTerms(['上海'], withAlias).listingTerms).toEqual(['上海'])
  })

  it('不是任何别名的中文词保持原样', () => {
    expect(expandSearchTerms(['小张'], withAlias).listingTerms).toEqual(['小张'])
  })
})

