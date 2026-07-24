import { expect, test } from '@playwright/test'

test('list → detail → submit inquiry creates a lead', async ({ page }) => {
  await page.goto('/listings')
  await expect(page.locator('.listing-card').first()).toBeVisible()

  const slug = await page.locator('.listing-card').first().getAttribute('href')
  expect(slug).toBeTruthy()

  await page.goto(slug!)
  await expect(page.locator('h1')).toBeVisible()

  await page.getByRole('button', { name: /在线询价|留电/ }).click()
  await page.getByLabel('姓名').fill('E2E 用户')
  await page.getByLabel('手机').fill('13800001111')
  await page.getByRole('button', { name: '提交' }).click()

  await expect(page.getByText(/已收到/)).toBeVisible()
})
