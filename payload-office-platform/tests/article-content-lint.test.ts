import { describe, expect, it } from 'vitest'

import { lintArticle, parseArticleFile, resolveRelated, selectArticles, type SlugLookup } from '../scripts/lib/article-content'

/** 拼一篇刚好合规的文章：正文用同一句话重复凑够字数，末尾带引用声明。 */
function source(overrides: Readonly<Record<string, string>> = {}, body?: string): string {
  const meta: Record<string, string> = {
    slug: 'sample-article',
    title: '上海小办公室怎么挑',
    category: 'guide',
    excerpt: '小团队找办公室，面积、预算和区域怎么取舍。这篇按平台在租房源的挂牌价，把几个常见问题一次讲清楚，方便你直接拿去比。数据截至 2026 年 10 月。',
    seoTitle: '上海小办公室怎么挑：面积与预算',
    seoDescription: '上海小面积办公室怎么挑：按平台在租房源的挂牌价，讲清面积、预算和区域怎么取舍，附常见问题与看房提醒，数据截至 2026 年 10 月。',
    coverAlt: '采光明亮的小办公室',
    ...overrides,
  }
  const frontmatter = Object.entries(meta)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')
  const paragraph = '小团队找办公室，先想清楚每天几个人坐、客户会不会上门，再去看面积和价格，顺序反过来很容易多花钱。'
  const defaultBody = `## 先想清楚几个人坐\n\n${Array.from({ length: 30 }, () => paragraph).join('\n\n')}\n\n> 数据来自平台在租房源，仅供参考。\n`
  return `---\n${frontmatter}\n---\n${body ?? defaultBody}`
}

describe('parseArticleFile：关联商圈 / 楼盘', () => {
  it('没写关联字段时为 null（导入时不动库里已有的关联）', () => {
    const a = parseArticleFile(source(), 'sample-article.md')
    expect(a.relatedDistricts).toBeNull()
    expect(a.relatedBuildings).toBeNull()
  })

  it('逗号分隔的 slug 解析成数组，去掉空白', () => {
    const a = parseArticleFile(
      source({ relatedDistricts: 'huangpu, lujiazui', relatedBuildings: 'qian-tan-zhong-xin-248' }),
      'sample-article.md',
    )
    expect(a.relatedDistricts).toEqual(['huangpu', 'lujiazui'])
    expect(a.relatedBuildings).toEqual(['qian-tan-zhong-xin-248'])
  })

  it('写了但留空表示明确不关联', () => {
    const a = parseArticleFile(source({ relatedDistricts: '' }), 'sample-article.md')
    expect(a.relatedDistricts).toEqual([])
  })

  it('非法 slug 与重复 slug 直接报错', () => {
    expect(() => parseArticleFile(source({ relatedDistricts: 'Huang Pu' }), 'sample-article.md')).toThrow('relatedDistricts')
    expect(() => parseArticleFile(source({ relatedBuildings: 'a-1, a-1' }), 'sample-article.md')).toThrow('重复')
  })
})

describe('lintArticle：内容规则', () => {
  it('合规文章没有问题', () => {
    expect(lintArticle(parseArticleFile(source(), 'sample-article.md'))).toEqual([])
  })

  it('篇幅、摘要、SEO 字段、标题长度越界都会报出来', () => {
    const a = parseArticleFile(
      source(
        {
          excerpt: '太短的摘要',
          seoTitle: '这是一个明显超过三十二个字的搜索标题会被搜索结果截断掉的那种写法吧',
          seoDescription: '太短',
          title: '这是一个特别特别长的标题，长到超过四十五个字以后列表卡片和搜索结果都会把它截断，读者根本看不全',
        },
        '## 小标题\n\n正文太短。\n\n> 声明\n',
      ),
      'sample-article.md',
    )
    const problems = lintArticle(a).join('\n')
    expect(problems).toContain('正文')
    expect(problems).toContain('excerpt')
    expect(problems).toContain('seoTitle')
    expect(problems).toContain('seoDescription')
    expect(problems).toContain('title')
  })

  it('套话、破折号、模板小标题、粗体过多、缺末尾声明', () => {
    const filler = Array.from({ length: 30 }, () => '小团队找办公室，先想清楚每天几个人坐、客户会不会上门，再去看面积和价格。').join('\n\n')
    const body = `## 先说结论\n\n首先，**一**、**二**、**三**、**四**——都要看。\n\n${filler}\n`
    const problems = lintArticle(parseArticleFile(source({}, body), 'sample-article.md')).join('\n')
    expect(problems).toContain('套话「首先」')
    expect(problems).toContain('模板小标题「先说结论」')
    expect(problems).toContain('粗体 4 处')
    expect(problems).toContain('末尾声明')
  })

  it('电话号码、占位符、未核实的绝对化用语', () => {
    const filler = Array.from({ length: 30 }, () => '小团队找办公室，先想清楚每天几个人坐、客户会不会上门，再去看面积和价格。').join('\n\n')
    const body = `## 看房\n\n联系 13812345678，TODO 补数据，全网最低。\n\n${filler}\n\n> 声明\n`
    const problems = lintArticle(parseArticleFile(source({}, body), 'sample-article.md')).join('\n')
    expect(problems).toContain('电话')
    expect(problems).toContain('占位')
    expect(problems).toContain('绝对化')
  })

  it('封面替代文本不能写成 slug，也不能超过 40 字', () => {
    expect(lintArticle(parseArticleFile(source({ coverAlt: 'sample-article' }), 'sample-article.md')).join('\n')).toContain('coverAlt')
    expect(
      lintArticle(parseArticleFile(source({ coverAlt: '一'.repeat(41) }), 'sample-article.md')).join('\n'),
    ).toContain('coverAlt')
  })
})

describe('selectArticles：--only', () => {
  const a = parseArticleFile(source(), 'sample-article.md')
  const b = parseArticleFile(source({ slug: 'other-article' }), 'other-article.md')

  it('不带 --only 取全部；带了只取那一篇', () => {
    expect(selectArticles([a, b], undefined).map((x) => x.slug)).toEqual(['sample-article', 'other-article'])
    expect(selectArticles([a, b], 'other-article').map((x) => x.slug)).toEqual(['other-article'])
  })

  it('指定的 slug 不存在就报错，不会退回成全部', () => {
    expect(() => selectArticles([a, b], 'nope')).toThrow('--only=nope')
  })
})

describe('resolveRelated：slug → id', () => {
  const lookup: SlugLookup = async (kind, slug) => {
    const table: Record<string, number> = { 'location:huangpu': 11, 'location:lujiazui': 12, 'building:qian-tan-zhong-xin-248': 248 }
    return table[`${kind}:${slug}`] ?? null
  }

  it('全部查得到时按原顺序返回 id；字段缺省（null）时不出现在结果里', async () => {
    const a = parseArticleFile(source({ relatedDistricts: 'lujiazui, huangpu' }), 'sample-article.md')
    expect(await resolveRelated(a, lookup)).toEqual({ relatedDistricts: [12, 11] })
  })

  it('查不到的 slug 一次性列全再报错', async () => {
    const a = parseArticleFile(
      source({ relatedDistricts: 'huangpu, nowhere', relatedBuildings: 'missing-building' }),
      'sample-article.md',
    )
    await expect(resolveRelated(a, lookup)).rejects.toThrow(/nowhere.*missing-building|missing-building.*nowhere/s)
  })
})
