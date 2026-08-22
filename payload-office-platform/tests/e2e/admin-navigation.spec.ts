import {
  expect,
  type Locator,
  type Page,
  test,
} from '@playwright/test'

const ROLE_ACCOUNTS = {
  ADM: { email: 'e2e-adm@example.com', password: 'Test1234!' },
  OPS: { email: 'e2e-ops@example.com', password: 'Test1234!' },
  MGR: { email: 'e2e-mgr@example.com', password: 'Test1234!' },
  BRK: { email: 'e2e-brk@example.com', password: 'Test1234!' },
  CSR: { email: 'e2e-csr@example.com', password: 'Test1234!' },
} as const

type RoleCode = keyof typeof ROLE_ACCOUNTS

const ALL_TOP_GROUPS = [
  '工作台',
  '房源运营',
  '区域管理',
  '审核与风控',
  '客户运营',
  '商户合作',
  '团队管理',
  '内容管理',
  '表单中心',
  '系统管理',
] as const

/**
 * 导航配置里的**全部**叶子标签。
 *
 * 为什么要有这份清单：五角色矩阵每个角色只点**一个**代表性叶子（ROLE_NAVIGATION
 * 的 allowed），分组层面也只验分组在不在。结果是「审核队列」整条入口在线上消失了
 * 两天没人发现——页面能打开、数据查得出、URL 直达可用，只是侧边栏里没有它，而
 * 3200 个单测、typecheck、lint、既有 e2e 全绿。
 *
 * 真正漏掉的一类是「功能是通的，人碰不到」。这里对平台管理员断言**每一个**叶子
 * 都在，就是补这一类。
 *
 * 与配置的一致性由 tests/admin-nav-leaf-coverage.test.ts 守着，不会漂。
 */
const ALL_LEAF_LABELS = [
  '运营概览',
  '我的待办',
  '消息通知',
  '房源列表',
  '楼盘库',
  '房源投放申请',
  '房源批量导入',
  '楼盘批量导入',
  '城市管理',
  '城市站点配置',
  '行政区域',
  '商圈管理',
  '地铁管理',
  '审核队列',
  '举报处理',
  '咨询线索',
  '客户档案',
  '跟进记录',
  '商户管理',
  '城市合伙人申请',
  '团队管理',
  '经纪人管理',
  '顾问服务时间',
  '页面内容',
  '资讯中心',
  '素材库',
  '表单管理',
  '提交数据',
  '用户管理',
  '角色管理',
  '配套字典',
  '搜索索引',
  '领域事件',
  '审计日志',
] as const

const ROLE_NAVIGATION = {
  ADM: {
    groups: [
      '工作台',
      '房源运营',
      '区域管理',
      '审核与风控',
      '客户运营',
      '商户合作',
      '团队管理',
      '内容管理',
      '表单中心',
      '系统管理',
    ],
    allowed: { group: '内容管理', leaf: '页面内容', slug: 'pages' },
  },
  OPS: {
    groups: [
      '工作台',
      '房源运营',
      '区域管理',
      '审核与风控',
      '商户合作',
      '内容管理',
      '表单中心',
      '系统管理',
    ],
    allowed: {
      group: '审核与风控',
      leaf: '审核队列',
      slug: 'listing-reviews',
      pageMarker: '房源审核台',
    },
  },
  MGR: {
    groups: ['工作台', '房源运营', '客户运营', '团队管理'],
    allowed: { group: '团队管理', leaf: '团队管理', slug: 'teams' },
  },
  BRK: {
    groups: ['工作台', '房源运营', '客户运营'],
    allowed: { group: '房源运营', leaf: '房源列表', slug: 'listings' },
  },
  CSR: {
    groups: ['工作台', '客户运营', '表单中心'],
    allowed: { group: '表单中心', leaf: '表单管理', slug: 'forms' },
  },
} as const satisfies Record<
  RoleCode,
  {
    groups: readonly string[]
    allowed: {
      group: string
      leaf: string
      slug: string
      pageMarker?: string
    }
  }
>

async function loginAs(page: Page, role: RoleCode): Promise<void> {
  const response = await page.request.post('/api/users/login', {
    data: ROLE_ACCOUNTS[role],
    failOnStatusCode: false,
  })

  expect(response.status(), `${role} 测试账号应成功登录`).toBe(200)
}

async function ensureDesktopNavigationOpen(page: Page): Promise<void> {
  const toggler = page.locator('.template-default__nav-toggler')
  // 桌面端（≥1024px）custom.scss 强制 .nav 常驻可见并对汉堡 display:none；
  // 仅在汉堡可见（移动/窄视口）时点击展开，桌面端直接确认分组按钮可见即可。
  if (await toggler.isVisible().catch(() => false)) {
    await toggler.click()
  }
  await expect(
    page.locator('.admin-navigation__group-toggle').first(),
  ).toBeVisible()
}

function topGroupButtons(page: Page): Locator {
  return page.locator('.admin-navigation__group-toggle')
}

function topGroupButton(page: Page, name: string): Locator {
  return page
    .getByRole('button', { name, exact: true })
    .and(page.locator('.admin-navigation__group-toggle'))
}

/**
 * 定位导航叶子链接。
 *
 * 不能用 `getByRole('link', { name: label, exact: true })`：带角标的叶子
 * （navigation-config 的 badgeKey）在计数 > 0 时会多渲染一个
 * `<span aria-label="{label}待处理 N 项">`，它会并入链接的 accessible name，
 * 于是 accessible name 变成「消息通知消息通知待处理 1 项」，exact 匹配直接落空。
 *
 * 后果比匹配不到更坏：本用例会把它报成「平台管理员看不到这些入口」，把一个
 * 纯数据条件误导成权限判定 bug。真实事故：本地库里残留了一条 e2e 造出来的未读
 * 通知（recipient = e2e-adm），「消息通知」就被判成入口消失，而其余六个角标源
 * 恰好都是 0，看起来像只有这一个叶子出了权限问题。
 *
 * 所以锚定叶子自己的 label 元素，让断言只回答「入口在不在」，与角标数量无关；
 * 同时限定在自研导航内 —— Payload 默认导航也会渲染同名 collection 链接，不限定
 * 的话「自研导航吞掉入口」这类真回归会被默认导航遮掉。
 */
function navLeafLink(page: Page, label: string): Locator {
  return page
    .locator('.admin-navigation__link')
    .filter({ has: page.getByText(label, { exact: true }) })
}

async function expectRoleGroups(page: Page, role: RoleCode): Promise<void> {
  const allowed = ROLE_NAVIGATION[role].groups
  await expect(topGroupButtons(page)).toHaveCount(allowed.length)

  for (const [index, group] of allowed.entries()) {
    await expect(
      topGroupButton(page, group),
      `${role} 应显示 ${group}`,
    ).toBeVisible()
    await expect(
      topGroupButtons(page).nth(index).locator('.admin-navigation__group-label'),
    ).toHaveText(group)
  }

  for (const group of ALL_TOP_GROUPS.filter(
    (candidate) => !allowed.some((allowedGroup) => allowedGroup === candidate),
  )) {
    await expect(
      topGroupButton(page, group),
      `${role} 不应渲染无权分组 ${group}`,
    ).toHaveCount(0)
  }
}

async function openGroup(page: Page, name: string): Promise<void> {
  const button = topGroupButton(page, name)
  await expect(button).toBeVisible()
  if ((await button.getAttribute('aria-expanded')) !== 'true') {
    // 桌面端 custom.scss 强制 .nav 可见，但 Payload 3 navOpen=false 时
    // template-default 容器覆盖在 nav 之上，坐标命中落到 template-default
    // 而非 button（elementFromPoint 返回 template-default），Playwright 的
    // 鼠标点击（含 force:true）被拦截、React onClick 不触发。改用 dispatchEvent
    // 直接派发 click 事件，绕过坐标命中，稳定触发分组展开。
    await button.dispatchEvent('click')
  }
  await expect(button).toHaveAttribute('aria-expanded', 'true')
}

function parseRGB(color: string): [number, number, number] {
  const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number)
  if (!channels || channels.length !== 3) {
    throw new Error(`无法解析颜色：${color}`)
  }
  return [channels[0], channels[1], channels[2]]
}

function relativeLuminance([red, green, blue]: [number, number, number]): number {
  const channel = (value: number) => {
    const normalized = value / 255
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4
  }

  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)
}

function contrastRatio(foreground: string, background: string): number {
  const first = relativeLuminance(parseRGB(foreground))
  const second = relativeLuminance(parseRGB(background))
  const lighter = Math.max(first, second)
  const darker = Math.min(first, second)
  return (lighter + 0.05) / (darker + 0.05)
}

async function navigationTextColors(page: Page): Promise<{
  background: string
  foreground: string
}> {
  return topGroupButton(page, '工作台').evaluate((button) => {
    const foreground = getComputedStyle(button).color
    let ancestor: Element | null = button
    let background = ''

    while (ancestor) {
      const candidate = getComputedStyle(ancestor).backgroundColor
      const alpha = Number(candidate.match(/[\d.]+/g)?.[3] ?? 1)
      if (candidate !== 'transparent' && alpha >= 0.99) {
        background = candidate
        break
      }
      ancestor = ancestor.parentElement
    }

    return { background, foreground }
  })
}

async function expectUncovered(
  locator: Locator,
  viewportHeight: number,
): Promise<void> {
  const box = await locator.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewportHeight)

  await expect
    .poll(() =>
      locator.evaluate((element) => {
        const box = element.getBoundingClientRect()
        const topmost = document.elementFromPoint(
          box.left + box.width / 2,
          box.top + box.height / 2,
        )
        return (
          topmost !== null &&
          (topmost === element || element.contains(topmost))
        )
      }),
    )
    .toBe(true)
}

/**
 * 展开所有子分组。
 *
 * 导航是两层可折叠：顶层分组（openGroup）之下还有 subgroup，各自独立的
 * aria-expanded。只展开顶层的话，「高级工具」这类子分组里的叶子仍然不可见——
 * 第一版全叶子用例就是这么误报了四个「缺失入口」的。
 */
async function openAllSubgroups(page: Page): Promise<void> {
  const collapsed = page.locator(
    '.admin-navigation__subgroup-toggle[aria-expanded="false"]',
  )
  // 每次点开一个后 DOM 变化，重新求值；给个上界防止意外死循环
  for (let guard = 0; guard < 20; guard += 1) {
    if ((await collapsed.count()) === 0) break
    await collapsed.first().dispatchEvent('click')
  }
  await expect(collapsed).toHaveCount(0)
}

test.describe('后台导航 / 五角色桌面矩阵', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  for (const role of Object.keys(ROLE_NAVIGATION) as RoleCode[]) {
    test(`${role} 仅显示目标分组并可进入允许页面`, async ({ page }) => {
      await loginAs(page, role)
      await page.goto('/admin')
      await ensureDesktopNavigationOpen(page)
      await expect(page.locator('.admin-navigation')).toBeVisible()

      await expectRoleGroups(page, role)

      const { group, leaf, slug } = ROLE_NAVIGATION[role].allowed
      await openGroup(page, group)
      // template-default 拦截坐标点击，用原生 click() 直接触发 next/link 路由导航
      await navLeafLink(page, leaf).evaluate((el: HTMLElement) => el.click())

      await expect(page).toHaveURL(
        new RegExp(`/admin/collections/${slug}(?:\\?.*)?$`),
      )
      const allowed = ROLE_NAVIGATION[role].allowed
      if ('pageMarker' in allowed) {
        await expect(
          page.getByText(allowed.pageMarker, { exact: true }),
        ).toBeVisible()
      } else {
        await expect(
          page.getByRole('heading', { level: 1, name: leaf, exact: true }),
        ).toBeVisible()
      }
    })
  }

  for (const role of ['OPS', 'MGR', 'BRK', 'CSR'] as const) {
    test(`${role} 直接访问无权领域事件仍被后端拒绝`, async ({ page }) => {
      await loginAs(page, role)

      const apiResponse = await page.request.get('/api/domain-events?limit=1', {
        failOnStatusCode: false,
      })
      expect(apiResponse.status()).toBe(403)

      const pageResponse = await page.goto('/admin/collections/domain-events')
      expect(pageResponse?.status()).toBe(404)
      await expect(
        page.getByRole('heading', { level: 1, name: '没有找到任何东西' }),
      ).toBeVisible()
    })
  }
})

test.describe('后台导航 / 桌面交互', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'ADM')
    await page.goto('/admin')
    await ensureDesktopNavigationOpen(page)
    await expect(page.locator('.admin-navigation')).toBeVisible()
  })

  test('多分组可同时展开，刷新后恢复当前分组和高亮叶子', async ({ page }) => {
    // 当前路由 /admin 的激活分组为"工作台"，初始自动展开
    await expect(topGroupButton(page, '工作台')).toHaveAttribute(
      'aria-expanded',
      'true',
    )

    // 多展开模式（对标 Arco Design Pro）：打开新分组不收起已展开分组
    await openGroup(page, '房源运营')
    await expect(topGroupButton(page, '房源运营')).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    await expect(topGroupButton(page, '工作台')).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    await expect(
      page.locator('.admin-navigation__group-toggle[aria-expanded="true"]'),
    ).toHaveCount(2)

    await openGroup(page, '客户运营')
    await expect(topGroupButton(page, '客户运营')).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    await expect(
      page.locator('.admin-navigation__group-toggle[aria-expanded="true"]'),
    ).toHaveCount(3)

    // template-default 拦截坐标点击，用原生 click() 直接触发 next/link 路由导航
    await page
      .getByRole('link', { name: '咨询线索', exact: true })
      .evaluate((el: HTMLElement) => el.click())
    await expect(page).toHaveURL(
      /\/admin\/collections\/leads(?:\?.*)?$/,
    )
    await page.reload()
    await ensureDesktopNavigationOpen(page)

    // 刷新后恢复当前路由所在分组（客户运营）并高亮叶子
    await expect(topGroupButton(page, '客户运营')).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    await expect(
      page.getByRole('link', { name: '咨询线索', exact: true }),
    ).toHaveAttribute('aria-current', 'page')
  })

  test('数量提醒正确格式化 0、1、99、100 边界', async ({ page }) => {
    await page.route('**/api/admin-navigation', async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          ok: true,
          badges: {
            tasks: 0,
            notifications: 1,
            listingReviews: 99,
            listingReports: 100,
          },
          asOf: '2026-07-28T12:00:00.000Z',
        }),
        contentType: 'application/json',
        status: 200,
      })
    })
    await page.reload()
    await ensureDesktopNavigationOpen(page)

    const tasksLink = page.locator(
      'a.admin-navigation__link[href="/admin/collections/tasks"]',
    )
    await expect(tasksLink).toBeVisible()
    await expect(tasksLink.locator('.admin-navigation__badge')).toHaveCount(0)
    await expect(
      page.getByLabel('消息通知待处理 1 项', { exact: true }),
    ).toHaveText('1')

    await openGroup(page, '审核与风控')
    await expect(
      page.getByLabel('审核队列待处理 99 项', { exact: true }),
    ).toHaveText('99')
    await expect(
      page.getByLabel('举报处理待处理 99+ 项', { exact: true }),
    ).toHaveText('99+')
  })

  test('亮色和暗色关键状态保持可读', async ({ page }, testInfo) => {
    const light = await navigationTextColors(page)
    expect(light.background).not.toBe('')
    expect(
      contrastRatio(light.foreground, light.background),
    ).toBeGreaterThanOrEqual(4.5)
    await page.screenshot({
      path: testInfo.outputPath('admin-navigation-desktop-light.png'),
    })

    await page.getByRole('button', { name: '切换到深色模式' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

    // 主题切换存在 CSS color transition：data-theme 立即变更，但 group-toggle
    // 的 color 过渡需要一小段时间。切换瞬间 foreground 仍是亮色蓝（#165dff），
    // 与暗色背景对比度短暂 <4.5；过渡完成后变为暗色蓝（#7eb0ff），对比度 8+。
    // 用 expect.poll 等过渡完成、contrast 稳定达标后再取色比对。
    await expect.poll(async () => {
      const c = await navigationTextColors(page)
      return contrastRatio(c.foreground, c.background)
    }).toBeGreaterThanOrEqual(4.5)
    const dark = await navigationTextColors(page)
    expect(dark.background).not.toBe('')
    expect(dark).not.toEqual(light)
    await page.screenshot({
      path: testInfo.outputPath('admin-navigation-desktop-dark.png'),
    })
  })
})

test.describe('后台导航 / 较矮桌面滚动', () => {
  const VIEWPORT_HEIGHT = 480
  test.use({ viewport: { width: 1440, height: VIEWPORT_HEIGHT } })

  test('真实溢出时导航可滚动，账号和退出控件不被遮挡', async ({ page }) => {
    await loginAs(page, 'ADM')
    await page.goto('/admin')
    await ensureDesktopNavigationOpen(page)

    // Next.js dev-only toolbar occupies the lower-left corner in local E2E runs.
    // Disable only that framework overlay's hit target so this check measures the
    // product navigation and its fixed footer, as a production build does.
    await page.addStyleTag({
      content: 'nextjs-portal { pointer-events: none !important; }',
    })

    const navigation = page.locator('.admin-navigation__groups')
    await expect(navigation).toBeVisible()
    await expect(navigation).toHaveCSS('overflow-y', 'auto')

    const dimensions = await navigation.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }))
    expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight)

    await navigation.evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })
    const scrollTop = await navigation.evaluate((element) => element.scrollTop)
    expect(scrollTop).toBeGreaterThan(0)

    const themeToggle = page.getByRole('button', { name: '切换到深色模式' })
    const account = page.getByRole('button', { name: '账号菜单' })
    await expect(themeToggle).toBeVisible()
    await expect(account).toBeVisible()
    // 退出登录在账号下拉菜单内，展开后确认可访问
    await account.click()
    const logout = page.getByRole('menuitem', { name: '退出登录' })
    await expect(logout).toBeVisible()
    await expectUncovered(account, VIEWPORT_HEIGHT)
  })
})

test.describe('后台导航 / 移动交互', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  // The seeded roles do not contain a source-read/target-no-read combination.
  // Task 9's Server wrapper unit tests remain the authoritative negative gate;
  // this browser suite exercises both real positive journeys without forging roles.
  test('上下文入口可进入带过滤条件的列表，抽屉置底系统管理并区分返回和关闭', async ({
    page,
  }, testInfo) => {
    await loginAs(page, 'ADM')
    const leads = await page.request.get('/api/leads?limit=1')
    expect(leads.status()).toBe(200)
    const leadData = (await leads.json()) as {
      docs?: Array<{ id?: number | string }>
    }
    const leadId = leadData.docs?.[0]?.id
    expect(leadId).toBeDefined()

    await page.goto(`/admin/collections/leads/${leadId}`)
    const ownershipHistoryLink = page.getByRole('link', { name: '归属记录' })
    await expect(ownershipHistoryLink).toHaveAttribute(
      'href',
      new RegExp(
        `/admin/collections/lead-ownership-history\\?where%5Blead%5D%5Bequals%5D=${leadId}$`,
      ),
    )
    await ownershipHistoryLink.click()
    await expect(page).toHaveURL(
      /\/admin\/collections\/lead-ownership-history(?:\?.*)?$/,
    )
    expect(new URL(page.url()).searchParams.get('where[lead][equals]')).toBe(
      String(leadId),
    )
    await expect(
      page.getByRole('heading', { level: 1, name: '线索归属历史' }),
    ).toBeVisible()

    const formResponse = await page.request.post('/api/forms', {
      data: {
        title: `E2E 上下文入口表单 ${Date.now()}`,
        fields: [],
        confirmationType: 'redirect',
        redirect: { url: 'https://example.com/thanks' },
      },
      failOnStatusCode: false,
    })
    expect(formResponse.status()).toBe(201)
    const form = (await formResponse.json()) as {
      doc?: { id?: number | string }
    }
    const formId = form.doc?.id
    expect(formId).toBeDefined()

    try {
      await page.goto(`/admin/collections/forms/${formId}`)
      const submissionsLink = page.getByRole('link', {
        name: '查看提交数据',
      })
      await expect(submissionsLink).toBeVisible()
      await submissionsLink.click()
      await expect(page).toHaveURL(
        /\/admin\/collections\/form-submissions(?:\?.*)?$/,
      )
      expect(new URL(page.url()).searchParams.get('where[form][equals]')).toBe(
        String(formId),
      )
      await expect(
        page.getByRole('heading', { level: 1, name: '提交数据' }),
      ).toBeVisible()
    } finally {
      const deleteFormResponse = await page.request.delete(
        `/api/forms/${formId}`,
        { failOnStatusCode: false },
      )
      expect(deleteFormResponse.status()).toBe(200)
    }

    await page.goto(`/admin/collections/leads/${leadId}`)

    const returnToList = page
      .getByRole('banner')
      .getByRole('link', { name: '咨询线索', exact: true })
    await expect(returnToList).toBeVisible()

    await page.locator('.app-header__mobile-nav-toggler').click()
    const drawer = page.locator('aside.nav')
    await expect(drawer).toHaveClass(/nav--nav-open/)
    await expect(drawer).toBeVisible()
    await expect(
      page.getByRole('button', { name: '关闭', exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: '咨询线索', exact: true }),
    ).toHaveCount(0)

    const drawerBox = await drawer.boundingBox()
    expect(drawerBox).toEqual({ x: 0, y: 0, width: 390, height: 844 })

    await expect(
      topGroupButtons(page).last().locator('.admin-navigation__group-label'),
    ).toHaveText('系统管理')

    const systemBox = await topGroupButton(page, '系统管理').boundingBox()
    const workspaceBox = await topGroupButton(page, '工作台').boundingBox()
    expect(systemBox).not.toBeNull()
    expect(workspaceBox).not.toBeNull()
    expect(systemBox!.y).toBeGreaterThan(workspaceBox!.y)

    await page.screenshot({
      path: testInfo.outputPath('admin-navigation-mobile-light.png'),
    })

    await navLeafLink(page, '客户档案').click()
    await expect(page).toHaveURL(
      /\/admin\/collections\/customers(?:\?.*)?$/,
    )
    await expect(drawer).not.toHaveClass(/nav--nav-open/)
  })

  test('线索和表单创建页没有对象 ID 时不显示上下文入口', async ({ page }) => {
    await loginAs(page, 'ADM')
    await page.goto('/admin/collections/leads/create')

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByRole('link', { name: '归属记录' })).toHaveCount(0)

    await page.goto('/admin/collections/forms/create')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(
      page.getByRole('link', { name: '查看提交数据' }),
    ).toHaveCount(0)
  })
})

test.describe('后台导航 / 全叶子可达', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('ADM 能看到导航配置里的每一个叶子，而不是抽查一个代表', async ({ page }) => {
    await loginAs(page, 'ADM')
    await page.goto('/admin')
    await ensureDesktopNavigationOpen(page)
    await expect(page.locator('.admin-navigation')).toBeVisible()

    for (const group of ALL_TOP_GROUPS) {
      await openGroup(page, group)
    }
    // 导航是两层折叠，顶层展开不等于子分组展开
    await openAllSubgroups(page)

    const missing: string[] = []
    for (const label of ALL_LEAF_LABELS) {
      const link = navLeafLink(page, label).first()
      if ((await link.count()) === 0 || !(await link.isVisible())) {
        missing.push(label)
      }
    }

    // 一次报全部缺失项而不是撞到第一个就停：入口批量消失时（比如某个 access
    // 判定写错），一条条修比一次看全清单慢得多。
    expect(missing, `平台管理员看不到这些入口：${missing.join('、')}`).toEqual([])
  })
})
