/**
 * 拼音「窗口」匹配：用户只打名字中间 / 后半段的拼音（「上海 zhongxin」）。
 *
 * 此前拼音只支持「整个名字的拼音」或「名字拼音的开头」，`zhongxin` 是 `shanghaizhongxin`
 * 的后半截，两种都不命中，词项原样去 ILIKE，AND 失败后放宽把它丢掉，只剩「上海」撑出几百条。
 *
 * 规则：按音节对齐（不能从音节中间起匹配）；至少 4 个字母（短了是噪音）；
 * 优先级最低（整词、别名、全拼、首字母、前缀都没命中才用）。
 */

import { describe, expect, it } from 'vitest'

import { expandSearchTerms } from '@/domain/search/expand'
import { resolveFuzzyAuto } from '@/domain/search/fuzzy'
import { resolveVocabularyTerm } from '@/domain/search/vocabulary'
import { buildSearchVocabulary } from '@/domain/search/vocabulary-build'

const vocab = buildSearchVocabulary(
  [
    { kind: 'building', id: 1, slug: 'cn-center', name: '东中心', parent_name: '虹桥' },
    { kind: 'building', id: 2, slug: 'shanghai-tower', name: '上海中心', parent_name: '陆家嘴' },
    { kind: 'building', id: 3, slug: 'ifc', name: '上海国金中心', parent_name: '陆家嘴' },
    { kind: 'businessArea', id: 4, slug: 'lujiazui', name: '陆家嘴', parent_name: '浦东新区' },
    { kind: 'district', id: 5, slug: 'jingan', name: '静安', parent_name: '上海' },
  ],
  'shanghai',
)

const names = (term: string) => resolveVocabularyTerm(vocab, term).map((entry) => entry.name)
const fuzzy = (term: string) => resolveFuzzyAuto(vocab, term).map((entry) => entry.name)

describe('拼音窗口（统一模糊匹配器的自动模式）', () => {
  it('后半截拼音能命中，同为楼盘按名称长度排序（不依赖 localeCompare，它随运行环境的排序规则变）', () => {
    expect(fuzzy('zhongxin')).toEqual(['东中心', '上海中心', '上海国金中心'])
  })

  it('中间一段、带不完整的最后一个音节也行', () => {
    expect(fuzzy('guojin')).toEqual(['上海国金中心'])
    expect(fuzzy('guojinzhongx')).toEqual(['上海国金中心'])
  })

  it('必须按音节对齐：不能从音节中间开始', () => {
    expect(fuzzy('hongxin')).toEqual([]) // zhong 的中间
    expect(fuzzy('ongxi')).toEqual([])
  })

  it('证据不够不做窗口匹配（噪音）：一个完整音节 / 半个音节都不够', () => {
    expect(fuzzy('xin')).toEqual([])
    expect(fuzzy('zhon')).toEqual([])
  })

  it('优先级最低：整词全拼 / 前缀命中时不走窗口', () => {
    expect(names('shanghaizhongxin')).toEqual(['上海中心'])
    expect(names('shanghai')).toEqual(['上海中心', '上海国金中心'])
  })

  it('没有音节信息的词条（旧缓存 / 夹具）不参与窗口匹配，不报错', () => {
    const legacy = {
      city: 'shanghai',
      entries: vocab.entries.map(({ syllables: _syllables, ...rest }) => rest),
    }
    expect(resolveFuzzyAuto(legacy, 'zhongxin')).toEqual([])
  })
})

describe('expandSearchTerms：拼音窗口 + 同句里的中文上下文', () => {
  it('「上海 zhongxin」选名字里带「上海」的候选，而不是排序第一的「东中心」', () => {
    const expanded = expandSearchTerms(['上海', 'zhongxin'], vocab)
    expect(expanded.listingTerms).toEqual(['上海', '上海中心'])
    // 全部候选仍保留，供「你是不是想找」展示
    expect(expanded.resolved.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(['东中心', '上海中心', '上海国金中心']),
    )
  })

  it('上下文也看所属商圈 / 行政区（parentName）', () => {
    const expanded = expandSearchTerms(['陆家嘴', 'zhongxin'], vocab)
    expect(expanded.listingTerms).toEqual(['陆家嘴', '上海中心'])
  })

  it('没有中文上下文时仍取排序第一的候选', () => {
    expect(expandSearchTerms(['zhongxin'], vocab).listingTerms).toEqual(['东中心'])
  })

  it('上下文没有任何候选命中时回退到排序第一', () => {
    expect(expandSearchTerms(['浦东', 'zhongxin'], vocab).listingTerms).toEqual(['浦东', '东中心'])
  })
})

describe('expandSearchTerms：精确档（拼音前缀）有候选时，中文上下文仍要能选中模糊匹配的候选', () => {
  // 线上形态：有楼盘的拼音以 zhongxin 开头（中心大厦），走更高优先级的「拼音前缀」档，
  // 档内没有一个名字带「上海」，上下文选不出东西，于是「上海 zhongxin」选了无关的「中心大厦」。
  const withPrefixEntry = buildSearchVocabulary(
    [
      { kind: 'building', id: 20, slug: 'zx-dasha', name: '中心大厦', parent_name: '浦东新区' },
      { kind: 'building', id: 2, slug: 'shanghai-tower', name: '上海中心', parent_name: '陆家嘴' },
      { kind: 'building', id: 3, slug: 'ifc', name: '上海国金中心', parent_name: '陆家嘴' },
    ],
    'shanghai',
  )

  it('没有上下文：拼音前缀档优先，行为不变', () => {
    expect(expandSearchTerms(['zhongxin'], withPrefixEntry).listingTerms).toEqual(['中心大厦'])
  })

  it('有上下文「上海」：选名字带上海的上海中心，而不是前缀档里的中心大厦', () => {
    expect(expandSearchTerms(['上海', 'zhongxin'], withPrefixEntry).listingTerms).toEqual(['上海', '上海中心'])
  })

  it('上下文在前缀档里就有命中时，仍选前缀档的（不被模糊候选抢走）', () => {
    expect(expandSearchTerms(['浦东', 'zhongxin'], withPrefixEntry).listingTerms).toEqual(['浦东', '中心大厦'])
  })

  it('整词全拼 / 首字母命中时不引入模糊候选：「上海」上下文不会把 shzx 改选成别的', () => {
    expect(expandSearchTerms(['陆家嘴', 'shzx'], withPrefixEntry).listingTerms).toEqual(['陆家嘴', '上海中心'])
  })
})

