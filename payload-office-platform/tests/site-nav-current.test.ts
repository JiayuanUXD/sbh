/**
 * 主导航激活态：同一时刻只能有一项 `aria-current="page"`
 *
 * ## 被守护的缺陷
 *
 * OPT-054 给导航加了「首页」目标。多城市模式下 `cityAwareHref` 把 `/` 重写成
 * `/shanghai`，而 `isCurrent` 原本只对字面量 `/` 做精确匹配、其余走**前缀匹配**——
 * 于是在 `/shanghai/buildings` 上「首页」与「找楼盘」**同时**高亮：
 * 两个 `aria-current="page"`、两道激活下划线。移动抽屉共用同一份判据，同样中招。
 *
 * 对读屏用户尤其糟：`aria-current="page"` 出现两次，等于告诉用户"你同时在两个页面上"。
 *
 * ## 为什么必须是断言而不是靠看
 *
 * 这个错法不改变任何 href，链接全都能点、都能到。**浏览器里只核对 href 是发现不了的**
 * ——我自己就是这么漏掉的，靠 code review 才捞回来。
 */
import { describe, expect, it } from 'vitest'

import { isCurrent } from '@/components/frontend/SiteNav'

/** 无 query 的 searchParams 替身。 */
const NO_PARAMS = {
  get: () => null,
  has: () => false,
}

/** 主导航的实际形态：城市前缀已由 cityAwareHref 重写完成。 */
const CITY_NAV = [
  { itemHref: '/', href: '/shanghai', label: '首页' },
  { itemHref: '/listings', href: '/shanghai/listings', label: '找办公室' },
  { itemHref: '/buildings', href: '/shanghai/buildings', label: '找楼盘' },
  { itemHref: '/news', href: '/news', label: '资讯' },
]

function activeLabels(pathname: string): string[] {
  return CITY_NAV.filter((i) =>
    isCurrent(pathname, NO_PARAMS, i.href, i.itemHref === '/'),
  ).map((i) => i.label)
}

describe('主导航激活态', () => {
  it('城市首页只在城市首页本身高亮', () => {
    expect(activeLabels('/shanghai')).toEqual(['首页'])
  })

  it('子页面上不得同时高亮「首页」——这正是本文件要防的缺陷', () => {
    expect(activeLabels('/shanghai/buildings')).toEqual(['找楼盘'])
    expect(activeLabels('/shanghai/listings')).toEqual(['找办公室'])
  })

  it('详情页仍高亮其所属板块（前缀匹配对非首页项要保留）', () => {
    expect(activeLabels('/shanghai/buildings/some-building')).toEqual(['找楼盘'])
  })

  it('任何路径下最多一项高亮', () => {
    for (const p of [
      '/shanghai',
      '/shanghai/listings',
      '/shanghai/buildings',
      '/shanghai/buildings/x',
      '/news',
      '/news/some-article',
    ]) {
      expect(activeLabels(p).length, `路径 ${p} 高亮了多项`).toBeLessThanOrEqual(1)
    }
  })

  it('单城市模式：/ 只在根路径高亮，不前缀命中 /listings', () => {
    expect(isCurrent('/', NO_PARAMS, '/', true)).toBe(true)
    expect(isCurrent('/listings', NO_PARAMS, '/', true)).toBe(false)
  })

  it('exact 不影响非首页项——单段路径如 /listings 仍按前缀匹配', () => {
    // 这是第一版修法踩的坑：用"路径只有一段"当首页判据，会把 /listings 也算进去，
    // 于是 /listings/some-slug 不再高亮「找办公室」。判据必须来自重写前的 item.href。
    expect(isCurrent('/listings/abc', NO_PARAMS, '/listings', false)).toBe(true)
  })
})
