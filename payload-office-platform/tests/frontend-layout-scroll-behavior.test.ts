/**
 * 守卫：根元素**不得**设 `scroll-behavior: smooth`
 *
 * ## 沿革（这条守卫翻过一次面，两段都要读）
 *
 * 2026-09-03：`styles.css` 有全局 `html { scroll-behavior: smooth }`，而 layout 没给
 * `<html>` 加 `data-scroll-behavior="smooth"`。Next 16 的
 * `disableSmoothScrollDuringRouteTransition` 判的是这个**属性**而不是计算样式：
 * 没有它就直接执行 `scrollTop = 0` 不做压制，于是**前进导航**（首页 → 详情页）
 * 会从上一页的滚动位置一路平滑滚到顶。当时的修法是补上那个属性，本文件
 * 相应断言「CSS 是 smooth 且属性存在」。
 *
 * 2026-09-04：用户报告**返回**（详情页 → 首页）仍有滚动动画。查证：
 *   - `disableSmoothScrollDuringRouteTransition` 只在 `layout-router.js` 被调用，
 *     那是前进导航那条路径；
 *   - App Router 的 `onPopState` 只 dispatch 状态，**不碰滚动**；
 *   - Next 从不设 `history.scrollRestoration`（线上实测是 `auto`）。
 * 所以返回时的滚动是**浏览器做的历史滚动恢复**，Next 压制不到，那个属性也管不到。
 * 根元素上的 `scroll-behavior` 会给每一次程序化滚动加动画，历史恢复也在其中。
 *
 * 处置（产品 2026-09-04 权衡）：**移除全局 smooth**，连带移除已无物可压制的
 * `data-scroll-behavior` 属性。代价是全站唯一有意义的消费方——楼盘详情页锚点
 * 导航条与 layout 的 skip link——变成瞬时跳转。
 *
 * ## 为什么两条都要断言
 *
 * 只断言 CSS → 属性会作为无人敢清的残留留在 layout 里，下一个人看到它会以为
 * 全站还有平滑滚动。
 * 只断言属性 → CSS 那条被加回来时，前进导航的动画立刻复发（2026-09-03 的原始故障），
 * 而属性不在，Next 连压制的机会都没有。
 * 两条一起断言，表达的是「这两件事必须同进同退」——将来若要恢复平滑滚动，
 * 本测试会同时指着两条失败，那时应当重新设计（只在锚点点击那一刻临时打开），
 * 而不是把断言删掉了事。
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

/** 取根元素规则的声明体（排除注释与 @media 块里的同名规则）。 */
function baseHtmlRuleBody(css: string): string {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const withoutMedia = withoutComments.replace(
    /@media[^{]*\{(?:[^{}]|\{[^{}]*\})*\}/g,
    '',
  )
  return withoutMedia.match(/(?:^|\})\s*html\s*\{([^}]*)\}/m)?.[1] ?? ''
}

describe('根元素不得设 scroll-behavior: smooth', () => {
  it('styles.css 的 html 基态规则里没有 scroll-behavior', () => {
    const body = baseHtmlRuleBody(readFileSync(STYLES_PATH, 'utf8'))

    // 规则本身还在（放 text-size-adjust），只是不该再有 scroll-behavior
    expect(body).toContain('text-size-adjust')
    expect(body).not.toMatch(/scroll-behavior/)
  })

  // 该属性只对「根元素设了 smooth」这个前提有意义（Next 靠它决定是否压制）。
  // 前提没了还留着，就是会误导人的残留。
  it('SSR 输出的 <html> 标签不带 data-scroll-behavior', async () => {
    const element = await RootLayout({
      children: React.createElement('section', null, 'content'),
    })
    const markup = renderToStaticMarkup(element)

    expect(markup).toMatch(/<html[^>]*lang="zh-CN"/)
    expect(markup).not.toContain('data-scroll-behavior')
  })
})
