import { describe, expect, it } from 'vitest'

import { buildSiteSearchHref, siteSearchPathFor } from '@/lib/frontend/search-submit'

describe('buildSiteSearchHref', () => {
  it('默认值不写进 URL', () => {
    expect(buildSiteSearchHref('shanghai', { q: ' 陆家嘴 ' })).toBe('/shanghai/search?q=%E9%99%86%E5%AE%B6%E5%98%B4')
    expect(buildSiteSearchHref('shanghai', { q: '陆家嘴', tab: 'all', page: 1 })).toBe(
      '/shanghai/search?q=%E9%99%86%E5%AE%B6%E5%98%B4',
    )
  })

  it('tab 与 page 非默认时写入', () => {
    expect(buildSiteSearchHref('shanghai', { q: '陆家嘴', tab: 'buildings', page: 2 })).toBe(
      '/shanghai/search?q=%E9%99%86%E5%AE%B6%E5%98%B4&tab=buildings&page=2',
    )
  })

  it('空关键词只返回路径', () => {
    expect(buildSiteSearchHref('shanghai', { q: '   ' })).toBe('/shanghai/search')
    expect(siteSearchPathFor(undefined)).toBe('/search')
  })

  it('按码点截断 100 字', () => {
    const href = buildSiteSearchHref('shanghai', { q: '😀'.repeat(120) })
    const q = new URL(href, 'https://example.com').searchParams.get('q') ?? ''
    expect(Array.from(q)).toHaveLength(100)
  })
})
