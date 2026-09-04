/**
 * OPT-068 列表导航反馈的结构契约。
 *
 * 「点击立即有反馈」这件事本身要在真实浏览器里走查（证据在
 * artifacts/verification/OPT-068/）。这里锁的是几条容易被后来者悄悄改回去的性质：
 *
 *   1. 六个筛选 / 排序 / 分页组件走 `NavLink`，不再直接 `next/link`——直接用回
 *      `Link` 会让 pending 态整片失效，而页面看起来完全正常；
 *   2. 高基数链接的 `prefetch={false}` 必须原样保留（OPT-026 的规矩）；
 *   3. `NavLink` 对修饰键 / 中键 / `target=_blank` 放行——拦下它们会让「新标签打开」
 *      失效，这是列表页最常用的操作之一；
 *   4. 无 Provider 时退化成普通链接，不吞导航；
 *   5. 详情路由有 `loading.tsx`，列表路由**没有**（后者会重挂移动筛选抽屉，
 *      见 opt036-listings-view-wiring 的同名守卫）。
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

const pushed: string[] = []

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: (href: string) => pushed.push(href) }),
}))

import { NavLink } from '@/components/frontend/listing/ListingNavigation'

const SRC = path.resolve(__dirname, '..', 'src')
const LISTING_COMPONENTS = [
  'FilterFormC.tsx',
  'FilterPill.tsx',
  'ResultToolbar.tsx',
  'PriceUnitSegment.tsx',
  'ListPager.tsx',
  'MobileFilterSheet.tsx',
  // 结果卡也要有 pending：点卡片进详情是列表页最常用的操作，而详情路由不能靠
  // loading.tsx 补反馈（会把 404 / 307 变成 200，见下方守卫）。
  'ListingResultCard.tsx',
  'ListingResultRow.tsx',
  'BuildingResultCard.tsx',
  'BuildingCompactRow.tsx',
] as const

const readComponent = (name: string) =>
  readFileSync(path.join(SRC, 'components', 'frontend', 'listing', name), 'utf8')

describe('OPT-068 列表导航反馈', () => {
  it('六个筛选 / 排序 / 分页组件都走 NavLink，不直接用 next/link', () => {
    for (const name of LISTING_COMPONENTS) {
      const source = readComponent(name)
      expect(source, `${name} 应导入 NavLink`).toContain(
        "import { NavLink } from '@/components/frontend/listing/ListingNavigation'",
      )
      expect(source, `${name} 不该再直接 import next/link`).not.toContain("from 'next/link'")
      expect(source, `${name} 不该残留 <Link`).not.toMatch(/<Link[\s/>]/)
    }
  })

  it('高基数筛选链接保留 prefetch={false}', () => {
    expect(readComponent('FilterFormC.tsx')).toContain('prefetch={false}')
    expect(readComponent('FilterPill.tsx')).toContain('prefetch={false}')
  })

  it('两个列表视图都包在 Provider 内、结果区换成 PendingRegion', () => {
    for (const view of ['CityListingsView.tsx', 'CityBuildingsView.tsx']) {
      const source = readFileSync(path.join(SRC, 'components', 'frontend', 'city', view), 'utf8')
      expect(source, view).toContain('<ListingNavigationProvider>')
      expect(source, view).toContain('<PendingRegion className="ls-container ls-results">')
      expect(source, view).not.toContain('<div className="ls-container ls-results">')
    }
  })

  it('无 Provider 时 NavLink 渲染成普通链接，href 与 prefetch 原样透传', () => {
    // vitest 的 include 只收 .test.ts，本文件因此用 createElement 而不是 JSX
    // （同 tests/city-home-view.test.ts 的先例）。
    const html = renderToStaticMarkup(
      React.createElement(
        NavLink,
        { href: '/shanghai/listings?district=jingan', prefetch: false, className: 'ls-pill' },
        '静安',
      ),
    )
    expect(html).toContain('href="/shanghai/listings?district=jingan"')
    expect(html).toContain('class="ls-pill"')
    expect(html).not.toContain('data-pending')
  })

  it('pending 样式与减少动效降级都在 list.css 里', () => {
    const css = readFileSync(path.join(SRC, 'app', '(frontend)', 'styles', 'list.css'), 'utf8')
    expect(css).toContain(".ls-results[aria-busy='true']")
    expect(css).toContain("[data-pending='true']::after")
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{[\s\S]*data-pending[\s\S]*animation: none/)
  })

  it('详情路由**不得**有 loading.tsx —— 它会把 404 / 307 变成 200', () => {
    // 本条是 CI 抓出来的真回归（PR #146 首轮 e2e 三红）：给详情路由加 loading.tsx
    // 之后，Next 立刻把外壳连同 **HTTP 200** 发出去，页面里后来执行的
    // `notFound()` / `redirect()` 只能以流式补丁的形式送达，改不了状态码。
    // 于是「错误城市的详情应 307 到正确城市」「回滚下架的房源应 404」全变成 200——
    // 这是 URL 归属与 SEO 的硬约束，不能为了一个骨架让路。
    //   - tests/e2e/detail-pages.spec.ts:121（wrongCity 应 307）
    //   - tests/e2e/multi-city-routing.spec.ts:143（/hangzhou/buildings/<上海楼盘> 应 307）
    //   - tests/e2e/bulk-import.spec.ts:374（回滚后应 404）
    // 列表路由不得有 loading.tsx 是另一条理由（抽屉重挂），见
    // tests/opt036-listings-view-wiring.test.ts 的同名守卫。
    const appDir = path.join(SRC, 'app', '(frontend)')
    for (const route of [
      '[city]/listings/[slug]', '[city]/buildings/[slug]', 'listings/[slug]', 'buildings/[slug]',
      '[city]/listings', 'listings', '[city]/buildings', 'buildings',
    ]) {
      expect(existsSync(path.join(appDir, route, 'loading.tsx')), route).toBe(false)
    }
  })

  it('NavLink 的点击判据放行修饰键 / 中键 / target=_blank', () => {
    const source = readFileSync(
      path.join(SRC, 'components', 'frontend', 'listing', 'ListingNavigation.tsx'),
      'utf8',
    )
    expect(source).toContain('event.button !== 0')
    expect(source).toContain('event.metaKey || event.ctrlKey || event.shiftKey || event.altKey')
    expect(source).toContain("target !== '_self'")
    expect(source).toContain('event.defaultPrevented')
  })
})
