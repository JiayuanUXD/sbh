// OPT-097 走查取证：C 端页脚 1440 / 375 + 后台字段。运行方式：复制到 payload-office-platform/scripts/ 下 node 跑（ESM 只在树内解析得到 @playwright/test）。
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const BASE = 'http://localhost:3729'
const OUT = '../artifacts/verification/OPT-097'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })

// 登录夹具管理员（cookie 落在 context 上，后续 page 共用）
const login = await ctx.request.post(`${BASE}/api/users/login`, {
  data: { email: 'e2e-adm@example.com', password: 'Test1234!' },
})
console.log('login', login.status())

const page = await ctx.newPage()

// C 端 1440
await page.goto(`${BASE}/`)
await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' }) // dev 角标会压住 ©，生产没有
await page.locator('.site-footer__bar').scrollIntoViewIfNeeded()
await page.locator('.site-footer__bar').screenshot({ path: `${OUT}/footer-bar-1440.png` })
console.log(
  'desktop',
  JSON.stringify(
    await page.evaluate(() => {
      const a = document.querySelector('.site-footer__icp')
      return {
        barText: document.querySelector('.site-footer__bar-inner')?.innerText,
        href: a?.getAttribute('href'),
        target: a?.getAttribute('target'),
        rel: a?.getAttribute('rel'),
      }
    }),
  ),
)

// C 端 375
await page.setViewportSize({ width: 375, height: 812 })
await page.goto(`${BASE}/shanghai`)
await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' }) // dev 角标会压住 ©，生产没有
await page.locator('.site-footer__bar').scrollIntoViewIfNeeded()
await page.locator('.site-footer__bar').screenshot({ path: `${OUT}/footer-bar-375.png` })
console.log(
  'mobile',
  JSON.stringify(
    await page.evaluate(() => ({
      barText: document.querySelector('.site-footer__bar-inner')?.innerText,
      overflow: document.documentElement.scrollWidth > innerWidth,
    })),
  ),
)

// 后台「页脚」tab
await page.setViewportSize({ width: 1440, height: 900 })
await page.goto(`${BASE}/admin/globals/site-settings`)
await page.getByRole('button', { name: '页脚', exact: true }).click()
const field = page.locator('#field-icpRecordNumber')
await field.waitFor()
await field.scrollIntoViewIfNeeded()
console.log('admin value', JSON.stringify(await field.inputValue()))
await page.locator('.tabs-field__tab-active, .tabs-field__tab').first().waitFor()
await page.screenshot({ path: `${OUT}/admin-footer-tab-1440.png` })

// 后台非法值：填 abc → 保存 → 400 + 红字
await field.fill('abc')
const [res] = await Promise.all([
  page.waitForResponse((r) => r.url().includes('/api/globals/site-settings') && r.request().method() === 'POST'),
  page.getByRole('button', { name: '保存', exact: true }).first().click(),
])
console.log('invalid save status', res.status())
await page.locator('.field-error, .tooltip').first().waitFor({ timeout: 5000 }).catch(() => {})
await page.screenshot({ path: `${OUT}/admin-invalid-400-1440.png` })
console.log(
  'field error',
  JSON.stringify(await page.evaluate(() => document.querySelector('.field-error, .tooltip')?.textContent?.trim())),
)

// 还原为合法值（不留 abc 在表单里；库里本来就是合法值，400 没落库）
await page.reload()
await page.getByRole('button', { name: '页脚', exact: true }).click()
console.log('admin value after reload', JSON.stringify(await page.locator('#field-icpRecordNumber').inputValue()))

await browser.close()
