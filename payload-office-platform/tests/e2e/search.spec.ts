import { expect, test } from '@playwright/test'

/**
 * OPT-122 站内搜索 E2E：入口 → 三类结果 → tab → 零结果 → 兼容跳转。
 * 只断言结构与关键文案，不锁具体 seed 数量（种子数据会变）。
 */
test.describe('站内搜索', () => {
  test('顶栏搜索落到 /search 并渲染分类结果', async ({ page }) => {
    await page.goto('/shanghai/listings')
    await page.locator('.header-search__input').fill('虹桥')
    await page.locator('.header-search__submit').click()

    await expect(page).toHaveURL(/\/shanghai\/search\?q=/)
    await expect(page.getByRole('heading', { level: 1, name: '搜索' })).toBeVisible()
    const tabs = page.getByRole('navigation', { name: '搜索结果类型' })
    await expect(tabs).toBeVisible()
    await expect(tabs.getByRole('link', { name: /房源/ })).toBeVisible()
  })

  test('tab 切换保留关键词并重置页码', async ({ page }) => {
    await page.goto('/shanghai/search?q=虹桥&page=2')
    const tabs = page.getByRole('navigation', { name: '搜索结果类型' })

    await tabs.getByRole('link', { name: /楼盘/ }).click()
    await expect(page).toHaveURL(/tab=buildings/)
    await expect(page).not.toHaveURL(/page=2/)
    await expect(tabs.getByRole('link', { name: /楼盘/ })).toHaveAttribute('aria-current', 'page')
  })

  test('零结果显示兜底而不是空白页', async ({ page }) => {
    await page.goto('/shanghai/search?q=zzzz-no-such-thing')

    await expect(page.getByRole('heading', { level: 2, name: /没有找到/ })).toBeVisible()
    await expect(page.getByRole('heading', { level: 3, name: '热门区域' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 3, name: '推荐房源' })).toBeVisible()
  })

  test('无前缀 /search 307 到城市路径并保留参数', async ({ page }) => {
    const response = await page.goto('/search?q=虹桥&tab=listings', { waitUntil: 'commit' })
    expect(response?.status()).toBe(200)
    await expect(page).toHaveURL(/\/shanghai\/search\?q=%E8%99%B9%E6%A1%A5&tab=listings/)
  })

  test('移动端不出现横向滚动', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/shanghai/search?q=虹桥')

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(1)
  })

  test('顶栏联想：键盘选出楼盘并直达详情页', async ({ page }) => {
    await page.goto('/shanghai/listings')
    await page.locator('.header-search__input').fill('上海中心')

    const listbox = page.getByRole('listbox', { name: '搜索建议' })
    await expect(listbox).toBeVisible()
    await expect(listbox.getByRole('option', { name: /上海中心/ })).toBeVisible()

    await page.locator('.header-search__input').press('ArrowDown')
    await page.locator('.header-search__input').press('Enter')
    await expect(page).toHaveURL(/\/shanghai\/buildings\/shanghai-tower/)
  })

  test('搜索页表单联想：点击建议直达实体页', async ({ page }) => {
    await page.goto('/shanghai/search?q=')
    await page.locator('.sw-form__input').fill('lujia')

    const listbox = page.getByRole('listbox', { name: '搜索建议' })
    await expect(listbox).toBeVisible()
    // 'lujia' 同时命中楼盘与商圈，楼盘按 kind 顺序排第一；点第一条进楼盘详情。
    await listbox.getByRole('option').first().click()
    await expect(page).toHaveURL(/\/shanghai\/buildings\//)
  })

  test('拼音别名 shzx 直达上海中心', async ({ page }) => {
    await page.goto('/shanghai/search?q=shzx')

    await expect(page.getByRole('link', { name: /上海中心/ }).first()).toBeVisible()
  })

  test('分类型零结果：房源 tab 给出楼盘出口', async ({ page }) => {
    await page.goto('/shanghai/search?q=静安待租楼盘&tab=listings')

    await expect(page.getByText(/暂无在租房源/)).toBeVisible()
    await expect(page.getByRole('link', { name: /查看全部.*楼盘/ })).toBeVisible()
  })

  test('放宽后标注被忽略的词', async ({ page }) => {
    await page.goto('/shanghai/search?q=静安 游泳池')

    await expect(page.locator('.sw-relaxed')).toContainText('已忽略「游泳池」')
  })
})
