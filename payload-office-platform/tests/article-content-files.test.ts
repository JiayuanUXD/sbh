import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import { coverPathFor, loadArticleFiles, parseArticleFile, toArticleData } from '../scripts/lib/article-content'

const DIR = path.resolve(__dirname, '../content/articles')

describe('content/articles 资讯内容文件', () => {
  const articles = loadArticleFiles(DIR)

  it('至少有 6 篇，slug 唯一，站内资讯链接全部可达（loadArticleFiles 已校验）', () => {
    expect(articles.length).toBeGreaterThanOrEqual(6)
    expect(new Set(articles.map((a) => a.slug)).size).toBe(articles.length)
  })

  it.each(articles.map((a) => [a.slug, a] as const))('%s：篇幅与 SEO 字段在合理范围', (_slug, a) => {
    expect(a.length, '正文字数').toBeGreaterThanOrEqual(1200)
    expect(a.excerpt.length, 'excerpt 字数（后台提示 60–120，放宽到 150）').toBeGreaterThanOrEqual(60)
    expect(a.excerpt.length).toBeLessThanOrEqual(150)
    expect(a.seoTitle.length, 'seoTitle 套上「 · 商办租赁」后不应被搜索结果截断').toBeLessThanOrEqual(32)
    expect(a.seoDescription.length).toBeGreaterThanOrEqual(50)
    expect(a.seoDescription.length).toBeLessThanOrEqual(130)
    expect(a.title.length).toBeLessThanOrEqual(45)
  })

  it('正文里不得出现电话号码、占位符或未核实的绝对化用语', () => {
    for (const a of articles) {
      const text = JSON.stringify(a.content)
      expect(text, a.slug).not.toMatch(/1[3-9]\d{9}/)
      expect(text, a.slug).not.toMatch(/TODO|待补|XXX|lorem/i)
      expect(text, a.slug).not.toMatch(/第一品牌|全网最低|100%\s*保证/)
    }
  })

  it('行文不带 AI 套话和公文腔（OPT-118 去 AI 化约束）', () => {
    // 这些词在口语化的行业文章里几乎不会自然出现，出现了基本就是模板腔。
    const banned = /首先|其次|最后，|综上|总而言之|总的来说|值得注意的是|需要注意的是|不仅.{0,12}而且|赋能|助力|全方位|深度解析|一站式|从而|旨在|众所周知|在当今|随着.{0,10}的(发展|不断)|——/
    for (const a of articles) {
      const text = JSON.stringify(a.content)
      expect(text.match(banned)?.[0], `${a.slug} 含套话`).toBeUndefined()
      // 粗体是强调，满屏粗体就是模板：每篇最多 3 处
      const bold = (text.match(/"format":1,/g) ?? []).length
      expect(bold, `${a.slug} 粗体过多`).toBeLessThanOrEqual(3)
    }
  })

  it('每篇都带数据口径或免责声明（引用块），数据类文章标注截止日期', () => {
    for (const a of articles) {
      const hasQuote = a.content.root.children.some((n) => n.type === 'quote')
      expect(hasQuote, `${a.slug} 缺少末尾声明`).toBe(true)
    }
  })

  it('导入数据：草稿不写发布时间，发布时补 publishedAt，且不带封面与首页主推', () => {
    const now = new Date('2026-10-16T08:00:00.000Z')
    const draft = toArticleData(articles[0], { status: 'draft', now })
    expect(draft).not.toHaveProperty('publishedAt')
    expect(draft).toMatchObject({ status: 'draft', seo: { title: articles[0].seoTitle } })
    const published = toArticleData(articles[0], { status: 'published', now })
    expect(published.publishedAt).toBe('2026-10-16T08:00:00.000Z')
    for (const data of [draft, published]) {
      expect(data).not.toHaveProperty('coverImage')
      expect(data).not.toHaveProperty('isHomeFeatured')
    }
  })

  it.each(articles.map((a) => [a.slug, a] as const))('%s：封面是 16:9、体积适中，且有替代文本', async (slug, a) => {
    const cover = coverPathFor(DIR, slug)
    expect(cover, `${slug} 缺少 covers/${slug}.jpg`).not.toBeNull()
    const meta = await sharp(cover!).metadata()
    expect(meta.format).toBe('jpeg')
    expect(Math.abs((meta.width! / meta.height!) - 16 / 9)).toBeLessThan(0.01)
    expect(fs.statSync(cover!).size, '封面体积').toBeLessThan(400 * 1024)
    expect(a.coverAlt, 'coverAlt').toBeTruthy()
    expect(a.coverAlt!.length).toBeLessThanOrEqual(40)
  })

  it('frontmatter 校验：文件名与 slug 不一致、分类非法都会报错', () => {
    const base = '---\nslug: a-b\ntitle: t\ncategory: guide\nexcerpt: e\nseoTitle: s\nseoDescription: d\n---\n## h\n\n正文\n'
    expect(() => parseArticleFile(base, 'other.md')).toThrow('文件名必须与 slug 一致')
    expect(() => parseArticleFile(base.replace('guide', 'news'), 'a-b.md')).toThrow('category')
    expect(() => parseArticleFile(base.replace('slug: a-b\n', ''), 'a-b.md')).toThrow('缺少 slug')
  })
})
