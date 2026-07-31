import { expect, test } from '@playwright/test'

test('list → detail → submit inquiry creates a lead', async ({ page }) => {
  const submittedBodies: Record<string, unknown>[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/inquiries')) {
      submittedBodies.push(request.postDataJSON() as Record<string, unknown>)
    }
  })
  await page.goto('/listings')
  await expect(page.locator('.listing-card').first()).toBeVisible()

  const href = await page.locator('.listing-card').first().getAttribute('href')
  expect(href).toBeTruthy()

  await page.goto(href!)
  await expect(page.locator('h1').first()).toBeVisible()

  // 详情页询价触发按钮标签为「询价 / 预约看房」（桌面主区 + 移动底栏各一个，取第一个可见的）
  await page
    .getByRole('button', { name: /询价|预约看房|留电/ })
    .first()
    .click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()

  await dialog.getByLabel('称呼').fill('E2E 用户')
  await dialog.getByLabel('手机号').fill('13800001111')
  await dialog.getByLabel('团队规模').fill('10-20 人')
  // consent 复选框 required：不勾选时浏览器原生校验会拦截提交，须先同意隐私政策
  await dialog.getByRole('checkbox').check()
  await dialog.getByRole('button', { name: '下一步', exact: true }).click()

  await expect(dialog.getByText('第二步：需求补充（选填）')).toBeVisible()
  await dialog.getByRole('button', { name: '提交', exact: true }).click()

  await expect(dialog.getByText(/已收到/)).toBeVisible()
  const submittedBody = submittedBodies[0]
  expect(submittedBody).toBeDefined()
  expect(submittedBody).toMatchObject({
    activeSupplyGroup: expect.stringMatching(/^(lease|sale|coworking)$/),
    priceSnapshot: {
      amount: expect.any(Number),
      currency: 'CNY',
      period: expect.stringMatching(/^(day|month|year|one-time)$/),
      unit: expect.stringMatching(/^rmb-/),
    },
    source: {
      currentFilters: {
        group: expect.stringMatching(/^(lease|sale|coworking)$/),
        priceUnit: expect.stringMatching(/^rmb-/),
      },
    },
  })
  const source = submittedBody.source as Record<string, unknown>
  expect(source.path).toMatch(/^\/listings\/[^?#]+$/)
})

test('inquiry validation focuses the first invalid field and describes it with the error summary', async ({ page }) => {
  await page.goto('/listings')
  const href = await page.locator('.listing-card').first().getAttribute('href')
  expect(href).toBeTruthy()
  await page.goto(href!)

  await page.getByRole('button', { name: /询价|预约看房|留电/ }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: '下一步', exact: true }).click()

  const name = dialog.getByLabel('称呼')
  await expect(name).toBeFocused()
  await expect(name).toHaveAttribute('aria-invalid', 'true')
  const describedBy = await name.getAttribute('aria-describedby')
  expect(describedBy).toBeTruthy()
  await expect(dialog.locator(`#${describedBy}`)).toContainText('请填写姓名')
})
