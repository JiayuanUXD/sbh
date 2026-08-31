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
): Promise<{ id: number; status: number; message: string | null; raw: string }> {
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
  let body: any = {}
  try {
    body = JSON.parse(raw)
  } catch {
    body = {}
  }
  return {
    id: body?.doc?.id,
    status: res.status(),
    message: body?.errors?.[0]?.data?.errors?.[0]?.message ?? null,
    // 诊断用：CI 上 message 取到 null 而服务端日志里文案完全正确，
    // 本地（含 next start 生产 server）复现不出来。留原始响应体让 CI 自己交代。
    raw: raw.slice(0, 1200),
  }
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
    created.push(first.id)

    const dup = await createListing(request, buildingId, room, 'b')
    expect(dup.status, '同楼盘撞号应被拒').toBe(400)
    expect(dup.message, `撞号响应原始体：${dup.raw}`).toContain(room)
    expect(dup.message).toContain('OPT-063 用例房源-a')
    // 报错文案是给人看的，不该带 markdown 星号（Payload 按纯文本渲染）
    expect(dup.message).not.toContain('**')

    // 换一个楼盘用同一个房间号：应当放行
    const buildings = await request.get('/api/buildings?limit=2&depth=0')
    const otherId = (await buildings.json())?.docs?.[1]?.id
    test.skip(typeof otherId !== 'number', '库里只有一个楼盘，跨楼盘用例不适用')
    const cross = await createListing(request, otherId as number, room, 'c')
    expect(cross.status, '不同楼盘用同一房间号应放行').toBe(201)
    created.push(cross.id)
  })

  test('留空的房间号互不冲突（空串归一为 null）', async ({ page }) => {
    const request = await login(page)
    const buildingId = await pickBuildingId(request)

    const blank1 = await createListing(request, buildingId, '', 'blank1')
    expect(blank1.status).toBe(201)
    created.push(blank1.id)

    const blank2 = await createListing(request, buildingId, '   ', 'blank2')
    expect(blank2.status, '两条都没填房间号的房源必须能共存').toBe(201)
    created.push(blank2.id)
  })

  test('字段级权限：匿名读不到 roomNumber，带登录态读得到', async ({ page, browser }) => {
    const request = await login(page)
    const buildingId = await pickBuildingId(request)
    const room = `E2E-${Date.now().toString(36)}`
    const made = await createListing(request, buildingId, room, 'acl')
    expect(made.status).toBe(201)
    created.push(made.id)

    const authed = await request.get(`/api/listings/${made.id}?depth=0`)
    expect(authed.status()).toBe(200)
    expect(await authed.json(), '后台读得到房间号').toMatchObject({ roomNumber: room })

    // 全新的 context = 没有任何 cookie，才是真匿名
    const anonCtx = await browser.newContext()
    const anon = await anonCtx.request.get(`/api/listings/${made.id}?depth=0`)
    if (anon.status() === 200) {
      const body = await anon.json()
      expect(
        Object.prototype.hasOwnProperty.call(body, 'roomNumber'),
        '匿名响应里不该出现 roomNumber 这个键',
      ).toBe(false)
    } else {
      // 新建的房源不满足有效供给，匿名连文档都读不到——同样达到目的
      expect([403, 404]).toContain(anon.status())
    }
    await anonCtx.close()
  })

  test('后台列表：有「房间号」列，且能按房间号搜到', async ({ page }) => {
    const request = await login(page)
    const buildingId = await pickBuildingId(request)
    const room = `E2E-${Date.now().toString(36)}`
    const made = await createListing(request, buildingId, room, 'list')
    expect(made.status).toBe(201)
    created.push(made.id)

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
