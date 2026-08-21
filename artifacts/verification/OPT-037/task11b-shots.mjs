/**
 * OPT-037 Task 11b 验收脚本（裁定 1「侧栏只留留资卡」+ 裁定 2「Breadcrumb prefetch 回退」）
 *
 * 与 Task 11 的 `task11-shots.mjs` 同一套路，三点差异：
 *   1. 断点改成控制方点名的 **375 / 768 / 1440 / 1920**（Task 11 用的是 320/375/768/1440）；
 *   2. 增加**埋点核查**：把页面上所有 `[data-event-name="inquiry_open_trigger"]` 的
 *      `data-source-section` / `data-page-type` / 按钮文案全量导出，用来证明
 *      「摘掉一个 AdvisorCard 实例后没有丢掉任何一个 source」——这是 grep 证不了的，
 *      因为 source 值是否仍有元素承载只有渲染后才知道；
 *   3. 选择器扫描的候选换成本次会失活的那批（`.detail-side-rail__price` 等）+ 对照组。
 *
 * `/dev-story/opt037` 在 `next start`（NODE_ENV=production）下**恒 404**
 * （其 page.tsx:863 显式 notFound），所以本脚本不再把它算进截图集——
 * 拿两张 404 页比像素得到的「0 差异」是假的。楼盘 + 有图画廊的入口用
 * `/dev-story/building-detail-demo`（无该守卫）。
 *
 * 用法：node task11b-shots.mjs <origin> <before|after>
 */
import { chromium } from 'file:///E:/github/sbh/payload-office-platform/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'

const OUT = 'E:/github/sbh/artifacts/verification/OPT-037'
const ORIGIN = process.argv[2] ?? 'http://localhost:3805'
const TAG = process.argv[3] ?? 'before'
const SHOT_VIEWPORTS = [375, 768, 1440, 1920]

/** 截图用例：本批改动实际触及的页面 */
const SHOT_CASES = [
  { name: 'building-nomedia', url: '/buildings/west-nanjing-premium-center' },
  { name: 'building-withmedia', url: '/dev-story/building-detail-demo' },
  { name: 'listing', url: '/listings/lujiazui-grade-a-780sqm' },
  { name: 'listings-index', url: '/listings' },
]

/** 本次会失活的候选（改后应全 0）+ 对照组（改前改后都必须命中） */
const SELECTORS = [
  '.detail-side-rail__price',
  '.detail-side-rail .advisor-card',
  // 对照
  '.detail-side-rail',
  '.detail-side-rail__card',
  '.detail-side-rail__muted',
  '.hero-summary',
  '.hero-summary .advisor-card',
  '.breadcrumb__link',
]

/** 全站扫描路由 */
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
  '/dev-story/building-detail-demo',
]

/** 询价入口全量导出（埋点核查） + 面包屑链接的 prefetch 判据 */
const AUDIT_URLS = [
  '/buildings/west-nanjing-premium-center',
  '/dev-story/building-detail-demo',
  '/listings/lujiazui-grade-a-780sqm',
]

const browser = await chromium.launch()
const report = { tag: TAG, shots: [], scan: [], selectorTotals: {}, inquiryAudit: [] }
for (const sel of SELECTORS) report.selectorTotals[sel] = 0

// ── 1. 截图 + 断点级测量 ────────────────────────────────────────────────────
for (const { name, url } of SHOT_CASES) {
  for (const width of SHOT_VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    const errors = []
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    await page.goto(`${ORIGIN}${url}`, { waitUntil: 'networkidle' })
    await page.evaluate(async () => {
      const step = window.innerHeight
      for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
        window.scrollTo({ top: y, behavior: 'instant' })
        await new Promise((r) => requestAnimationFrame(() => r()))
      }
      window.scrollTo({ top: 0, behavior: 'instant' })
    })
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${OUT}/task11b-${TAG}-${name}-${width}.png`, fullPage: true })
    const measured = await page.evaluate(() => {
      const de = document.documentElement
      const offenders = []
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 && r.height === 0) continue
        const over = Math.round(r.right + window.scrollX - de.clientWidth)
        if (over > 0) offenders.push({ sel: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''), over })
      }
      offenders.sort((a, b) => b.over - a.over)
      const rail = document.querySelector('.detail-side-rail')
      const railCards = [...document.querySelectorAll('.detail-side-rail__card')]
      return {
        scrollWidth: de.scrollWidth,
        clientWidth: de.clientWidth,
        overflowPx: de.scrollWidth - de.clientWidth,
        offenders: offenders.slice(0, 6),
        // 卡片带的实测形态：列数取值 + 每张卡的实测宽度（证明「单卡横贯」而不是
        // 「一张卡挂在多列网格左端」——后者的卡宽会明显小于 rail 宽）
        rail: rail
          ? {
              display: getComputedStyle(rail).display,
              gridTemplateColumns: getComputedStyle(rail).gridTemplateColumns,
              width: Math.round(rail.getBoundingClientRect().width),
              cards: railCards.map((c) => Math.round(c.getBoundingClientRect().width)),
            }
          : null,
      }
    })
    report.shots.push({ case: name, url, width, ...measured, consoleErrors: errors })
    await page.close()
  }
}

// ── 2. 全站选择器扫描（1440 + 375 两档） ────────────────────────────────────
for (const url of SCAN_URLS) {
  for (const width of [1440, 375]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    const status = (await page.goto(`${ORIGIN}${url}`, { waitUntil: 'domcontentloaded' }))?.status() ?? 0
    const hits = await page.evaluate((sels) => {
      const out = {}
      for (const s of sels) out[s] = document.querySelectorAll(s).length
      return out
    }, SELECTORS)
    for (const [sel, n] of Object.entries(hits)) report.selectorTotals[sel] += n
    report.scan.push({ url, width, status, hits: Object.fromEntries(Object.entries(hits).filter(([, n]) => n > 0)) })
    await page.close()
  }
}

// ── 3. 询价入口埋点全量导出 + 面包屑链接清单 ────────────────────────────────
for (const url of AUDIT_URLS) {
  for (const width of [1440, 375]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    await page.goto(`${ORIGIN}${url}`, { waitUntil: 'networkidle' })
    const audit = await page.evaluate(() => ({
      triggers: [...document.querySelectorAll('[data-event-name="inquiry_open_trigger"]')].map((el) => ({
        section: el.getAttribute('data-source-section'),
        pageType: el.getAttribute('data-page-type'),
        label: (el.textContent ?? '').trim(),
        // 是否可见（display:none 的移动端底条在 1440 上不参与曝光，但 DOM 里在）
        visible: el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0,
      })),
      breadcrumbLinks: [...document.querySelectorAll('.breadcrumb__link')].map((el) => ({
        href: el.getAttribute('href'),
        text: (el.textContent ?? '').trim(),
      })),
    }))
    report.inquiryAudit.push({ url, width, ...audit })
    await page.close()
  }
}

await browser.close()
console.log(JSON.stringify(report, null, 2))
