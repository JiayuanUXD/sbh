import { expect, test } from '@playwright/test'

const LISTING_SLUG = 'jingan-serviced-office-42-seats'
const PRICE_ON_REQUEST_SLUG = 'jingan-price-on-request-300sqm'

test.describe('房源详情 P0', () => {
  test('有效房源按决策顺序展示概况、锚点和咨询入口', async ({ page }) => {
    const response = await page.goto(`/listings/${LISTING_SLUG}`)

    expect(response?.status()).toBe(200)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: '房源概况' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: '详情导航' })).toBeVisible()
    await expect(page.getByRole('link', { name: '查看楼盘' })).toBeVisible()
    await expect(
      page.locator('button[data-source-section="hero"]', { hasText: '询价 / 预约看房' }),
    ).toBeVisible()
  })

  test('失效或不存在的房源统一返回 404', async ({ page }) => {
    const response = await page.goto('/listings/not-an-effective-listing')

    expect(response?.status()).toBe(404)
  })

  test('价格面议房源不显示零元且窄屏没有水平溢出', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    const response = await page.goto(`/listings/${PRICE_ON_REQUEST_SLUG}`)

    expect(response?.status()).toBe(200)
    await expect(page.getByText('价格面议').first()).toBeVisible()
    await expect(page.locator('.detail-hero').getByText(/0\s*元/)).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
  })
})
