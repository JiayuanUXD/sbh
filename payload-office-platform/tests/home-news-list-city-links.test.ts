import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import HomeNewsList from '@/components/frontend/home/HomeNewsList'
import type { ArticleCardViewModel } from '@/domain/public-catalog/contracts'

/**
 * 回归：修复前 HomeNewsList 在组件内手拼 `${prefix}/news` /
 * `${prefix}/news/${slug}`，而 `src/app/(frontend)/[city]/` 下根本没有 news
 * 路由——`/shanghai/news` 实测 404，`/news` 才是真实存在的路由。
 * `city-routes.ts` 的 `buildCityPath` 对 pageType 'news' 明确恒返回 '/news'
 * （不带城市前缀），本用例锁死首页资讯区块产出的链接与这个事实源保持一致，
 * 不再退回城市前缀那个死链。
 */
const articles: readonly ArticleCardViewModel[] = [
  {
    id: 31,
    slug: 'news-31',
    title: '首页改版上线',
    category: null,
    excerpt: null,
    coverImage: null,
    publishedAt: '2026-08-01T00:00:00.000Z',
    stableSortKey: 'article-31',
  },
]

describe('HomeNewsList 资讯链接不带城市前缀', () => {
  it('prefixed 路由（citySlug=shanghai）下「更多资讯」与逐条链接仍指向 /news，不拼城市前缀', () => {
    const html = renderToStaticMarkup(
      createElement(HomeNewsList, { articles, citySlug: 'shanghai' }),
    )
    expect(html).toContain('href="/news"')
    expect(html).toContain('href="/news/news-31"')
    expect(html).not.toContain('href="/shanghai/news"')
    expect(html).not.toContain('href="/shanghai/news/news-31"')
  })

  it('legacy 路由（citySlug 未传）下同样指向 /news', () => {
    const html = renderToStaticMarkup(createElement(HomeNewsList, { articles }))
    expect(html).toContain('href="/news"')
    expect(html).toContain('href="/news/news-31"')
  })
})

const makeArticle = (id: number, publishedAt: string | null): ArticleCardViewModel => ({
  id,
  slug: `news-${id}`,
  title: `资讯 ${id}`,
  category: null,
  excerpt: null,
  coverImage: null,
  publishedAt,
  stableSortKey: `article-${id}`,
})

describe('HomeNewsList 首页资讯布局', () => {
  it('单独展示后台主推文章，右侧仍保留包含该文章的最新五条并按发布时间倒序', () => {
    const latest = Object.freeze([
      makeArticle(3, '2026-08-03T00:00:00.000Z'),
      makeArticle(1, '2026-08-01T00:00:00.000Z'),
      makeArticle(6, '2026-08-06T00:00:00.000Z'),
      makeArticle(2, '2026-08-02T00:00:00.000Z'),
      makeArticle(5, '2026-08-05T00:00:00.000Z'),
      makeArticle(4, '2026-08-04T00:00:00.000Z'),
    ])
    const html = renderToStaticMarkup(createElement(HomeNewsList, {
      articles: latest,
      featuredArticle: latest[0],
    }))

    expect(html).toMatch(/class="hm-news__featured"[^>]*href="\/news\/news-3"/)
    const rows = [...html.matchAll(/class="hm-news__row"[^>]*href="\/news\/news-(\d+)"/g)]
    expect(rows.map((match) => Number(match[1]))).toEqual([6, 5, 4, 3, 2])
    expect(html.match(/data-news-id="3"/g)).toHaveLength(2)
    expect(latest.map((article) => article.id)).toEqual([3, 1, 6, 2, 5, 4])
  })

  it('未配置主推时回退最新文章，并显示缺图占位与缺失日期', () => {
    const html = renderToStaticMarkup(createElement(HomeNewsList, {
      articles: [makeArticle(8, null), makeArticle(9, '2026-08-09T00:00:00.000Z')],
      featuredArticle: null,
    }))
    expect(html).toMatch(/class="hm-news__featured"[^>]*href="\/news\/news-9"/)
    expect(html).toMatch(/<h3 class="hm-news__featured-title">资讯 9<\/h3>/)
    expect(html).toContain('data-media-state="missing"')
    expect(html).toContain('>—</span>')
  })

  it('主推可来自列表以外，且保留主推及列表点击埋点', () => {
    const html = renderToStaticMarkup(createElement(HomeNewsList, {
      articles: [makeArticle(2, '2026-08-02T00:00:00.000Z')],
      featuredArticle: {
        ...makeArticle(10, '2026-07-01T00:00:00.000Z'),
        coverImage: { src: '/media/news-10.jpg', alt: '资讯封面' },
      },
    }))
    expect(html).toContain('href="/news/news-10"')
    expect(html).toContain('src="/media/news-10.jpg"')
    expect(html).toContain('data-news-id="10"')
    expect(html.match(/data-event-name="home_news_click"/g)).toHaveLength(2)
  })

  it('无任何可展示文章时隐藏区块', () => {
    expect(renderToStaticMarkup(createElement(HomeNewsList, { articles: [] }))).toBe('')
  })
})
