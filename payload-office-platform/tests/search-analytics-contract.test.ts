/**
 * 守卫：`site_search` 埋点不得携带查询文本（OPT-126 §4、§11）
 *
 * OPT-122 §9.1 的决定是「不上报 q 原文」，OPT-126 对它做的是**有限反转**：
 * 未命中词走自有端点、进自有表，**不进 Umami**。这条守卫守住 Umami 一侧的边界，
 * 防止以后有人为了方便，顺手把 `q` / `term` 之类的文本属性加进白名单。
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { ANALYTICS_EVENTS, assertSafeAnalyticsProps, validateEvent } from '@/lib/frontend/analytics/events'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const EXPECTED_KEYS = [
  'city',
  'q_length',
  'tab',
  'page',
  'result_total',
  'result_listings',
  'result_buildings',
  'result_news',
  'zero_result',
  'relaxed',
  'term_count',
  'script',
  'entity_hit',
  'suggested',
  'too_short',
] as const

const TEXT_LIKE_KEY = /^(?:q|query|term|terms|keyword|keywords|text|raw|search|search_text|normalized)$/i

describe('site_search 白名单', () => {
  it('键集合与 OPT-126 P0 约定一致（增删都要改这里，逼一次评审）', () => {
    expect([...ANALYTICS_EVENTS.site_search].sort()).toEqual([...EXPECTED_KEYS].sort())
  })

  it('没有任何形似查询文本的键', () => {
    const offenders = ANALYTICS_EVENTS.site_search.filter((key) => TEXT_LIKE_KEY.test(key))
    expect(offenders).toEqual([])
  })

  it('每个键都能通过 PII 键名守卫', () => {
    const props = Object.fromEntries(ANALYTICS_EVENTS.site_search.map((key) => [key, 1]))
    expect(() => assertSafeAnalyticsProps(props)).not.toThrow()
  })
})

describe('validateEvent(site_search)', () => {
  const base = {
    city: 'shanghai',
    q_length: 6,
    tab: 'all',
    page: 1,
    result_total: 0,
    result_listings: 0,
    result_buildings: 0,
    result_news: 0,
    zero_result: true,
    relaxed: false,
  }

  it('保留 4 个新增派生字段', () => {
    const result = validateEvent('site_search', {
      ...base,
      term_count: 1,
      script: 'cjk',
      entity_hit: false,
      suggested: true,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.sanitized).toMatchObject({
      term_count: 1,
      script: 'cjk',
      entity_hit: false,
      suggested: true,
    })
  })

  it('调用方即使传了查询文本，也被白名单剥掉', () => {
    const result = validateEvent('site_search', {
      ...base,
      q: '陆家嘴整层',
      query: '陆家嘴整层',
      term: '陆家嘴整层',
      keyword: '陆家嘴整层',
      normalized: '陆家嘴整层',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Object.keys(result.sanitized)).not.toEqual(
      expect.arrayContaining(['q', 'query', 'term', 'keyword', 'normalized']),
    )
    expect(JSON.stringify(result.sanitized)).not.toContain('陆家嘴')
  })
})

describe('SearchAnalytics 组件', () => {
  const source = readFileSync(
    path.join(ROOT, 'src/components/frontend/search/SearchAnalytics.tsx'),
    'utf8',
  )

  /** 取 `track('site_search', { ... })` 的对象字面量。 */
  function trackCallBody(): string {
    const start = source.indexOf("track('site_search'")
    expect(start).toBeGreaterThan(-1)
    const open = source.indexOf('{', start)
    let depth = 0
    for (let index = open; index < source.length; index += 1) {
      if (source[index] === '{') depth += 1
      if (source[index] === '}') {
        depth -= 1
        if (depth === 0) return source.slice(open, index + 1)
      }
    }
    throw new Error('track(site_search) 对象字面量没有闭合')
  }

  it('上报对象里不出现 q 原文（q.length 这类派生量允许）', () => {
    const body = trackCallBody()
    // `q,`（简写）、`q:`（显式键）、`: q,`（把原文当值）都不允许
    expect(body).not.toMatch(/(?:^|[\s{,])q\s*[,:}]/)
    expect(body).not.toMatch(/:\s*q\s*[,}]/)
  })

  it('上报对象里包含 4 个派生字段', () => {
    const body = trackCallBody()
    for (const key of ['term_count', 'script', 'entity_hit', 'suggested']) {
      expect(body).toContain(key)
    }
  })
})
