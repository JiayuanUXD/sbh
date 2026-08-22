/**
 * 补充运行时扫描：capture.mjs 的候选表漏掉的兄弟类（`.detail__decision-row` 这类
 * 「同族但不是后代」的独立类），以及 grep 判死后需要运行时二次确认的几条。
 * 用法：node scan-extra.mjs <origin> <before|after>
 */
import { writeFileSync } from 'node:fs'
import { chromium } from 'file:///E:/github/sbh/payload-office-platform/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'

const OUT = 'E:/github/sbh/artifacts/verification/OPT-037/final-fix-2'
const ORIGIN = process.argv[2] ?? 'http://localhost:3802'
const TAG = process.argv[3] ?? 'before'

const SELECTORS = [
  '.detail__decision-row', '.detail__decision-cta', '.detail__decision-title',
  '.amenity-list__group-title', '.amenity-list__items',
  '.route-planner__modes', '.route-planner__summary', '.route-planner__fallback',
  '.route-planner__trigger',
  '.advisor-availability__status--open', '.advisor-availability__status--closed',
  '.detail-facts__item',
  '.building-supply-overview__groups', '.building-supply-overview__group',
  '.detail__summary',
  '.ls-section', '.hm-lead', '.site-main--narrow', '.listing-card__rent',
  '.publish-card__error', '.text-copper', '.text-center',
  // 对照组
  '.detail__section', '.detail__mobile-bar', '.location-panel', '.detail__header',
  '.detail-gallery__tabs', '.building-supply-browser__table', '.site-main',
  '.listing-card__title', '.publish-card', '.text-muted', '.ls-card', '.hm-home',
]

const URLS = [
  '/', '/listings', '/buildings',
  '/buildings/west-nanjing-premium-center', '/buildings/huangpu-bund', '/buildings/empty-building',
  '/listings/lujiazui-grade-a-780sqm', '/listings/jingan-price-on-request-300sqm',
  '/listings/media-rich-listing', '/listings/jingan-serviced-office-42-seats',
  '/news', '/pages/privacy', '/entrust', '/publish', '/city-partner',
  '/dev-story/building-detail-demo',
]

const browser = await chromium.launch()
const totals = {}
for (const s of SELECTORS) totals[s] = 0
const rows = []
for (const url of URLS) {
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
    const hits = await page.evaluate((sels) => {
      const out = {}
      for (const s of sels) out[s] = document.querySelectorAll(s).length
      return out
    }, SELECTORS)
    for (const [s, n] of Object.entries(hits)) totals[s] += n
    rows.push({ url, width, status, hits: Object.fromEntries(Object.entries(hits).filter((e) => e[1] > 0)) })
    await page.close()
  }
}
await browser.close()
writeFileSync(OUT + '/scan-extra-' + TAG + '.json', JSON.stringify({ rows, totals }, null, 2))
console.log(JSON.stringify({
  tag: TAG,
  bad: rows.filter((r) => r.status !== 200).map((r) => r.url + '=' + r.status),
  zero: SELECTORS.filter((s) => totals[s] === 0),
  hit: SELECTORS.filter((s) => totals[s] > 0).map((s) => s + '=' + totals[s]),
}, null, 2))
