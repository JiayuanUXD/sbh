/**
 * OPT-037 Task 11 清理验收脚本
 *
 * 两个用途，同一份脚本跑两遍（改前 tag=before / 改后 tag=after）：
 *   1. 四断点（320 / 375 / 768 / 1440）截图，用于「删 CSS 前后视觉零差异」比对。
 *      320 是本批硬约束里的最窄真实设备宽度（brief §2.1），其余三档沿用 Task 10。
 *   2. 逐选择器实测「页面上有没有元素命中」——比 grep 更硬的死规则判据：
 *      grep 只能证明源码里没写，querySelectorAll 证明运行时真的没有元素。
 *      同时量出 documentElement.scrollWidth/clientWidth（页面级横向溢出）
 *      与 .hero-summary 的实际 padding（证明 styles.css 那条 767 padding 是否生效）。
 *
 * 用法：node task11-shots.mjs <origin> <before|after>
 */
import { chromium } from 'file:///E:/github/sbh/payload-office-platform/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'
import { gotoChecked } from './lib/sentinel.mjs'

const OUT = 'E:/github/sbh/artifacts/verification/OPT-037'
const ORIGIN = process.argv[2] ?? 'http://localhost:3801'
const TAG = process.argv[3] ?? 'before'
const SHOT_VIEWPORTS = [320, 375, 768, 1440]

/** 截图用例：本批改动实际触及的页面 */
const SHOT_CASES = [
  { name: 'building-nomedia', url: '/buildings/west-nanjing-premium-center' },
  { name: 'building-withmedia', url: '/dev-story/building-detail-demo' },
  { name: 'listing', url: '/listings/lujiazui-grade-a-780sqm' },
  { name: 'listings-index', url: '/listings' },
  { name: 'devstory-opt037', url: '/dev-story/opt037' },
]

/** 死规则候选：全站扫一遍，任一页命中即为「不可删」 */
const DEAD_CANDIDATES = [
  '.detail__summary',
  '.detail__decision',
  '.detail-section__header',
  '.detail-section__summary',
  '.detail-v2__titlebar',
  '.detail-v2__titlebar-actions',
  '.detail-v2__hero',
  '.detail-v2__supply',
  '.detail-v2__supply-main',
  '.detail-v2__subsection-title',
  '.detail-v2__features-body',
  '.detail-v2__location-band',
  '.hero-summary__facts',
  '.detail-side-rail__popular',
  // 对照组：这些必须命中，否则说明扫描本身没抓到详情页
  '.hero-summary',
  '.detail-side-rail',
  '.detail-side-rail__card',
  '.nearby-strip-wrap',
  '.dev-story-banner',
]

/** 全站扫描路由（覆盖所有可能残留旧类名的 C 端页面） */
const SCAN_URLS = [
  '/',
  '/listings',
  '/buildings',
  '/buildings/west-nanjing-premium-center',
  '/listings/lujiazui-grade-a-780sqm',
  '/listings/jingan-price-on-request-300sqm',
  '/listings/media-rich-listing',
  '/news',
  '/pages/privacy',
  '/entrust',
  '/publish',
  '/sale',
  '/city-partner',
  '/dev-story',
  '/dev-story/opt036',
  '/dev-story/opt037',
  '/dev-story/building-detail-demo',
]

const browser = await chromium.launch()
const report = { tag: TAG, shots: [], scan: [], selectorTotals: {} }
for (const sel of DEAD_CANDIDATES) report.selectorTotals[sel] = 0

// ── 1. 截图 + 断点级测量 ────────────────────────────────────────────────────
for (const { name, url } of SHOT_CASES) {
  for (const width of SHOT_VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    const errors = []
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    // ⚠️ 2026-08-22 终审第 3 轮补：截图循环原本**不记状态码**。
    // 这正是「/dev-story/opt037 四档 0 差异像素」那条假结论的直接成因——两侧都是 404 页。
    // 现在过共享哨兵（`lib/sentinel.mjs`），状态码与关键选择器缺失都写进产物。
    const sentinel = await gotoChecked(page, `${ORIGIN}${url}`)
    await page.evaluate(async () => {
      const step = window.innerHeight
      for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
        window.scrollTo({ top: y, behavior: 'instant' })
        await new Promise((r) => requestAnimationFrame(() => r()))
      }
      window.scrollTo({ top: 0, behavior: 'instant' })
    })
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${OUT}/task11-${TAG}-${name}-${width}.png`, fullPage: true })
    const measured = await page.evaluate(() => {
      const de = document.documentElement
      // 页面级横向溢出的「元凶清单」：所有右边界越过 clientWidth 的元素
      const offenders = []
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 && r.height === 0) continue
        const over = Math.round(r.right + window.scrollX - de.clientWidth)
        if (over > 0) offenders.push({ sel: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''), over })
      }
      offenders.sort((a, b) => b.over - a.over)
      const heroSummary = document.querySelector('.hero-summary')
      const keyspecs = document.querySelector('.dt-keyspecs')
      return {
        scrollWidth: de.scrollWidth,
        clientWidth: de.clientWidth,
        overflowPx: de.scrollWidth - de.clientWidth,
        offenders: offenders.slice(0, 6),
        heroSummaryPadding: heroSummary ? getComputedStyle(heroSummary).padding : null,
        keyspecsBox: keyspecs
          ? { w: Math.round(keyspecs.getBoundingClientRect().width), right: Math.round(keyspecs.getBoundingClientRect().right) }
          : null,
      }
    })
    report.shots.push({ case: name, url, width, sentinel, ...measured, consoleErrors: errors })
    await page.close()
  }
}

// ── 2. 全站死规则扫描（1440 + 375 两档，媒体查询下的条件渲染都覆盖到） ──────
for (const url of SCAN_URLS) {
  for (const width of [1440, 375]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    const status = (await page.goto(`${ORIGIN}${url}`, { waitUntil: 'domcontentloaded' }))?.status() ?? 0
    const hits = await page.evaluate((sels) => {
      const out = {}
      for (const s of sels) out[s] = document.querySelectorAll(s).length
      return out
    }, DEAD_CANDIDATES)
    for (const [sel, n] of Object.entries(hits)) report.selectorTotals[sel] += n
    report.scan.push({ url, width, status, hits: Object.fromEntries(Object.entries(hits).filter(([, n]) => n > 0)) })
    await page.close()
  }
}

await browser.close()
console.log(JSON.stringify(report, null, 2))
