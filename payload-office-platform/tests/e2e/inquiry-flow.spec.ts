import { expect, test } from '@playwright/test'

test('list → detail → submit inquiry creates a lead', async ({ page }) => {
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

  await dialog.getByLabel('姓名').fill('E2E 用户')
  await dialog.getByLabel('手机号').fill('13800001111')
  // consent 复选框 required：不勾选时浏览器原生校验会拦截提交，须先同意隐私政策
  await dialog.getByRole('checkbox').check()
  await dialog.getByRole('button', { name: '提交', exact: true }).click()

  await expect(dialog.getByText(/已收到/)).toBeVisible()
})
