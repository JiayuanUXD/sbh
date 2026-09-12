/**
 * OPT-088 会员登录 E2E。前置：pnpm seed（会员夹具 13800009999 / Member1234!）、SMS_PROVIDER=fixture。
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const BASE = (process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3717}`).replace(/\/$/, '')
const ORIGIN_HEADERS = { origin: BASE, 'content-type': 'application/json' }
const FIXTURE_CODE = '123456'
const SEEDED = { phone: '13800009999', password: 'Member1234!' }
const NEW_PHONE = '13800008888'
const NO_CONSENT_PHONE = '13800008889'

async function post(request: APIRequestContext, path: string, data: unknown) {
  return request.post(`${BASE}${path}`, { data, headers: ORIGIN_HEADERS, failOnStatusCode: false })
}

/**
 * OPT-094：顶栏「登录 / 会员入口」改由站点设置开关控制，默认关。
 * 验顶栏账号菜单前要先把开关打开；`request` 与 `page` 是两个上下文，
 * 后台管理员的 cookie 不会串进会员会话。
 */
const ADMIN = { email: 'e2e-adm@example.com', password: 'Test1234!' }
async function setMemberEntryVisible(request: APIRequestContext, visible: boolean) {
  const login = await request.post(`${BASE}/api/users/login`, { data: ADMIN, failOnStatusCode: false })
  expect(login.status(), 'E2E 管理员账号应成功登录').toBe(200)
  const res = await request.post(`${BASE}/api/globals/site-settings`, {
    data: { memberEntryVisible: visible },
    headers: ORIGIN_HEADERS,
    failOnStatusCode: false,
  })
  expect(res.status()).toBe(200)
}

test.describe('Payload 自带的会员 auth 端点已封', () => {
  for (const p of ['login', 'logout', 'refresh-token', 'me', 'first-register', 'forgot-password', 'reset-password', 'unlock']) {
    test(`POST /api/members/${p} → 404`, async ({ request }) => {
      const res = await post(request, `/api/members/${p}`, {})
      expect(res.status()).toBe(404)
    })
  }
  test('匿名 POST /api/members 被拒', async ({ request }) => {
    const res = await post(request, '/api/members', { username: '13800007777', password: 'Whatever123' })
    expect([401, 403]).toContain(res.status())
  })
})

test.describe('验证码登录', () => {
  test('未勾同意 → CONSENT_REQUIRED；勾选后登录并进入账户页', async ({ page, request }) => {
    const send = await post(request, '/api/member/sms/send', { phone: NO_CONSENT_PHONE, purpose: 'login' })
    expect(send.status()).toBe(200)
    const noConsent = await post(request, '/api/member/login/sms', { phone: NO_CONSENT_PHONE, code: FIXTURE_CODE, consent: null })
    // 号码若已被上次运行注册，则不需要同意，直接 200
    expect([200, 400]).toContain(noConsent.status())
    if (noConsent.status() === 400) {
      expect((await noConsent.json()).code).toBe('CONSENT_REQUIRED')
    }

    await setMemberEntryVisible(request, true)
    try {
      await page.goto('/login?returnTo=%2Faccount')
      await page.getByLabel('手机号').fill(NEW_PHONE)
      await page.getByRole('button', { name: '获取验证码' }).click()
      await page.getByLabel('验证码').fill(FIXTURE_CODE)
      await page.getByRole('checkbox').check()
      await page.getByRole('button', { name: '登录', exact: true }).click()
      await page.waitForURL('**/account')
      await expect(page.getByRole('heading', { name: '账号设置' })).toBeVisible()
      await expect(page.getByRole('button', { name: '账号菜单' })).toBeVisible()
    } finally {
      await setMemberEntryVisible(request, false)
    }
  })

  test('顶栏登录入口默认关闭，开关打开后出现（OPT-094）', async ({ page, request }) => {
    await page.goto('/')
    await expect(page.locator('.member-login')).toHaveCount(0)
    await setMemberEntryVisible(request, true)
    try {
      await page.goto('/')
      await expect(page.locator('.member-login').first()).toHaveAttribute('href', /^\/login\?returnTo=/)
    } finally {
      await setMemberEntryVisible(request, false)
    }
    await page.goto('/')
    await expect(page.locator('.member-login')).toHaveCount(0)
  })

  test('60 秒内重复发码 → 429', async ({ request }) => {
    await post(request, '/api/member/sms/send', { phone: '13800006666', purpose: 'login' })
    const again = await post(request, '/api/member/sms/send', { phone: '13800006666', purpose: 'login' })
    expect(again.status()).toBe(429)
    expect(again.headers()['retry-after']).toBeTruthy()
  })
})

test.describe('密码登录与会话', () => {
  async function loginByPassword(page: Page) {
    await page.goto('/login')
    await page.getByRole('tab', { name: '密码登录' }).click()
    await page.getByLabel('手机号').fill(SEEDED.phone)
    await page.getByLabel('密码').fill(SEEDED.password)
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await page.waitForURL('**/account')
  }

  test('错密码统一文案；对密码登录；退出后 me 为 null', async ({ page, request }) => {
    const bad = await post(request, '/api/member/login/password', { phone: SEEDED.phone, password: 'nope-nope-1' })
    expect(bad.status()).toBe(401)
    expect((await bad.json()).message).toBe('手机号或密码错误')

    await loginByPassword(page)
    const me = await page.request.get(`${BASE}/api/member/me`)
    expect((await me.json()).member.phoneMasked).toBe('138****9999')

    await page.getByRole('button', { name: '退出登录' }).click()
    await page.waitForURL(`${BASE}/`)
    const after = await page.request.get(`${BASE}/api/member/me`)
    expect((await after.json()).member).toBeNull()
  })

  test('未登录访问账户页跳登录并带 returnTo', async ({ page }) => {
    await page.goto('/account/favorites')
    await expect(page).toHaveURL(/\/login\?returnTo=%2Faccount%2Ffavorites$/)
  })

  test('页脚员工入口指向后台登录', async ({ page }) => {
    await page.goto('/')
    const link = page.getByRole('link', { name: '员工入口' })
    await expect(link).toHaveAttribute('href', '/admin/login')
    await expect(link).toHaveAttribute('rel', 'nofollow')
  })

  test('本地收藏在登录后合并到账号', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => {
      window.localStorage.setItem('sbh:saved-details:v1', JSON.stringify([
        { type: 'building', id: 1, slug: 'placeholder', savedAt: new Date().toISOString() },
      ]))
    })
    await loginByPassword(page)
    await page.goto('/account/favorites')
    // id=1 的楼盘在 seed 库里存在则出现一条；不存在会被合并跳过 → 空态。两种都断言 localStorage 已清空。
    await expect(page.getByRole('heading', { name: '我的收藏' })).toBeVisible()
    await expect.poll(async () => page.evaluate(() => window.localStorage.getItem('sbh:saved-details:v1'))).toBeNull()
  })
})
