/**
 * 守卫：`html { scroll-behavior: smooth }` 必须配一个 `data-scroll-behavior="smooth"`
 *
 * ## 这条守卫防的是什么
 *
 * Next 16 的 `disableSmoothScrollDuringRouteTransition`
 * （next/dist/shared/lib/router/utils/disable-smooth-scroll.js）只有在
 * `document.documentElement.dataset.scrollBehavior === 'smooth'` 时，才会在路由跳转期间
 * 把 `scroll-behavior` 临时压成 `auto`。**没有这个属性它就直接执行 `scrollTop = 0`**，
 * 而全局 CSS 的 smooth 仍然生效——于是从「上一页已经往下滚过」跳到新页面时，
 * 页面会平滑地一路滚上去，看起来像一段多余的入场动画。
 *
 * 现场表现（2026-09-04 实测）：首页滚到 3200 处点房源卡 → 详情页从 2402 一路滚到顶。
 * 它只在上一页滚动过时出现，所以用户侧的描述是「有时候」。
 *
 * ## 为什么两条断言缺一不可
 *
 * 只断言属性存在 → 将来有人把 CSS 的 smooth 删了，属性变成无意义残留，没人知道能不能清。
 * 只断言 CSS → 正是回归本身。**两条一起断言，才表达「这两件事必须同进同退」。**
 * 若哪天决定不再要全局平滑滚动（把 styles.css 的 smooth 删掉），本测试会指着第一条断言
 * 失败，那时连同属性与本文件一起删，是有意识的决定而不是漂移。
 *
 * 注意 reduced-motion 分支（styles.css 的 `@media (prefers-reduced-motion: reduce)`）
 * 把 scroll-behavior 回落成 auto，那条不受本守卫约束——属性在那种环境下无害。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
}))

vi.mock('@/app/(frontend)/_lib/city-context', () => ({
  listPublicCityOptions: async () => [
    { slug: 'shanghai', name: '上海', serviceStatus: 'live', sortOrder: 10 },
  ],
  listPublicCityProfiles: async () => [{ citySlug: 'shanghai', serviceStatus: 'live' }],
}))

vi.mock('@/lib/frontend/site-settings', async () => {
  const actual = await vi.importActual<typeof import('@/lib/frontend/site-settings')>(
    '@/lib/frontend/site-settings',
  )
  return { ...actual, getCachedSiteSettings: async () => actual.SITE_SETTINGS_FALLBACK }
})

vi.mock('@/lib/frontend/analytics/web-vitals', () => ({
  initWebVitals: async () => () => undefined,
}))

import RootLayout from '@/app/(frontend)/layout'

const STYLES_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'app',
  '(frontend)',
  'styles.css',
)

/** 取出 `@media (prefers-reduced-motion: reduce)` 之外的那份 html 规则。 */
function baseHtmlRuleHasSmoothScroll(css: string): boolean {
  // 去掉所有 reduced-motion 媒体块后再找，避免把回落规则误当基态。
  const withoutReducedMotion = css.replace(
    /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{(?:[^{}]|\{[^{}]*\})*\}/g,
    '',
  )
  return /(^|\})\s*html\s*\{[^}]*scroll-behavior:\s*smooth/m.test(withoutReducedMotion)
}

describe('全局平滑滚动必须向 Next 显式声明', () => {
  it('styles.css 的 html 基态规则确实设了 scroll-behavior: smooth', () => {
    const css = readFileSync(STYLES_PATH, 'utf8')
    expect(baseHtmlRuleHasSmoothScroll(css)).toBe(true)
  })

  it('layout 渲染的 <html> 必须带 data-scroll-behavior="smooth"', async () => {
    const element = await RootLayout({
      children: React.createElement('section', null, 'content'),
    })
    const markup = renderToStaticMarkup(element)

    expect(markup).toMatch(/<html[^>]*\sdata-scroll-behavior="smooth"/)
  })
})
