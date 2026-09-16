import { expect, type Page } from '@playwright/test'

/**
 * 断言当前页的 `<link rel="canonical">` 指向期望的 path + query。
 *
 * 只比 pathname + search，不比 origin：`next start` 下 canonical 的 origin 是
 * `next build` 时内联的 `NEXT_PUBLIC_SITE_URL`，与 Playwright 的 baseURL 未必一致
 * （见 `.agent/testing.md`「本地 next start 的两条环境事实」）。
 *
 * 原先只活在 `multi-city-routing.spec.ts` 里；出售频道 canonical 自指的守卫
 * （2026-09-16）也要用，于是抽出来共用，别再各写一份。
 */
export async function expectCanonical(page: Page, expected: string): Promise<void> {
  const href = await page.locator('link[rel="canonical"]').getAttribute('href')
  expect(href).not.toBeNull()
  const canonical = new URL(href!, page.url())
  expect(`${canonical.pathname}${canonical.search}`).toBe(expected)
}
