/**
 * 页头/页脚外壳水合回归测试
 *
 * 背景：SiteHeader / SiteFooter 曾用 <Suspense> 包裹调用 useSearchParams() 的
 * 客户端组件，以便在 /entrust?city=X 上识别 query 城市。在 force-dynamic 的
 * layout 下，该边界的内容会被流式推送到 React 的隐藏暂存区，边界停在 $~
 * （queued）态而客户端永不 reveal —— 内容滞留在 div[hidden] 里，整棵子树不水合。
 * 表现为页头页脚全部不可交互（移动端汉堡菜单打不开、城市切换器点不动），
 * 且因为 fallback 与子树同构、body 上有 suppressHydrationWarning，
 * 页面看起来完全正常、控制台无报错。
 *
 * 旧测试 frontend-layout-suspense.test.ts 断言的是「fallback 渲染完整」，
 * 而 fallback 渲染完整正是该故障能隐身的原因，所以它全绿却漏掉了问题。
 *
 * 本测试改为断言结构不变量：外壳不得位于任何流式 Suspense 边界之后。
 * 判据是流式输出里不出现待决边界标记 <!--$?--> 与 <template id="B:n">。
 */
import React from 'react'
import { renderToPipeableStream } from 'react-dom/server'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'

// 模拟「useSearchParams 会挂起」——这是线上真实发生的情形。
// 修复后外壳根本不调用它，所以这个 mock 永远不会被触发。
const neverResolves = new Promise<never>(() => undefined)

vi.mock('next/navigation', () => ({
  usePathname: () => '/hangzhou',
  useSearchParams: () => {
    throw neverResolves
  },
}))

vi.mock('@/app/(frontend)/_lib/city-context', () => ({
  listPublicCityOptions: async () => [
    { slug: 'shanghai', name: '上海', serviceStatus: 'live', sortOrder: 10 },
    { slug: 'hangzhou', name: '杭州', serviceStatus: 'coming-soon', sortOrder: 20 },
  ],
  listPublicCityProfiles: async () => [
    { citySlug: 'shanghai', serviceStatus: 'live' },
    { citySlug: 'hangzhou', serviceStatus: 'coming-soon' },
  ],
}))

// OPT-053：layout 现在还要读站点设置。与上面的 city-context 同一口径——
// 本文件验的是水合边界，不该为此起一个真实 payload 实例（getPayload 在单测里会挂住）。
vi.mock('@/lib/frontend/site-settings', async () => {
  const actual = await vi.importActual<typeof import('@/lib/frontend/site-settings')>(
    '@/lib/frontend/site-settings',
  )
  return {
    ...actual,
    getCachedSiteSettings: async () => actual.SITE_SETTINGS_FALLBACK,
  }
})

vi.mock('@/lib/frontend/analytics/web-vitals', () => ({
  initWebVitals: async () => () => undefined,
}))

import RootLayout from '@/app/(frontend)/layout'
import SiteHeader from '@/components/frontend/SiteHeader'
import SiteFooter from '@/components/frontend/SiteFooter'
import { SITE_SETTINGS_FALLBACK } from '@/lib/frontend/site-settings'

const CITIES = [
  { slug: 'shanghai', name: '上海', serviceStatus: 'live' as const, sortOrder: 10 },
  { slug: 'hangzhou', name: '杭州', serviceStatus: 'coming-soon' as const, sortOrder: 20 },
]

/** 流式渲染并收集完整 HTML（等到 onAllReady，给挂起边界最大机会补齐）。 */
function streamToHtml(element: React.ReactElement): Promise<string> {
  return new Promise((resolve, reject) => {
    const sink = new PassThrough()
    let html = ''
    sink.on('data', (chunk: Buffer) => {
      html += chunk.toString('utf8')
    })
    sink.on('end', () => resolve(html))
    sink.on('error', reject)

    // 挂起的边界永不 resolve，onAllReady 不会触发；用 onShellReady 落盘并中止，
    // 这与线上「shell 已发、边界仍待决」的形态一致。
    const { pipe, abort } = renderToPipeableStream(element, {
      onShellReady() {
        pipe(sink)
        // 让待决边界有机会写出 template 占位后再中止
        setTimeout(() => abort(), 50)
      },
      onShellError: reject,
      onError() {
        // 边界内部的挂起会走到这里；不让它污染断言
      },
    })
  })
}

/**
 * 判据说明：不能断言「整页无待决边界」——页面里存在合法边界
 * （layout 的 AnalyticsInit、CitySwitcher 内部的菜单增强），
 * 它们在真实渲染中会正常 resolve，只有本测试的强制挂起 mock 才让它们待决。
 *
 * 真正的回归判据是外壳容器的**紧邻内容**：
 *   修复前 → <div class="site-header__inner"><!--$?--><template id="B:0">
 *   修复后 → <div class="site-header__inner"><a class="site-logo"
 * 页脚同理。这个判据精确对应「整个外壳被挪进流式边界」这一故障形态。
 */
describe('公开站点外壳必须直接水合，不得整体位于流式边界之后', () => {
  it('SiteHeader 的外壳内容紧跟容器，未被边界标记顶掉', async () => {
    const html = await streamToHtml(
      React.createElement(SiteHeader, {
        cities: CITIES,
        defaultCity: 'shanghai',
        multiCityRoutingEnabled: true,
        // OPT-053：站点标识由 layout 传入。用兜底值——本用例验的是水合边界，
        // 不是文案内容，拿默认值即可，也顺带保证兜底值本身能渲染。
        brand: { siteName: SITE_SETTINGS_FALLBACK.siteName, logo: null },
      }),
    )
    expect(html).toContain('site-header')
    expect(html).toMatch(/<div class="site-header__inner"><a class="site-logo"/)
    // 导航与菜单按钮必须在 shell 里直接出现，而不是滞留在边界内容中
    expect(html).toContain('class="site-nav"')
    expect(html).toContain('class="site-menu-toggle"')
  })

  it('SiteFooter 的外壳内容紧跟容器，未被边界标记顶掉', async () => {
    const html = await streamToHtml(
      React.createElement(SiteFooter, {
        cities: CITIES,
        defaultCity: 'shanghai',
        multiCityRoutingEnabled: true,
        settings: SITE_SETTINGS_FALLBACK,
      }),
    )
    expect(html).toMatch(/<footer class="site-footer"><div class="site-footer__inner">/)
    expect(html).toContain('class="site-footer__logo"')
  })

  it('layout 内的页头与页脚外壳均直接落在 shell 中', async () => {
    const element = await RootLayout({
      children: React.createElement('section', null, 'city content'),
    })
    const html = await streamToHtml(element)

    expect(html).toContain('city content')
    expect(html).toMatch(/<div class="site-header__inner"><a class="site-logo"/)
    expect(html).toMatch(/<footer class="site-footer"><div class="site-footer__inner">/)
    expect(html).toContain('class="site-menu-toggle"')
  })

  it('外壳源码不得再消费 query 或引入流式边界', async () => {
    const { readFile } = await import('node:fs/promises')
    const { fileURLToPath } = await import('node:url')
    const base = fileURLToPath(new URL('../src/components/frontend/', import.meta.url))
    // 只看代码，不看注释：注释里说明历史成因时会提到这些标识符。
    const stripComments = (s: string) =>
      s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    for (const file of ['SiteHeader.tsx', 'SiteFooter.tsx']) {
      const source = stripComments(await readFile(`${base}${file}`, 'utf8'))
      expect(source, `${file} 不得消费 query 参数`).not.toContain('useSearchParams')
      expect(source, `${file} 不得引入流式边界`).not.toContain('<Suspense')
    }
  })
})
