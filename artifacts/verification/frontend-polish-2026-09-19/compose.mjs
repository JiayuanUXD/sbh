/**
 * 把 header-shots.mjs 的 before / after 截图拼成一张对照图：
 * shots/{before,after}-*.png → header-search-footer-before-after.png。
 *
 * 图片以 data URI 内嵌（setContent 的 about:blank 页面不能加载 file://）。
 * 用法：node artifacts/verification/frontend-polish-2026-09-19/compose.mjs
 */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const APP = path.resolve(HERE, '..', '..', '..', 'payload-office-platform')
const { chromium } = createRequire(path.join(APP, 'package.json'))('@playwright/test')
const SHOTS = path.join(HERE, 'shots')

const ROWS = [
  ['home-scrolled', '首页滚动后（玻璃压在 hero 上）'],
  ['listings', '房源列表页（浅灰底）'],
  ['listings-hover', 'hover 态'],
  ['listings-focus', '聚焦态'],
  ['footer-bar', '页脚底栏'],
]
const uri = (file) => `data:image/png;base64,${readFileSync(path.join(SHOTS, file)).toString('base64')}`
const cell = (tag, name) => {
  try {
    return `<figure><figcaption>${tag}</figcaption><img src="${uri(`${tag}-${name}.png`)}"></figure>`
  } catch {
    return `<figure><figcaption>${tag}</figcaption><p class="missing">（无 ${tag}-${name}.png）</p></figure>`
  }
}
const html = `<html><body>
${ROWS.map(([n, label]) => `<section><h3>${label}</h3><div class="row">${cell('before', n)}${cell('after', n)}</div></section>`).join('')}
<style>
  body{margin:0;padding:16px;background:#fff;font:13px/1.4 -apple-system,'Microsoft YaHei',sans-serif;color:#333}
  section{margin-bottom:18px} h3{margin:0 0 6px;font-size:14px} .row{display:flex;gap:12px}
  figure{margin:0;flex:1;min-width:0} figcaption{font-size:11px;color:#888;margin-bottom:4px}
  img{width:100%;display:block;border:1px solid #ddd;border-radius:6px} .missing{color:#c00}
</style></body></html>`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 800 }, deviceScaleFactor: 1 })
await page.setContent(html, { waitUntil: 'load' })
const out = path.join(HERE, 'header-search-footer-before-after.png')
await page.screenshot({ path: out, fullPage: true })
await browser.close()
console.log(`→ ${path.relative(process.cwd(), out)}`)
