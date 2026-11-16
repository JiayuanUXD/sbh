import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => undefined }),
  usePathname: () => '/shanghai/search',
  useSearchParams: () => new URLSearchParams(),
}))

import SiteSearchView from '@/components/frontend/search/SiteSearchView'

/**
 * OPT-128 §5.7：站内搜索房源 / 楼盘页签也走封顶后的分页元数据。
 * page=51 时必须是越界空态，不能是「空列表 + 页码 51/50 的分页器」。
 */

const city = { slug: 'shanghai', name: '上海' } as never

const listingsOf = (page: number, totalPages: number, totalDocs: number, capped: boolean) =>
  ({
    result: {
      docs: [],
      pagination: { page, pageSize: 24, totalDocs, totalPages, hasNextPage: false, hasPrevPage: page > 1, capped },
    },
    query: { raw: '陆家嘴', normalized: '陆家嘴', terms: [] },
    terms: [],
    relaxed: false,
    relaxedTerms: [],
    resolved: [],
    corrections: [],
    intent: { labels: [] },
  }) as never

const buildingsOf = (page: number, totalPages: number, totalDocs: number, capped: boolean) =>
  ({
    result: { docs: [], totalDocs, page, totalPages, capped },
    query: { raw: '陆家嘴', normalized: '陆家嘴', terms: [] },
    resolved: [],
  }) as never

const render = (props: Record<string, unknown>) =>
  renderToStaticMarkup(
    createElement(SiteSearchView, {
      city,
      basePath: '/shanghai/search',
      q: '陆家嘴',
      fallback: null,
      articles: null,
      listings: null,
      buildings: null,
      ...props,
    } as never),
  )

describe('SiteSearchView 页码封顶', () => {
  it('房源页签 page=51 且封顶：越界空态，去第 50 页，不渲染分页器', () => {
    const html = render({ tab: 'listings', page: 51, listings: listingsOf(51, 50, 2000, true) })
    expect(html).toContain('结果较多，仅展示前 50 页，第 51 页不开放')
    expect(html).toContain('去第 50 页')
    expect(html).toContain('q=%E9%99%86%E5%AE%B6%E5%98%B4&amp;tab=listings&amp;page=50')
    expect(html).not.toContain('ls-pager')
    expect(html).not.toContain('没有找到相关房源')
  })

  it('房源页签封顶但在范围内：分页器后有封顶提示', () => {
    const html = render({ tab: 'listings', page: 3, listings: listingsOf(3, 50, 2000, true) })
    expect(html).toContain('ls-pager')
    expect(html).toContain('仅显示前 50 页')
    expect(html).not.toContain('ls-emptyrange')
  })

  it('房源页签未封顶：无封顶提示，行为不变', () => {
    const html = render({ tab: 'listings', page: 2, listings: listingsOf(2, 3, 60, false) })
    expect(html).toContain('ls-pager')
    expect(html).not.toContain('仅显示前')
    expect(html).not.toContain('ls-emptyrange')
  })

  it('房源页签未封顶的真越界：沿用原文案', () => {
    const html = render({ tab: 'listings', page: 5, listings: listingsOf(5, 3, 60, false) })
    expect(html).toContain('这套筛选只有 3 页，第 5 页不存在')
    expect(html).not.toContain('ls-pager')
  })

  it('楼盘页签 page=51 且封顶：越界空态', () => {
    const html = render({ tab: 'buildings', page: 51, buildings: buildingsOf(51, 50, 2000, true) })
    expect(html).toContain('结果较多，仅展示前 50 页，第 51 页不开放')
    expect(html).toContain('tab=buildings&amp;page=50')
    expect(html).not.toContain('ls-pager')
  })

  it('楼盘页签封顶在范围内：有提示', () => {
    const html = render({ tab: 'buildings', page: 2, buildings: buildingsOf(2, 50, 2000, true) })
    expect(html).toContain('仅显示前 50 页')
  })
})

describe('SiteSearchView 源码接线', () => {
  const src = readFileSync(resolve(__dirname, '../src/components/frontend/search/SiteSearchView.tsx'), 'utf8')
  it('房源 / 楼盘页签都读 capped 并走 renderPagedResults', () => {
    expect(src).toContain('pagination.capped')
    expect(src).toContain('buildings?.result.capped')
    expect(src).toContain('<EmptyOutOfRange')
    expect(src).toContain('<PagerCapNote capped={capped} />')
  })
})
