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
