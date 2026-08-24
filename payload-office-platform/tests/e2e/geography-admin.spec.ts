import {
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
  test,
} from '@playwright/test'

/**
 * 地理管理后台 E2E（Task 17）
 *
 * 覆盖计划 Task 17 的五条路径。fixture 由本 spec 在 beforeAll 自行灌入
 * （按 slug 幂等 upsert，CI 从空库可复现），不依赖任何 seed 脚本——seed 只有上海。
 *
 * 为何用专属城市「全域测试城」而非计划正文的「杭州」：
 * 本地开发库 sbh_dev_geo 已含早期任务人工验收灌入的 2 城样例数据（杭州/苏州），
 * 若直接复用「杭州」会与既有节点叠加，完备度计数非确定、且多个环境不一致
 * （CI 空库无杭州）。改用 spec 专属唯一城市，计数可硬编码、全环境确定性一致，
 * 且不破坏既有样例数据。流程 3/5 的城市名/搜索词相应从「杭州」调整为「全域测试城」。
 *
 * 流程与 DOM 依据：
 *  - 城市完备度卡：GeographyCityDetailClient（Descriptions item-label/value）
 *  - 列表抽屉：GeographyListViewClient（city Select / 每行「编辑」/ 抽屉「保存」「完整编辑」）
 *  - 商圈扩展面板：BusinessAreaExtensionPanel（Card 标题「商圈空间扩展」，别名 + 添加别名，
 *    无扩展时保存按钮为「创建扩展」）
 *  - 全局搜索：GeographyQuickSearch（Cmd/Ctrl+K，结果「父级 / 名称」+ 城市分组头）
 *  - 导航：AdminNavigationClient（一级 group-toggle / 二级 subgroup-toggle / link）
 * 注：计划正文写「空间与展示」面板，实际 Card 标题为「商圈空间扩展」，此处按实际实现断言。
 */

const ROLE_ACCOUNTS = {
  ADM: { email: 'e2e-adm@example.com', password: 'Test1234!' },
} as const

/** 「全域测试城」fixture 的期望完备度（beforeAll 灌入后、flow4 建扩展前的确定性状态） */
const EXPECTED_COUNTS = {
  行政区: '2',
  商圈: '1',
  缺边界商圈: '1（需补边界）',
  地铁线路: '2',
  站点: '1',
  楼盘: '0',
} as const

// —— 模块级状态：beforeAll 灌入的 fixture id，供各 flow 跳转/断言使用 ——
let cityId: number | string | null = null
let xihuBaId: number | string | null = null

async function loginAs(page: Page): Promise<void> {
  const response = await page.request.post('/api/users/login', {
    data: ROLE_ACCOUNTS.ADM,
    failOnStatusCode: false,
  })
  expect(response.status(), 'ADM 测试账号应成功登录').toBe(200)
}

async function ensureDesktopNavigationOpen(page: Page): Promise<void> {
  const toggler = page.locator('.template-default__nav-toggler')
  if (await toggler.isVisible().catch(() => false)) {
    await toggler.click()
  }
  await expect(page.locator('.admin-navigation__group-toggle').first()).toBeVisible()
}

async function openTopGroup(page: Page, name: string): Promise<void> {
  const button = topGroupButton(page, name)
  await expect(button).toBeVisible()
  if ((await button.getAttribute('aria-expanded')) !== 'true') {
    // 桌面端 template-default 容器覆盖在 nav 上拦截坐标点击，改用 dispatchEvent 派发
    await button.dispatchEvent('click')
  }
  await expect(button).toHaveAttribute('aria-expanded', 'true')
}

function topGroupButton(page: Page, name: string): Locator {
  return page
    .getByRole('button', { name, exact: true })
    .and(page.locator('.admin-navigation__group-toggle'))
}

/** dev 模式下 Next.js dev-overlay portal 会拦截按钮坐标点击，改派发 click 事件绕过。 */
async function clickViaDispatch(locator: Locator): Promise<void> {
  await locator.dispatchEvent('click')
}

function toId(value: unknown): number | string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number' || typeof value === 'string') return value
  if (typeof value === 'object' && 'id' in value) {
    return toId((value as { id: unknown }).id)
  }
  return null
}

/** 按 slug 幂等 upsert location：存在则复用，否则 POST（protectLocation 自动维护 city/version）。 */
async function upsertLocation(
  request: APIRequestContext,
  data: Record<string, unknown>,
): Promise<{ id?: unknown }> {
  const slug = data.slug as string
  const where = new URLSearchParams({ 'where[slug][equals]': slug })
  const existingRes = await request.get(`/api/locations?${where.toString()}`)
  const existing = (await existingRes.json())?.docs ?? []
  if (existing.length > 0) return existing[0]

  const res = await request.post('/api/locations', { data, failOnStatusCode: false })
  expect(res.status(), `POST /api/locations ${slug} 应 201`).toBe(201)
  return (await res.json()).doc as { id?: unknown }
}

test.describe.serial('地理管理后台 E2E', () => {
  test.beforeAll(async ({ request }) => {
    const login = await request.post('/api/users/login', {
      data: ROLE_ACCOUNTS.ADM,
      failOnStatusCode: false,
    })
    expect(login.status(), 'ADM 测试账号应成功登录').toBe(200)

    // —— 灌入「全域测试城」fixture（按 slug 幂等）——
    const city = await upsertLocation(request, {
      name: '全域测试城',
      slug: 'e2e-test-city',
      immutableCode: 'E2E-CITY',
      type: 'city',
      status: 'active',
      sortOrder: 0,
    })
    cityId = toId(city.id)

    const xihu = await upsertLocation(request, {
      name: '测试西湖区',
      slug: 'e2e-xihu',
      immutableCode: 'E2E-D-XIHU',
      type: 'district',
      parent: cityId,
      status: 'active',
    })
    const xihuDistrictId = toId(xihu.id)

    await upsertLocation(request, {
      name: '测试滨江区',
      slug: 'e2e-binjiang',
      immutableCode: 'E2E-D-BINJIANG',
      type: 'district',
      parent: cityId,
      status: 'active',
    })

    // 线路名「全域2号线」保证 flow5 搜「全域2」命中（name contains 连续子串）
    const line2 = await upsertLocation(request, {
      name: '全域2号线',
      slug: 'e2e-metro-2',
      immutableCode: 'E2E-ML-L2',
      type: 'metro_line',
      parent: cityId,
      status: 'active',
      sortOrder: 1,
    })
    const line2Id = toId(line2.id)

    await upsertLocation(request, {
      name: '全域地铁1号线',
      slug: 'e2e-metro-1',
      immutableCode: 'E2E-ML-L1',
      type: 'metro_line',
      parent: cityId,
      status: 'active',
      sortOrder: 2,
    })

    await upsertLocation(request, {
      name: '测试龙翔桥',
      slug: 'e2e-metro-2-st1',
      immutableCode: 'E2E-MS-L2-ST1',
      type: 'metro_station',
      parent: line2Id,
      status: 'active',
    })

    const xihuBa = await upsertLocation(request, {
      name: '测试西湖商圈',
      slug: 'e2e-ba-xihu',
      immutableCode: 'E2E-BA-XIHU',
      type: 'business_area',
      parent: xihuDistrictId,
      status: 'active',
      sortOrder: 0,
    })
    xihuBaId = toId(xihuBa.id)

    // 重置扩展：删除既有扩展，保证每轮从「缺边界 + 无扩展（按钮=创建扩展）」态开始
    if (xihuBaId != null) {
      const extRes = await request.get(
        `/api/business-area-extensions?where[businessArea][equals]=${xihuBaId}&limit=1&depth=0`,
      )
      const extDoc = (await extRes.json())?.docs?.[0]
      if (toId(extDoc?.id) != null) {
        await request.delete(`/api/business-area-extensions/${toId(extDoc.id)}`)
      }
    }
  })

  test('flow1 区域管理含四个地理入口，系统基础配置只保留配套字典', async ({ page }) => {
    await loginAs(page)
    await page.goto('/admin')
    await ensureDesktopNavigationOpen(page)
    await openTopGroup(page, '区域管理')
    const regionGroup = topGroupButton(page, '区域管理').locator('..')
    // 6 项：城市管理 / 城市站点配置 / 行政区域 / 商圈管理 / 地铁管理 / 地理别名
    //（见 src/domain/admin-navigation/navigation-config.ts 的 region-management 组）
    // 地理别名由 OPT-045 D4 收编——此前它不在导航配置里，被兜底渲染成左下角
    // 那个风格不一致的「集合」区块。
    await expect(regionGroup.locator('.admin-navigation__item')).toHaveCount(6)
    await expect(regionGroup).toContainText('城市管理')
    await expect(regionGroup).toContainText('地理别名')
    await expect(regionGroup).toContainText('城市站点配置')
    await expect(regionGroup).toContainText('行政区域')
    await expect(regionGroup).toContainText('商圈管理')
    await expect(regionGroup).toContainText('地铁管理')

    await openTopGroup(page, '系统管理')
    const systemConfig = page.locator('.admin-navigation__subgroup').filter({ hasText: '基础配置' })
    await expect(systemConfig.locator('.admin-navigation__subgroup-item')).toHaveCount(1)
    await expect(systemConfig).toContainText('配套字典')
  })

  test('六条地理路由保留后台框架，区域管理为激活展开组', async ({ page }) => {
    expect(cityId).not.toBeNull()
    await loginAs(page)

    const routes = [
      '/admin/geography/cities',
      '/admin/geography/districts',
      '/admin/geography/business-areas',
      '/admin/geography/metro-lines',
      `/admin/geography/cities/${cityId}`,
      '/admin/geography/districts/new',
    ]

    for (const route of routes) {
      await page.goto(route)
      await expect(page.locator('.admin-navigation')).toBeVisible()
      await expect(page.locator('.app-header')).toBeVisible()

      const regionButton = topGroupButton(page, '区域管理')
      await expect(regionButton).toHaveClass(/admin-navigation__group-toggle--active/)
      await expect(regionButton).toHaveAttribute('aria-expanded', 'true')
      await expect(regionButton.locator('..')).toHaveClass(/admin-navigation__group--open/)
    }
  })

  test('flow2 城市管理完备度计数与灌入数据一致', async ({ page }) => {
    expect(cityId).not.toBeNull()
    await loginAs(page)
    await page.goto(`/admin/geography/cities/${cityId}`)

    const card = page.locator('.arco-card').filter({ hasText: '城市完备度' })
    await expect(card).toBeVisible()
    for (const [label, value] of Object.entries(EXPECTED_COUNTS)) {
      // Arco Descriptions 渲染为 table：label cell 文本带冒号后缀（如「行政区：」），
      // 紧随其后是 value cell。按含冒号的精确 cell 名定位，读其后续 sibling cell。
      const labelCell = card.getByRole('cell', { name: `${label}：`, exact: true })
      await expect(labelCell.locator('xpath=following-sibling::*[1]')).toHaveText(value)
    }
  })

  test('flow3 地铁管理按城市筛选、改名持久且筛选不丢', async ({ page }) => {
    await loginAs(page)
    await page.goto('/admin/geography/metro-lines')

    // 城市筛选切「全域测试城」
    const citySelect = page.locator('.arco-select').filter({ hasText: '全部城市' }).first()
    await citySelect.click()
    await page.locator('.arco-select-option').filter({ hasText: '全域测试城' }).first().click()

    const rows = page.locator('.arco-table tbody tr')
    await expect(rows.filter({ hasText: '全域2号线' })).toHaveCount(1)
    await expect(rows.filter({ hasText: '全域地铁' })).toHaveCount(1)
    await expect(rows.filter({ hasText: '上海' })).toHaveCount(0)

    // 打开「全域2号线」抽屉改名保存
    const lineRow = rows.filter({ hasText: '全域2号线' }).first()
    await lineRow.getByRole('button', { name: '编辑' }).click()
    const drawer = page.locator('.arco-drawer')
    await drawer
      .locator('.arco-form-item')
      .filter({ hasText: '名称' })
      .first()
      .locator('input')
      .fill('全域2号线新名')
    await clickViaDispatch(drawer.getByRole('button', { name: '保存', exact: true }))
    await expect(page.getByText('已保存').last()).toBeVisible()

    // 刷新后改名仍在，且城市筛选未丢（URL 仍带 city 参数、列表仍只列全域测试城线路）
    await page.reload()
    await expect(
      page.locator('.arco-table tbody tr').filter({ hasText: '全域2号线新名' }),
    ).toHaveCount(1)
    expect(new URL(page.url()).searchParams.get('city')).toBe(String(cityId))
    await expect(page.locator('.arco-table tbody tr').filter({ hasText: '上海' })).toHaveCount(0)
  })

  test('flow4 缺边界 chip 正确、商圈扩展面板别名持久', async ({ page }) => {
    expect(xihuBaId).not.toBeNull()
    await loginAs(page)
    await page.goto('/admin/geography/business-areas')

    // 「仅看缺边界」chip → 测试西湖商圈（无边界）应出现
    await page.getByRole('button', { name: '仅看缺边界' }).click()
    const baRows = page.locator('.arco-table tbody tr')
    await expect(baRows.filter({ hasText: '测试西湖商圈' })).toHaveCount(1)

    // 打开该商圈 → 完整编辑 → 原生编辑页内嵌「商圈空间扩展」面板
    const xihuRow = baRows.filter({ hasText: '测试西湖商圈' }).first()
    await xihuRow.getByRole('button', { name: '编辑' }).click()
    await clickViaDispatch(page.locator('.arco-drawer').getByRole('button', { name: '完整编辑' }))

    await expect(page.getByText('商圈空间扩展', { exact: true })).toBeVisible()

    // 填别名并保存（无扩展 → 「创建扩展」）
    await page.getByRole('button', { name: '+ 添加别名' }).click()
    const aliasInput = page
      .locator('.arco-form-item')
      .filter({ hasText: '别名' })
      .first()
      .locator('input')
      .last()
    await aliasInput.fill('西湖展')
    await clickViaDispatch(page.getByRole('button', { name: '创建扩展' }))
    await expect(page.getByText('已保存').last()).toBeVisible()

    // 刷新后别名持久
    await page.reload()
    await expect(page.locator('input[value="西湖展"]')).toBeVisible()
  })

  test('flow5 Cmd+K 全局搜索带城市面包屑并回车直达', async ({ page }) => {
    await loginAs(page)
    await page.goto('/admin')

    await page.keyboard.press('Control+K')
    const searchInput = page.getByPlaceholder(
      '搜索城市 / 行政区 / 商圈 / 地铁线路 / 站点（名称或区域代码）',
    )
    await searchInput.fill('全域2')

    // 结果带城市面包屑（父级「全域测试城」/ 名称「全域2号线」）
    await expect(page.getByText('全域测试城 / 全域2号线')).toBeVisible()

    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/admin\/geography\/metro-lines\?q=E2E-ML-L2$/)
  })
})
