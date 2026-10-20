import { describe, expect, it } from 'vitest'

import { parseSearchPage, parseSearchTab, parseSiteSearchParams } from '@/domain/search/tabs'

describe('parseSearchTab', () => {
  it('白名单内原样返回', () => {
    expect(parseSearchTab('listings')).toBe('listings')
    expect(parseSearchTab('buildings')).toBe('buildings')
    expect(parseSearchTab('news')).toBe('news')
    expect(parseSearchTab('all')).toBe('all')
  })

  it('数组取第一个，非法值回到 all', () => {
    expect(parseSearchTab(['news', 'listings'])).toBe('news')
    expect(parseSearchTab('unknown')).toBe('all')
    expect(parseSearchTab(undefined)).toBe('all')
  })
})

describe('parseSearchPage', () => {
  it('默认 1，非法值回到 1', () => {
    expect(parseSearchPage(undefined)).toBe(1)
    expect(parseSearchPage('0')).toBe(1)
    expect(parseSearchPage('-3')).toBe(1)
    expect(parseSearchPage('abc')).toBe(1)
  })

  it('上限 10000', () => {
    expect(parseSearchPage('999999')).toBe(10000)
    expect(parseSearchPage('2')).toBe(2)
  })
})

describe('parseSiteSearchParams', () => {
  it('trim + 100 字截断，并解析 tab/page', () => {
    expect(parseSiteSearchParams({ q: '  陆家嘴  ', tab: 'listings', page: '2' })).toEqual({
      q: '陆家嘴',
      tab: 'listings',
      page: 2,
    })
  })

  it('缺省 q 为空串、tab 为 all、page 为 1', () => {
    expect(parseSiteSearchParams({})).toEqual({ q: '', tab: 'all', page: 1 })
  })

  it('按码点截断，不切断代理项', () => {
    const q = '😀'.repeat(120)
    const parsed = parseSiteSearchParams({ q }).q
    expect(Array.from(parsed)).toHaveLength(100)
    expect(parsed).not.toContain('\uFFFD')
  })
})
