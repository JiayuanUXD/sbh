import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { blockUmamiScript } from './_umami-stub'

const BASE = (process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3717}`).replace(/\/$/, '')
const ADMIN = { email: 'e2e-adm@example.com', password: 'Test1234!' }
const MEMBER = { phone: '13800009999', password: 'Member1234!' }
const ORIGIN_HEADERS = { origin: BASE, 'content-type': 'application/json' }

const EVIDENCE_DIR = path.resolve(process.cwd(), '../artifacts/verification/OPT-129')

async function makePngBytes(r = 0, g = 113, b = 227): Promise<Buffer> {
  return sharp({
    create: { width: 64, height: 64, channels: 4, background: { r, g, b, alpha: 1 } },
  })
    .png()
    .toBuffer()
}

async function loginAsAdmin(page: Page) {
  const res = await page.request.post(`${BASE}/api/users/login`, {
    data: ADMIN,
    failOnStatusCode: false,
  })
  expect(res.status(), 'E2E 管理员账号应登录成功').toBe(200)
}

async function setMemberEntryVisible(request: APIRequestContext, visible: boolean) {
  const login = await request.post(`${BASE}/api/users/login`, {
    data: ADMIN,
    failOnStatusCode: false,
  })
  expect(login.status()).toBe(200)
  const res = await request.post(`${BASE}/api/globals/site-settings`, {
    data: { memberEntryVisible: visible },
    headers: ORIGIN_HEADERS,
    failOnStatusCode: false,
  })
  expect(res.status()).toBe(200)
}

function trackPageErrors(page: Page) {
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => {
    pageErrors.push(err.message)
  })
  return {
    assertClean: () => {
      expect(pageErrors, '不应有未捕获页面异常').toEqual([])
      expect(consoleErrors, '不应有控制台报错').toEqual([])
    },
  }
}

test.describe('OPT-129 管理员、会员与商办顾问头像全链路验收', () => {
  test.beforeAll(() => {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
  })

  test.beforeEach(async ({ page }) => {
    await blockUmamiScript(page)
  })

  test('1. 后台管理员头像上传、保存持久化、顶栏下拉与深色模式适配', async ({ page }) => {
    const errors = trackPageErrors(page)
    await loginAsAdmin(page)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/admin/account')

    const avatarField = page.locator('.arco-user-avatar-field')
    await expect(avatarField).toBeVisible()

    const png = await makePngBytes(0, 113, 227)
    const uploadPromise = page.waitForResponse(
      (res) => res.url().includes('/api/admin/avatar') && res.request().method() === 'POST',
    )
    await avatarField.locator('input[type="file"]').setInputFiles({
      name: 'admin-avatar.png',
      mimeType: 'image/png',
      buffer: png,
    })
    const uploadRes = await uploadPromise
    expect(uploadRes.status()).toBe(201)
    const uploadBody = await uploadRes.json()
    expect(uploadBody.ok).toBe(true)
    const uploadedId = uploadBody.media.id

    await expect(avatarField.locator('.arco-user-avatar-field__img')).toBeVisible()

    const saveReqPromise = page.waitForRequest(
      (req) => req.url().includes('/api/users/') && req.method() === 'PATCH',
    )
    const saveResPromise = page.waitForResponse(
      (res) => res.url().includes('/api/users/') && res.request().method() === 'PATCH',
    )
    await page.getByRole('button', { name: '保存' }).click()
    const saveReq = await saveReqPromise
    const saveRes = await saveResPromise
    expect(saveRes.status()).toBe(200)
    const rawBody = saveReq.postData() ?? ''
    expect(rawBody).toContain(String(uploadedId))

    // 强刷重载核验
    await page.waitForTimeout(300)
    await page.reload()
    const fieldImg = page.locator('.arco-user-avatar-field__img')
    await expect(fieldImg).toBeVisible()
    await expect
      .poll(async () => fieldImg.evaluate((el: HTMLImageElement) => el.naturalWidth))
      .toBeGreaterThan(0)

    await avatarField.scrollIntoViewIfNeeded()
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'admin-account-field.png') })

    const headerImg = page.locator('.arco-admin-account__trigger .arco-admin-account__img')
    await expect(headerImg).toBeVisible()
    await expect
      .poll(async () => headerImg.evaluate((el: HTMLImageElement) => el.naturalWidth))
      .toBeGreaterThan(0)

    // 展开菜单并截浅色图
    await page.locator('.arco-admin-account__trigger').click()
    const menu = page.locator('.arco-admin-account__menu')
    await expect(menu).toBeVisible()
    await expect(menu.locator('.arco-admin-account__header-avatar img')).toBeVisible()
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'admin-account-light.png') })

    // 切深色模式并核验浮层底色非 #FFFFFF
    await page.locator('.arco-admin-account__trigger').click()
    const themeToggle = page.locator('.arco-admin-theme-toggle')
    if (await themeToggle.isVisible()) {
      await themeToggle.click()
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
      await page.locator('.arco-admin-account__trigger').click()
      await expect(menu).toBeVisible()
      const menuBg = await menu.evaluate((el) => getComputedStyle(el).backgroundColor)
      expect(menuBg).not.toBe('rgb(255, 255, 255)')
      await page.screenshot({ path: path.join(EVIDENCE_DIR, 'admin-account-dark.png') })
      await page.locator('.arco-admin-account__trigger').click()
      await themeToggle.click()
    }

    // 恢复默认并强刷核验
    await avatarField.getByRole('button', { name: '恢复默认' }).click()
    const resetResPromise = page.waitForResponse(
      (res) => res.url().includes('/api/users/') && res.request().method() === 'PATCH',
    )
    await page.getByRole('button', { name: '保存' }).click()
    expect((await resetResPromise).status()).toBe(200)
    await page.waitForTimeout(300)
    await page.reload()
    await expect(page.locator('.arco-user-avatar-field__img')).toHaveCount(0)
    await expect(page.locator('.arco-admin-account__trigger .arco-admin-account__img')).toHaveCount(0)

    errors.assertClean()
  })

  test('2. 商办顾问头像在站点设置配置并在前台详情页展示与回退', async ({ page }) => {
    const errors = trackPageErrors(page)
    await loginAsAdmin(page)
    await page.setViewportSize({ width: 1440, height: 900 })

    // 通过媒体库接口上传一张商办顾问头像并绑定到站点设置
    const png = await makePngBytes(29, 29, 31)
    const formData = new FormData()
    const mediaRes = await page.request.post(`${BASE}/api/media`, {
      multipart: {
        file: { name: 'advisor-avatar.png', mimeType: 'image/png', buffer: png },
        _payload: JSON.stringify({ alt: '商办顾问头像测试', usage: 'brand' }),
      },
      failOnStatusCode: false,
    })
    expect(mediaRes.status()).toBe(201)
    const mediaBody = await mediaRes.json()
    const mediaId = mediaBody.doc.id as number
    void formData

    // 先在后台站点设置页确认「商办顾问头像」字段可见并保存
    await page.goto('/admin/globals/site-settings')
    await expect(page.getByText('商办顾问头像', { exact: false })).toBeVisible()

    const setRes = await page.request.post(`${BASE}/api/globals/site-settings`, {
      data: { advisorAvatar: mediaId },
      headers: ORIGIN_HEADERS,
      failOnStatusCode: false,
    })
    expect(setRes.status()).toBe(200)

    await page.reload()
    await expect(page.locator('img[src*="advisor-avatar"]').first()).toBeVisible()

    // 跳转到前台有效楼盘详情页核验 AdvisorCard 渲染
    await page.goto('/buildings')
    const firstBuildingHref = await page
      .locator('a[href*="/buildings/"]')
      .first()
      .getAttribute('href')
    expect(firstBuildingHref).toBeTruthy()
    await page.goto(firstBuildingHref!)

    const advisorCard = page.locator('.advisor-card').first()
    await expect(advisorCard).toBeVisible()
    const advisorImg = advisorCard.locator('.advisor-card__avatar-img')
    await expect(advisorImg).toBeVisible()
    await expect
      .poll(async () => advisorImg.evaluate((el: HTMLImageElement) => el.naturalWidth))
      .toBeGreaterThan(0)
    await advisorCard.scrollIntoViewIfNeeded()
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'advisor-card-desktop.png') })

    // 375 移动视口重载核验
    await page.setViewportSize({ width: 375, height: 812 })
    await page.reload()
    const mobileAdvisor = page.locator('.advisor-card').first()
    await expect(mobileAdvisor.locator('.advisor-card__avatar-img')).toBeVisible()
    await mobileAdvisor.scrollIntoViewIfNeeded()
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'advisor-card-mobile.png') })

    // 清除顾问头像后强刷恢复「顾问」文字图标
    const clearRes = await page.request.post(`${BASE}/api/globals/site-settings`, {
      data: { advisorAvatar: null },
      headers: ORIGIN_HEADERS,
      failOnStatusCode: false,
    })
    expect(clearRes.status()).toBe(200)

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.reload()
    await expect(page.locator('.advisor-card .advisor-card__avatar-text').first()).toHaveText('顾问')
    await expect(page.locator('.advisor-card .advisor-card__avatar-img')).toHaveCount(0)

    errors.assertClean()
  })

  test('3. C 端会员头像上传、顶栏菜单/移动抽屉展示与恢复默认', async ({ page, request }) => {
    const errors = trackPageErrors(page)
    await setMemberEntryVisible(request, true)

    try {
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.goto('/login?returnTo=%2Faccount')
      await page.getByRole('tab', { name: '密码登录' }).click()
      await page.getByLabel('手机号').fill(MEMBER.phone)
      await page.getByLabel('密码').fill(MEMBER.password)
      await page.getByRole('button', { name: '登录', exact: true }).click()
      await page.waitForURL('**/account')

      const png = await makePngBytes(16, 165, 92)
      const uploadResPromise = page.waitForResponse(
        (res) => res.url().includes('/api/member/avatar') && res.request().method() === 'POST',
      )
      await page.locator('.mb-avatar__input').setInputFiles({
        name: 'member-avatar.png',
        mimeType: 'image/png',
        buffer: png,
      })
      const uploadRes = await uploadResPromise
      expect(uploadRes.status()).toBe(200)
      const uploadBody = await uploadRes.json()
      expect(uploadBody.ok).toBe(true)
      expect(uploadBody.member.avatarUrl).toBeTruthy()

      await expect(page.locator('.mb-avatar__img')).toBeVisible()
      await expect(page.locator('.member-menu__trigger .member-menu__avatar-img')).toBeVisible()

      // 强刷重载核验持久化
      await page.reload()
      const pageAvatar = page.locator('.mb-avatar__img')
      const navAvatar = page.locator('.member-menu__trigger .member-menu__avatar-img')
      await expect(pageAvatar).toBeVisible()
      await expect(navAvatar).toBeVisible()
      await expect
        .poll(async () => pageAvatar.evaluate((el: HTMLImageElement) => el.naturalWidth))
        .toBeGreaterThan(0)
      await expect
        .poll(async () => navAvatar.evaluate((el: HTMLImageElement) => el.naturalWidth))
        .toBeGreaterThan(0)

      await page.locator('.member-menu__trigger').click()
      await expect(page.locator('.member-menu__panel')).toBeVisible()
      await page.waitForTimeout(250)
      await page.screenshot({ path: path.join(EVIDENCE_DIR, 'member-account-desktop.png') })
      await page.locator('.member-menu__trigger').click()

      // 375 移动视口抽屉核验
      await page.setViewportSize({ width: 375, height: 812 })
      await page.reload()
      await page.locator('.site-menu-toggle').click()
      const drawerAvatar = page.locator('.member-drawer__avatar img')
      await expect(drawerAvatar).toBeVisible()
      await expect
        .poll(async () => drawerAvatar.evaluate((el: HTMLImageElement) => el.naturalWidth))
        .toBeGreaterThan(0)
      await page.screenshot({ path: path.join(EVIDENCE_DIR, 'member-drawer-mobile.png') })

      // 切回桌面并恢复默认头像
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.reload()
      const deleteResPromise = page.waitForResponse(
        (res) => res.url().includes('/api/member/avatar') && res.request().method() === 'DELETE',
      )
      await page.locator('.mb-avatar').getByRole('button', { name: '恢复默认' }).click()
      expect((await deleteResPromise).status()).toBe(200)

      await page.reload()
      await expect(page.locator('.mb-avatar__img')).toHaveCount(0)
      await expect(page.locator('.mb-avatar__fallback')).toBeVisible()
      await expect(page.locator('.member-menu__trigger .member-menu__avatar-img')).toHaveCount(0)
      await expect(page.locator('.member-menu__trigger .member-menu__avatar')).toBeVisible()
    } finally {
      await setMemberEntryVisible(request, false)
    }

    errors.assertClean()
  })
})
