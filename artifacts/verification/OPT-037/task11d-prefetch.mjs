/**
 * OPT-037 Task 11d：三条补漏（撤 BuildingSummaryCard / 补 ArticleCard / 补 BuildingCardMini）
 * 的**实测**预取请求数。
 *
 * 沿用 11c 的两条纪律（都是被上一轮漏检逼出来的，别改回去）：
 *   1. **保留 query string**，只剥 Next 自己加的 `_rsc` 指纹参数。11b 那版把 URL
 *      归一成 pathname，筛选/排序/翻页那一整类链接的预取在证据里是隐形的。
 *   2. **按选择器分类点数**，别只数一个 class 名就下结论。
 *
 * 本轮新增统计的选择器：
 *   - `a.article-card__link`   ArticleCard（/news 网格，PAGE_SIZE=12）
 *   - `a.building-card-mini`   BuildingCardMini（楼盘详情 #related 网格，域层默认 limit=6）
 *   - `a.nearby-strip__card`   NearbyBuildingsStrip（**原生 <a>，不是 next/link**，
 *                              本就不产生 RSC 预取；列出来是为了让「它不适用」这件事
 *                              有实测而不是断言）
 *
 * 用法：node task11d-prefetch.mjs <origin> [输出 json 路径]
 */
import { writeFileSync } from 'node:fs'
import { chromium } from 'file:///E:/github/sbh/payload-office-platform/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'

const ORIGIN = process.argv[2] ?? 'http://localhost:3805'
const OUT = process.argv[3] ?? null

const CASES = [
  '/news',
  '/buildings/west-nanjing-premium-center',
  '/buildings/empty-building',
  '/listings/lujiazui-grade-a-780sqm',
  '/listings',
  '/buildings',
]

/** 剥掉 Next 给 RSC 预取加的 `_rsc` 指纹参数，保留其余 query。 */
function normalize(rawUrl) {
  const u = new URL(rawUrl)
  u.searchParams.delete('_rsc')
  const q = u.searchParams.toString()
  return q ? `${u.pathname}?${q}` : u.pathname
}

const browser = await chromium.launch()
const report = []

for (const url of CASES) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const prefetched = new Set()
  page.on('request', (r) => {
    const h = r.headers()
    if (h['rsc'] === '1' || h['next-router-prefetch'] === '1') prefetched.add(normalize(r.url()))
  })
  await page.goto(`${ORIGIN}${url}`, { waitUntil: 'networkidle' })
  await page.evaluate(async () => {
    const step = window.innerHeight
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo({ top: y, behavior: 'instant' })
      await new Promise((r) => setTimeout(r, 120))
    }
  })
  await page.waitForTimeout(1500)

  const links = await page.evaluate(() => {
    const hrefs = (sel) => [...document.querySelectorAll(sel)].map((a) => a.getAttribute('href'))
    return {
      articleCard: hrefs('a.article-card__link'),
      buildingCardMini: hrefs('a.building-card-mini'),
      nearbyStrip: hrefs('a.nearby-strip__card'),
      buildingSummaryCta: hrefs('a.building-summary-card__cta'),
      breadcrumb: hrefs('.breadcrumb__link'),
      lsCard: hrefs('a.ls-card'),
      bdCard: hrefs('a.bd-card'),
      bdRow: hrefs('a.bd-row'),
      listingCard: hrefs('a.listing-card'),
    }
  })

  const all = [...prefetched].sort()
  /**
   * ⚠️ 2026-08-22 终审第 3 轮修：原正则是 `/^\/(listings|buildings|news)\/[^/?]+$/`，
   * `$` 卡在 slug 后面 —— **任何带 query 的详情页都被排除在「详情页 URL」之外**
   * （`/buildings/<slug>?group=coworking`、`/listings/<slug>?from=...` 全部隐形）。
   * 这与 11b「把 URL 归一成 pathname」是同一族漏检：判据把一整类目标悄悄划出了统计。
   * 现在只匹配路径段，query 保留在 `all` / `queryPrefetched` 里另算。
   */
  const detailPrefetched = all.filter((p) => /^\/(?:[a-z][a-z0-9-]*\/)?(listings|buildings|news)\/[^/?#]+(?:[?#]|$)/.test(p))
  const queryPrefetched = all.filter((p) => p.includes('?'))

  report.push({ url, links, prefetchedTotal: all.length, detailPrefetched, queryPrefetched, all })

  console.log(`\n=== ${url} ===`)
  console.log(`  链接数: article=${links.articleCard.length} mini=${links.buildingCardMini.length} nearby(<a>)=${links.nearbyStrip.length} summaryCta=${links.buildingSummaryCta.length} ls-card=${links.lsCard.length} bd-card=${links.bdCard.length} bd-row=${links.bdRow.length} listing-card=${links.listingCard.length}`)
  console.log(`  ArticleCard hrefs: ${JSON.stringify(links.articleCard)}`)
  console.log(`  BuildingCardMini hrefs: ${JSON.stringify(links.buildingCardMini)}`)
  console.log(`  NearbyStrip hrefs: ${JSON.stringify(links.nearbyStrip)}`)
  console.log(`  BuildingSummaryCard CTA: ${JSON.stringify(links.buildingSummaryCta)}`)
  console.log(`  面包屑: ${JSON.stringify(links.breadcrumb)}`)
  console.log(`  预取总数: ${all.length}`)
  console.log(`  其中【详情页 URL】(${detailPrefetched.length}): ${JSON.stringify(detailPrefetched)}`)
  console.log(`  其中【带 query 的 URL】(${queryPrefetched.length}): ${JSON.stringify(queryPrefetched)}`)
  console.log(`  全量: ${JSON.stringify(all)}`)
  await page.close()
}

await browser.close()
if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8')
