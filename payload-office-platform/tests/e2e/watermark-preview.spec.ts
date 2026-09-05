import { expect, test, type Page } from '@playwright/test'

/**
 * OPT-069 后续：「站点设置 → 图片水印」的预览必须**要么出图、要么说真话**。
 *
 * 为什么值得一条 E2E：这个缺陷单测一条都拦不住，而它真的上过线。
 * 预览端点在生产恒 500，页面上却写着「预览需要『站点设置』管理权限」——
 * 因为组件当时用 `<img onError>`，拿不到状态码，把 401/403/5xx 显示成同一句话。
 * 排查因此先往权限方向走了一圈，直到抓网络面板才看到真实状态码。
 * 「渲染出来了没有」和「失败时说的是不是实话」都只有真跑浏览器才看得见。
 */

const ADMIN = { email: 'e2e-adm@example.com', password: 'Test1234!' }

async function loginAsAdmin(page: Page): Promise<void> {
  const response = await page.request.post('/api/users/login', {
    data: ADMIN,
    failOnStatusCode: false,
  })
  expect(response.status(), 'E2E 管理员账号应成功登录').toBe(200)
}

async function openWatermarkTab(page: Page): Promise<void> {
  await page.goto('/admin/globals/site-settings')
  await page.getByRole('button', { name: '图片水印', exact: true }).click()
  await expect(page.getByRole('heading', { name: '效果预览' })).toBeVisible()
}

test.describe('站点设置 → 图片水印 预览', () => {
  test('两张样张都真的渲染出来（而不是停在占位或报错文案）', async ({ page }) => {
    await loginAsAdmin(page)
    await openWatermarkTab(page)

    const previews = page.locator('figure img')
    await expect(previews).toHaveCount(2)

    for (const alt of ['详情大图满铺水印预览', '卡片角标水印预览']) {
      const img = page.getByAltText(alt)
      await expect(img).toBeVisible()
      // 组件走 fetch → data: URL（不用 objectURL，见组件内注释）；
      // 同时断言图片真的解码出了非零尺寸——`<img>` 存在不等于图出来了。
      await expect(img).toHaveAttribute('src', /^data:image\/jpeg;base64,/)
      await expect
        .poll(async () => img.evaluate((el: HTMLImageElement) => el.naturalWidth))
        .toBeGreaterThan(0)
    }
  })

  test('端点 500 时显示服务端给的真实原因，而不是谎报成权限问题', async ({ page }) => {
    await loginAsAdmin(page)

    // 注入一个 500，模拟线上那次故障的形态（端点挂了，但登录态与权限都正常）。
    await page.route('**/api/watermark-preview**', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'internal_error',
          name: 'Error',
          message: '注入的渲染失败：fontconfig error',
        }),
      }),
    )

    await openWatermarkTab(page)

    // 必须带上服务端 message：这句话往往是排查时唯一拿得到的现场。
    await expect(page.getByText('注入的渲染失败：fontconfig error').first()).toBeVisible()
    // 且**不能**再出现那句把人带偏的权限提示。
    await expect(page.getByText('预览需要「站点设置」管理权限')).toHaveCount(0)
  })

  test('403 时才说权限问题', async ({ page }) => {
    await loginAsAdmin(page)

    await page.route('**/api/watermark-preview**', (route) =>
      route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'forbidden' }),
      }),
    )

    await openWatermarkTab(page)

    await expect(page.getByText('预览需要「站点设置」管理权限').first()).toBeVisible()
  })
})
