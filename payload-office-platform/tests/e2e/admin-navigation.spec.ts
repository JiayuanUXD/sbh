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
  '审核与风控',
  '客户运营',
  '商户合作',
  '团队管理',
  '内容管理',
  '表单中心',
  '系统管理',
] as const

const ROLE_NAVIGATION = {
  ADM: {
    groups: [
      '工作台',
      '房源运营',
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
    groups: ['工作台', '房源运营', '审核与风控', '商户合作', '内容管理', '表单中心'],
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
  const aside = page.locator('aside.nav')
  const isNavigationInteractable = async () =>
    aside.evaluate((element) => {
      const button = element.querySelector<HTMLElement>(
        '.admin-navigation__group-toggle',
      )
      if (!button) return false

      const box = button.getBoundingClientRect()
      const topmost = document.elementFromPoint(
        box.left + box.width / 2,
        box.top + box.height / 2,
      )
      return topmost !== null && button.contains(topmost)
    })

  if (!(await isNavigationInteractable())) {
    await page.locator('.template-default__nav-toggler').click()
  }

  await expect.poll(isNavigationInteractable).toBe(true)
}

function topGroupButtons(page: Page): Locator {
  return page.locator('.admin-navigation__group-toggle')
}

function topGroupButton(page: Page, name: string): Locator {
  return page
    .getByRole('button', { name, exact: true })
    .and(page.locator('.admin-navigation__group-toggle'))
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
      topGroupButtons(page).nth(index).locator('span').first(),
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
    await button.click()
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
      await page.getByRole('link', { name: leaf, exact: true }).click()

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

  test('一次只展开一个分组，刷新后恢复当前分组和高亮叶子', async ({ page }) => {
    await expect(topGroupButton(page, '工作台')).toHaveAttribute(
      'aria-expanded',
      'true',
    )

    await openGroup(page, '房源运营')
    await expect(topGroupButton(page, '工作台')).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    await expect(
      page.locator('.admin-navigation__group-toggle[aria-expanded="true"]'),
    ).toHaveCount(1)

    await openGroup(page, '客户运营')
    await expect(topGroupButton(page, '房源运营')).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    await expect(
      page.locator('.admin-navigation__group-toggle[aria-expanded="true"]'),
    ).toHaveCount(1)

    await page.getByRole('link', { name: '咨询线索', exact: true }).click()
    await expect(page).toHaveURL(
      /\/admin\/collections\/leads(?:\?.*)?$/,
    )
    await page.reload()
    await ensureDesktopNavigationOpen(page)

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

    const dark = await navigationTextColors(page)
    expect(dark.background).not.toBe('')
    expect(
      contrastRatio(dark.foreground, dark.background),
    ).toBeGreaterThanOrEqual(4.5)
    expect(dark).not.toEqual(light)
    await page.screenshot({
      path: testInfo.outputPath('admin-navigation-desktop-dark.png'),
    })
  })
})

test.describe('后台导航 / 较矮桌面滚动', () => {
  const VIEWPORT_HEIGHT = 600
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

    const navigation = page.locator('.admin-navigation')
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
    const account = page.getByRole('link', { name: '账号' })
    const logout = page.getByRole('link', { name: '登出' })
    await expect(themeToggle).toBeVisible()
    await expect(account).toBeVisible()
    await expect(logout).toBeVisible()
    await expectUncovered(account, VIEWPORT_HEIGHT)
    await expectUncovered(logout, VIEWPORT_HEIGHT)
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
      topGroupButtons(page).last().locator('span').first(),
    ).toHaveText('系统管理')

    const systemBox = await topGroupButton(page, '系统管理').boundingBox()
    const workspaceBox = await topGroupButton(page, '工作台').boundingBox()
    expect(systemBox).not.toBeNull()
    expect(workspaceBox).not.toBeNull()
    expect(systemBox!.y).toBeGreaterThan(workspaceBox!.y)

    await page.screenshot({
      path: testInfo.outputPath('admin-navigation-mobile-light.png'),
    })

    await page.getByRole('link', { name: '客户档案', exact: true }).click()
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
