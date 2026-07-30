import { expect, test } from '@playwright/test'

const LISTING_SLUG = 'jingan-serviced-office-42-seats'
const PRICE_ON_REQUEST_SLUG = 'jingan-price-on-request-300sqm'
const PUBLISHED_INEFFECTIVE_SLUG = 'jingan-published-pending-recheck'

test.describe('房源详情 P0', () => {
  test('有效房源按决策顺序展示概况、锚点和咨询入口', async ({ page }) => {
    const response = await page.goto(`/listings/${LISTING_SLUG}`)

    expect(response?.status()).toBe(200)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: '房源概况' })).toBeVisible()
    await expect(page.locator('.detail-hero #overview')).toHaveCount(1)
    await expect(page.getByRole('navigation', { name: '详情导航' })).toBeVisible()
    await expect(page.getByRole('link', { name: '查看楼盘' })).toBeVisible()
    await expect(
      page.locator('button[data-source-section="hero"]', { hasText: '询价 / 预约看房' }),
    ).toBeVisible()
  })

  test('存在但待复核的已发布房源仍统一返回 404', async ({ page, request }) => {
    const fixture = await request.get(
      `/api/listings?where[slug][equals]=${PUBLISHED_INEFFECTIVE_SLUG}&limit=1`,
    )
    expect(fixture.status()).toBe(200)
    const fixtureData = await fixture.json() as { docs: Array<{
      slug: string
      publicationStatus: string
      reviewStatus: string
      supplyVisibilityHold: string
    }> }
    expect(fixtureData.docs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        slug: PUBLISHED_INEFFECTIVE_SLUG,
        publicationStatus: 'published',
        reviewStatus: 'approved',
        supplyVisibilityHold: 'pending_recheck',
      }),
    ]))

    const response = await page.goto(`/listings/${PUBLISHED_INEFFECTIVE_SLUG}`)

    expect(response?.status()).toBe(404)
  })

  test('价格面议房源不显示零元且窄屏没有水平溢出', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    const response = await page.goto(`/listings/${PRICE_ON_REQUEST_SLUG}`)

    expect(response?.status()).toBe(200)
    const heroPrice = page.locator('.detail-hero .detail__rent').first()
    const mobilePrice = page.locator('.detail__mobile-bar-rent')
    await expect(heroPrice).toBeVisible()
    await expect(heroPrice).toHaveText('价格面议')
    await expect(mobilePrice).toBeVisible()
    await expect(mobilePrice).toHaveText('价格面议')
    expect(await page.locator('main').evaluate(
      (element) => !/(^|\s)0\s*元(?=\s|$)/.test(element.textContent ?? ''),
    )).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
  })
})

test.describe('楼盘详情 P0', () => {
  test('楼盘页按有效供给显示非空分组', async ({ page }) => {
    const response = await page.goto('/buildings/west-nanjing-premium-center')

    expect(response?.status()).toBe(200)
    await expect(page.getByRole('heading', { name: '当前有效供给' })).toBeVisible()
    await expect(page.getByRole('tab', { name: '出租' })).toBeVisible()
    await expect(page.getByRole('tab', { name: '出售' })).toHaveCount(0)
    await expect(page.getByRole('tab', { name: '联合办公' })).toHaveCount(0)
    // The held `jingan-published-pending-recheck` fixture belongs to this
    // building but is not effective public supply.
    await expect(page.locator('[data-listing-card-variant="building-supply"]')).toHaveCount(3)
  })

  test('无供给楼盘不显示最低价和空 tab', async ({ page }) => {
    const response = await page.goto('/buildings/empty-building')

    expect(response?.status()).toBe(200)
    await expect(page.getByText('当前暂无公开可选空间')).toBeVisible()
    await expect(page.getByText('最低价', { exact: false })).toHaveCount(0)
    await expect(page.getByRole('tab')).toHaveCount(0)
  })

  test('楼盘详情供给聚合和列表使用同一 asOf 快照', async ({ page }) => {
    const response = await page.goto('/buildings/west-nanjing-premium-center')

    expect(response?.status()).toBe(200)
    const aggregate = page.locator('[data-supply-as-of]').first()
    const list = page.locator('.building-supply-browser[data-supply-as-of]')
    await expect(aggregate).toHaveAttribute('data-supply-as-of', /.+/)
    const asOf = await aggregate.getAttribute('data-supply-as-of')
    expect(asOf).not.toBeNull()
    await expect(list).toHaveAttribute('data-supply-as-of', asOf ?? '')
  })
})
