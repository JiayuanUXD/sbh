/**
 * OPT-037 终审第 3 轮 R6：Task 10b「有图时一个字节都不许变」的 HTML 取样。
 *
 * 为什么补：`task-10b-report.md:150-160` 给了四行 diff 计数，但**无脚本、无 HTML、
 * §8 证据清单里也没列**——正是本批第①条规矩（验证脚本随证据提交）要防的形态。
 *
 * 取样纪律（第 2 轮实测出来的，别省）：
 *   1. **热 vs 热**。冷启动首访与复访的 RSC flight 切块边界不同，且高德 POI 子树
 *      在冷抓时可能整块拿不到。先 warm 再抓。
 *   2. **配噪声本底对照组**：同一个构建连抓两次（`-ctrl` 后缀），拿它当「零改动应有的
 *      差异量」。没有对照组时，任何非零差异都无法归因。
 *   3. **每个 URL 先读 HTTP 状态码**，写进 `status.json`（哨兵判据见 `lib/sentinel.json`）。
 *      两个 404 页逐字节比对会打印「完全一致」——本批已经因此产生过一次假结论。
 *
 * 用法：node capture-html.mjs <origin> <输出目录名> [页面集名 r6|r7c]
 *
 * 页面集写在同一个 SETS 里而不是复制一份脚本——本批「同一逻辑多处」已经栽过 8 次。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'file:///E:/github/sbh/payload-office-platform/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'
import { sentinelFromHtml } from '../lib/sentinel.mjs'

const DIR = 'E:/github/sbh/artifacts/verification/OPT-037/final-fix-3'
const ORIGIN = process.argv[2] ?? 'http://localhost:3820'
const TAG = process.argv[3] ?? 'x'
const OUT = `${DIR}/${TAG}-html`
mkdirSync(OUT, { recursive: true })

const SETS = {
  /** R6 / Task 10b：判据只落在「有图」路径上；`buildings/*` 是**无图**路径，作为「应当变」的反向对照。 */
  r6: {
    'listing-media-rich': '/listings/media-rich-listing',
    'listing-serviced': '/listings/jingan-serviced-office-42-seats',
    'building-demo-with-media': '/dev-story/building-detail-demo',
    'building-no-media-control': '/buildings/west-nanjing-premium-center',
  },
  /** R7 / Task 11c：重建那一轮丢失的 HTML 输入，页面集与 `task11c-domdiff.py` 的 PAGES 一致。 */
  r7c: {
    listings: '/listings',
    'listings-row': '/listings?view=row',
    buildings: '/buildings',
    'listing-detail': '/listings/lujiazui-grade-a-780sqm',
    'building-detail': '/buildings/west-nanjing-premium-center',
  },
}
const PAGES = SETS[process.argv[4] ?? 'r6']
if (!PAGES) throw new Error(`未知页面集：${process.argv[4]}（可选 ${Object.keys(SETS).join(' / ')}）`)

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()

// ── 预热：每条 URL 连打 3 次 ────────────────────────────────────────────
for (let round = 0; round < 3; round += 1) {
  for (const path of Object.values(PAGES)) {
    // eslint-disable-next-line no-await-in-loop
    await page.goto(ORIGIN + path, { waitUntil: 'networkidle' })
  }
}

const status = {}
for (const [name, path] of Object.entries(PAGES)) {
  const res = await page.goto(ORIGIN + path, { waitUntil: 'networkidle' })
  const code = res ? res.status() : 0
  const html = res ? await res.text() : ''
  writeFileSync(`${OUT}/${name}.html`, html, 'utf8')
  const s = sentinelFromHtml(path, code, html)
  status[name] = { path, status: code, sentinelOk: s.ok, family: s.family, missing: s.missing }
}
writeFileSync(`${OUT}/status.json`, JSON.stringify(status, null, 2), 'utf8')
await browser.close()

const bad = Object.entries(status).filter(([, v]) => !v.sentinelOk)
console.log(`[capture-html] tag=${TAG} origin=${ORIGIN} 页面集=${process.argv[4] ?? 'r6'}`)
for (const [name, v] of Object.entries(status)) {
  console.log(`  ${name.padEnd(28)} ${v.path.padEnd(46)} HTTP ${v.status}  哨兵=${v.sentinelOk ? 'PASS' : 'FAIL ' + JSON.stringify(v.missing)}`)
}
if (bad.length) {
  console.error('[capture-html] 有页面未通过渲染哨兵，后续比对结论不成立')
  process.exitCode = 1
}
