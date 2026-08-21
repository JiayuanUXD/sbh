/**
 * OPT-037 终审修复第 2 轮（收敛 + 基元复用 + 死代码）验收脚本。
 *
 * 同一份脚本跑两遍（改前 tag=before / 改后 tag=after）：
 *   1. **先读 HTTP 状态码**再取 HTML —— 本批出过「两侧都是 404 页，比出 DOM 完全
 *      一致」的假绿，故每个 URL 的 status 都写进产物，非 200 一律进 badStatus。
 *   2. HTML 原文落盘，供 `diff` 逐字节比对。
 *   3. 四断点（320/375/768/1440）全页截图 + 关键节点 computed style 快照。
 *   4. 运行时 `querySelectorAll` 扫描死 CSS 候选（比 grep 更硬：grep 只能证明
 *      源码没写，querySelectorAll 证明页面上真的没有元素），附对照选择器。
 *
 * 用法：node capture.mjs <origin> <before|after>
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'file:///E:/github/sbh/payload-office-platform/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'

const OUT = 'E:/github/sbh/artifacts/verification/OPT-037/final-fix-2'
const ORIGIN = process.argv[2] ?? 'http://localhost:3802'
const TAG = process.argv[3] ?? 'before'
mkdirSync(OUT + '/' + TAG, { recursive: true })
mkdirSync(OUT + '/' + TAG + '-html', { recursive: true })

const SHOT_VIEWPORTS = [320, 375, 768, 1440]

/** 截图用例：本批 CSS/组件改动可能溢出到的页面 */
const SHOT_CASES = [
  { name: 'building-nomedia', url: '/buildings/west-nanjing-premium-center' },
  { name: 'building-withmedia', url: '/dev-story/building-detail-demo' },
  { name: 'building-empty', url: '/buildings/empty-building' },
  { name: 'listing', url: '/listings/lujiazui-grade-a-780sqm' },
  { name: 'listing-so', url: '/listings/jingan-serviced-office-42-seats' },
  { name: 'listings-index', url: '/listings' },
  { name: 'buildings-index', url: '/buildings' },
  { name: 'home', url: '/' },
  { name: 'news', url: '/news' },
]

/** 全站扫描路由 */
const SCAN_URLS = [
  '/', '/listings', '/buildings',
  '/buildings/west-nanjing-premium-center', '/buildings/huangpu-bund', '/buildings/empty-building',
  '/listings/lujiazui-grade-a-780sqm', '/listings/jingan-price-on-request-300sqm',
  '/listings/media-rich-listing', '/listings/jingan-serviced-office-42-seats',
  '/news', '/pages/privacy', '/entrust', '/publish', '/sale', '/city-partner',
  '/dev-story', '/dev-story/opt036', '/dev-story/opt037', '/dev-story/building-detail-demo',
]

/** 死规则候选（D2）。 */
const DEAD_CANDIDATES = [
  '.amenity-list', '.amenity-list__item', '.amenity-list__icon', '.amenity-list__label',
  '.route-planner', '.route-planner__mode', '.route-planner__result',
  '.advisor-availability', '.advisor-availability__status',
  '.detail-facts', '.detail-facts__group', '.detail-facts__estimated',
  '.detail-hero', '.detail__overview', '.detail__rent',
  '.detail__specs', '.detail__decision', '.building-supply-overview',
  '.detail__amenities', '.detail__top', '.detail__type', '.detail__tags',
  '.detail__building-summary', '.detail__header-tags', '.detail__grade-badge',
  '.detail-gallery__panel',
  '.location-panel__static', '.location-panel__facts', '.location-panel__fact', '.location-panel__actions',
  '.text-copper', '.text-center', '.site-main--narrow', '.listing-card__rent',
  '.publish-card__error', '.ls-section', '.hm-lead',
  '.landing-hero--split', '.landing-hero--centered',
  '.process-steps--card', '.process-steps--compact',
  '.city-switcher__status--live', '.city-switcher__status--coming-soon',
]

/** 对照组：必须命中，证明扫描确实抓到了页面而不是一堆 404 */
const CONTROL = [
  '.dt-page', '.dt-panel', '.hero-summary', '.building-card-mini',
  '.detail-side-rail__card', '.location-panel__poi-panel', '.sf-card', '.sf-media',
  '.dt-spec__value', '.dt-keyspecs__value', '.dt-decision__price-num',
  '.dt-sticky-bar__price-num', '.location-panel__poi-distance', '.hero-summary__price',
  '.detail-gallery__main-counter', '.dt-decision__verify-when',
]

const ALL_SEL = [...DEAD_CANDIDATES, ...CONTROL]

const browser = await chromium.launch()
const report = { tag: TAG, origin: ORIGIN, badStatus: [], shots: [], scan: [], selectorTotals: {} }
for (const s of ALL_SEL) report.selectorTotals[s] = 0

// 1. HTML 原文 + 状态码
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  for (const url of SCAN_URLS) {
    const res = await page.goto(ORIGIN + url, { waitUntil: 'domcontentloaded' })
    const status = res ? res.status() : 0
    const body = res ? await res.text() : ''
    const file = url === '/' ? 'root' : url.replace(/^\//, '').replace(/[/?=&]/g, '_')
    writeFileSync(OUT + '/' + TAG + '-html/' + file + '.html', body)
    if (status !== 200) report.badStatus.push({ url, status })
    report.scan.push({ url, status })
  }
  await ctx.close()
}

// 2. 四断点截图 + computed style 快照
for (const shotCase of SHOT_CASES) {
  for (const width of SHOT_VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    const errors = []
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    const res = await page.goto(ORIGIN + shotCase.url, { waitUntil: 'networkidle' })
    const status = res ? res.status() : 0
    await page.evaluate(async () => {
      const step = window.innerHeight
      for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
        window.scrollTo({ top: y, behavior: 'instant' })
        await new Promise((r) => requestAnimationFrame(() => r()))
      }
      window.scrollTo({ top: 0, behavior: 'instant' })
    })
    await page.waitForTimeout(400)
    await page.screenshot({ path: OUT + '/' + TAG + '/' + shotCase.name + '-' + width + '.png', fullPage: true })
    const measured = await page.evaluate(() => {
      const de = document.documentElement
      const pick = (sel, props) => {
        const el = document.querySelector(sel)
        if (!el) return null
        const cs = getComputedStyle(el)
        const out = {}
        for (const p of props) out[p] = cs.getPropertyValue(p)
        const r = el.getBoundingClientRect()
        out._box = Math.round(r.width) + 'x' + Math.round(r.height)
        return out
      }
      return {
        overflowPx: de.scrollWidth - de.clientWidth,
        card: pick('.building-card-mini', ['display', 'flex-direction', 'background-color', 'border-top-width', 'border-radius', 'box-shadow', 'overflow', 'text-decoration-line', 'transition-duration', 'transition-property']),
        cardMedia: pick('.building-card-mini__media', ['aspect-ratio', 'background-color', 'position', 'display', 'overflow']),
        cardBody: pick('.building-card-mini__body', ['display', 'flex-direction', 'padding', 'gap']),
        cardName: pick('.building-card-mini__name', ['font-size', 'font-weight', 'white-space', 'text-overflow', 'letter-spacing', 'line-height', 'margin-top']),
        cardDistrict: pick('.building-card-mini__district', ['background-color', 'border-radius', 'border-top-width', 'font-size']),
        cardAddress: pick('.building-card-mini__address', ['font-size', 'color', 'margin-top']),
        cardPlaceholder: pick('.building-card-mini__placeholder', ['display', 'width', 'height', 'color']),
        railCard: pick('.detail-side-rail__card', ['background-color', 'border-top-width', 'border-radius', 'padding', 'display']),
        poiPanel: pick('.location-panel__poi-panel', ['background-color', 'border-top-width', 'border-radius', 'box-shadow', 'position', 'height']),
        poiSubtab: pick('.location-panel__poi-subtab', ['border-radius', 'background-color']),
        specValue: pick('.dt-spec__value', ['font-variant-numeric', 'font-feature-settings', 'text-align']),
        keyspecValue: pick('.dt-keyspecs__value', ['font-variant-numeric', 'font-feature-settings', 'letter-spacing', 'font-size']),
        nomediaTitle: pick('.dt-nomedia__title', ['letter-spacing', 'font-size']),
        heroPrice: pick('.hero-summary__price', ['font-variant-numeric', 'font-size']),
        heroStat: pick('.hero-summary__stat strong', ['font-variant-numeric', 'font-size']),
        decisionPrice: pick('.dt-decision__price-num', ['font-variant-numeric', 'font-size']),
        verifyWhen: pick('.dt-decision__verify-when', ['font-variant-numeric']),
        poiDistance: pick('.location-panel__poi-distance', ['font-variant-numeric']),
        galleryCounter: pick('.detail-gallery__main-counter', ['font-variant-numeric', 'background-color', 'border-radius']),
        stickyPrice: pick('.dt-sticky-bar__price-num', ['font-variant-numeric']),
        pinLabel: pick('.amap-map-canvas__pin-label', ['background-color', 'color']),
        pinMarker: pick('.amap-map-canvas__pin-marker', ['background-color', 'border-top-color', 'color']),
        pinDot: pick('.amap-map-canvas__pin-dot', ['background-color']),
        sfCard: pick('.sf-card', ['transition-duration']),
      }
    })
    report.shots.push(Object.assign({ case: shotCase.name, url: shotCase.url, width, status }, measured, { consoleErrors: errors }))
    await page.close()
  }
}

// 3. 全站运行时选择器扫描（1440 + 375）
const hitsByUrl = []
for (const url of SCAN_URLS) {
  for (const width of [1440, 375]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    const res = await page.goto(ORIGIN + url, { waitUntil: 'networkidle' })
    const status = res ? res.status() : 0
    await page.evaluate(async () => {
      const step = window.innerHeight
      for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
        window.scrollTo({ top: y, behavior: 'instant' })
        await new Promise((r) => requestAnimationFrame(() => r()))
      }
    })
    await page.waitForTimeout(300)
    const hits = await page.evaluate((sels) => {
      const out = {}
      for (const s of sels) out[s] = document.querySelectorAll(s).length
      return out
    }, ALL_SEL)
    for (const [sel, n] of Object.entries(hits)) report.selectorTotals[sel] += n
    hitsByUrl.push({ url, width, status, hits: Object.fromEntries(Object.entries(hits).filter((e) => e[1] > 0)) })
    await page.close()
  }
}
report.scanHits = hitsByUrl

await browser.close()
writeFileSync(OUT + '/report-' + TAG + '.json', JSON.stringify(report, null, 2))
const deadNow = DEAD_CANDIDATES.filter((s) => report.selectorTotals[s] === 0)
const aliveNow = DEAD_CANDIDATES.filter((s) => report.selectorTotals[s] > 0)
const controlMiss = CONTROL.filter((s) => report.selectorTotals[s] === 0)
console.log(JSON.stringify({
  tag: TAG,
  badStatus: report.badStatus,
  controlMiss,
  runtimeZeroHit: deadNow,
  runtimeHit: aliveNow.map((s) => s + '=' + report.selectorTotals[s]),
  overflow: report.shots.filter((s) => s.overflowPx > 0).map((s) => s.case + '@' + s.width + ':' + s.overflowPx),
  consoleErrors: report.shots.filter((s) => s.consoleErrors.length).map((s) => s.case + '@' + s.width),
}, null, 2))
