/**
 * OPT-113：楼盘 / 房源列表批量上下架 + 楼盘库列表行内停用 E2E
 *
 * 单测已钉死端点逐条规则（状态机、前置门、乐观锁、审计、权限）与预筛 / 响应收口纯函数，
 * 这里只覆盖单测看不见的部分：
 *   1. 房源列表：勾选 → 批量下架（原因为空确认键禁用）→ 行状态翻新、勾选清空；
 *      再勾选（含一条不适用的已发布行）→ 批量上架 → 弹层明示「将跳过 1 条」→ 恢复上架；
 *   2. 楼盘库列表：勾选 → 批量下架 → 批量上架；行内「停用」先预检再确认 → 行翻成「启用」→ 再启用；
 *      勾选两个楼盘 → 批量停用（弹层先展示汇总预检）→ 批量启用（跳过已启用的行）；
 *   3. OPS（有 building:update、无 building:freeze）：看得到批量上下架、看不到「停用」与批量停用 / 启用，
 *      直调启停端点（单条、批量）都 403。
 *
 * 夹具纪律：所有改动在 `finally` 里走 API 恢复（房源恢复上架、楼盘恢复已发布 + 启用），
 * 理由同 listing-publication-actions.spec.ts——排在后面的 spec 依赖「夹具里有若干已上架供给」。
 *
 * 运行前置：`pnpm seed`。
 */
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'

type Account = Readonly<{ email: string; password: string }>

/** seed 创建的公开夹具账号（scripts/seed.ts），不是真凭据。 */
const ADM: Account = { email: 'e2e-adm@example.com', password: 'Test1234!' }
const OPS: Account = { email: 'e2e-ops@example.com', password: 'Test1234!' }

type Picked = { id: number; label: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function login(request: APIRequestContext, account: Account): Promise<void> {
  const response = await request.post('/api/users/login', {
    data: account,
    failOnStatusCode: false,
  })
  expect(response.status(), `${account.email} 应能登录后台`).toBe(200)
}

async function getJson(request: APIRequestContext, url: string): Promise<unknown> {
  const response = await request.get(url, { failOnStatusCode: false })
  expect(response.status(), `GET ${url} 应成功`).toBe(200)
  return response.json()
}

/**
 * 取 n 套「下架后还能重新上架」的房源：已上架、审核通过、未待复核、设置了供给商户。
 * 少了商户条件，下架后批量上架会因 NO_SUPPLY_MERCHANT 恢复不回来（seed 里真有这种房源）。
 */
async function pickRepublishableListings(
  request: APIRequestContext,
  n: number,
): Promise<Picked[]> {
  const body = await getJson(
    request,
    `/api/listings?limit=${n}&depth=0&sort=id` +
      '&where[publicationStatus][equals]=published&where[reviewStatus][equals]=approved' +
      '&where[supplyVisibilityHold][equals]=normal&where[merchant][exists]=true',
  )
  const docs = isRecord(body) && Array.isArray(body.docs) ? body.docs : []
  const picked = docs.flatMap((doc: unknown) =>
    isRecord(doc) && typeof doc.id === 'number' && typeof doc.title === 'string'
      ? [{ id: doc.id, label: doc.title }]
      : [],
  )
  expect(picked.length, `夹具里至少要有 ${n} 套可重新上架的房源`).toBe(n)
  return picked
}

/** 再取一套已上架房源，排除给定 id——批量上架时用它验证「不适用的行被跳过」。 */
async function pickAnotherPublishedListing(
  request: APIRequestContext,
  exclude: readonly number[],
): Promise<Picked> {
  const body = await getJson(
    request,
    '/api/listings?limit=20&depth=0&sort=id&where[publicationStatus][equals]=published',
  )
  const docs = isRecord(body) && Array.isArray(body.docs) ? body.docs : []
  for (const doc of docs) {
    if (isRecord(doc) && typeof doc.id === 'number' && typeof doc.title === 'string') {
      if (!exclude.includes(doc.id)) return { id: doc.id, label: doc.title }
    }
  }
  throw new Error('夹具里缺少第三套已上架房源')
}

async function pickPublishedActiveBuildings(
  request: APIRequestContext,
  n: number,
): Promise<Picked[]> {
  const body = await getJson(
    request,
    `/api/buildings?limit=${n}&depth=0&sort=id` +
      '&where[status][equals]=published&where[operationalStatus][equals]=active',
  )
  const docs = isRecord(body) && Array.isArray(body.docs) ? body.docs : []
  const picked = docs.flatMap((doc: unknown) =>
    isRecord(doc) && typeof doc.id === 'number' && typeof doc.name === 'string'
      ? [{ id: doc.id, label: doc.name }]
      : [],
  )
  expect(picked.length, `夹具里至少要有 ${n} 个已发布且启用的楼盘`).toBe(n)
  return picked
}

async function pickPublishedActiveBuilding(request: APIRequestContext): Promise<Picked> {
  const [first] = await pickPublishedActiveBuildings(request, 1)
  return first
}

async function fieldOf(
  request: APIRequestContext,
  collection: 'listings' | 'buildings',
  id: number,
  field: string,
): Promise<string | null> {
  const response = await request.get(`/api/${collection}/${id}?depth=0`, {
    failOnStatusCode: false,
  })
  if (!response.ok()) return null
  const body: unknown = await response.json()
  const value = isRecord(body) ? body[field] : undefined
  return typeof value === 'string' ? value : null
}

/** 房源恢复上架：走单条发布端点（过前置门，夹具房源满足有效供给）。已上架则跳过。 */
async function restoreListing(request: APIRequestContext, id: number): Promise<void> {
  if ((await fieldOf(request, 'listings', id, 'publicationStatus')) === 'published') return
  const response = await request.post(`/api/listings/${id}/publish`, {
    data: { action: 'publish' },
    failOnStatusCode: false,
  })
  expect.soft(response.status(), `恢复房源 ${id} 上架应成功：${await response.text()}`).toBe(200)
}

/** 楼盘恢复「已发布 + 启用」：ADM 直接 PATCH 两个字段。 */
async function restoreBuilding(request: APIRequestContext, id: number): Promise<void> {
  const response = await request.patch(`/api/buildings/${id}`, {
    data: { status: 'published', operationalStatus: 'active' },
    failOnStatusCode: false,
  })
  expect.soft(response.status(), `恢复楼盘 ${id} 应成功：${await response.text()}`).toBe(200)
}

/**
 * 点触发按钮直到确认弹层挂上来——`load` 之后 React 还要一会儿才挂上 onClick，
 * 落在水合窗口里的点击会被静默吞掉。理由与写法同 listing-publication-actions.spec.ts。
 */
async function clickUntilModalOpens(page: Page, trigger: Locator, label: string): Promise<Locator> {
  const modal = page.locator('.arco-modal')
  await expect(async () => {
    if (!(await modal.isVisible())) await trigger.click()
    await expect(modal, `点${label}后应弹出确认层`).toBeVisible({ timeout: 1_000 })
  }).toPass({ timeout: 20_000 })
  return modal
}

function rowOf(page: Page, collection: 'listings' | 'buildings', id: number): Locator {
  // 按 id 锁定行（编辑链接），不按标题文本：短标题会连带命中别的行。
  return page.locator('.arco-table-tr', {
    has: page.locator(`a[href="/admin/collections/${collection}/${id}"]`),
  })
}

/** 勾选某行。同样有水合窗口：勾完以「已选 N 项」计数为准，没变就再勾一次。 */
async function checkRow(page: Page, row: Locator, expectedCount: number): Promise<void> {
  const counter = page.getByText(`已选 ${expectedCount} 项`, { exact: true })
  await expect(async () => {
    if (!(await counter.isVisible())) await row.locator('.arco-checkbox').first().click()
    await expect(counter).toBeVisible({ timeout: 1_000 })
  }).toPass({ timeout: 20_000 })
}

test.describe('OPT-113 列表批量上下架与楼盘停用', () => {
  test('房源列表：批量下架（原因必填）→ 批量上架（跳过不适用行）', async ({ page }) => {
    await login(page.request, ADM)
    const targets = await pickRepublishableListings(page.request, 2)
    const bystander = await pickAnotherPublishedListing(
      page.request,
      targets.map((t) => t.id),
    )

    try {
      await page.goto('/admin/collections/listings?limit=100')
      const rows = targets.map((t) => rowOf(page, 'listings', t.id))
      for (const row of rows) await expect(row).toHaveCount(1)

      await checkRow(page, rows[0], 1)
      await checkRow(page, rows[1], 2)

      // —— 批量下架 ——
      let modal = await clickUntilModalOpens(
        page,
        page.getByRole('button', { name: '批量下架', exact: true }),
        '「批量下架」',
      )
      await expect(modal).toContainText('批量下架房源')
      await expect(modal).toContainText('将下架 2 条房源')
      const okUnpublish = modal.getByRole('button', { name: '确认下架', exact: true })
      await expect(okUnpublish, '原因为空时确认键必须禁用').toBeDisabled()
      await modal.getByLabel('下架原因').fill('e2e：OPT-113 批量下架验证')
      await okUnpublish.click()
      await expect(modal, '全部成功时弹层直接关闭').toBeHidden()

      for (const [i, t] of targets.entries()) {
        await expect(rows[i].getByText('已下架', { exact: true })).toBeVisible()
        expect(await fieldOf(page.request, 'listings', t.id, 'publicationStatus')).toBe(
          'unpublished',
        )
      }
      await expect(page.getByText('已选 0 项', { exact: true }), '完成后勾选应清空').toBeVisible()

      // —— 批量上架：两条已下架 + 一条已发布（不适用，应在确认层里列为跳过）——
      await checkRow(page, rows[0], 1)
      await checkRow(page, rows[1], 2)
      await checkRow(page, rowOf(page, 'listings', bystander.id), 3)
      modal = await clickUntilModalOpens(
        page,
        page.getByRole('button', { name: '批量上架', exact: true }),
        '「批量上架」',
      )
      await expect(modal).toContainText('将对 2 条房源执行上架')
      await expect(modal).toContainText('将跳过 1 条')
      await expect(modal).toContainText(bystander.label)
      await modal.getByRole('button', { name: '确认上架', exact: true }).click()
      await expect(modal).toBeHidden()

      for (const [i, t] of targets.entries()) {
        await expect(rows[i].getByText('已发布', { exact: true })).toBeVisible()
        expect(await fieldOf(page.request, 'listings', t.id, 'publicationStatus')).toBe(
          'published',
        )
      }
    } finally {
      for (const t of targets) await restoreListing(page.request, t.id)
    }
  })

  test('楼盘库列表：批量下架 / 上架，行内停用 / 启用', async ({ page }) => {
    await login(page.request, ADM)
    const building = await pickPublishedActiveBuilding(page.request)

    try {
      await page.goto(
        `/admin/collections/buildings?q=${encodeURIComponent(building.label)}&limit=100`,
      )
      const row = rowOf(page, 'buildings', building.id)
      await expect(row).toHaveCount(1)
      await expect(row.getByText('已发布', { exact: true })).toBeVisible()

      // —— 批量下架 ——
      await checkRow(page, row, 1)
      let modal = await clickUntilModalOpens(
        page,
        page.getByRole('button', { name: '批量下架', exact: true }),
        '「批量下架」',
      )
      await expect(modal).toContainText('将下架 1 个楼盘')
      await expect(modal, '下架会连带房源在前台消失，必须说清').toContainText('全部房源在前台立即不可见')
      await modal.getByRole('button', { name: '确认下架', exact: true }).click()
      await expect(modal).toBeHidden()
      await expect(row.getByText('下架', { exact: true })).toBeVisible()
      expect(await fieldOf(page.request, 'buildings', building.id, 'status')).toBe('archived')

      // —— 批量上架 ——
      await checkRow(page, row, 1)
      modal = await clickUntilModalOpens(
        page,
        page.getByRole('button', { name: '批量上架', exact: true }),
        '「批量上架」',
      )
      await modal.getByRole('button', { name: '确认上架', exact: true }).click()
      await expect(modal).toBeHidden()
      await expect(row.getByText('已发布', { exact: true })).toBeVisible()
      expect(await fieldOf(page.request, 'buildings', building.id, 'status')).toBe('published')

      // —— 行内停用：先预检受影响记录，再确认 ——
      modal = await clickUntilModalOpens(
        page,
        row.getByRole('button', { name: '停用', exact: true }),
        '行内「停用」',
      )
      await expect(modal).toContainText(`停用楼盘「${building.label}」`)
      await expect(
        modal.getByText(/将影响|当前无对外可见房源受影响/),
        '停用前必须展示预检结果',
      ).toBeVisible()
      await modal.getByRole('button', { name: '确认停用', exact: true }).click()
      await expect(modal).toBeHidden()
      expect(await fieldOf(page.request, 'buildings', building.id, 'operationalStatus')).toBe(
        'disabled',
      )
      await expect(row.getByText('停用', { exact: true }), '启停列应翻成停用').toBeVisible()

      // —— 再启用 ——
      modal = await clickUntilModalOpens(
        page,
        row.getByRole('button', { name: '启用', exact: true }),
        '行内「启用」',
      )
      await modal.getByRole('button', { name: '确认启用', exact: true }).click()
      await expect(modal).toBeHidden()
      expect(await fieldOf(page.request, 'buildings', building.id, 'operationalStatus')).toBe(
        'active',
      )
      await expect(row.getByRole('button', { name: '停用', exact: true })).toBeVisible()
    } finally {
      await restoreBuilding(page.request, building.id)
    }
  })

  test('楼盘库列表：批量停用（汇总预检）→ 批量启用（跳过已启用行）', async ({ page }) => {
    await login(page.request, ADM)
    const buildings = await pickPublishedActiveBuildings(page.request, 2)

    try {
      await page.goto('/admin/collections/buildings?limit=100')
      const rows = buildings.map((b) => rowOf(page, 'buildings', b.id))
      for (const row of rows) await expect(row).toHaveCount(1)
      await checkRow(page, rows[0], 1)
      await checkRow(page, rows[1], 2)

      // —— 批量停用：弹层先展示一次性汇总的受影响记录 ——
      let modal = await clickUntilModalOpens(
        page,
        page.getByRole('button', { name: '批量停用', exact: true }),
        '「批量停用」',
      )
      await expect(modal).toContainText('批量停用楼盘')
      await expect(modal).toContainText('将停用 2 个楼盘')
      await expect(
        modal.getByText(/将影响 .*套对外可见房源|当前无对外可见房源受影响/),
        '批量停用前必须展示汇总预检结果',
      ).toBeVisible()
      await modal.getByRole('button', { name: '确认停用', exact: true }).click()
      await expect(modal, '全部成功时弹层直接关闭').toBeHidden()

      for (const [i, b] of buildings.entries()) {
        expect(await fieldOf(page.request, 'buildings', b.id, 'operationalStatus')).toBe('disabled')
        await expect(rows[i].getByRole('button', { name: '启用', exact: true })).toBeVisible()
      }
      await expect(page.getByText('已选 0 项', { exact: true }), '完成后勾选应清空').toBeVisible()

      // —— 批量启用：只恢复第一个，再连同一个启用中的楼盘一起勾，后者应被跳过 ——
      // 先单独把第二个启用回来，制造「勾选里有一个已启用的行」
      const restore = await page.request.post(
        `/api/buildings/${buildings[1].id}/toggle-operational-status`,
        { data: { target: 'active' } },
      )
      expect(restore.status()).toBe(200)
      await page.reload()
      await checkRow(page, rows[0], 1)
      await checkRow(page, rows[1], 2)
      modal = await clickUntilModalOpens(
        page,
        page.getByRole('button', { name: '批量启用', exact: true }),
        '「批量启用」',
      )
      await expect(modal).toContainText('将启用 1 个楼盘')
      await expect(modal).toContainText('将跳过 1 条')
      await expect(modal).toContainText(buildings[1].label)
      await modal.getByRole('button', { name: '确认启用', exact: true }).click()
      await expect(modal).toBeHidden()
      for (const b of buildings) {
        expect(await fieldOf(page.request, 'buildings', b.id, 'operationalStatus')).toBe('active')
      }
    } finally {
      for (const b of buildings) await restoreBuilding(page.request, b.id)
    }
  })

  test('OPS：有批量上下架、无停用 / 批量启停；直调启停端点 403', async ({ page, request }) => {
    await login(request, ADM)
    const building = await pickPublishedActiveBuilding(request)

    await login(page.request, OPS)
    await page.goto(
      `/admin/collections/buildings?q=${encodeURIComponent(building.label)}&limit=100`,
    )
    const row = rowOf(page, 'buildings', building.id)
    await expect(row).toHaveCount(1)
    await expect(page.getByRole('button', { name: '批量下架', exact: true })).toBeVisible()
    await expect(
      row.getByRole('button', { name: '停用', exact: true }),
      'OPS 没有 building:freeze，不渲染停用按钮',
    ).toHaveCount(0)
    await expect(page.getByRole('button', { name: '批量停用', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '批量启用', exact: true })).toHaveCount(0)

    const batchResponse = await page.request.post('/api/buildings/batch-operational-status', {
      data: { target: 'disabled', items: [{ id: building.id }] },
      failOnStatusCode: false,
    })
    expect(batchResponse.status(), '批量启停端点同样要 building:freeze').toBe(403)

    const response = await page.request.post(
      `/api/buildings/${building.id}/toggle-operational-status`,
      { data: { target: 'disabled' }, failOnStatusCode: false },
    )
    expect(response.status(), '界面隐藏只是体验，端点才是强制点').toBe(403)
    expect(await fieldOf(request, 'buildings', building.id, 'operationalStatus')).toBe('active')
  })
})
