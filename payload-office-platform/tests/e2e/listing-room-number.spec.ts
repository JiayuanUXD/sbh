import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * 房源「房间号」端到端（OPT-063）。
 *
 * 单测已经把归一化、查重分支、字段级 access 的**判定函数**都锁死了。这里只做单测
 * 够不着的两件事：
 *
 *   1. **字段级权限在真实 HTTP 上确实生效**。仓库此前零字段级 access 先例，
 *      「access.read 返回 false 会把字段从响应里剥掉」是文档承诺，不是实测事实。
 *      匿名 vs 带登录态打同一个端点做对照，才算验过。
 *   2. **后台列表真的多了那一列、搜索真的能搜到**。房源列表是 OPT-056 整页替换的
 *      自定义视图，`admin.defaultColumns` 对它无效——列是手写的，三处（行类型 /
 *      服务端映射 / 列定义）漏一处就是空列，而空列不会让任何单测变红。
 *
 * 数据自备自清：用例自己建房源、结束时硬删，不依赖 seed 里某条特定记录
 *（那种依赖迟早随夹具漂移变成假红）。
 */

const ADM = { email: 'e2e-adm@example.com', password: 'Test1234!' }

/**
 * 后台登录并返回**带登录态的** APIRequestContext。
 *
 * 必须返回 `page.request` 而不是用 `request` fixture：两者是各自独立的 cookie jar，
 * 在 `page.request` 上登录、拿 `request` 去打写接口，会稳定收到 403（实测踩到）。
 * 统一走 `page.request`，`page.goto` 才和 API 调用共享同一个会话。
 */
async function login(page: Page): Promise<APIRequestContext> {
  const response = await page.request.post('/api/users/login', {
    data: ADM,
    failOnStatusCode: false,
  })
  expect(response.status(), 'ADM 测试账号应成功登录').toBe(200)
  return page.request
}

/** 取一个可用的楼盘 id——不写死，seed 里楼盘 id 会漂。 */
async function pickBuildingId(request: APIRequestContext): Promise<number> {
  const res = await request.get('/api/buildings?limit=1&depth=0')
  expect(res.status()).toBe(200)
  const body = await res.json()
  const id = body?.docs?.[0]?.id
  expect(typeof id, '库里至少要有一个楼盘').toBe('number')
  return id as number
}

async function createListing(
  request: APIRequestContext,
  buildingId: number,
  roomNumber: string | null,
  suffix: string,
): Promise<{ id: number | null; status: number; message: string | null; raw: string }> {
  const res = await request.post('/api/listings', {
    data: {
      title: `OPT-063 用例房源-${suffix}`,
      building: buildingId,
      listingType: 'traditional-office',
      businessType: 'lease',
      ...(roomNumber === null ? {} : { roomNumber }),
    },
    failOnStatusCode: false,
  })
  const raw = await res.text()
  return {
    id: readCreatedId(parseJson(raw)),
    status: res.status(),
    message: readFieldErrorMessage(parseJson(raw)),
    // 诊断用：断言失败时把原始响应体一起打出来。曾因 message 取到 null 而
    // 服务端日志文案完全正确排查许久（根因见 domain/shared/payload-after-error.ts）。
    raw: raw.slice(0, 1200),
  }
}

/** 响应体是不受信输入：解析失败返回 undefined，不抛错、不用 any。 */
function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return undefined
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** 取 `doc.id`；形状不符一律 null，绝不把 undefined 当成 id 用。 */
function readCreatedId(body: unknown): number | null {
  const doc = asRecord(asRecord(body)?.doc)
  return typeof doc?.id === 'number' ? doc.id : null
}

/** 取列表响应 `docs[0].id`；空列表或形状不符返回 null（调用方据此 skip）。 */
function readFirstDocId(body: unknown): number | null {
  const docs = asRecord(body)?.docs
  if (!Array.isArray(docs) || docs.length === 0) return null
  const id = asRecord(docs[0])?.id
  return typeof id === 'number' ? id : null
}

/**
 * 取字段级校验文案：`errors[0].data.errors[0].message`。
 *
 * 逐层守卫而不是可选链一把梭——`data` 这一层曾在生产构建下整个消失
 * （Payload `formatErrors` 的 instanceof 跨 chunk 失效），当时用 `any` 读只得到
 * 一个 null，看不出是哪一层断的。
 */
function readFieldErrorMessage(body: unknown): string | null {
  const errors = asRecord(body)?.errors
  if (!Array.isArray(errors) || errors.length === 0) return null
  const fieldErrors = asRecord(asRecord(errors[0])?.data)?.errors
  if (!Array.isArray(fieldErrors) || fieldErrors.length === 0) return null
  const message = asRecord(fieldErrors[0])?.message
  return typeof message === 'string' ? message : null
}

/**
 * 登记待清理的房源 id。
 *
 * 创建返回 201 却读不到 `doc.id`，说明响应形状变了——这种情况必须当场失败，
 * 而不是往清理队列里塞一个 undefined，让后续用例被上一轮的残留数据搞挂。
 */
function trackCreated(created: number[], id: number | null): number {
  expect(typeof id, '创建成功的响应里应带 doc.id').toBe('number')
  created.push(id as number)
  return id as number
}

test.describe('房源房间号', () => {
  const created: number[] = []

  test.afterEach(async ({ page }) => {
    // 硬删而非软删：软删的行会继续占住 (building, roomNumber) 唯一索引，
    // 下一次跑用例就会被自己上一次的残留挡住。
    while (created.length > 0) {
      const id = created.pop()
      await page.request.delete(`/api/listings/${id}`, { failOnStatusCode: false })
    }
  })

  test('同楼盘唯一：撞号被拒且报错指名冲突房源，跨楼盘同号放行', async ({ page }) => {
    const request = await login(page)
    const buildingId = await pickBuildingId(request)
    const room = `E2E-${Date.now().toString(36)}`

    const first = await createListing(request, buildingId, room, 'a')
    expect(first.status, '首次写入房间号应成功').toBe(201)
    trackCreated(created, first.id)

    const dup = await createListing(request, buildingId, room, 'b')
    expect(dup.status, '同楼盘撞号应被拒').toBe(400)
    // 先断言类型再断言内容：message 为 null 时 toContain 抛的是 Matcher error，
    // Playwright 会丢弃自定义消息，原始响应体根本打不出来（曾因此白跑一轮 CI）。
    expect(typeof dup.message, `撞号响应原始体：${dup.raw}`).toBe('string')
    expect(dup.message).toContain(room)
    expect(dup.message).toContain('OPT-063 用例房源-a')
    // 报错文案是给人看的，不该带 markdown 星号（Payload 按纯文本渲染）
    expect(dup.message).not.toContain('**')

    // 换一个楼盘用同一个房间号：应当放行
    const buildings = await request.get('/api/buildings?limit=2&depth=0')
    const otherId = (await buildings.json())?.docs?.[1]?.id
    test.skip(typeof otherId !== 'number', '库里只有一个楼盘，跨楼盘用例不适用')
    const cross = await createListing(request, otherId as number, room, 'c')
    expect(cross.status, '不同楼盘用同一房间号应放行').toBe(201)
    trackCreated(created, cross.id)
  })

  test('留空的房间号互不冲突（空串归一为 null）', async ({ page }) => {
    const request = await login(page)
    const buildingId = await pickBuildingId(request)

    const blank1 = await createListing(request, buildingId, '', 'blank1')
    expect(blank1.status).toBe(201)
    trackCreated(created, blank1.id)

    const blank2 = await createListing(request, buildingId, '   ', 'blank2')
    expect(blank2.status, '两条都没填房间号的房源必须能共存').toBe(201)
    trackCreated(created, blank2.id)
  })

  test('字段级权限：带登录态读得到 roomNumber', async ({ page }) => {
    const request = await login(page)
    const buildingId = await pickBuildingId(request)
    const room = `E2E-${Date.now().toString(36)}`
    const made = await createListing(request, buildingId, room, 'acl')
    expect(made.status).toBe(201)
    const madeId = trackCreated(created, made.id)

    const authed = await request.get(`/api/listings/${madeId}?depth=0`)
    expect(authed.status()).toBe(200)
    expect(await authed.json(), '后台读得到房间号').toMatchObject({ roomNumber: room })
  })

  /**
   * 匿名侧必须用**匿名本来就读得到的**房源做夹具。
   *
   * 早先这里用的是本用例新建的房源，而新建房源不满足有效供给谓词，匿名请求走的是
   * 403/404 分支——那条分支下**即使把 `roomNumber.access.read` 整个删掉，用例照样绿**，
   * 等于没有验证任何东西（Codex review 指出）。
   *
   * 改法：先以匿名身份列出有效供给，拿一条真能读到的房源，给它挂上房间号，
   * 再用匿名读同一条——这次 200 是必须的，断言"200 且响应里没有 roomNumber 这个键"
   * 才真正锁住字段级权限。用完把房间号还原，不给夹具留残留。
   */
  test('字段级权限：匿名读已发布房源，响应里没有 roomNumber 这个键', async ({
    page,
    browser,
  }) => {
    const request = await login(page)
    const anonCtx = await browser.newContext()

    // 匿名列表返回的就是有效供给，天然满足 Listings.access.read 的公开谓词
    const anonList = await anonCtx.request.get('/api/listings?limit=1&depth=0')
    expect(anonList.status(), '匿名应能列出有效供给').toBe(200)
    const publishedId = readFirstDocId(await anonList.json())
    test.skip(publishedId === null, '库里没有匿名可读的房源，字段级权限用例不适用')

    const room = `E2E-ACL-${Date.now().toString(36)}`
    try {
      const patch = await request.patch(`/api/listings/${publishedId}?depth=0`, {
        data: { roomNumber: room },
        failOnStatusCode: false,
      })
      expect(patch.status(), '给已发布房源挂房间号应成功').toBe(200)

      // 带登录态读得到（对照组，确认房间号确实写进去了）
      const authed = await request.get(`/api/listings/${publishedId}?depth=0`)
      expect(authed.status()).toBe(200)
      expect(await authed.json(), '后台读得到刚挂上的房间号').toMatchObject({ roomNumber: room })

      // 匿名读：这次必须是 200，否则夹具选错了，用例会退化成"什么都没验"
      const anon = await anonCtx.request.get(`/api/listings/${publishedId}?depth=0`)
      expect(anon.status(), '该房源匿名本来就该读得到').toBe(200)
      const body = await anon.json()
      expect(
        Object.prototype.hasOwnProperty.call(body, 'roomNumber'),
        '匿名响应里不该出现 roomNumber 这个键',
      ).toBe(false)
    } finally {
      // 还原夹具：断言失败也要还原，否则残留的房间号会挡住后续跑批
      await request.patch(`/api/listings/${publishedId}?depth=0`, {
        data: { roomNumber: null },
        failOnStatusCode: false,
      })
      await anonCtx.close()
    }
  })

  test('后台列表：有「房间号」列，且能按房间号搜到', async ({ page }) => {
    const request = await login(page)
    const buildingId = await pickBuildingId(request)
    const room = `E2E-${Date.now().toString(36)}`
    const made = await createListing(request, buildingId, room, 'list')
    expect(made.status).toBe(201)
    trackCreated(created, made.id)

    await page.goto(`/admin/collections/listings?q=${encodeURIComponent(room)}`)

    // 列存在（OPT-056 自定义列表视图是手写列，漏一处就是空列）
    await expect(
      page.locator('thead th', { hasText: '房间号' }),
      '房源列表应有「房间号」列',
    ).toBeVisible()

    // 搜索命中：正好一行，且那一行显示的就是这个房间号
    const rows = page.locator('tbody tr')
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText(room)

    // 搜索框提示要说清能搜什么，否则没人知道可以这么用
    await expect(page.locator('input[placeholder="搜索标题 / 房间号"]')).toBeVisible()
  })
})
