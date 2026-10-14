/**
 * OPT-111 浏览器走查：后台真实表单改价格（`price.amount`，后台表单的租金输入）→ 前台详情 / 列表刷新后即见新值；
 * 下架 → 详情与列表立即不再出现（硬过期语义未变）。
 *
 * 用法：[PW_EXECUTABLE=/opt/pw-browsers/chromium] node browser-walk.mjs <origin> <listingId> <slug> <out.json>
 * 前置：server 为 next start（生产模式），MULTI_CITY_ROUTING_ENABLED=true，房源属上海且已上架。
 * 账号是 scripts/seed.ts 的公开 E2E 夹具。
 */
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(path.resolve(HERE, '../../../payload-office-platform/package.json'))
const { chromium } = require('@playwright/test')

const [origin, listingId, slug, outFile] = process.argv.slice(2)
if (!origin || !listingId || !slug || !outFile) throw new Error('usage: node browser-walk.mjs <origin> <listingId> <slug> <out.json>')
const DETAIL = `${origin}/shanghai/listings/${slug}`
const LIST = `${origin}/shanghai/listings`
const NEW_RENT = 4321 + Math.floor(Date.now() / 1000) % 1000
const rentPattern = (n) => new RegExp(`${n.toLocaleString('en-US').replace(',', ',?')}`)

const browser = await chromium.launch(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {})
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const consoleErrors = []
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`${page.url()} :: ${m.text()}`) })

const steps = []
async function frontend(label) {
  const detail = await page.goto(DETAIL, { waitUntil: 'networkidle' })
  const detailStatus = detail?.status() ?? 0
  const detailHtml = detailStatus === 200 ? await page.content() : ''
  const list = await page.goto(LIST, { waitUntil: 'networkidle' })
  const listHtml = await page.content()
  const step = {
    label,
    detailStatus,
    detailShowsNewRent: rentPattern(NEW_RENT).test(detailHtml),
    listStatus: list?.status() ?? 0,
    listLinksListing: listHtml.includes(`/listings/${slug}`),
  }
  steps.push(step)
  return step
}

// 0. 预热两页，让缓存处于「已命中」状态
await frontend('warm-1')
const before = await frontend('warm-2')
if (before.detailStatus !== 200 || !before.listLinksListing) throw new Error(`起点不对：${JSON.stringify(before)}`)

// 1. 后台真实表单改租金
await page.goto(`${origin}/admin/login`, { waitUntil: 'networkidle' })
await page.fill('#field-email', 'e2e-adm@example.com')
await page.fill('#field-password', 'Test1234!')
await Promise.all([page.waitForURL(/\/admin(?!\/login)/), page.click('button[type="submit"]')])
await page.goto(`${origin}/admin/collections/listings/${listingId}`, { waitUntil: 'networkidle' })
// Payload 的 RenderFields 只渲染滚进视口的字段（.agent/backend.md「后台走查陷阱」），先滚到它出现
const rentInput = page.locator('#field-price__amount')
for (let i = 0; i < 40 && (await rentInput.count()) === 0; i++) {
  await page.mouse.wheel(0, 500)
  await page.waitForTimeout(150)
}
await rentInput.scrollIntoViewIfNeeded()
await rentInput.fill(String(NEW_RENT))
const saveResponse = page.waitForResponse((r) => r.url().includes(`/api/listings/${listingId}`) && r.request().method() === 'PATCH')
await page.keyboard.press('Control+s')
const saved = await saveResponse
const savedBody = saved.request().postData() ?? ''
await page.screenshot({ path: path.join(HERE, 'admin-after-save.png') })
steps.push({ label: 'admin-save', status: saved.status(), url: saved.url(), payloadHasRent: savedBody.includes(String(NEW_RENT)) })

// 2. 前台刷新即见新值
await frontend('after-rent-edit')
await page.goto(DETAIL, { waitUntil: 'networkidle' })
await page.screenshot({ path: path.join(HERE, 'detail-after-rent-edit.png') })

// 3. 下架（后台下架按钮调用的同一端点），前台立即不可见
const unpublish = await page.request.post(`${origin}/api/listings/${listingId}/publish`, {
  data: { action: 'unpublish', reason: 'OPT-111 浏览器走查：验证下架即时不可见' },
})
steps.push({ label: 'unpublish', status: unpublish.status() })
await frontend('after-unpublish')

await browser.close()
const result = { origin, listingId: Number(listingId), slug, newRent: NEW_RENT, measuredAt: new Date().toISOString(), steps, consoleErrors }
writeFileSync(outFile, JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result, null, 2))
