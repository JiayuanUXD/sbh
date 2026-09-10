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

// OPT-084 Phase 1：导航从 10 组 / 2 子分组重排为 8 组 / 无子分组。
// 这份清单只用于「无权分组不该被渲染」的反向断言，所以必须是**全集**——
// 少写一个组，那个组的越权渲染就永远测不到。
const ALL_TOP_GROUPS = [
  '工作台',
  '待处理',
  '房源与楼盘',
  '客户与线索',
  '站点与内容',
  '城市与区域',
  '团队与账号',
  '设置与工具',
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
 *
 * OPT-084 Phase 1：按新树重排为 39 项（组内顺序与 navigation-config.ts 一致，便于
 * 逐段对读）。唯一被删掉的叶子是「领域事件」——裁定 2 让它退出导航，collection 本身
 * 仍在（group:false，URL 可直达），所以它不该再出现在这份「导航里必须能看到」的清单。
 */
const ALL_LEAF_LABELS = [
  // 工作台
  '运营概览',
  '消息通知',
  '数据看板',
  // 待处理：原先散在房源运营 / 审核与风控 / 商户合作 / 表单中心四组里的
  // 「有人提交了东西等我处理」，本次统一收进这一组。
  '我的待办',
  '审核队列',
  '举报处理',
  '信息纠错',
  '房源投放申请',
  '城市合伙人申请',
  '提交数据',
  // 房源与楼盘（商户管理、楼盘商户关系并入）
  '房源列表',
  '楼盘库',
  '商户管理',
  '楼盘商户关系',
  '楼盘批量导入',
  '房源批量导入',
  // OPT-045 D4：此前未被导航收编的集合（会被兜底渲染成左下角风格不一致的
  // 「集合」区块），现已收编进正常分组。
  '导入批次',
  // 客户与线索
  '咨询线索',
  '客户档案',
  '跟进记录',
  // 站点与内容（表单的「定义」并入，表单的「提交」归待处理）
  // OPT-053：站点设置（Global）。漏在这里 = 该入口永不进 e2e 覆盖，
  // 而「入口悄悄消失」正是这条 e2e 要防的事故。
  '站点设置',
  '城市站点配置',
  '页面内容',
  '资讯中心',
  '素材库',
  '表单管理',
  // 城市与区域
  '城市管理',
  '行政区域',
  '商圈管理',
  '地铁管理',
  '地理别名',
  // 团队与账号
  '用户管理',
  '角色管理',
  '团队管理',
  '经纪人管理',
  '顾问服务时间',
  // 设置与工具
  '配套字典',
  '审计日志',
  '搜索索引',
] as const

/**
 * 五角色的导航预期（OPT-084 Phase 1）。
 *
 * 新增 `flatLeaves`：解析层会把「筛完只剩一片叶子」的组降级成顶级链接（没有组头按钮、
 * 点了直接跳转）。不单独断言它的话，一个组从「3 片叶子」被误筛成「1 片」在组数上看
 * 不出来——它只是从组数里消失、悄悄变成一个顶级链接，而组数正好也少了一。
 *
 * 单元快照 tests/admin-navigation-role-snapshot.test.ts 跑的是同一份预期，但它走
 * resolveAdminNavigation 的返回值；这里走真实 DOM。两边都要绿才算这棵树真的立住了。
 */
const ROLE_NAVIGATION = {
  ADM: {
    groups: [
      '工作台',
      '待处理',
      '房源与楼盘',
      '客户与线索',
      '站点与内容',
      '城市与区域',
      '团队与账号',
      '设置与工具',
    ],
    flatLeaves: [],
    allowed: { group: '站点与内容', leaf: '页面内容', slug: 'pages' },
  },
  OPS: {
    groups: ['工作台', '待处理', '房源与楼盘', '站点与内容', '城市与区域'],
    // 「设置与工具」对 OPS 只剩配套字典一片（缺 audit:view 与 search 菜单码）→ 被扁平化
    flatLeaves: ['配套字典'],
    allowed: {
      group: '待处理',
      leaf: '审核队列',
      slug: 'listing-reviews',
      pageMarker: '房源审核台',
    },
  },
  MGR: {
    groups: ['工作台', '待处理', '房源与楼盘', '客户与线索', '团队与账号'],
    flatLeaves: [],
    allowed: { group: '团队与账号', leaf: '团队管理', slug: 'teams' },
  },
  BRK: {
    groups: ['工作台', '客户与线索'],
    // 「待处理」只剩我的待办、「房源与楼盘」只剩房源列表 → 两组都被扁平化。
    // 顺序按解析结果的文档顺序（待处理在房源与楼盘之前）。
    flatLeaves: ['我的待办', '房源列表'],
    allowed: {
      // 扁平叶没有可展开的组头，直接点顶级链接
      flat: true,
      leaf: '房源列表',
      slug: 'listings',
      // OPT-056 起 listings/buildings 整页换成 Arco 自定义列表视图。
      //
      // 订正一处措辞：被刻意去掉的是原生抬头里的「所有 房源列表 / 垃圾箱」**标签条**，
      // 不是 h1 标题——原生抬头是「h1 房源列表 | 创建新条目 | 所有 房源列表 | 垃圾箱」
      // 四段。h1 后来补回来了（可访问性地标），所以断言 h1 其实也能过。
      //
      // 但这里仍按根容器断言：本批改动本身就含「文案净化」，按文案断言的东西下次
      // 净化时又会挂，容器类名不会。
      rootSelector: '.listings-list',
    },
  },
  CSR: {
    groups: ['工作台', '待处理', '客户与线索'],
    // 「站点与内容」对 CSR 只剩表单管理一片 → 被扁平化（排在客户与线索之后）
    flatLeaves: ['表单管理'],
    allowed: { flat: true, leaf: '表单管理', slug: 'forms' },
  },
} as const satisfies Record<
  RoleCode,
  {
    groups: readonly string[]
    /** 被扁平化成顶级链接的叶子（组里只剩一片时发生），按文档顺序。 */
    flatLeaves: readonly string[]
    /**
     * 代表性入口：`group` 表示它在某个组内（需先展开），`flat: true` 表示它本身
     * 就是顶级扁平叶（没有组头可展）。两者互斥，用联合类型而不是两个可选字段，
     * 免得写出「既没有 group 也不是 flat」这种点不到东西的条目。
     */
    allowed:
      | {
          group: string
          leaf: string
          slug: string
          /** 页面内的唯一文本标识（原生列表视图没有 h1 时用）。 */
          pageMarker?: string
          /**
           * 自定义列表视图的根容器选择器。
           *
           * 换成自定义视图的 collection 没有 Payload 原生 h1，也不一定有稳定的字面量文本；
           * 按根容器断言比按文案断言更稳——文案会被"净化"改写，容器类名不会。
           */
          rootSelector?: string
        }
      | {
          flat: true
          leaf: string
          slug: string
          pageMarker?: string
          rootSelector?: string
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

/**
 * 定位组头按钮。
 *
 * 不能用 `getByRole('button', { name, exact: true })`：OPT-084 起收起状态的组头会多
 * 渲染一个汇总角标 `<span aria-label="{组名}共 N 项待处理">`，它并入按钮的 accessible
 * name，exact 匹配当场落空——而失败信息会说成「该角色看不到这个分组」，把一个纯数据
 * 条件（组内恰好有待办）误导成权限判定 bug。叶子链接早就踩过同一个坑，见 navLeafLink。
 *
 * 所以锚定组头自己的 label 元素，让断言只回答「这个组在不在」，与角标数量无关。
 */
function topGroupButton(page: Page, name: string): Locator {
  return page
    .locator('.admin-navigation__group-toggle')
    .filter({ has: page.getByText(name, { exact: true }) })
}

/**
 * 定位被扁平化的顶级叶子链接。
 *
 * 扁平叶与组内叶子共用 `.admin-navigation__link`，靠 `--flat` 修饰类区分；这里刻意只
 * 认扁平那一种——「组被误筛成只剩一片叶子」和「组正常渲染」在组数上看不出差别，
 * 只有扁平叶本身能把它们区分开。
 */
function flatLeafLink(page: Page, label: string): Locator {
  return page
    .locator('a.admin-navigation__link--flat')
    .filter({ has: page.getByText(label, { exact: true }) })
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
  const { flatLeaves, groups: allowed } = ROLE_NAVIGATION[role]
  // 扁平叶不渲染 toggle 按钮，所以这个计数是纯粹的「组数」
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

  // 扁平叶单独对一遍：只对组数的话，「某个组被误筛到只剩一片叶子」会伪装成
  // 「少了一个组」，而它其实还在，只是降级成了顶级链接——两种情况得分得开。
  for (const leaf of flatLeaves) {
    await expect(
      flatLeafLink(page, leaf),
      `${role} 应把 ${leaf} 渲染成顶级扁平叶`,
    ).toBeVisible()
  }
  await expect(
    page.locator('.admin-navigation__link--flat'),
    `${role} 的扁平叶数量应为 ${flatLeaves.length}`,
  ).toHaveCount(flatLeaves.length)
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
 * 展开当前渲染出来的所有分组。
 *
 * OPT-084 之后导航只剩一层可折叠（子分组已删），但「默认展开集」只覆盖两个组，
 * 其余组初始是收着的。按名字逐个 openGroup 要求测试自己维护一份组名清单，会和
 * ALL_TOP_GROUPS 各漂各的；直接扫 `aria-expanded="false"` 与真实 DOM 同步。
 */
async function openAllGroups(page: Page): Promise<void> {
  const collapsed = page.locator(
    '.admin-navigation__group-toggle[aria-expanded="false"]',
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

      const allowed = ROLE_NAVIGATION[role].allowed
      const { leaf, slug } = allowed
      if ('group' in allowed) {
        await openGroup(page, allowed.group)
        // template-default 拦截坐标点击，用原生 click() 直接触发 next/link 路由导航
        await navLeafLink(page, leaf).evaluate((el: HTMLElement) => el.click())
      } else {
        // 扁平叶就在顶层，没有要先展开的组
        await flatLeafLink(page, leaf).evaluate((el: HTMLElement) => el.click())
      }

      await expect(page).toHaveURL(
        new RegExp(`/admin/collections/${slug}(?:\\?.*)?$`),
      )
      if ('rootSelector' in allowed && allowed.rootSelector) {
        await expect(page.locator(allowed.rootSelector)).toBeVisible()
      } else if ('pageMarker' in allowed) {
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

  test('首次进入按默认集展开，多分组互不排斥，刷新后恢复当前分组和高亮叶子', async ({
    page,
  }) => {
    // OPT-084 Task 2：首次进入（localStorage 里没有展开集）时展开「待处理」「房源与楼盘」
    // 两个日常最高频的组，再并上当前路由 /admin 所在的「工作台」——共三个。
    // 这里逐个点名而不是只数个数：数量对得上、开错组的情况在计数里看不出来。
    for (const group of ['工作台', '待处理', '房源与楼盘']) {
      await expect(
        topGroupButton(page, group),
        `首次进入 /admin 时 ${group} 应默认展开`,
      ).toHaveAttribute('aria-expanded', 'true')
    }
    await expect(
      page.locator('.admin-navigation__group-toggle[aria-expanded="true"]'),
    ).toHaveCount(3)

    // 多展开模式（对标 Arco Design Pro）：打开新分组不收起已展开分组
    await openGroup(page, '客户与线索')
    await expect(topGroupButton(page, '工作台')).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    await expect(
      page.locator('.admin-navigation__group-toggle[aria-expanded="true"]'),
    ).toHaveCount(4)

    // 反向也要成立：收起一个组只影响它自己。只测「开」的话，
    // 「点谁都全开」这种实现同样能过。
    await topGroupButton(page, '房源与楼盘').dispatchEvent('click')
    await expect(topGroupButton(page, '房源与楼盘')).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    await expect(
      page.locator('.admin-navigation__group-toggle[aria-expanded="true"]'),
    ).toHaveCount(3)

    // template-default 拦截坐标点击，用原生 click() 直接触发 next/link 路由导航
    await navLeafLink(page, '咨询线索').evaluate((el: HTMLElement) => el.click())
    await expect(page).toHaveURL(
      /\/admin\/collections\/leads(?:\?.*)?$/,
    )
    await page.reload()
    await ensureDesktopNavigationOpen(page)

    // 刷新后恢复当前路由所在分组（客户与线索）并高亮叶子
    await expect(topGroupButton(page, '客户与线索')).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    // 上面被用户收起的组不该因为刷新又冒出来——展开态落盘的意义就在这里
    await expect(topGroupButton(page, '房源与楼盘')).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    await expect(navLeafLink(page, '咨询线索')).toHaveAttribute(
      'aria-current',
      'page',
    )
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

    // 「我的待办」「审核队列」「举报处理」都在「待处理」组里，而它是默认展开集的
    // 一员——不必再点开。这里显式确认一次：默认展开一旦回退，下面几条角标断言会
    // 因为「元素不可见」而失败，失败信息却指向角标，容易查错方向。
    await expect(topGroupButton(page, '待处理')).toHaveAttribute(
      'aria-expanded',
      'true',
    )

    const tasksLink = page.locator(
      'a.admin-navigation__link[href="/admin/collections/tasks"]',
    )
    await expect(tasksLink).toBeVisible()
    await expect(tasksLink.locator('.admin-navigation__badge')).toHaveCount(0)
    await expect(
      page.getByLabel('消息通知待处理 1 项', { exact: true }),
    ).toHaveText('1')
    await expect(
      page.getByLabel('审核队列待处理 99 项', { exact: true }),
    ).toHaveText('99')
    await expect(
      page.getByLabel('举报处理待处理 99+ 项', { exact: true }),
    ).toHaveText('99+')

    // OPT-084 Task 2：组展开时组头不挂汇总角标（同一批事情会被数两遍），
    // 收起后才出现，数值是组内各叶子之和（0 + 99 + 100 = 199 → 99+）。
    await expect(
      topGroupButton(page, '待处理').locator('.admin-navigation__group-badge'),
    ).toHaveCount(0)
    await topGroupButton(page, '待处理').dispatchEvent('click')
    await expect(
      topGroupButton(page, '待处理').locator('.admin-navigation__group-badge'),
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
  test('上下文入口可进入带过滤条件的列表，抽屉置底设置与工具并区分返回和关闭', async ({
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
    ).toHaveText('设置与工具')

    const systemBox = await topGroupButton(page, '设置与工具').boundingBox()
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

    // ADM 八个组全在（没有被扁平化的），逐个展开后 39 片叶子应当同屏可见
    await expect(topGroupButtons(page)).toHaveCount(ALL_TOP_GROUPS.length)
    await openAllGroups(page)

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
