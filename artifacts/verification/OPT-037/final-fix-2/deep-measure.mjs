/**
 * 逐属性 computed-style 快照：本轮所有「删 CSS / 换基元」触碰到的节点，
 * 把它们的**全部**相关计算值在四断点上录下来，改前改后逐字段 diff。
 * 截图能看出大差异，这份能抓住「视觉上看不出、但确实变了」的 1px 级偏移。
 * 用法：node deep-measure.mjs <origin> <before|after>
 */
import { writeFileSync } from 'node:fs'
import { chromium } from 'file:///E:/github/sbh/payload-office-platform/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'

const OUT = 'E:/github/sbh/artifacts/verification/OPT-037/final-fix-2'
const ORIGIN = process.argv[2] ?? 'http://localhost:3802'
const TAG = process.argv[3] ?? 'before'

const PROPS = [
  'display', 'flex-direction', 'flex-wrap', 'position', 'top', 'right', 'bottom', 'left',
  'width', 'height', 'max-height', 'min-height', 'margin', 'padding', 'gap',
  'background-color', 'border-top-width', 'border-top-style', 'border-top-color',
  'border-radius', 'box-shadow', 'overflow', 'overflow-x', 'overflow-y', 'z-index',
  'color', 'font-size', 'font-weight', 'line-height', 'letter-spacing',
  'font-variant-numeric', 'font-feature-settings', 'text-align', 'text-decoration-line',
  'transition-property', 'transition-duration', 'transition-timing-function',
  'aspect-ratio', 'object-fit', 'white-space', 'text-overflow', 'align-items',
  'justify-content', 'grid-template-columns', 'transform', 'opacity', 'backdrop-filter',
]

const TARGETS = [
  '.building-card-mini', '.building-card-mini__media', '.building-card-mini__media img',
  '.building-card-mini__body', '.building-card-mini__name', '.building-card-mini__district',
  '.building-card-mini__address', '.building-card-mini__placeholder',
  '.detail-side-rail', '.detail-side-rail__card', '.detail-side-rail__card h3',
  '.detail-side-rail__band-copy', '.detail-side-rail__muted',
  '.location-panel__poi-panel', '.location-panel__pois', '.location-panel__poi-tab',
  '.location-panel__poi-subtabs', '.location-panel__poi-subtab', '.location-panel__poi-list',
  '.location-panel__poi-item', '.location-panel__poi-letter', '.location-panel__poi-name',
  '.location-panel__poi-distance',
  '.dt-panel', '.dt-panel--full', '.dt-panel--side',
  '.dt-spec__value', '.dt-keyspecs__value', '.dt-nomedia__title',
  '.hero-summary', '.hero-summary__price', '.hero-summary__price-row',
  '.hero-summary__price-unit', '.hero-summary__disclaimer', '.hero-summary__stats',
  '.hero-summary__stat strong', '.hero-summary__stat span',
  '.dt-decision__price-num', '.dt-decision__verify-when',
  '.detail-gallery__main-counter', '.dt-sticky-bar__price-num',
  '.amap-map-canvas__pin-label', '.amap-map-canvas__pin-marker', '.amap-map-canvas__pin-dot',
  '.dt-related-grid', '.dt-building-spec__feature-list li',
  '.dt-titlebar__subtitle', '.dt-h3',
]

const URLS = [
  { name: 'building', url: '/buildings/west-nanjing-premium-center' },
  { name: 'building-media', url: '/dev-story/building-detail-demo' },
  { name: 'listing', url: '/listings/lujiazui-grade-a-780sqm' },
]

const browser = await chromium.launch()
const out = {}
for (const t of URLS) {
  for (const width of [320, 375, 768, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    const res = await page.goto(ORIGIN + t.url, { waitUntil: 'networkidle' })
    const status = res ? res.status() : 0
    if (status !== 200) { out[t.name + '@' + width] = { status }; await page.close(); continue }
    await page.evaluate(async () => {
      const step = window.innerHeight
      for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
        window.scrollTo({ top: y, behavior: 'instant' })
        await new Promise((r) => requestAnimationFrame(() => r()))
      }
      window.scrollTo({ top: 0, behavior: 'instant' })
    })
    await page.waitForTimeout(300)
    const data = await page.evaluate((args) => {
      const [targets, props] = args
      const res = {}
      for (const sel of targets) {
        const els = document.querySelectorAll(sel)
        res[sel] = { count: els.length }
        if (els.length === 0) continue
        const el = els[0]
        const cs = getComputedStyle(el)
        for (const p of props) res[sel][p] = cs.getPropertyValue(p)
        const r = el.getBoundingClientRect()
        res[sel]._rect = [Math.round(r.width * 100) / 100, Math.round(r.height * 100) / 100]
      }
      return res
    }, [TARGETS, PROPS])
    out[t.name + '@' + width] = { status, data }
    await page.close()
  }
}
await browser.close()
writeFileSync(OUT + '/deep-' + TAG + '.json', JSON.stringify(out, null, 2))
console.log('written deep-' + TAG + '.json; pages=' + Object.keys(out).length)
