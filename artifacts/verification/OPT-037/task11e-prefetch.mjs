/**
 * OPT-037 Task 11e：`/news/<slug>` 详情页「相关推荐」两组关系链接补 `prefetch={false}`
 * 的**实测**预取请求数。
 *
 * 沿用 11c/11d 的两条取样纪律（都是被漏检逼出来的，别改回去）：
 *   1. **保留 query string**，只剥 Next 自己加的 `_rsc` 指纹参数。11b 那版把 URL 归一成
 *      pathname，`/listings?district=<slug>` 这一整类链接的预取在证据里就是隐形的——
 *      而本轮补的两组里，恰好有一组就是这个形态。
 *   2. **按选择器分类点数**，别只数一个 class 名就下结论。
 *
 * 本轮新增统计的选择器：
 *   - `a.news-detail__related-link`  文章详情页「相关楼盘 / 相关商圈」两组
 *     （`app/(frontend)/news/[slug]/page.tsx`，同一个 class，两组共用）
 *
 * 用法：node task11e-prefetch.mjs <origin> [输出 json 路径]
 */
import { writeFileSync } from 'node:fs'
import { chromium } from 'file:///E:/github/sbh/payload-office-platform/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'

const ORIGIN = process.argv[2] ?? 'http://localhost:3805'
const OUT = process.argv[3] ?? null

const CASES = [
  // 本轮目标：本地夹具给 article#4 挂了 6 个楼盘 + 5 个商圈（详见 task11e-fixture.mjs）
  '/news/jingan-temple-district-why-popular',
  // 对照：同一模板但没有任何关系的文章，改动后应当仍然 ±0
  '/news/2026-shanghai-office-market-h1',
  // 回归对照：11d 已处理，本轮不应被触碰
  '/news',
  '/buildings/west-nanjing-premium-center',
  '/listings/lujiazui-grade-a-780sqm',
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
      newsRelated: hrefs('a.news-detail__related-link'),
      articleCard: hrefs('a.article-card__link'),
      buildingCardMini: hrefs('a.building-card-mini'),
      buildingSummaryCta: hrefs('a.building-summary-card__cta'),
      breadcrumb: hrefs('.breadcrumb__link'),
      lsCard: hrefs('a.ls-card'),
      bdCard: hrefs('a.bd-card'),
    }
  })

  const all = [...prefetched].sort()
  // 本轮两组链接的两种形态：/buildings/<slug> 与 /listings?district=<slug>
  const relatedTargets = all.filter(
    (p) => /^\/buildings\/[^/?]+$/.test(p) || /^\/listings\?district=/.test(p),
  )
  /**
   * ⚠️ 2026-08-22 终审第 3 轮修：原正则是 `/^\/(listings|buildings|news)\/[^/?]+$/`，
   * `$` 卡在 slug 后面 —— **任何带 query 的详情页都被排除在「详情页 URL」之外**
   * （`/buildings/<slug>?group=coworking`、`/listings/<slug>?from=...` 全部隐形）。
   * 这与 11b「把 URL 归一成 pathname」是同一族漏检：判据把一整类目标悄悄划出了统计。
   * 现在只匹配路径段，query 保留在 `all` / `queryPrefetched` 里另算。
   */
  const detailPrefetched = all.filter((p) => /^\/(?:[a-z][a-z0-9-]*\/)?(listings|buildings|news)\/[^/?#]+(?:[?#]|$)/.test(p))
  const queryPrefetched = all.filter((p) => p.includes('?'))

  report.push({
    url,
    links,
    prefetchedTotal: all.length,
    relatedTargets,
    detailPrefetched,
    queryPrefetched,
    all,
  })

  console.log(`\n=== ${url} ===`)
  console.log(
    `  链接数: newsRelated=${links.newsRelated.length} article=${links.articleCard.length} mini=${links.buildingCardMini.length} summaryCta=${links.buildingSummaryCta.length} ls-card=${links.lsCard.length} bd-card=${links.bdCard.length}`,
  )
  console.log(`  news 相关推荐 hrefs: ${JSON.stringify(links.newsRelated)}`)
  console.log(`  面包屑: ${JSON.stringify(links.breadcrumb)}`)
  console.log(`  预取总数: ${all.length}`)
  console.log(`  其中【相关推荐目标 URL】(${relatedTargets.length}): ${JSON.stringify(relatedTargets)}`)
  console.log(`  其中【详情页 URL】(${detailPrefetched.length}): ${JSON.stringify(detailPrefetched)}`)
  console.log(`  其中【带 query 的 URL】(${queryPrefetched.length}): ${JSON.stringify(queryPrefetched)}`)
  console.log(`  全量: ${JSON.stringify(all)}`)
  await page.close()
}

await browser.close()
if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8')
