import { expect, test, type Page } from '@playwright/test'
import { captureAnalytics } from './support/landing-analytics-capture'

const runSuffix = Date.now().toString().slice(-8).padStart(8, '0')
const entrustPhone = `139${runSuffix}`
const publishPhone = `138${runSuffix}`

const browserErrors = new WeakMap<Page, string[]>()

async function flushAnalytics(page: Page): Promise<void> {
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')))
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const hasOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
  expect(hasOverflow).toBe(false)
}

test.beforeAll(async ({ request }) => {
  const expectedStatuses: Readonly<Record<string, number>> = {
    '/': 200,
    '/entrust': 200,
    '/publish': 200,
    '/api/inquiries': 405,
    '/api/supply-submissions': 405,
  }

  for (const [path, expectedStatus] of Object.entries(expectedStatuses)) {
    const response = await request.get(path)
    expect(response.status(), `预热 ${path}`).toBe(expectedStatus)
  }
})

test.beforeEach(async ({ page }) => {
  const errors: string[] = []
  browserErrors.set(page, errors)
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
})

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page) ?? []).toEqual([])
})

test.describe('主导航入口调整', () => {
  test('主导航有 6 项且不含服务式办公', async ({ page }) => {
    await page.goto('/entrust')
    const nav = page.getByRole('navigation', { name: '主导航' })

    await expect(nav.getByRole('link')).toHaveCount(6)
    await expect(nav.getByRole('link', { name: '服务式办公' })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: '委托找房' })).toBeVisible()
    await expect(nav.getByRole('link', { name: '投放房源' })).toBeVisible()
  })
})

test.describe('/entrust 委托找房', () => {
  test('非法手机号内联报错', async ({ page }) => {
    await page.goto('/entrust')
    await page.getByLabel('手机号').fill('123')
    await page.getByRole('button', { name: '免费委托', exact: true }).click()

    await expect(page.getByRole('alert').filter({ hasText: '11 位手机号' })).toContainText(
      '11 位手机号',
    )
    expect(new URL(page.url()).pathname).toBe('/entrust')
  })

  test('合法提交后就地成功且埋点不含 PII', async ({ page }) => {
    const submittedBodies: unknown[] = []
    const analyticsCapture = await captureAnalytics(page)
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/api/inquiries')) {
        submittedBodies.push(request.postDataJSON())
      }
    })

    await page.goto('/entrust')
    await page.getByLabel('手机号').fill(entrustPhone)
    await page.getByRole('button', { name: '免费委托', exact: true }).click()

    await expect(page.getByRole('status')).toContainText('已收到您的委托', { timeout: 30_000 })
    expect(new URL(page.url()).pathname).toBe('/entrust')
    expect(submittedBodies).toHaveLength(1)
    expect(submittedBodies[0]).toMatchObject({
      phone: entrustPhone,
      requestId: expect.stringMatching(/^entrust-/),
      targetType: 'none',
      source: { pageType: 'entrust', path: '/entrust' },
    })

    await flushAnalytics(page)
    await expect.poll(async () => (await analyticsCapture.read()).map((event) => event.name)).toEqual(
      expect.arrayContaining([
        'landing_view',
        'landing_form_start',
        'landing_form_submit',
        'landing_form_success',
      ]),
    )
    const serializedEvents = JSON.stringify(await analyticsCapture.read())
    expect(serializedEvents).not.toContain(entrustPhone)
    expect(serializedEvents).not.toContain('phone')
  })

  test('页尾 CTA 聚焦首屏输入框并在移动端按锚点吸底', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/entrust')
    const cta = page.locator('.bottom-cta')

    await expect(cta).not.toHaveClass(/bottom-cta--docked/)
    await page.locator('.bottom-cta-anchor').scrollIntoViewIfNeeded()
    await expect(cta).toHaveClass(/bottom-cta--docked/)
    await expect.poll(() => cta.evaluate((element) => getComputedStyle(element).position)).toBe('fixed')

    await page.getByRole('button', { name: '免费委托定制' }).click()
    await expect(page.getByLabel('手机号')).toBeFocused()
    await expectNoHorizontalOverflow(page)

    await page.evaluate(() => window.scrollTo(0, 0))
    await expect(cta).not.toHaveClass(/bottom-cta--docked/)
  })
})

test.describe('/publish 投放房源', () => {
  test('空提交报必填错误且保留已填内容', async ({ page }) => {
    await page.goto('/publish')
    await page.getByLabel('楼盘名称').fill('E2E 测试楼盘')
    await page.getByRole('button', { name: '立即投放' }).click()

    await expect(page.locator('.publish-card__status')).toContainText('还有几项信息需要补充')
    await expect(page.getByText('请输入详细地址')).toBeVisible()
    await expect(page.getByText('请输入出租面积')).toBeVisible()
    await expect(page.getByText('请输入正确的 11 位手机号')).toBeVisible()
    await expect(page.getByLabel('详细地址')).toBeFocused()
    await expect(page.getByLabel('楼盘名称')).toHaveValue('E2E 测试楼盘')
  })

  test('佣金默认无且可切换', async ({ page }) => {
    await page.goto('/publish')

    await expect(page.getByRole('radio', { name: '无', exact: true })).toBeChecked()
    await page.getByRole('radio', { name: '1个月', exact: true }).check()
    await expect(page.getByRole('radio', { name: '1个月', exact: true })).toBeChecked()
  })

  test('合法提交后卡片变为成功态且埋点不含 PII', async ({ page }) => {
    const buildingName = `E2E 楼盘 ${runSuffix}`
    const address = `上海市静安区测试路 ${runSuffix} 号 601`
    const submittedBodies: unknown[] = []
    const analyticsCapture = await captureAnalytics(page)
    await page.route('**/api/supply-submissions', async (route) => {
      const request = route.request()
      if (request.method() === 'POST') submittedBodies.push(request.postDataJSON())
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      })
    })

    await page.goto('/publish')
    await page.getByLabel('楼盘名称').fill(buildingName)
    await page.getByLabel('详细地址').fill(address)
    await page.getByLabel('出租面积').fill('200')
    await page.getByLabel('租金', { exact: true }).fill('6.5')
    await page.getByRole('radio', { name: '1个月', exact: true }).check()
    await page.getByLabel('手机号').fill(publishPhone)
    await page.getByRole('button', { name: '立即投放' }).click()

    await expect(page.getByRole('status')).toContainText('已收到您的房源', { timeout: 30_000 })
    await expect(page.getByRole('status')).toBeFocused()
    await expect(page.getByRole('link', { name: '返回首页' })).toBeVisible()
    expect(new URL(page.url()).pathname).toBe('/publish')
    expect(submittedBodies).toHaveLength(1)
    expect(submittedBodies[0]).toMatchObject({
      requestId: expect.stringMatching(/^publish-/),
      buildingName,
      address,
      areaSqm: 200,
      rentAmount: 6.5,
      rentUnit: 'rmb-sqm-day',
      commissionMonths: '1',
      contactPhone: publishPhone,
      source: { path: '/publish' },
    })

    await flushAnalytics(page)
    await expect.poll(async () => (await analyticsCapture.read()).map((event) => event.name)).toEqual(
      expect.arrayContaining([
        'landing_view',
        'landing_form_start',
        'landing_form_submit',
        'landing_form_success',
      ]),
    )
    const serializedEvents = JSON.stringify(await analyticsCapture.read())
    expect(serializedEvents).not.toContain(publishPhone)
    expect(serializedEvents).not.toContain(buildingName)
    expect(serializedEvents).not.toContain(address)

    await page.getByRole('link', { name: '返回首页' }).click()
    await expect(page).toHaveURL(/\/$/)
  })

  test('服务暂时不可用时保留内容并允许重新提交', async ({ page }) => {
    await page.route('**/api/supply-submissions', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false }),
      }),
    )

    await page.goto('/publish')
    await page.getByLabel('楼盘名称').fill('E2E 失败楼盘')
    await page.getByLabel('详细地址').fill('上海市静安区测试路 1 号')
    await page.getByLabel('出租面积').fill('200')
    await page.getByLabel('手机号').fill(publishPhone)
    await page.getByRole('button', { name: '立即投放' }).click()

    await expect(page.locator('.publish-card__status')).toContainText('暂时没有提交成功')
    await expect(page.getByLabel('楼盘名称')).toHaveValue('E2E 失败楼盘')
    await expect(page.getByLabel('详细地址')).toHaveValue('上海市静安区测试路 1 号')
    await expect(page.getByRole('button', { name: '重新提交' })).toBeVisible()
    browserErrors.set(page, [])
  })

  test('提交过于频繁时提示稍后重试且不清空表单', async ({ page }) => {
    await page.route('**/api/supply-submissions', (route) =>
      route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'rate_limited' }),
      }),
    )

    await page.goto('/publish')
    await page.getByLabel('楼盘名称').fill('E2E 限流楼盘')
    await page.getByLabel('详细地址').fill('上海市静安区测试路 2 号')
    await page.getByLabel('出租面积').fill('188')
    await page.getByLabel('手机号').fill(publishPhone)
    await page.getByRole('button', { name: '立即投放' }).click()

    await expect(page.locator('.publish-card__status')).toContainText('刚才提交得有点频繁')
    await expect(page.getByLabel('楼盘名称')).toHaveValue('E2E 限流楼盘')
    await expect(page.getByRole('button', { name: '稍后重试' })).toBeVisible()
    browserErrors.set(page, [])
  })

  test('375px 视口无横向滚动', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/publish')

    await expectNoHorizontalOverflow(page)
  })
})
