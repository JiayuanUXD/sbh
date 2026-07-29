/**
 * OPT-021 导航验收截图（一次性证据脚本，非生产代码）。
 * 前置：worktree dev server 跑在 http://localhost:3718，已 seed。
 * 运行：PORT=3718 pnpm exec tsx scripts/opt021-shots.ts
 */
import { chromium, type Browser, type BrowserContext } from '@playwright/test'
import path from 'path'
import { fileURLToPath } from 'url'

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? `http://localhost:${process.env.PORT ?? 3718}`
const here = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.resolve(here, '..', '..', 'artifacts', 'verification', 'OPT-021-admin-navigation-ia')

const ACCOUNTS: Record<string, { email: string; password: string }> = {
  ADM: { email: 'e2e-adm@example.com', password: 'Test1234!' },
  OPS: { email: 'e2e-ops@example.com', password: 'Test1234!' },
  BRK: { email: 'e2e-brk@example.com', password: 'Test1234!' },
}

async function login(ctx: BrowserContext, role: string): Promise<void> {
  const res = await ctx.request.post(`${BASE}/api/users/login`, { data: ACCOUNTS[role] })
  if (res.status() !== 200) throw new Error(`${role} 登录失败 HTTP ${res.status()}`)
}

async function openDesktopNav(page: import('@playwright/test').Page): Promise<void> {
  const aside = page.locator('aside.nav')
  const interactable = async (): Promise<boolean> =>
    aside.evaluate((el) => {
      const button = el.querySelector<HTMLElement>('.admin-navigation__group-toggle')
      if (!button) return false
      const box = button.getBoundingClientRect()
      const topmost = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
      return topmost !== null && button.contains(topmost)
    }).catch(() => false)

  if (!(await interactable())) {
    await page.locator('.template-default__nav-toggler').click().catch(() => {})
  }
  for (let i = 0; i < 30 && !(await interactable()); i++) await page.waitForTimeout(200)
  await page.waitForTimeout(300)
}

async function shotDesktop(browser: Browser, role: string, file: string): Promise<void> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await login(ctx, role)
  const page = await ctx.newPage()
  await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' })
  await openDesktopNav(page)
  await page.screenshot({ path: path.join(OUT, file), fullPage: false })
  await ctx.close()
  console.log(`✓ ${file}`)
}

async function main(): Promise<void> {
  const browser = await chromium.launch()

  await shotDesktop(browser, 'ADM', 'adm-desktop.png')
  await shotDesktop(browser, 'OPS', 'ops-desktop.png')

  // 暗色：ADM 桌面点“切换到深色模式”
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    await login(ctx, 'ADM')
    const page = await ctx.newPage()
    await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' })
    await openDesktopNav(page)
    await page.getByRole('button', { name: '切换到深色模式' }).click()
    await page.waitForTimeout(500)
    await page.screenshot({ path: path.join(OUT, 'dark-mode.png'), fullPage: false })
    await ctx.close()
    console.log('✓ dark-mode.png')
  }

  // 移动：BRK 390×844，打开全屏抽屉
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    await login(ctx, 'BRK')
    const page = await ctx.newPage()
    await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' })
    await page.locator('.app-header__mobile-nav-toggler').click()
    await page.locator('aside.nav.nav--nav-open').waitFor({ state: 'visible', timeout: 15_000 })
    await page.waitForTimeout(300)
    await page.screenshot({ path: path.join(OUT, 'brk-mobile.png'), fullPage: false })
    await ctx.close()
    console.log('✓ brk-mobile.png')
  }

  await browser.close()
  console.log(`\n全部截图已写入 ${OUT}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
