import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { lintArticle, lintCover, loadArticleFiles, parseArticleFile, toArticleData } from '../scripts/lib/article-content'

const DIR = path.resolve(__dirname, '../content/articles')

describe('content/articles 资讯内容文件', () => {
  const articles = loadArticleFiles(DIR)

  it('至少有 6 篇，slug 唯一，站内资讯链接全部可达（loadArticleFiles 已校验）', () => {
    expect(articles.length).toBeGreaterThanOrEqual(6)
    expect(new Set(articles.map((a) => a.slug)).size).toBe(articles.length)
  })

  // 规则本身（篇幅、SEO 字段、套话、模板小标题、粗体、末尾声明、电话 / 占位符 / 绝对化用语、封面规格）
  // 在 scripts/lib/article-content.ts，日更流水线发布前用同一份；规则的正反例见 tests/article-content-lint.test.ts。
  it.each(articles.map((a) => [a.slug, a] as const))('%s：通过内容规则', (_slug, a) => {
    expect(lintArticle(a)).toEqual([])
  })

  it('导入数据：草稿不写发布时间，发布时补 publishedAt，且不带封面与首页主推', () => {
    const now = new Date('2026-10-16T08:00:00.000Z')
    const draft = toArticleData(articles[0], { status: 'draft', now })
    expect(draft).not.toHaveProperty('publishedAt')
    expect(draft).toMatchObject({ status: 'draft', seo: { title: articles[0].seoTitle } })
    const published = toArticleData(articles[0], { status: 'published', now })
    expect(published.publishedAt).toBe('2026-10-16T08:00:00.000Z')
    // 重复导入：已有发布时间时保留，不被本次运行时刻覆盖
    const again = toArticleData(articles[0], { status: 'published', now, existingPublishedAt: '2026-09-01T00:00:00.000Z' })
    expect(again.publishedAt).toBe('2026-09-01T00:00:00.000Z')
    for (const data of [draft, published]) {
      expect(data).not.toHaveProperty('coverImage')
      expect(data).not.toHaveProperty('isHomeFeatured')
    }
  })

  it.each(articles.map((a) => [a.slug, a] as const))('%s：封面是 16:9、体积适中，且有替代文本', async (_slug, a) => {
    expect(await lintCover(DIR, a)).toEqual([])
  })

  it('frontmatter 校验：文件名与 slug 不一致、分类非法都会报错', () => {
    const base = '---\nslug: a-b\ntitle: t\ncategory: guide\nexcerpt: e\nseoTitle: s\nseoDescription: d\n---\n## h\n\n正文\n'
    expect(() => parseArticleFile(base, 'other.md')).toThrow('文件名必须与 slug 一致')
    expect(() => parseArticleFile(base.replace('guide', 'news'), 'a-b.md')).toThrow('category')
    expect(() => parseArticleFile(base.replace('slug: a-b\n', ''), 'a-b.md')).toThrow('缺少 slug')
  })
})
