/**
 * OPT-086 PR1：房源发布轴动作条 E2E
 *
 * 单测已经钉死了「可用动作表」与端点行为，这里只覆盖单测看不见的三件事：
 *   1. 编辑页动作条能真的把一套已上架房源下架——含「原因为空 → 确认键禁用」这条纯客户端门
 *      （G5：不拿端点的 422 当校验），以及下架后动作条翻出上架类动作；
 *   2. 房源列表操作列的「下架」与编辑页复用同一个确认弹层，提交后该行状态随之翻新；
 *   3. 没有 `listing:unpublish` 的角色（CSR）即便绕过界面直接打端点也被拒，且房源状态不受影响。
 *
 * 夹具纪律：两个下架用例都在 `finally` 里走 API 把房源恢复成已上架。前台列表 / 详情类 spec
 * 依赖「夹具里有若干已上架房源」，本 spec 的断言失败也不能把这套房源留在下架态。
 *
 * 运行前置：`pnpm seed`（5 个 E2E 账号 + 至少一套已上架、未被举报暂停的租赁房源）。
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

type Account = Readonly<{ email: string; password: string }>

/** seed 创建的公开夹具账号（scripts/seed.ts），不是真凭据。 */
const ADM: Account = { email: 'e2e-adm@example.com', password: 'Test1234!' }
const CSR: Account = { email: 'e2e-csr@example.com', password: 'Test1234!' }

type PickedListing = {
  id: number
  /** 列表页要靠它把目标行搜出来（列表默认 25 条一页，不筛就未必在第一页） */
  title: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 用 REST 登录。传 `page.request` 时 cookie 落在浏览器 context 的 jar 上，
 * 后续 `page.goto('/admin/...')` 即为已登录态（与 geography-admin.spec.ts 同套路）。
 */
async function login(request: APIRequestContext, account: Account): Promise<void> {
  const response = await request.post('/api/users/login', {
    data: account,
    failOnStatusCode: false,
  })
  expect(response.status(), `${account.email} 应能登录后台`).toBe(200)
}

/**
 * 取一套已上架、未被举报暂停的租赁房源。
 *
 * 不写死 id：seed 会漂，写死一次就得跟着 seed 改一次。限定 `lease` 是因为编辑页动作条
 * 对租售给的成交按钮不同（租 →「标记已租」/ 售 →「标记已售」），限定一种才好断言。
 */
async function pickPublishedListing(request: APIRequestContext): Promise<PickedListing> {
  const response = await request.get(
    '/api/listings?limit=1&depth=0&where[publicationStatus][equals]=published' +
      '&where[businessType][equals]=lease&where[supplyVisibilityHold][equals]=normal',
  )
  expect(response.status(), '查询已上架租赁房源应成功').toBe(200)

  const body: unknown = await response.json()
  const doc = isRecord(body) && Array.isArray(body.docs) ? (body.docs[0] as unknown) : undefined
  expect(isRecord(doc), '夹具里至少要有一套已上架且未被举报暂停的租赁房源').toBe(true)
  if (!isRecord(doc)) throw new Error('夹具缺少已上架租赁房源')

  const { id, title } = doc
  expect(typeof id, '房源 id 应为数字').toBe('number')
  expect(typeof title, '房源标题应为字符串').toBe('string')
  if (typeof id !== 'number' || typeof title !== 'string') {
    throw new Error('房源文档缺少 id 或 title')
  }
  return { id, title }
}

/** 读发布态；读不到一律回 null，让断言以「期望值 vs null」的形式报错而不是抛在半路。 */
async function publicationStatusOf(
  request: APIRequestContext,
  id: number,
): Promise<string | null> {
  const response = await request.get(`/api/listings/${id}?depth=0`, { failOnStatusCode: false })
  if (!response.ok()) return null
  const body: unknown = await response.json()
  return isRecord(body) && typeof body.publicationStatus === 'string'
    ? body.publicationStatus
    : null
}

/** 某类审计动作的现存条数（下架 / 标记成交都记为 listing.unpublish）。 */
async function countAudit(request: APIRequestContext, action: string): Promise<number> {
  const response = await request.get(
    `/api/audit-logs?limit=1&depth=0&where[action][equals]=${encodeURIComponent(action)}`,
  )
  expect(response.status(), 'ADM 应能读审计日志').toBe(200)
  const body: unknown = await response.json()
  const total = isRecord(body) ? body.totalDocs : undefined
  expect(typeof total, '审计日志响应应带 totalDocs').toBe('number')
  if (typeof total !== 'number') throw new Error('审计日志响应缺少 totalDocs')
  return total
}

/**
 * 把夹具恢复成「已上架」。只在 `finally` 里调用，因此两处刻意的设计：
 *   - 先读当前状态：房源仍是 published 时 `publish` 不是合法转移（端点回 409），直接跳过。
 *     否则「下架还没发生就失败」的用例会在 finally 里再抛一个 409，把真正的失败原因盖掉。
 *   - 用 `expect.soft`：恢复失败作为附加错误一并报出，同样不覆盖首个失败。
 */
async function restorePublished(request: APIRequestContext, id: number): Promise<void> {
  if ((await publicationStatusOf(request, id)) === 'published') return

  const response = await request.post(`/api/listings/${id}/publish`, {
    data: { action: 'publish' },
    failOnStatusCode: false,
  })
  expect.soft(response.status(), '恢复上架应成功（夹具房源满足有效供给条件）').toBe(200)
  expect.soft(await publicationStatusOf(request, id), '跑完必须把夹具还原成已上架').toBe(
    'published',
  )
}

/**
 * 走一遍下架确认弹层：先验「原因为空 → 确认键禁用」，填原因后提交并等弹层关闭。
 *
 * 编辑页与列表行共用同一个弹层组件（ListingPublicationActionModal），所以这段也共用——
 * 两份副本迟早会漂，而「原因必填」正是这个 PR 最不该漂的一条。
 */
async function confirmUnpublish(page: Page, reason: string): Promise<void> {
  // Arco Modal 的根节点（role="dialog"），一次只挂一个实例。
  const modal = page.locator('.arco-modal')
  await expect(modal, '点「下架」后应弹出确认层').toBeVisible()

  const ok = modal.getByRole('button', { name: '确认下架', exact: true })
  await expect(ok, '原因为空时确认键必须禁用，而不是提交后吃一个 422').toBeDisabled()

  await modal.getByLabel('下架原因').fill(reason)
  await expect(ok, '填了原因后确认键应可用').toBeEnabled()
  await ok.click()

  await expect(modal, '提交成功后弹层应关闭').toBeHidden()
}

test.describe('OPT-086 房源发布轴动作', () => {
  test('编辑页下架（原因必填）→ 状态与审计变化 → 恢复夹具', async ({ page }) => {
    await login(page.request, ADM)
    const { id } = await pickPublishedListing(page.request)
    const auditBefore = await countAudit(page.request, 'listing.unpublish')

    await page.goto(`/admin/collections/listings/${id}`)
    const bar = page.locator('.listing-publication-actions')
    await expect(bar, '编辑页顶部应有发布轴动作条').toBeVisible()
    await expect(bar.getByText('已发布', { exact: true })).toBeVisible()

    try {
      await bar.getByRole('button', { name: '下架', exact: true }).click()
      await confirmUnpublish(page, 'e2e：编辑页下架验证')

      await expect(bar.getByText('已下架', { exact: true }), '动作条状态标签应翻成已下架')
        .toBeVisible()
      expect(await publicationStatusOf(page.request, id), '库里的发布态应为 unpublished').toBe(
        'unpublished',
      )
      expect(
        await countAudit(page.request, 'listing.unpublish'),
        '下架必须留下一条审计',
      ).toBe(auditBefore + 1)

      // 下架后动作条给上架类动作。按钮标签是「发布」（PUBLISH_ACTION_LABELS），
      // 「重新上架」只出现在确认弹层标题里——两者故意不同，不要在这里断言成同一个词。
      await expect(
        bar.getByRole('button', { name: '发布', exact: true }),
        '下架后应出现上架类动作',
      ).toBeVisible()
    } finally {
      // 走 API 而不是 UI：上面任何一步失败也要把夹具还原。
      await restorePublished(page.request, id)
    }
  })

  test('列表操作列「下架」复用同一弹层，行状态随之翻新', async ({ page }) => {
    await login(page.request, ADM)
    const { id, title } = await pickPublishedListing(page.request)

    // 带 q 搜索把目标行筛到第一页（列表默认 25 条 / 页，按 -updatedAt 排序，不筛不保证在第一页）。
    // 故意不带 publicationStatus 筛选：那样下架成功后该行会从结果里消失，就没法断言它翻成已下架。
    await page.goto(`/admin/collections/listings?q=${encodeURIComponent(title)}`)

    // 按 id 锁定行，而不是按标题文本：夹具里存在标题极短（如「test」）的房源，
    // 用文本匹配会连带命中标题包含它的其它行。
    const row = page.locator('.arco-table-tr', {
      has: page.locator(`a[href="/admin/collections/listings/${id}"]`),
    })
    await expect(row, '搜索结果里应有目标房源那一行').toHaveCount(1)
    await expect(row.getByText('已发布', { exact: true })).toBeVisible()

    try {
      await row.getByRole('button', { name: '下架', exact: true }).click()
      await expect(page.locator('.arco-modal'), '弹层标题应指向被点的那一行').toContainText(
        `下架「${title}」`,
      )
      await confirmUnpublish(page, 'e2e：列表行下架验证')

      await expect(row.getByText('已下架', { exact: true }), '该行发布状态列应翻成已下架')
        .toBeVisible()
      expect(await publicationStatusOf(page.request, id), '库里的发布态应为 unpublished').toBe(
        'unpublished',
      )
    } finally {
      await restorePublished(page.request, id)
    }
  })

  test('无 listing:unpublish 的角色（CSR）直接打端点被拒，房源不受影响', async ({
    context,
    request,
  }) => {
    // 两个 APIRequestContext 各有独立 cookie jar：`request` fixture 当 ADM 只读夹具，
    // 浏览器 context 的那个登录 CSR 发越权调用，互不串味。
    await login(request, ADM)
    const { id } = await pickPublishedListing(request)

    await login(context.request, CSR)
    // CSR 侧界面上根本不渲染这些按钮（权限在服务端算好才传给组件），所以这里直接验端点——
    // 界面隐藏只是体验，端点才是唯一强制点。
    const response = await context.request.post(`/api/listings/${id}/publish`, {
      data: { action: 'unpublish', reason: 'e2e：越权尝试' },
      failOnStatusCode: false,
    })
    expect([401, 403], `CSR 不该被放行（实际 ${response.status()}）`).toContain(response.status())
    expect(await publicationStatusOf(request, id), '越权调用不得改动房源').toBe('published')
  })
})
