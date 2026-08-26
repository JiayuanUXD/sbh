import { expect, test, type Page } from '@playwright/test'

const browserErrors = new WeakMap<Page, string[]>()

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

test('saves stage one once, completes optional stage two, and keeps the canonical global URL', async ({ page }) => {
  const requests: Array<{ path: string; body: Record<string, unknown> }> = []
  await page.route('**/api/city-partner-applications', async (route) => {
    requests.push({ path: '/create', body: route.request().postDataJSON() })
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })
  await page.route('**/api/city-partner-applications/details', async (route) => {
    requests.push({ path: '/details', body: route.request().postDataJSON() })
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })

  await page.goto('/city-partner?city=hangzhou')
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/city-partner$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
  await expect(page.getByLabel('申请城市')).toHaveValue('hangzhou')

  await page.getByLabel('姓名').fill('测试申请人')
  await page.getByLabel('手机号').fill('13800001111')
  await page.getByLabel('合作身份').selectOption('local-operations')
  await page.getByLabel(/我已阅读并同意/).check()
  await page.getByRole('button', { name: '保存并继续' }).click()

  await expect(page.getByRole('heading', { name: '补充合作信息（可选）' })).toBeVisible()
  await page.getByLabel('机构名称').fill('测试机构')
  await page.getByLabel('本地运营团队').check()
  await page.getByRole('button', { name: '提交补充信息' }).click()
  await expect(page.getByRole('status')).toContainText('申请已收到')

  expect(requests.map((request) => request.path)).toEqual(['/create', '/details'])
  expect(requests[0]?.body).toMatchObject({
    city: 'hangzhou',
    applicantName: '测试申请人',
    contactPhone: '13800001111',
    source: { path: '/city-partner' },
  })
  expect(requests[1]?.body).toMatchObject({
    contactPhone: '13800001111',
    organizationName: '测试机构',
    resourceTypes: ['local-team'],
  })
  expect(requests[0]?.body.requestId).toBe(requests[1]?.body.requestId)
})

test('keeps values after 429 and coalesces rapid duplicate submission', async ({ page }) => {
  let calls = 0
  const requestIds: unknown[] = []
  await page.route('**/api/city-partner-applications', async (route) => {
    calls += 1
    requestIds.push(route.request().postDataJSON().requestId)
    await new Promise((resolve) => setTimeout(resolve, 80))
    await route.fulfill({
      status: calls === 1 ? 429 : 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: calls !== 1 }),
    })
  })

  await page.goto('/city-partner?city=shanghai')
  await page.getByLabel('姓名').fill('保留姓名')
  await page.getByLabel('手机号').fill('13900001111')
  await page.getByLabel('合作身份').selectOption('owner-property')
  await page.getByLabel(/我已阅读并同意/).check()
  const submit = page.getByRole('button', { name: '保存并继续' })
  await submit.dblclick()
  await expect(page.getByText('提交过于频繁，请稍后再试。您填写的内容仍保留在本页。')).toBeVisible()
  expect(calls).toBe(1)
  await expect(page.getByLabel('姓名')).toHaveValue('保留姓名')
  browserErrors.set(page, [])
  await submit.click()
  await expect(page.getByRole('heading', { name: '补充合作信息（可选）' })).toBeVisible()
  expect(requestIds[0]).toBe(requestIds[1])
})

test('shows invalid query visibly, supports keyboard recovery, and skips details without a request', async ({ page }) => {
  let detailCalls = 0
  await page.route('**/api/city-partner-applications', (route) => route.fulfill({
    status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true }),
  }))
  await page.route('**/api/city-partner-applications/details', (route) => {
    detailCalls += 1
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })

  await page.goto('/city-partner?city=HangZhou')
  await expect(page.getByText('链接中的城市无效')).toBeVisible()
  await expect(page.getByRole('button', { name: '保存并继续' })).toBeDisabled()
  await page.getByLabel('申请城市').selectOption('hangzhou')
  await expect(page.getByRole('button', { name: '保存并继续' })).toBeEnabled()

  await page.getByLabel('姓名').fill('键盘申请人')
  await page.getByLabel('手机号').fill('13700001111')
  await page.getByLabel('合作身份').selectOption('broker-channel')
  await page.getByLabel(/我已阅读并同意/).check()
  await page.getByRole('button', { name: '保存并继续' }).press('Enter')
  await page.getByRole('button', { name: '暂不补充，完成申请' }).click()
  await expect(page.getByRole('status')).toContainText('申请已收到')
  expect(detailCalls).toBe(0)

  await page.setViewportSize({ width: 375, height: 812 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false)
})

test('keeps skip disabled and announces progress while stage two is pending', async ({ page }) => {
  let resolveDetails: () => void = () => undefined
  await page.route('**/api/city-partner-applications', (route) => route.fulfill({
    status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true }),
  }))
  await page.route('**/api/city-partner-applications/details', async (route) => {
    await new Promise<void>((resolve) => { resolveDetails = resolve })
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })

  await page.goto('/city-partner?city=shanghai')
  await page.getByLabel('姓名').fill('pending applicant')
  await page.getByLabel('手机号').fill('13600001111')
  await page.getByLabel('合作身份').selectOption('local-operations')
  await page.getByLabel(/我已阅读并同意/).check()
  await page.getByRole('button', { name: '保存并继续' }).click()
  await page.getByRole('button', { name: '提交补充信息' }).click()

  await expect(page.getByRole('status')).toContainText('正在提交补充信息')
  await expect(page.getByRole('button', { name: '正在提交补充信息' })).toBeDisabled()
  await expect(page.getByRole('button', { name: '暂不补充，完成申请' })).toBeDisabled()
  resolveDetails()
  await expect(page.getByRole('status')).toContainText('申请已收到')
})

/**
 * OPT-038 终审 I1 · 下拉三角回归守卫。
 *
 * 保护的失效点：招募页把 `.filter-bar__select` 的基态覆写在 `.rc-page` 作用域下
 * （(0,3,0)），而下拉三角是 styles.css 里那条 `.filter-bar__select` 基础规则上的
 * 一张 `background-image`（styles.css:992，(0,1,0)）。只要有人把本页那条基态写成
 * `background:` **简写**（Task 3 就这么写过，Task 5 才发现），简写会把
 * `background-image` 一并复位成 `none` —— select 在 5 条真实路由上和单行输入框
 * 长得一模一样，而 typecheck / test / lint / 逐像素截图对比**四道闸门全绿**。
 *
 * 为什么断计算样式而不是断 CSS 源码文本：
 * 源码断言只能钉住它自己 grep 的那一种写法与那一个文件，而失效通道是**层叠**
 * ——`.rc-page` 作用域内任何文件、任何 ≥(0,3,0) 的 `background:` 简写都会打断它。
 * `getComputedStyle` 读的是层叠的最终结果，与是谁、在哪写的无关，这才是失效点本身。
 * （本守卫「会红」已实测验证：把 recruit.css 那两处 `background-color` 临时改回
 * `background` 简写重新 build 后本用例失败，见 OPT-038 final-fix-report。）
 */
test('keeps the native-replacement dropdown arrow on every recruit-page select', async ({ page }) => {
  await page.goto('/city-partner')
  const selects = page.locator('.city-partner-form .filter-bar__select')
  await expect(selects).not.toHaveCount(0)

  const count = await selects.count()
  for (let index = 0; index < count; index += 1) {
    const styles = await selects.nth(index).evaluate((el) => {
      const computed = getComputedStyle(el)
      return {
        id: el.id,
        appearance: computed.appearance,
        backgroundImage: computed.backgroundImage,
        backgroundRepeat: computed.backgroundRepeat,
      }
    })
    // appearance:none 摘掉了浏览器原生箭头，所以那张背景图是**唯一**的可展开提示
    expect(styles.appearance).toBe('none')
    expect(styles.backgroundImage, `select#${styles.id} 丢了下拉三角`).not.toBe('none')
    expect(styles.backgroundImage).toContain('svg')
    expect(styles.backgroundRepeat).toBe('no-repeat')
  }
})
