import { expect, test, type Page } from '@playwright/test'

const routingEnabled = process.env.MULTI_CITY_ROUTING_ENABLED === 'true'

function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  return errors
}

test('coming-soon list is 200 noindex with four CTAs and no Shanghai inventory UI', async ({ page }) => {
  const errors = watchErrors(page)
  const response = await page.goto('/hangzhou/listings')

  expect(response?.status()).toBe(200)
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/i)
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/杭州.*即将开启/)
  const actions = page.getByRole('region', { name: '城市服务入口' })
  for (const name of ['委托找房', '投放房源', '城市合伙人', '获取选址方案']) {
    await expect(actions.getByRole(name === '获取选址方案' ? 'button' : 'link', { name })).toBeVisible()
  }
  await expect(page.locator('[data-listing-city="shanghai"]')).toHaveCount(0)
  await expect(page.locator('.listing-card')).toHaveCount(0)
  await expect(page.locator('.filter-bar')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('city switch preserves universal filters and clears geography and page', async ({ page }) => {
  await page.goto('/shanghai/listings?areaMin=100&rentMax=10&district=pudong&page=3')
  const switcher = page.locator('.city-switcher')
  const trigger = switcher.getByRole('button', { name: /上海.*切换城市/ })
  await trigger.focus()
  await trigger.press('Enter')
  const menu = page.getByRole('menu', { name: '切换城市' })
  await expect(menu.getByRole('menuitem').first()).toBeFocused()
  await menu.getByRole('menuitem', { name: /杭州.*正在开通/ }).click()
  await expect(page).toHaveURL(/\/hangzhou\/listings\?areaMin=100&rentMax=10$/)

  await page.goBack()
  await trigger.click()
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(trigger).toBeFocused()
})

test('flag-off prefixed owners are noindex legacy canonicals; flag-on owners are indexable', async ({ page }) => {
  for (const [path, legacy] of [
    ['/shanghai', '/'],
    ['/shanghai/listings', '/listings'],
    ['/shanghai/buildings', '/buildings'],
  ] as const) {
    const response = await page.goto(path)
    expect(response?.status(), path).toBe(200)
    const href = await page.locator('link[rel="canonical"]').getAttribute('href')
    const canonical = new URL(href!, page.url())
    expect(canonical.pathname).toBe(routingEnabled ? path : legacy)
    if (routingEnabled) {
      await expect(page.locator('meta[name="robots"]')).not.toHaveAttribute('content', /noindex/i)
    } else {
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/i)
    }
  }
})

test('lead entry pages expose the selected trusted city and global canonical', async ({ page }) => {
  for (const path of [
    '/entrust?city=hangzhou',
    '/publish?city=hangzhou',
    '/city-partner?city=hangzhou',
  ]) {
    const response = await page.goto(path)
    expect(response?.status(), path).toBe(200)
    await expect(page.getByRole('combobox').filter({ has: page.locator('option[value="hangzhou"]') }).first())
      .toHaveValue('hangzhou')
    const href = await page.locator('link[rel="canonical"]').getAttribute('href')
    expect(new URL(href!, page.url()).search).toBe('')
  }
})
