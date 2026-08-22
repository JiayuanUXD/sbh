/**
 * OPT-037 Task 11b：`prefetch` 判据的**实测**（不是读代码推断）。
 *
 * Next 的 RSC 预取请求的指纹是 `RSC: 1` 请求头（App Router 用它区分 RSC payload
 * 与整页 HTML）。本脚本在两个页面上把这类请求全量抓下来去重，用来回答两件事：
 *
 *   1. 列表页 `/listings` 会不会为**每张房源卡**各发一次预取？
 *      —— `ListingCard` 的 `prefetch={false}` 就是冲这个来的，这里量它真的没了；
 *   2. 详情页的面包屑链接会不会被预取？
 *      —— Task 11b 回退 `prefetch={false}` 后，`/` `/listings`
 *         （以及房源详情多出来的 `/buildings/<slug>`）应当重新出现在预取里。
 *
 * 顺带暴露一个**裁定 2 的副作用**：房源详情页的面包屑末段链接与
 * `BuildingSummaryCard` 的「查看楼盘」CTA 指向**同一个 URL**。Next 的路由缓存按
 * URL 去重，所以面包屑一旦预取该 URL，`BuildingSummaryCard` 上的
 * `prefetch={false}` 在这个页面就等于失效了（它只在没有面包屑的场景才还起作用）。
 * 这不是错误，但值得记录，免得下一个人看到两处取值不同以为是漏改。
 *
 * 用法：node task11b-prefetch.mjs <origin>
 */
import { chromium } from 'file:///E:/github/sbh/payload-office-platform/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'

const ORIGIN = process.argv[2] ?? 'http://localhost:3805'
const CASES = ['/listings', '/listings/lujiazui-grade-a-780sqm', '/buildings/west-nanjing-premium-center']

const browser = await chromium.launch()
for (const url of CASES) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const rsc = new Set()
  page.on('request', (r) => {
    const h = r.headers()
    if (h['rsc'] === '1' || h['next-router-prefetch'] === '1') rsc.add(new URL(r.url()).pathname)
  })
  await page.goto(`${ORIGIN}${url}`, { waitUntil: 'networkidle' })
  // 滚到底，逼出所有「进视口才预取」的链接
  await page.evaluate(async () => {
    const step = window.innerHeight
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo({ top: y, behavior: 'instant' })
      await new Promise((r) => setTimeout(r, 120))
    }
  })
  await page.waitForTimeout(1200)
  const counts = await page.evaluate(() => ({
    listingCardLinks: document.querySelectorAll('a.listing-card').length,
    breadcrumbLinks: [...document.querySelectorAll('.breadcrumb__link')].map((a) => a.getAttribute('href')),
    buildingSummaryCta: [...document.querySelectorAll('.building-summary-card a')].map((a) => a.getAttribute('href')),
  }))
  console.log(`\n=== ${url} ===`)
  console.log(`  页面上房源卡链接数: ${counts.listingCardLinks}`)
  console.log(`  面包屑链接: ${JSON.stringify(counts.breadcrumbLinks)}`)
  console.log(`  BuildingSummaryCard CTA: ${JSON.stringify(counts.buildingSummaryCta)}`)
  console.log(`  实测被 RSC 预取的路径 (${rsc.size}): ${JSON.stringify([...rsc].sort())}`)
  await page.close()
}
await browser.close()
