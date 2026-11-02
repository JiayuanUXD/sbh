/**
 * 零结果页漏斗埋点（OPT-126 P2）：data-* 契约、解析 fail-closed、白名单不含文本、
 * 结果卡来源标记 section='search' 被点击守卫放行。
 */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import SearchZeroState from '@/components/frontend/search/SearchZeroState'

import { isListSection, listAnalyticsAttrs } from '@/components/frontend/listing/list-analytics'
import {
  parseSearchFunnelClick,
  SEARCH_FUNNEL_ATTR,
  searchFunnelAttrs,
} from '@/domain/search/funnel-analytics'
import { ANALYTICS_EVENTS, assertSafeAnalyticsProps, validateEvent } from '@/lib/frontend/analytics/events'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const reader = (attrs: Record<string, string | number>) => (name: string) =>
  name in attrs ? String(attrs[name]) : null

describe('searchFunnelAttrs / parseSearchFunnelClick', () => {
  it('建议词点击往返：只带 city 与位置', () => {
    const attrs = searchFunnelAttrs({ event: 'search_suggestion_click', position: 2 })
    expect(parseSearchFunnelClick('shanghai', reader(attrs))).toEqual({
      event: 'search_suggestion_click',
      props: { city: 'shanghai', position: 2 },
    })
  })

  it('兜底块点击往返：带 block 与位置', () => {
    const attrs = searchFunnelAttrs({ event: 'search_fallback_click', block: 'district', position: 3 })
    expect(parseSearchFunnelClick('shanghai', reader(attrs))).toEqual({
      event: 'search_fallback_click',
      props: { city: 'shanghai', block: 'district', position: 3 },
    })
  })

  it.each([
    ['缺城市', undefined, { [SEARCH_FUNNEL_ATTR.event]: 'search_suggestion_click', [SEARCH_FUNNEL_ATTR.position]: '1' }],
    ['位置为 0', 'shanghai', { [SEARCH_FUNNEL_ATTR.event]: 'search_suggestion_click', [SEARCH_FUNNEL_ATTR.position]: '0' }],
    ['位置非整数', 'shanghai', { [SEARCH_FUNNEL_ATTR.event]: 'search_suggestion_click', [SEARCH_FUNNEL_ATTR.position]: '1.5' }],
    ['未知事件', 'shanghai', { [SEARCH_FUNNEL_ATTR.event]: 'inquiry_open', [SEARCH_FUNNEL_ATTR.position]: '1' }],
    [
      '未知兜底块',
      'shanghai',
      { [SEARCH_FUNNEL_ATTR.event]: 'search_fallback_click', [SEARCH_FUNNEL_ATTR.block]: 'ad', [SEARCH_FUNNEL_ATTR.position]: '1' },
    ],
    ['兜底块缺 block', 'shanghai', { [SEARCH_FUNNEL_ATTR.event]: 'search_fallback_click', [SEARCH_FUNNEL_ATTR.position]: '1' }],
  ])('%s：整条不报', (_label, city, attrs) => {
    expect(parseSearchFunnelClick(city, reader(attrs))).toBeNull()
  })
})

describe('白名单', () => {
  it('两个漏斗事件的键集合固定，且不含文本类键', () => {
    expect([...ANALYTICS_EVENTS.search_suggestion_click].sort()).toEqual(['city', 'position'])
    expect([...ANALYTICS_EVENTS.search_fallback_click].sort()).toEqual(['block', 'city', 'position'])
    const textLike = /^(?:q|query|term|terms|keyword|keywords|text|raw|name|title|slug|normalized)$/i
    for (const keys of [ANALYTICS_EVENTS.search_suggestion_click, ANALYTICS_EVENTS.search_fallback_click]) {
      expect(keys.filter((key) => textLike.test(key))).toEqual([])
    }
  })

  it('事件通过 validateEvent，夹带的文本属性被剥离', () => {
    const result = validateEvent('search_suggestion_click', {
      city: 'shanghai',
      position: 1,
      q: '陆家嘴',
      name: '陆家嘴中心',
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(Object.keys(result.sanitized).sort()).toEqual(['city', 'position'])
      expect(() => assertSafeAnalyticsProps(result.sanitized)).not.toThrow()
    }
  })
})

describe('结果卡来源标记', () => {
  it("section='search' 被点击守卫放行，且随 data 属性输出", () => {
    expect(isListSection('search')).toBe(true)
    const attrs = listAnalyticsAttrs({
      event: 'listing_result_click',
      city: 'shanghai',
      rank: 1,
      pageIndex: 1,
      section: 'search',
      listingId: 7,
    })
    expect(attrs['data-analytics-section']).toBe('search')
  })

  it('搜索页编排层只给搜索结果传 analytics，热门推荐（无查询）不传', () => {
    const source = readFileSync(
      path.join(ROOT, 'src/components/frontend/search/SiteSearchView.tsx'),
      'utf8',
    )
    expect(source).toContain("section: 'search'")
    expect(source).toContain('pageIndex === undefined')
    expect(source).toMatch(/renderListings\(fallbackData\.listings\)/)
    expect(source).toMatch(/renderBuildings\(fallbackData\.buildings\)/)
  })
})

describe('SearchZeroState 渲染', () => {
  it('建议词与实体 / 区域兜底链接带漏斗属性，位置为 1 基序号', () => {
    const html = renderToStaticMarkup(
      createElement(SearchZeroState, {
        basePath: '/shanghai/search',
        citySlug: 'shanghai',
        q: 'x',
        fallback: { districts: [{ slug: 'pudong', name: '浦东', count: 3 }], buildings: [], listings: [] },
        suggestions: ['甲楼', '乙楼'],
        entity: { name: '甲楼', slug: 'jia' },
      } as never),
    )
    const tags = [...html.matchAll(/data-search-funnel-event="([^"]+)"[^>]*?data-search-funnel-position="(\d+)"/g)]
    expect(tags.map((m) => `${m[1]}#${m[2]}`)).toEqual(
      expect.arrayContaining(['search_suggestion_click#1', 'search_suggestion_click#2', 'search_fallback_click#1']),
    )
    expect(html).toContain('data-search-funnel-block="entity"')
    expect(html).toContain('data-search-funnel-block="district"')
  })
})
