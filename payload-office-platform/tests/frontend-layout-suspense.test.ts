/**
 * 外壳 SSR 完整性测试
 *
 * 历史：本文件原名断言「query 增强挂起时 Suspense fallback 仍输出完整链接」。
 * 那个断言在外壳整体不水合的故障下依然全绿 —— fallback 渲染完整恰恰是该故障
 * 能隐身的原因，所以它给了假的信心（详见 tests/frontend-shell-hydration.test.ts）。
 *
 * 外壳已改为不消费 query、不引入流式边界（lib/frontend/use-client-search-params.ts），
 * 原断言的前提不复存在。这里保留仍然成立的那部分价值：
 * layout 的 SSR 输出必须自带完整、确定性的导航与页脚链接，
 * 不依赖任何客户端补齐 —— 这是 SEO 与无 JS 可用性的底线。
 *
 * 「外壳不得再位于流式边界之后」的结构不变量由 frontend-shell-hydration.test.ts 负责。
 */
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/hangzhou',
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

vi.mock('@/lib/frontend/analytics/web-vitals', () => ({
  initWebVitals: async () => () => undefined,
}))

import RootLayout from '@/app/(frontend)/layout'

describe('layout SSR 输出的外壳完整性', () => {
  it('SSR 即输出完整确定性的页头页脚链接，不依赖客户端补齐', async () => {
    const element = await RootLayout({ children: React.createElement('section', null, 'city content') })

    expect(() => renderToStaticMarkup(element)).not.toThrow()
    const markup = renderToStaticMarkup(element)
    expect(markup).toContain('city content')
    expect(markup).toContain('aria-label="商办租赁首页"')
    expect(markup).toContain('href="/"')
    expect(markup).toContain('class="site-nav__link"')
    expect(markup).toContain('href="/listings"')
    expect(markup).toContain('data-event-name="inquiry_open_trigger"')
    expect(markup).toContain('class="site-footer"')
    expect(markup).toContain('class="site-footer__logo"')
    expect(markup).toContain('href="/buildings"')
  })

  it('外壳的 SSR 输出不依赖 next/navigation 的 useSearchParams', async () => {
    // 上面的 mock 刻意不提供 useSearchParams：外壳若再去调用它会直接抛错。
    const element = await RootLayout({ children: React.createElement('section', null, 'ok') })
    expect(() => renderToStaticMarkup(element)).not.toThrow()
  })
})
