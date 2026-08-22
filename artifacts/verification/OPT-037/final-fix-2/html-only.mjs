/**
 * 只抓 HTML（不截图），用于「预热后再取一次样」的二次比对。
 * 每个 URL **先读 HTTP 状态码**再取正文，非 200 打进 badStatus。
 * 用法：node html-only.mjs <origin> <tag>
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'file:///E:/github/sbh/payload-office-platform/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'

const OUT = 'E:/github/sbh/artifacts/verification/OPT-037/final-fix-2'
const ORIGIN = process.argv[2] ?? 'http://localhost:3802'
const TAG = process.argv[3] ?? 'x'
mkdirSync(OUT + '/' + TAG + '-html', { recursive: true })

const URLS = [
  '/', '/listings', '/buildings',
  '/buildings/west-nanjing-premium-center', '/buildings/huangpu-bund', '/buildings/empty-building',
  '/listings/lujiazui-grade-a-780sqm', '/listings/jingan-price-on-request-300sqm',
  '/listings/media-rich-listing', '/listings/jingan-serviced-office-42-seats',
  '/news', '/pages/privacy', '/entrust', '/publish', '/sale', '/city-partner',
  '/dev-story', '/dev-story/opt036', '/dev-story/opt037', '/dev-story/building-detail-demo',
]

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
const bad = []
for (const url of URLS) {
  const res = await page.goto(ORIGIN + url, { waitUntil: 'domcontentloaded' })
  const status = res ? res.status() : 0
  const body = res ? await res.text() : ''
  const file = url === '/' ? 'root' : url.replace(/^\//, '').replace(/[/?=&]/g, '_')
  writeFileSync(OUT + '/' + TAG + '-html/' + file + '.html', body)
  if (status !== 200) bad.push(url + '=' + status)
}
await browser.close()
console.log(JSON.stringify({ tag: TAG, badStatus: bad }))
