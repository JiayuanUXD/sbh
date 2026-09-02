import { expect, type Page, test } from '@playwright/test'

/**
 * 数据看板页（OPT-065）
 *
 * 覆盖三件 CI 之外验不到的事：
 * 1. 平台管理员点得进去，且页面真的渲染出卡片与 asOf——不是「路由在但页面空」。
 *    OPT-053 的教训正是这一类：菜单渲染正常、点进去是「没有找到任何东西」，
 *    而当时 typecheck、3823 个单测、next build、CI 三项全绿。
 * 2. 无指标权限的角色**直访 URL** 被挡。Payload 3.86 把自定义视图当公共路由，
 *    既不重定向未登录也不过滤菜单码——不显式判就等于任意登录账号敲 URL 就能进。
 * 3. 未登录直访跳登录页。
 */

const ACCOUNTS = {
  /** 平台管理员：有 analytics 菜单码 + 全部指标权限 */
  ADM: { email: 'e2e-adm@example.com', password: 'Test1234!' },
  /** 经纪人：无经营概览指标权限，用作阴性对照 */
  BRK: { email: 'e2e-brk@example.com', password: 'Test1234!' },
} as const

async function loginAs(page: Page, role: keyof typeof ACCOUNTS): Promise<void> {
  const response = await page.request.post('/api/users/login', {
    data: ACCOUNTS[role],
    failOnStatusCode: false,
  })
  expect(response.status(), `${role} 测试账号应成功登录`).toBe(200)
}

test.describe('/admin/analytics 数据看板', () => {
  test('平台管理员：导航项可见，点进去渲染出卡片与数据截至时间', async ({ page }) => {
    await loginAs(page, 'ADM')
    await page.goto('/admin')

    // 先验导航项真的在——「功能是通的但人碰不到」是这一类改动最典型的漏法
    const navLink = page.getByRole('link', { name: '数据看板' })
    await expect(navLink).toBeVisible()

    await navLink.click()
    await expect(page).toHaveURL(/\/admin\/analytics$/)

    // 页面主体渲染（而不是 Payload 的「没有找到任何东西」）
    const dashboard = page.getByTestId('analytics-dashboard')
    await expect(dashboard).toBeVisible({ timeout: 20_000 })

    // asOf 必须有值：它是所有卡共用的时间锚点，缺了就无法声明数据截至时刻
    await expect(page.getByTestId('analytics-as-of')).not.toBeEmpty()

    // 至少渲染出一张卡（OVERVIEW_CARDS 有 7 个，取决于夹具数据，不硬断言数量）
    await expect(dashboard.locator('.arco-admin-dashboard__metric').first()).toBeVisible()
  })

  test('无指标权限的角色直访 URL 被挡（自定义视图是公共路由，必须自己判）', async ({ page }) => {
    await loginAs(page, 'BRK')
    await page.goto('/admin/analytics')

    // 要么被守卫挡下显示 403 文案，要么整页降级——两者都不能出现正常看板
    await expect(page.getByTestId('analytics-dashboard')).toHaveCount(0)
    const forbidden = page.getByTestId('analytics-forbidden')
    const clientError = page.getByTestId('analytics-error')
    await expect(forbidden.or(clientError)).toBeVisible({ timeout: 20_000 })
  })

  test('未登录直访跳登录页并带回跳参数', async ({ page }) => {
    await page.context().clearCookies()
    await page.goto('/admin/analytics')
    await expect(page).toHaveURL(/\/admin\/login/)
    expect(page.url()).toContain('redirect=')
  })
})
