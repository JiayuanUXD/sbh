/**
 * OPT-112 浏览器走查：「站点设置 → 图片水印」里的重刷按钮。
 *
 * 用法：[PW_EXECUTABLE=/opt/pw-browsers/chromium] node browser-walk.mjs <origin> <phase> <out.json>
 *   phase = start  登录 → 打开水印 tab → 读进度 → 点按钮（抓 POST 响应）→ 再用同一会话 POST 一次
 *                  （应回 running，不排第二条链）→ 截图
 *   phase = view   登录 → 打开水印 tab → 读进度并截图（链条跑完后用）
 * 账号是 scripts/seed.ts 的公开 E2E 夹具。
 */
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(path.resolve(HERE, '../../../payload-office-platform/package.json'))
const { chromium } = require('@playwright/test')

const [origin, phase, outFile] = process.argv.slice(2)
if (!origin || !['start', 'view'].includes(phase) || !outFile) {
  throw new Error('usage: node browser-walk.mjs <origin> <start|view> <out.json>')
}

const browser = await chromium.launch(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {})
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()
const consoleErrors = []
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(`${page.url()} :: ${m.text()}`)
})
// 控制台的 ERR_* 不带 URL，单独记失败请求，好判断是不是本改动的资源
const failedRequests = []
page.on('requestfailed', (r) => failedRequests.push(`${r.url().split('?')[0]} :: ${r.failure()?.errorText}`))

await page.goto(`${origin}/admin/login`, { waitUntil: 'networkidle' })
await page.fill('#field-email', 'e2e-adm@example.com')
await page.fill('#field-password', 'Test1234!')
await Promise.all([page.waitForURL(/\/admin(?!\/login)/), page.click('button[type="submit"]')])

await page.goto(`${origin}/admin/globals/site-settings`, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: '图片水印', exact: true }).click()
const button = page.getByRole('button', { name: /重刷全部房源图|重刷进行中|正在排队/ })
await button.scrollIntoViewIfNeeded()
// 等进度读回来：「已完成 X / Y 张」出现或给出读取失败提示
await page.getByText(/已完成 \d+ \/ \d+ 张|读取进度失败|水印开关当前关闭/).first().waitFor({ timeout: 30_000 })

async function snapshot(label) {
  const container = button.locator('xpath=..')
  const shot = `walk-${phase}-${label}.png`
  await container.screenshot({ path: path.join(HERE, shot) })
  return {
    label,
    buttonText: (await button.textContent())?.trim(),
    buttonDisabled: await button.isDisabled(),
    lines: await container.locator('p').allTextContents(),
    screenshot: shot,
  }
}

const steps = [await snapshot('loaded')]

if (phase === 'start') {
  const [postResponse] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/watermark-rebake') && r.request().method() === 'POST'),
    button.click(),
  ])
  steps.push({ label: 'click-post', status: postResponse.status(), body: await postResponse.json() })
  await page.getByRole('button', { name: '重刷进行中' }).waitFor({ timeout: 30_000 })
  steps.push(await snapshot('after-click'))

  // 模拟「点了没反应就再点」：同一会话再 POST 一次（按钮已禁用，直接调端点）。
  const second = await page.evaluate(async () => {
    const response = await fetch('/api/watermark-rebake', { method: 'POST' })
    return { status: response.status, body: await response.json() }
  })
  steps.push({ label: 'second-post', ...second })
}

await browser.close()
const result = { origin, phase, measuredAt: new Date().toISOString(), steps, consoleErrors, failedRequests }
writeFileSync(outFile, JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result, null, 1))
