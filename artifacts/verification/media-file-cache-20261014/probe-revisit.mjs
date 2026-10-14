/**
 * 首页「首访 vs 回访」时 /api/media/file/* 到底有几个请求打到了服务器。
 *
 * 用法：[PW_EXECUTABLE=/opt/pw-browsers/chromium] node probe-revisit.mjs <origin> <out.json> [--proxy]
 *   origin   http://localhost:3780 或 https://shangban.cc
 *   --proxy  走 $HTTPS_PROXY（云端会话访问线上时需要）
 *
 * 判据（CDP Network 事件）：
 *   - servedFromCache = 收到 Network.requestServedFromCache，或 responseReceived 带
 *     fromDiskCache / fromMemoryCache —— 这类请求**没有**到服务器；
 *   - 其余都算「打到服务器」，并按状态码分桶（回访时没缓存头会是一串 304）。
 * 同一个 BrowserContext 里开两个新页面各 goto 一次：磁盘缓存跨页面共享，内存缓存不共享，
 * 第二页量到的就是「关掉标签页、过会儿再回来」的形态。
 * 页面先过 OPT-037 共享哨兵（状态码 + 首页关键选择器），不过就抛——不量空页。
 */
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { gotoChecked } from '../OPT-037/lib/sentinel.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(path.resolve(HERE, '../../../payload-office-platform/package.json'))
const { chromium } = require('@playwright/test')

const [origin, outFile] = process.argv.slice(2)
const useProxy = process.argv.includes('--proxy')
if (!origin || !outFile) throw new Error('usage: node probe-revisit.mjs <origin> <out.json> [--proxy]')

const MEDIA = '/api/media/file/'
// 桌面视口才会加载背景视频（HomeHeroMedia 的移动端闸门），且要等 requestIdleCallback。
const VIEWPORT = { width: 1440, height: 900 }
const SETTLE_MS = 6000

async function visit(context, label) {
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  await cdp.send('Network.enable')
  const reqs = new Map()
  cdp.on('Network.requestWillBeSent', (e) => {
    if (e.request.url.includes(MEDIA)) reqs.set(e.requestId, { url: e.request.url, cached: false })
  })
  cdp.on('Network.requestServedFromCache', (e) => {
    const r = reqs.get(e.requestId)
    if (r) r.cached = true
  })
  cdp.on('Network.responseReceived', (e) => {
    const r = reqs.get(e.requestId)
    if (!r) return
    r.status = e.response.status
    if (e.response.fromDiskCache || e.response.fromMemoryCache) r.cached = true
    const h = Object.fromEntries(Object.entries(e.response.headers).map(([k, v]) => [k.toLowerCase(), v]))
    r.cacheControl = h['cache-control'] ?? null
  })
  cdp.on('Network.loadingFinished', (e) => {
    const r = reqs.get(e.requestId)
    if (r) r.encodedBytes = e.encodedDataLength
  })
  const consoleErrors = []
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text())
  })

  const sentinel = await gotoChecked(page, origin + '/')
  if (!sentinel.ok) throw new Error(`${label}: 哨兵未过 ${JSON.stringify(sentinel)}`)
  // 滚到底触发 lazy 图，再回顶等视频的 idle 加载
  await page.evaluate(async () => {
    document.documentElement.style.scrollBehavior = 'auto'
    for (let y = 0; y < document.body.scrollHeight; y += 600) {
      window.scrollTo(0, y)
      await new Promise((r) => setTimeout(r, 150))
    }
    window.scrollTo(0, 0)
  })
  await page.waitForTimeout(SETTLE_MS)
  const shot = path.join(HERE, `home-${label}-${new URL(origin).hostname}.png`)
  await page.screenshot({ path: shot })
  await page.close()

  const list = [...reqs.values()]
  const hitServer = list.filter((r) => !r.cached)
  const byStatus = {}
  for (const r of hitServer) byStatus[r.status ?? 'none'] = (byStatus[r.status ?? 'none'] ?? 0) + 1
  return {
    label,
    sentinel,
    mediaRequests: list.length,
    servedFromCache: list.length - hitServer.length,
    hitServer: hitServer.length,
    hitServerByStatus: byStatus,
    bytesFromServer: hitServer.reduce((s, r) => s + (r.encodedBytes ?? 0), 0),
    cacheControlSeen: [...new Set(list.map((r) => r.cacheControl ?? '(none)'))],
    consoleErrors,
    screenshot: path.basename(shot),
  }
}

// 云端会话预装 Chromium 版本与 @playwright/test 期望的不同，用 PW_EXECUTABLE 指过去，别下载。
const browser = await chromium.launch({
  ...(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {}),
  ...(useProxy && process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {}),
})
const context = await browser.newContext({ viewport: VIEWPORT, ignoreHTTPSErrors: false })
const first = await visit(context, 'first')
const revisit = await visit(context, 'revisit')
await browser.close()

const result = { origin, measuredAt: new Date().toISOString(), viewport: VIEWPORT, first, revisit }
writeFileSync(outFile, JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify({ first: { ...first, consoleErrors: first.consoleErrors.length }, revisit: { ...revisit, consoleErrors: revisit.consoleErrors.length } }, null, 1))
