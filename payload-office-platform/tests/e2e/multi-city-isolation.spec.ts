import { expect, test, type Page } from '@playwright/test'

const routingEnabled = process.env.MULTI_CITY_ROUTING_ENABLED === 'true'
const KNOWN_UNAVAILABLE_SEED_MEDIA = [
  'cover-changning-hongqiao-3.jpg',
  'cover-empty-building.jpg',
  'cover-huangpu-bund-3.jpg',
  'cover-lujiazui-grade-a-river-view-3.jpg',
  'cover-west-nanjing-premium-center-3.jpg',
  'cover-xuhui-xujiahui-3.jpg',
  'hero-bg.mp4',
] as const

const browserErrors = new WeakMap<Page, string[]>()

test.beforeEach(async ({ page }) => {
  const errors: string[] = []
  browserErrors.set(page, errors)
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  for (const filename of KNOWN_UNAVAILABLE_SEED_MEDIA) {
    await page.route(`**/api/media/file/${filename}?*`, (route) =>
      route.fulfill({ status: 204, body: '' }))
  }
})

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page) ?? []).toEqual([])
})

test('coming-soon list is 200 noindex with four CTAs and no Shanghai inventory UI', async ({ page }) => {
  // 城市前缀路由（/hangzhou/listings）只在多城市路由开启时可达，关闭态下本用例无意义。
  // 开启态由 quality.yml 的 e2e-multi-city 步骤覆盖。
  test.skip(!routingEnabled, '多城市路由未开启')
  // OPT-029：用例描述的四个 CTA 与实现对不上，且分歧需产品判断，不是断言写法问题。
  // 该页实有三个 region（平台实力背书 / 客户与业主专项服务 / 其他入口），没有
  // 「城市服务入口」；「投放房源」入口在整个组件里 0 次出现；「获取选址方案」实际
  // 是「预约<城市>专属选址方案」。是补入口还是改用例，见
  // specs/work-items/OPT-029-coming-soon-city-cta-divergence.md
  test.fixme(true, 'OPT-029：即将开通城市页的 CTA 集合与用例期望不一致，待产品判断')
  const response = await page.goto('/hangzhou/listings')

  expect(response?.status()).toBe(200)
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/i)
  // 实现的文案是「商办租赁即将登陆<城市>诚邀本地城市合伙人」（ComingSoonCityView.tsx:78），
  // 城市名在「即将登陆」之后。原断言 /杭州.*即将开启/ 的词序与用词都与实现对不上。
  const comingSoonHeading = page.getByRole('heading', { level: 1 })
  await expect(comingSoonHeading).toContainText('即将登陆')
  await expect(comingSoonHeading).toContainText('杭州')
  const actions = page.getByRole('region', { name: '城市服务入口' })
  for (const name of ['委托找房', '投放房源', '城市合伙人', '获取选址方案']) {
    await expect(actions.getByRole(name === '获取选址方案' ? 'button' : 'link', { name })).toBeVisible()
  }
  await expect(page.locator('[data-listing-city="shanghai"]')).toHaveCount(0)
  // OPT-036 Task 11 后列表页 DOM 换成 .ls-card / .ls-filterc；断言意图不变——
  // coming-soon 城市页不得渲染任何房源卡或筛选条。
  await expect(page.locator('.ls-card')).toHaveCount(0)
  await expect(page.locator('.ls-filterc')).toHaveCount(0)
})

test('city switch preserves universal filters and clears geography and page', async ({ page }) => {
  // 依赖城市切换器与城市前缀路由，二者均以多城市路由开启为前提。
  test.skip(!routingEnabled, '多城市路由未开启')
  // rentUnit 不能省：单位闸门之后，缺单位的 rentMax 在解析层整段丢弃，
  // 切城后自然也带不过去（见 search-params.ts 的单位闸门）。
  await page.goto('/shanghai/listings?areaMin=100&rentUnit=rmb-sqm-day&rentMax=10&district=pudong&page=3')
  const switcher = page.locator('.city-switcher')
  // 触发器有 aria-label="切换城市"（CitySwitcher.tsx:143），可访问名被它覆盖、不含城市名；
  // 城市名在子元素 .city-switcher__trigger-city 里。按 class 定位并单独断言当前城市。
  const trigger = switcher.locator('.city-switcher__trigger')
  await expect(trigger).toContainText('上海')
  await trigger.focus()
  await trigger.press('Enter')
  const menu = page.getByRole('menu', { name: '切换城市' })
  await expect(menu.getByRole('menuitem').first()).toBeFocused()
  await menu.getByRole('menuitem', { name: /杭州.*正在开通/ }).click()
  // 输入用旧名 rentUnit/rentMax（已收录 URL 的形态），canonical 输出新名 priceUnit/priceMax
  await expect(page).toHaveURL(/\/hangzhou\/listings\?areaMin=100&priceMax=10&priceUnit=rmb-sqm-day$/)

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
