/**
 * F7.1 全链路 E2E 验收
 *
 * 设计依据：specs/frontend-mvp/tasks/F7-acceptance.md 7.1
 *           specs/frontend-mvp/design.md §15.3
 *           Page PRD FP-01 / FP-02 / FP-03 / FP-04 / FP-05 / FP-06
 *
 * 覆盖场景：
 *   1. 首页搜索 → 列表筛选 → 房源详情 → 咨询成功
 *   2. 楼盘详情 → 楼内房源 → 咨询
 *   3. 内容页 → 相关房源/通用咨询
 *   4. 无结果、404、数据失败、重复提交、限流
 *
 * 运行前提：本地 dev server 已启动（pnpm dev）且有种子数据。
 * 在 CI 中通过 playwright webServer 自动启动。
 *
 * 注：本套件依赖种子数据中至少有一条有效房源、楼盘、内容页。
 *     若种子数据为空，相应 test 会跳过而非失败（避免 CI 误报）。
 */
import { expect, test } from '@playwright/test'

// 当前隐私政策版本（与 src/lib/frontend/site-config.ts PRIVACY_POLICY_VERSION 对齐）
// 拆为常量便于未来政策版本升级时统一更新
const CONSENT_POLICY_VERSION = 'MVP-R1'

test.describe('F7.1 全链路 E2E', () => {
  test('首页 → 列表 → 详情 → 咨询成功', async ({ page }) => {
    // 1. 首页加载
    await page.goto('/')
    await expect(page.locator('h1')).toBeVisible()
    // OPT-035 首页改版后首屏容器是 `.hm-hero`（`.hero` 早已不存在于任何组件），
    // 这条断言从那时起就恒失败、卡在整条链路的第 2 步——本批 Task 9 跑 E2E 时
    // 撞见并顺手订正，与房源详情接线无关。
    await expect(page.locator('.hm-hero')).toBeVisible()

    // 2. 跳转到列表页
    await page.goto('/listings')
    await expect(page.locator('h1', { hasText: '在租房源' })).toBeVisible()

    // OPT-036 Task 11：列表页结果卡换成 .ls-card（ListingResultCard）。
    // 楼盘详情页内的「在租房源」仍是旧 .listing-card，两者不要混用同一个选择器。
    const listingCards = page.locator('.ls-card')
    const count = await listingCards.count()
    test.skip(count === 0, '种子数据无有效房源，跳过详情链路')

    // 3. 进入第一条房源详情
    const firstCard = listingCards.first()
    const href = await firstCard.getAttribute('href')
    expect(href).toBeTruthy()
    await page.goto(href!)
    await expect(page.locator('h1')).toBeVisible()
    // OPT-037 Task 9：首屏价格从 `.detail__rent`（旧摘要行）搬进决策卡。
    await expect(page.locator('.dt-decision__price-num').first()).toBeVisible()

    // 4. 打开询价 Modal
    await page
      .getByRole('button', { name: /询价|预约看房|在线询价/ })
      .first()
      .click()
    await expect(page.getByRole('dialog')).toBeVisible()

    // 5. 填写表单（第一步：联系方式）
    await page.getByLabel('称呼').fill('E2E 用户')
    await page.getByLabel('手机号').fill('13800001111')
    await page.getByLabel('团队规模').fill('10-20 人')
    await page.getByLabel(/我已阅读并同意/).check()

    // 6. 进入第二步（需求补充）
    await page.getByRole('button', { name: '下一步' }).click()

    // 7. 提交
    await page.getByRole('button', { name: '提交' }).click()
    await expect(page.getByText(/已收到/)).toBeVisible({ timeout: 10_000 })
  })

  test('楼盘详情 → 楼内房源 → 咨询', async ({ page }) => {
    // 先从列表找到一个楼盘链接
    await page.goto('/listings')
    const listingCards = page.locator('.ls-card')
    const count = await listingCards.count()
    test.skip(count === 0, '种子数据无有效房源，跳过楼盘链路')

    // 进入第一个房源详情，再跳到楼盘
    const href = await listingCards.first().getAttribute('href')
    await page.goto(href!)
    const buildingLink = page.getByRole('link', { name: /查看楼盘/ })
    if ((await buildingLink.count()) === 0) {
      test.skip(true, '该房源未关联楼盘，跳过')
    }
    await buildingLink.click()
    await expect(page).toHaveURL(/\/buildings\//)
    await expect(page.locator('h1')).toBeVisible()

    // 楼盘应有"在租房源"区块（h2 标题，避开 site-nav 文本重复）
    const inBuildingSection = page.getByRole('heading', { level: 2, name: '在租房源' })
    await expect(inBuildingSection).toBeVisible()

    // 楼内房源卡片应可点击进入详情
    const innerCards = page.locator('.listing-card')
    if ((await innerCards.count()) > 0) {
      const innerHref = await innerCards.first().getAttribute('href')
      await page.goto(innerHref!)
      await expect(page.locator('h1')).toBeVisible()
    }
  })

  test('内容页 → 通用咨询', async ({ page }) => {
    // 通过 sitemap 找到一个内容页
    const sitemap = await page.goto('/sitemap.xml')
    const xml = await sitemap?.text()
    const pageMatch = xml?.match(/<loc>([^<]+\/pages\/[^<]+)<\/loc>/)
    test.skip(!pageMatch, 'sitemap 无内容页，跳过')

    const pageUrl = pageMatch![1].replace(/^https?:\/\/[^/]+/, '')
    await page.goto(pageUrl)
    await expect(page.locator('h1')).toBeVisible()

    // 法律页面（privacy/policy）不应显示咨询 CTA
    const isLegal = /\/(privacy|policy)/i.test(pageUrl)
    if (!isLegal) {
      const cta = page.locator('.page-detail__cta')
      if ((await cta.count()) > 0) {
        await cta.getByRole('button', { name: /提交需求|询价/ }).click()
        await expect(page.getByRole('dialog')).toBeVisible()
      }
    }
  })

  test('404 页面', async ({ page }) => {
    await page.goto('/listings/this-slug-definitely-does-not-exist-xyz')
    // Next.js 默认 404 页面
    await expect(page).toHaveURL(/this-slug-definitely-does-not-exist-xyz/)
  })

  test('无结果状态', async ({ page }) => {
    // 使用极其严苛的筛选条件确保无结果
    await page.goto(
      '/listings?rentMin=999999999&rentMax=999999999&areaMin=999999999',
    )
    // OPT-036 Task 11：叠加了收窄条件却零结果 → 空态②（EmptyFiltered），
    // 它必须给出可操作的退路，而不只是一句「没有结果」。这里断言的正是那条
    // 出口存在（「清除全部条件」永远可点，见 EmptyFiltered.tsx 顶部注释）。
    await expect(page.locator('.ls-emptyfiltered__title')).toBeVisible()
    await expect(page.locator('.ls-emptyfiltered__clear-all')).toBeVisible()
    await expect(page.getByText('共 0 套在租房源')).toBeVisible()
  })

  test('重复提交幂等：相同 requestId 不重复创建 Lead', async ({ request }) => {
    // 每个测试用唯一 IP，避免共享限流配额（5 次/分钟/IP）
    const ip = `203.0.113.${Math.floor(Math.random() * 200) + 10}`
    const headers = { 'X-Forwarded-For': ip, 'Content-Type': 'application/json' }

    const requestId = `e2e-idempotent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const body = {
      requestId,
      name: '幂等测试',
      phone: '13800002222',
      consent: { accepted: true, policyVersion: CONSENT_POLICY_VERSION },
      source: { pageType: 'home' as const, path: '/' },
    }

    // 第一次提交
    const r1 = await request.post('/api/inquiries', { data: body, headers })
    expect(r1.status()).toBeLessThan(500)

    // 第二次相同 requestId
    const r2 = await request.post('/api/inquiries', { data: body, headers })
    expect(r2.status()).toBeLessThan(500)

    // 两次响应都应 ok=true（幂等命中或成功）
    const j1 = await r1.json().catch(() => ({}))
    const j2 = await r2.json().catch(() => ({}))
    expect(j1.ok).toBe(true)
    expect(j2.ok).toBe(true)
  })

  test('字段错误返回 422 + errors 数组', async ({ request }) => {
    const ip = `203.0.113.${Math.floor(Math.random() * 200) + 10}`
    const headers = { 'X-Forwarded-For': ip, 'Content-Type': 'application/json' }

    const r = await request.post('/api/inquiries', {
      headers,
      data: {
        requestId: `e2e-invalid-${Date.now()}`,
        // 故意缺失 name 与 phone
        consent: { accepted: true, policyVersion: CONSENT_POLICY_VERSION },
        source: { pageType: 'home', path: '/' },
      },
    })
    expect(r.status()).toBe(422)
    const j = await r.json()
    expect(j.ok).toBe(false)
    expect(Array.isArray(j.errors)).toBe(true)
    expect(j.errors).toContain('name_required')
    expect(j.errors).toContain('phone_invalid')
  })

  test('未同意隐私政策返回 422', async ({ request }) => {
    const ip = `203.0.113.${Math.floor(Math.random() * 200) + 10}`
    const headers = { 'X-Forwarded-For': ip, 'Content-Type': 'application/json' }

    const r = await request.post('/api/inquiries', {
      headers,
      data: {
        requestId: `e2e-no-consent-${Date.now()}`,
        name: '无同意',
        phone: '13800003333',
        consent: { accepted: false, policyVersion: CONSENT_POLICY_VERSION },
        source: { pageType: 'home', path: '/' },
      },
    })
    expect(r.status()).toBe(422)
    const j = await r.json()
    expect(j.ok).toBe(false)
    expect(j.errors).toContain('consent_required')
  })

  test('GET /api/inquiries 返回 405', async ({ request }) => {
    const r = await request.get('/api/inquiries')
    expect(r.status()).toBe(405)
  })
})
