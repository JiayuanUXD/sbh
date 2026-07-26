/**
 * OPT-011 停用供给不可达专项验收
 *
 * 设计依据：frontend-acceptance-audit.md P2-03
 *           specs/frontend-mvp/design.md §3.4（有效供给谓词）
 *
 * 守护不变量（运行时层面，纯函数层见
 *   public-catalog-effective-supply-consistency.test.ts §2a/§2b/§5）：
 *   - 非有效供给的房源/楼盘 slug 直接访问 -> 404（notFound）
 *   - sitemap 只含有效供给 URL（每个 URL 返回 200）
 *   - 列表页的房源详情链接均出现在 sitemap 中（无停用供给混入列表）
 *
 * 说明：seed 数据全部 publicationStatus=published，无真实停用 listing。
 * 非有效供给（draft/unpublished/leased/举报暂停）与"不存在 slug"在运行时
 * 表现一致--均不在 findEffectiveListings 结果，详情页 notFound()。
 * 本 spec 用不存在 slug 验证运行时 404 行为；纯函数层的停用过滤由
 * effective-supply-consistency 测试覆盖（§2a draft / §2b unpublished / §5 paused）。
 */
import { expect, test } from '@playwright/test'

test.describe('OPT-011 停用供给不可达', () => {
  test('不存在的房源 slug 返回 404', async ({ page }) => {
    const resp = await page.goto('/listings/this-listing-does-not-exist')
    expect(resp?.status()).toBe(404)
  })

  test('不存在的楼盘 slug 返回 404', async ({ page }) => {
    const resp = await page.goto('/buildings/this-building-does-not-exist')
    expect(resp?.status()).toBe(404)
  })

  test('sitemap 中的房源/楼盘 URL 均返回 200（只含有效供给）', async ({ request }) => {
    const sitemap = await request.get('/sitemap.xml')
    expect(sitemap.status()).toBe(200)
    const xml = await sitemap.text()
    const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
    const detailUrls = urls.filter(
      (u) => u.includes('/listings/') || u.includes('/buildings/'),
    )
    // sitemap 至少含若干房源/楼盘（seed 数据存在）
    expect(detailUrls.length).toBeGreaterThan(0)
    for (const url of detailUrls) {
      const r = await request.get(url)
      expect(r.status(), `${url} 应可访问`).toBe(200)
    }
  })

  test('列表页房源详情链接均出现在 sitemap 中（无停用供给混入）', async ({
    page,
    request,
  }) => {
    const sitemap = await request.get('/sitemap.xml')
    const xml = await sitemap.text()
    const sitemapPaths = new Set(
      [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) =>
        new URL(m[1]).pathname,
      ),
    )
    await page.goto('/listings')
    // 仅取详情链接 /listings/<slug>，排除 /listings?type= 等筛选链接
    const links = await page
      .locator('a[href*="/listings/"]')
      .evaluateAll((els) =>
        els
          .map((e) => e.getAttribute('href'))
          .filter((h): h is string => !!h && /^\/listings\/[^?]+$/.test(h)),
      )
    expect(links.length).toBeGreaterThan(0)
    for (const href of links) {
      expect(sitemapPaths.has(href), `${href} 应在 sitemap 中`).toBe(true)
    }
  })

  test('dev-story 不出现在 sitemap 中', async ({ request }) => {
    const sitemap = await request.get('/sitemap.xml')
    const xml = await sitemap.text()
    expect(xml).not.toContain('/dev-story')
  })
})
