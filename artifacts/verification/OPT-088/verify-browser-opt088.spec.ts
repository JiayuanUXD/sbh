import { expect, test, type Page } from '@playwright/test'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

const require = createRequire(import.meta.url)

const SCREENS_DIR = path.resolve(process.cwd(), '../artifacts/verification/OPT-088/screens')
const PAYLOADS_DIR = path.resolve(process.cwd(), '../artifacts/verification/OPT-088/payloads')

fs.mkdirSync(SCREENS_DIR, { recursive: true })
fs.mkdirSync(PAYLOADS_DIR, { recursive: true })

const BREAKPOINTS = [
  { name: '375', width: 375, height: 812 },
  { name: '768', width: 768, height: 1024 },
  { name: '1440', width: 1440, height: 900 },
  { name: '1920', width: 1920, height: 1080 },
]

test.describe.configure({ mode: 'serial', timeout: 120_000 })

test.describe('OPT-088 浏览器验收与证据收集', () => {
  test('0. 预热核心路由', async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto('/', { waitUntil: 'load' })
    await page.goto('/login', { waitUntil: 'load' })
    await page.goto('/login/reset', { waitUntil: 'load' })
  })

  test('1. 四断点走查：未登录态首页与抽屉', async ({ browser }) => {
    test.setTimeout(120_000)
    for (const bp of BREAKPOINTS) {
      const context = await browser.newContext({ viewport: { width: bp.width, height: bp.height } })
      const page = await context.newPage()
      await page.goto('/', { waitUntil: 'networkidle' })
      await page.screenshot({ path: path.join(SCREENS_DIR, `01-home-unlogged-${bp.name}.png`) })

      if (bp.width <= 768) {
        const hamburger = page.locator('.site-menu-toggle')
        if (await hamburger.isVisible()) {
          await hamburger.click()
          await page.waitForTimeout(400)
          await page.screenshot({ path: path.join(SCREENS_DIR, `02-drawer-unlogged-${bp.name}.png`) })
        }
      }
      await context.close()
    }
  })

  test('2. 四断点走查：登录页（短信 tab、密码 tab）与忘记密码页', async ({ browser }) => {
    test.setTimeout(120_000)
    for (const bp of BREAKPOINTS) {
      const context = await browser.newContext({ viewport: { width: bp.width, height: bp.height } })
      const page = await context.newPage()

      await page.goto('/login', { waitUntil: 'networkidle' })
      await page.screenshot({ path: path.join(SCREENS_DIR, `03-login-sms-tab-${bp.name}.png`) })

      const pwdTab = page.getByRole('tab', { name: '密码登录' })
      await expect(pwdTab).toBeVisible()
      await pwdTab.click()
      await page.waitForTimeout(300)
      await page.screenshot({ path: path.join(SCREENS_DIR, `04-login-password-tab-${bp.name}.png`) })

      await page.goto('/login/reset', { waitUntil: 'networkidle' })
      await page.screenshot({ path: path.join(SCREENS_DIR, `05-login-reset-${bp.name}.png`) })

      await context.close()
    }
  })

  test('3. 表单三重铁证：短信验证码登录抓包与重置密码抓包', async ({ browser }) => {
    test.setTimeout(120_000)
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()

    let capturedReq: Record<string, unknown> | null = null
    let capturedRes: Record<string, unknown> | null = null

    page.on('request', (req) => {
      if (req.url().includes('/api/member/login/sms')) {
        capturedReq = {
          url: req.url(),
          method: req.method(),
          headers: req.headers(),
          postData: req.postDataJSON(),
        }
      }
    })
    page.on('response', async (res) => {
      if (res.url().includes('/api/member/login/sms')) {
        capturedRes = {
          status: res.status(),
          headers: res.headers(),
          json: await res.json().catch(() => null),
        }
      }
    })

    await page.goto('/login', { waitUntil: 'networkidle' })
    await page.getByLabel('手机号').fill('13800008888')
    await page.getByRole('button', { name: '获取验证码' }).click()
    await page.waitForTimeout(600)
    await page.getByLabel('验证码').fill('123456')
    await page.getByRole('checkbox').check()

    const smsResPromise = page.waitForResponse((res) => res.url().includes('/api/member/login/sms') && res.request().method() === 'POST')
    await page.getByRole('button', { name: '登录', exact: true }).click()
    const smsRes = await smsResPromise
    capturedRes = {
      status: smsRes.status(),
      headers: smsRes.headers(),
      json: await smsRes.json().catch(() => null),
    }

    await page.waitForURL('**/account', { timeout: 20000 })
    const cookies = await context.cookies()
    const memberCookie = cookies.find((c) => c.name === 'sbh-member-token')

    expect(memberCookie).toBeDefined()
    expect(memberCookie?.httpOnly).toBe(true)

    fs.writeFileSync(
      path.join(PAYLOADS_DIR, '01-login-sms.json'),
      JSON.stringify(
        {
          proof: '三重铁证之一：短信验证码登录抓包',
          request: capturedReq,
          response: capturedRes,
          cookie: {
            name: memberCookie?.name,
            httpOnly: memberCookie?.httpOnly,
            sameSite: memberCookie?.sameSite,
            path: memberCookie?.path,
          },
        },
        null,
        2,
      ),
      'utf8',
    )

    // 铁证三：刷新页面后仍保持登录态，会员菜单可见
    await page.reload({ waitUntil: 'networkidle' })
    const memberMenu = page.locator('.member-menu__trigger')
    await expect(memberMenu).toBeVisible()

    // 铁证之二：设置/重置密码抓包（用已注册的 13800009999 重置为 Member1234!）
    let setPwdReq: Record<string, unknown> | null = null
    let setPwdRes: Record<string, unknown> | null = null
    page.on('request', (req) => {
      if (req.url().includes('/api/member/password') && req.method() === 'POST') {
        setPwdReq = { url: req.url(), method: req.method(), postData: req.postDataJSON() }
      }
    })

    await page.goto('/login/reset', { waitUntil: 'networkidle' })
    await page.locator('#reset-phone').fill('13800009999')
    await page.getByRole('button', { name: '获取验证码' }).click()
    await page.waitForTimeout(600)
    await page.locator('#reset-code').fill('123456')
    await page.locator('#reset-password').fill('Member1234!')

    const setPwdResPromise = page.waitForResponse((res) => res.url().includes('/api/member/password') && res.request().method() === 'POST')
    await page.locator('.mb-form button[type="submit"]').click()
    const setPwdResponse = await setPwdResPromise
    setPwdRes = {
      status: setPwdResponse.status(),
      json: await setPwdResponse.json().catch(() => null),
    }

    expect(setPwdRes.status).toBe(200)

    fs.writeFileSync(
      path.join(PAYLOADS_DIR, '02-set-password.json'),
      JSON.stringify(
        {
          proof: '三重铁证之二：修改/设置密码抓包',
          request: setPwdReq,
          response: setPwdRes,
        },
        null,
        2,
      ),
      'utf8',
    )

    await context.close()
  })

  test('4. 密码登录抓包与四断点已登录态（首页、抽屉、个人中心、收藏夹）', async ({ browser }) => {
    test.setTimeout(120_000)
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()

    let pwdLoginReq: Record<string, unknown> | null = null
    let pwdLoginRes: Record<string, unknown> | null = null
    page.on('request', (req) => {
      if (req.url().includes('/api/member/login/password')) {
        pwdLoginReq = { url: req.url(), method: req.method(), postData: req.postDataJSON() }
      }
    })
    page.on('response', async (res) => {
      if (res.url().includes('/api/member/login/password')) {
        pwdLoginRes = { status: res.status(), json: await res.json().catch(() => null) }
      }
    })

    await page.goto('/login', { waitUntil: 'networkidle' })
    await page.getByRole('tab', { name: '密码登录' }).click()
    await page.getByLabel('手机号').fill('13800009999')
    await page.getByLabel('密码').fill('Member1234!')

    const pwdResPromise = page.waitForResponse((res) => res.url().includes('/api/member/login/password') && res.request().method() === 'POST')
    await page.getByRole('button', { name: '登录', exact: true }).click()
    const pwdResponse = await pwdResPromise
    pwdLoginRes = {
      status: pwdResponse.status(),
      json: await pwdResponse.json().catch(() => null),
    }

    await page.waitForURL('**/account', { timeout: 20000 })

    fs.writeFileSync(
      path.join(PAYLOADS_DIR, '03-login-password.json'),
      JSON.stringify(
        {
          proof: '密码登录抓包',
          request: pwdLoginReq,
          response: pwdLoginRes,
        },
        null,
        2,
      ),
      'utf8',
    )

    // 四断点已登录态截图
    for (const bp of BREAKPOINTS) {
      await page.setViewportSize({ width: bp.width, height: bp.height })
      await page.waitForTimeout(300)

      // /account 个人中心
      await page.goto('/account', { waitUntil: 'networkidle' })
      await page.screenshot({ path: path.join(SCREENS_DIR, `08-account-${bp.name}.png`) })

      // /account/favorites 收藏夹
      await page.goto('/account/favorites', { waitUntil: 'networkidle' })
      await page.screenshot({ path: path.join(SCREENS_DIR, `09-account-favorites-${bp.name}.png`) })

      // / 首页已登录态顶栏
      await page.goto('/', { waitUntil: 'networkidle' })
      await page.screenshot({ path: path.join(SCREENS_DIR, `06-home-logged-${bp.name}.png`) })

      // 抽屉已登录态
      if (bp.width <= 768) {
        const hamburger = page.locator('.site-menu-toggle')
        if (await hamburger.isVisible()) {
          await hamburger.click()
          await page.waitForTimeout(400)
          await page.screenshot({ path: path.join(SCREENS_DIR, `07-drawer-logged-${bp.name}.png`) })
          // 关闭抽屉
          const closeBtn = page.locator('.mobile-drawer__close')
          if (await closeBtn.isVisible()) {
            await closeBtn.click()
            await page.waitForTimeout(200)
          }
        }
      }
    }

    await context.close()
  })

  test('5. 后台管理走查：ADM 角色（浅色/深色会员列表与详情）', async ({ browser }) => {
    test.setTimeout(120_000)
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()

    await page.goto('/admin/login')
    await page.fill('input[id="field-email"]', 'e2e-adm@example.com')
    await page.fill('input[id="field-password"]', 'Test1234!')
    await page.click('button[type="submit"]')
    await page.waitForURL(/admin(?!\/login)/, { timeout: 30000 })

    await page.goto('/admin/collections/members', { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)

    // 浅色模式列表
    await page.screenshot({ path: path.join(SCREENS_DIR, '10-admin-members-list-light.png') })

    // 深色模式列表
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'dark')
    })
    await page.waitForTimeout(300)
    await page.screenshot({ path: path.join(SCREENS_DIR, '11-admin-members-list-dark.png') })

    // 切回浅色并进入第一行详情
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'light')
    })
    const firstRowLink = page.locator('.cell-username a, .table a, table tbody tr a').first()
    if (await firstRowLink.isVisible()) {
      await firstRowLink.click()
      await page.waitForTimeout(1500)
      await page.screenshot({ path: path.join(SCREENS_DIR, '12-admin-member-detail.png') })
    }

    await context.close()
  })

  test('6. 后台管理走查：OPS 角色（手机号脱敏验证）', async ({ browser }) => {
    test.setTimeout(120_000)

    const dbUri = process.env.DATABASE_URL ?? 'postgres://postgres:root@localhost:5432/sbh_dev_opt088'
    const pg = require(path.resolve(process.cwd(), 'node_modules/.pnpm/pg@8.20.0/node_modules/pg'))
    const client = new pg.Client({ connectionString: dbUri })
    await client.connect()

    // 临时从 OPS 移除 phone:full（走查《OPT-088 §12.3 无 phone:full 的 OPS 看到 138****1111》）
    await client.query('UPDATE roles SET field_permissions = $1 WHERE code = $2', [
      JSON.stringify(['phone:masked', 'audit:before_after']),
      'OPS',
    ])

    try {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
      const page = await context.newPage()

      await page.goto('/admin/login')
      await page.fill('input[id="field-email"]', 'e2e-ops@example.com')
      await page.fill('input[id="field-password"]', 'Test1234!')
      await page.click('button[type="submit"]')
      await page.waitForURL(/admin(?!\/login)/, { timeout: 30000 })

      await page.goto('/admin/collections/members', { waitUntil: 'networkidle' })
      await page.waitForTimeout(1500)
      await page.screenshot({ path: path.join(SCREENS_DIR, '13-admin-members-ops-masked.png') })

      const content = await page.content()
      expect(content).toContain('138****9999')
      expect(content).not.toContain('13800009999')

      await context.close()
    } finally {
      // 恢复 OPS 的 phone:full 权限
      await client.query('UPDATE roles SET field_permissions = $1 WHERE code = $2', [
        JSON.stringify(['phone:full', 'phone:masked', 'audit:before_after']),
        'OPS',
      ])
      await client.end()
    }
  })

  test('7. 后台管理走查：BRK 角色（无权拦截验证）', async ({ browser }) => {
    test.setTimeout(120_000)
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()

    await page.goto('/admin/login')
    await page.fill('input[id="field-email"]', 'e2e-brk@example.com')
    await page.fill('input[id="field-password"]', 'Test1234!')
    await page.click('button[type="submit"]')
    await page.waitForURL(/admin(?!\/login)/, { timeout: 30000 })

    await page.goto('/admin/collections/members', { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)
    await page.screenshot({ path: path.join(SCREENS_DIR, '14-admin-members-brk-denied.png') })

    const content = await page.content()
    expect(content).not.toContain('13800009999')

    await context.close()
  })
})
