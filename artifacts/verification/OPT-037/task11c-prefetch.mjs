/**
 * OPT-037 Task 11c：列表页预取请求数的**实测**（不是读代码推断）。
 *
 * 与 Task 11b 的 `task11b-prefetch.mjs` 的两点区别（都是被上一轮的漏检逼出来的）：
 *
 *   1. **保留 query string**。11b 那版把请求 URL 归一成 `new URL(u).pathname`，
 *      于是 `/listings?district=jingan` 与 `/listings?sort=price-asc` 全都塌成
 *      `/listings` 一条——筛选/排序/翻页这一整类链接的预取在那份证据里是**隐形的**。
 *      本版剥掉 Next 自己加的 `_rsc` 指纹参数后保留其余 query，分开统计
 *      「详情页 URL 预取」与「查询变体 URL 预取」两类。
 *   2. **按选择器分类点数**。`/listings` 渲染的是 `.ls-card`（网格）/ `.ls-rowcard`
 *      （横向行），不是 `.listing-card`；11b 那版只数 `a.listing-card`，在 `/listings`
 *      上恒为 0，正好把「真正的高基数页面一条都没改到」这件事盖住了。
 *
 * 用法：node task11c-prefetch.mjs <origin> [输出 json 路径]
 */
import { writeFileSync } from 'node:fs'
import { chromium } from 'file:///E:/github/sbh/payload-office-platform/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'

const ORIGIN = process.argv[2] ?? 'http://localhost:3805'
const OUT = process.argv[3] ?? null

const CASES = [
  '/listings',
  '/listings?view=row',
  '/buildings',
  '/listings/lujiazui-grade-a-780sqm',
  '/buildings/west-nanjing-premium-center',
]

/** 剥掉 Next 给 RSC 预取加的 `_rsc` 指纹参数，保留其余 query（筛选/排序/翻页要看得见）。 */
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
  // 滚到底，逼出所有「进视口才预取」的链接（Next 默认策略是视口内自动预取）
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
      lsCard: hrefs('a.ls-card'),            // ListingResultCard（房源网格）
      lsRowCard: hrefs('a.ls-rowcard'),      // ListingResultRow（房源横向行）
      bdCard: hrefs('a.bd-card'),            // BuildingResultCard（楼盘「有在租」网格）
      bdRow: hrefs('a.bd-row'),              // BuildingCompactRow（楼盘「暂无在租」紧凑行）
      listingCard: hrefs('a.listing-card'),  // ListingCard（详情页相关推荐 / 楼盘供给）
      breadcrumb: hrefs('.breadcrumb__link'),
      buildingSummaryCta: hrefs('.building-summary-card a'),
      pager: hrefs('.ls-pager__item, .ls-pager__edge'),
      toolbar: hrefs('.ls-toolbar a[href]'),
    }
  })

  const all = [...prefetched].sort()
  const detailPrefetched = all.filter((p) => /^\/(listings|buildings|news)\/[^/?]+$/.test(p))
  const queryPrefetched = all.filter((p) => p.includes('?'))

  const entry = { url, links, prefetchedTotal: all.length, detailPrefetched, queryPrefetched, all }
  report.push(entry)

  console.log(`\n=== ${url} ===`)
  console.log(`  卡片链接数: ls-card=${links.lsCard.length} ls-rowcard=${links.lsRowCard.length} bd-card=${links.bdCard.length} bd-row=${links.bdRow.length} listing-card=${links.listingCard.length}`)
  console.log(`  面包屑: ${JSON.stringify(links.breadcrumb)}`)
  console.log(`  BuildingSummaryCard CTA: ${JSON.stringify(links.buildingSummaryCta)}`)
  console.log(`  预取总数: ${all.length}`)
  console.log(`  其中【详情页 URL】(${detailPrefetched.length}): ${JSON.stringify(detailPrefetched)}`)
  console.log(`  其中【带 query 的列表 URL】(${queryPrefetched.length}): ${JSON.stringify(queryPrefetched)}`)
  console.log(`  全量: ${JSON.stringify(all)}`)
  await page.close()
}

await browser.close()
if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8')
