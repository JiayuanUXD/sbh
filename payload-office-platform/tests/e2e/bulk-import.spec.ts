import { existsSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test, type Locator, type Page } from '@playwright/test'
import ExcelJS from 'exceljs'

/**
 * OPT-041 Task 10：批量导入全链路 E2E。
 *
 * 覆盖「上传 → 预检 → 确认 → 上架 → 前台可见 → 幂等重传 → 回滚 → 前台不可见」
 * 整条链路，外加权限前置检查（未登录 403 / 无 data:import 权限 Forbidden）。
 *
 * fixture 现场生成（不往 git 塞二进制）：beforeAll 用 exceljs 在 test-results/
 * 下生成一份含 2 行正确 + 1 行错误的房源导入表，afterAll 删除。楼盘编号取本树
 * 种子库（sbh_dev_opt041）里真实存在的楼盘 slug（查库确认，非猜测）：
 *   - west-nanjing-premium-center（南京西路高端商务中心）
 *   - lujiazui-grade-a-river-view（陆家嘴江景甲级写字楼）
 * 两者 city_id 均为 1（上海，siteConfig.defaultCity），MULTI_CITY_ROUTING_ENABLED=false
 * 下 `/listings/<slug>` 直接按默认城市解析，不经过多城市前缀重定向。
 *
 * externalId 按本次运行时间戳打标（`E2E-OPT041-<runId>-N`），避免重复跑本测试时
 * 撞上库里上一次运行遗留的记录——导入的幂等键是 (source, externalId)，如果沿用
 * 固定 externalId，第二次跑主流程时就会退化成"更新"而不是"新建"，把主流程断言
 * 和专门的幂等断言混在一起、互相污染。幂等性在主链路测试内部对同一批 externalId
 * 原样连续导入两次来验证（点「再导一批」后重新上传同一份 fixture）。
 *
 * importedSlug 不硬编码——`slugify()` 现场从标题生成；这里用完成后已知的
 * externalId 去查 `GET /api/listings?where[dataSource.externalId][equals]=...`
 * 取回真实 slug（Listings 集合 `read: () => true`，无需额外权限）。
 */

const ADMIN = { email: 'e2e-adm@example.com', password: 'Test1234!' }
// BRK 角色有 listings 相关菜单权限但不持 data:import 操作权限（与 Task 8 浏览器验证
// 记录一致，artifacts/verification/OPT-041/task8-browser-verification.md）。
const NO_IMPORT_ROLE = { email: 'e2e-brk@example.com', password: 'Test1234!' }

// 现查种子库确认存在（node -e 直连 sbh_dev_opt041 执行 `select slug from buildings`），
// 不是猜测值；两者 city_id 均为 1（上海）。
const BUILDING_SLUG_VALID_1 = 'west-nanjing-premium-center'
const BUILDING_SLUG_VALID_2 = 'lujiazui-grade-a-river-view'
const BUILDING_ID_UNRESOLVABLE = 'E2E-NO-SUCH-BUILDING-XYZ'

// 最终评审 Important 5：城市前缀路由 `/shanghai/listings/<slug>` 曾被当作 D11
// （导入/回滚必须使前台缓存失效）的主断言，但这是假信号——`[city]/listings/[slug]/
// page.tsx` 的 `loadCityDetail` 在读缓存**之前**先调
// `resolveListingRouteIdentity(slug)`（`facade.ts` 的 `findListingRouteIdentity`），
// 而它直连库、完全未缓存。回滚后该路由的 404 是这条未缓存查询给出的，与
// `revalidateTag` 是否被调用无关——把失效调用整段删掉，这条断言照样全绿（已实测，
// 见「杀伤力验证」流程记录）。裸路径 `/listings/<slug>` 才是真正命中
// `getCachedListingBySlug`（`unstable_cache`，`revalidate: 300`）的路由，也是
// `.github/workflows/quality.yml` 里注明的当前生产路由形态（`MULTI_CITY_ROUTING_ENABLED`
// 未设置 = 关闭）。裸路径断言才是本文件对 D11 的真实证据；城市前缀路由的断言仍然
// 保留，但只作为「路由形态」覆盖，不构成对 D11 的验证。
const CITY_SLUG = 'shanghai'

const RUN_ID = Date.now().toString(36)
const EXTERNAL_ID_1 = `E2E-OPT041-${RUN_ID}-1`
const EXTERNAL_ID_2 = `E2E-OPT041-${RUN_ID}-2`
const EXTERNAL_ID_ERROR = `E2E-OPT041-${RUN_ID}-ERR`

const TITLE_1 = `E2E自动化测试房源一号-${RUN_ID}`
const TITLE_2 = `E2E自动化测试房源二号-${RUN_ID}`
// 最终评审 Important 5：重传改标题用的新标题——update 路径才是 unstable_cache
// 真正会命中旧值的场景（create 是 cold miss，rollback 只看状态码不看内容），
// 用它验证前台在有界时间内读到新值，而不是继续沿用旧值。
const UPDATED_TITLE_1 = `E2E自动化测试房源一号-改标题-${RUN_ID}`
const UPDATED_TITLE_2 = `E2E自动化测试房源二号-改标题-${RUN_ID}`

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_DIR = path.join(__dirname, '..', '..', 'test-results')
const FIXTURE_PATH = path.join(FIXTURE_DIR, `bulk-import-listings-${RUN_ID}.xlsx`)
const REIMPORT_FIXTURE_PATH = path.join(FIXTURE_DIR, `bulk-import-listings-reimport-${RUN_ID}.xlsx`)

const LISTING_COLUMNS = [
  '房源编号',
  '房源标题',
  '房源类型',
  '楼盘编号或标识',
  '面积',
  '租金',
  '楼层',
  '装修',
  '可租日期',
] as const

async function buildFixture(): Promise<void> {
  if (!existsSync(FIXTURE_DIR)) mkdirSync(FIXTURE_DIR, { recursive: true })

  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Sheet1')
  sheet.addRow([...LISTING_COLUMNS])
  // 行 2：正确行 1
  sheet.addRow([
    EXTERNAL_ID_1,
    TITLE_1,
    '传统办公室',
    BUILDING_SLUG_VALID_1,
    '120',
    '8000元/月',
    '12层',
    '精装带家具',
    '2026-09-01',
  ])
  // 行 3：正确行 2
  sheet.addRow([
    EXTERNAL_ID_2,
    TITLE_2,
    '共享办公',
    BUILDING_SLUG_VALID_2,
    '200',
    '6.5元/㎡/天',
    '8层',
    '简装',
    '2026-09-15',
  ])
  // 行 4：错误行——楼盘标识查无此楼盘，errors[0] 恰好 1 条（BUILDING_NOT_FOUND）
  sheet.addRow([
    EXTERNAL_ID_ERROR,
    `E2E自动化测试错误行-${RUN_ID}`,
    '传统办公室',
    BUILDING_ID_UNRESOLVABLE,
    '80',
    '5000元/月',
    '5层',
    '毛坯',
    '',
  ])

  await workbook.xlsx.writeFile(FIXTURE_PATH)
}

/**
 * 最终评审 Important 5：专门用于「重传改标题」的第二份 fixture——同一对 externalId，
 * 只有标题列改了。不复用原 fixture 是因为这条用例要单独测 update 路径下前台缓存
 * 会不会带着旧标题继续陈旧下去，混进原本就会失败的错误行只会让断言意图变模糊。
 */
async function buildReimportFixture(): Promise<void> {
  if (!existsSync(FIXTURE_DIR)) mkdirSync(FIXTURE_DIR, { recursive: true })

  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Sheet1')
  sheet.addRow([...LISTING_COLUMNS])
  sheet.addRow([
    EXTERNAL_ID_1,
    UPDATED_TITLE_1,
    '传统办公室',
    BUILDING_SLUG_VALID_1,
    '120',
    '8000元/月',
    '12层',
    '精装带家具',
    '2026-09-01',
  ])
  sheet.addRow([
    EXTERNAL_ID_2,
    UPDATED_TITLE_2,
    '共享办公',
    BUILDING_SLUG_VALID_2,
    '200',
    '6.5元/㎡/天',
    '8层',
    '简装',
    '2026-09-15',
  ])

  await workbook.xlsx.writeFile(REIMPORT_FIXTURE_PATH)
}

async function loginAsAdmin(page: Page): Promise<void> {
  const response = await page.request.post('/api/users/login', {
    data: ADMIN,
    failOnStatusCode: false,
  })
  expect(response.status(), 'ADM 测试账号应成功登录').toBe(200)
}

async function loginAsNoImportRole(page: Page): Promise<void> {
  const response = await page.request.post('/api/users/login', {
    data: NO_IMPORT_ROLE,
    failOnStatusCode: false,
  })
  expect(response.status(), 'BRK 测试账号应成功登录').toBe(200)
}

/**
 * Arco `Statistic` 把 title 与 value 渲染成两个独立 div（无文本节点分隔），
 * `.arco-statistic` 容器的 textContent 是"新建2"这样无空格的拼接串——
 * `getByText('新建 2')` 这类按空格拼接的断言在真实 DOM 上永远不命中。
 * 用容器 + hasText 定位到具体卡片，再单独断言 value 节点的文本。
 */
function statisticValue(scope: Page | Locator, title: string): Locator {
  return scope.locator('.arco-statistic', { hasText: title }).locator('.arco-statistic-value')
}

async function fetchListingByExternalId(
  page: Page,
  externalId: string,
): Promise<{ id: number; slug: string; publicationStatus: string }> {
  const res = await page.request.get('/api/listings', {
    params: {
      'where[dataSource.externalId][equals]': externalId,
      depth: '0',
      limit: '1',
    },
  })
  expect(res.status(), `查询 externalId=${externalId} 应返回 200`).toBe(200)
  const body = (await res.json()) as { docs: Array<{ id: number; slug: string; publicationStatus: string }> }
  expect(body.docs.length, `externalId=${externalId} 应能查到已导入的房源`).toBe(1)
  return body.docs[0]
}

/**
 * 最终评审 Important 5：裸路径 `/listings/<slug>` 有界轮询到目标状态码。
 *
 * 15s 远小于 `getCachedListingBySlug` 的 `unstable_cache revalidate: 300`（5 分钟）——
 * 若 `invalidateSupplyImportCache` 真的被删掉不调用，缓存要等 5 分钟才会自然过期，
 * 15s 内不可能等到目标状态，断言必挂（杀伤力所在）；而失效调用正常触发时，
 * `revalidateTag` 之后最多再陈旧一次读（`unstable_cache` 的既有行为），第二次
 * poll 即可命中新值，15s 綽綽有余。
 */
async function pollBareListingStatus(
  front: Page,
  slug: string,
  expected: number,
  timeoutMs = 15_000,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const res = await front.goto(`/listings/${slug}`)
        return res?.status()
      },
      { timeout: timeoutMs, message: `等待 /listings/${slug} 变为 ${expected}` },
    )
    .toBe(expected)
}

test.describe('OPT-041 批量导入房源全链路', () => {
  test.beforeAll(async () => {
    await buildFixture()
    await buildReimportFixture()
  })

  test.afterAll(() => {
    rmSync(FIXTURE_PATH, { force: true })
    rmSync(REIMPORT_FIXTURE_PATH, { force: true })
  })

  test('权限前置：未登录打预检端点 403，无 data:import 权限账号看到 Forbidden', async ({
    page,
    request,
  }) => {
    // 未登录：直接对预检端点发请求（不带任何登录态 cookie 的独立 request context）。
    const anon = await request.post('/api/bulk-import/preflight?type=listings')
    expect(anon.status(), '未登录打预检端点应返回 403').toBe(403)

    // 已登录但无 data:import：进入导入视图应看到「无权访问」，不是重定向也不是 404。
    await loginAsNoImportRole(page)
    await page.goto('/admin/import/listings')
    await expect(page.getByRole('heading', { name: '无权访问' })).toBeVisible()
    await expect(page.getByText('当前账号没有批量导入权限')).toBeVisible()
  })

  test('预检 → 确认 → 上架 → 前台可见 → 幂等重传 → 回滚 → 前台不可见', async ({ page, context }) => {
    test.setTimeout(180_000)

    await loginAsAdmin(page)
    await page.goto('/admin/import/listings')

    // ── Step 1: 上传 fixture → 预检报告 ──────────────────────────────
    await page.setInputFiles('input[type=file]', FIXTURE_PATH)

    await expect(statisticValue(page, '总行数')).toHaveText('3')
    await expect(statisticValue(page, '校验通过')).toHaveText('2')
    await expect(statisticValue(page, '校验失败')).toHaveText('1')
    // 红色警示条：房源导入语义 D4——确认后立即对外可见，措辞不可改写。
    await expect(page.getByText(/确认后 2 套房源将立即对外可见/)).toBeVisible()
    // 错误明细表格：能看到那一行的错误原因（楼盘查无此楼盘）。
    await expect(page.getByText(`未找到「${BUILDING_ID_UNRESOLVABLE}」对应的楼盘`)).toBeVisible()

    // ── Step 2: 确认导入 → 轮询到完成（Jobs Queue 10 秒一轮，给足 60 秒）──
    await page.getByRole('button', { name: '确认导入' }).click()
    await expect(page.getByText('本批导入已完成')).toBeVisible({ timeout: 60_000 })
    await expect(statisticValue(page, '新建')).toHaveText('2')
    await expect(statisticValue(page, '更新')).toHaveText('0')
    await expect(statisticValue(page, '失败')).toHaveText('0')

    // ── Step 3: 前台真的能查到（不硬编码 slug，按 externalId 现查） ──────
    // 裸路径 `/listings/<slug>` 才是当前生产路由形态（见上方 CITY_SLUG 的注释）。
    // 这里的 200 本身不构成对 D11 缓存失效的证据——新建房源此前从未被缓存过，
    // 首次读必然 cold miss，不管 revalidateTag 有没有被调用结果都是 200；
    // 真正验证失效生效与否的是 Step 4（改标题重传）与 Step 6（回滚后 404）。
    const doc1 = await fetchListingByExternalId(page, EXTERNAL_ID_1)
    const doc2 = await fetchListingByExternalId(page, EXTERNAL_ID_2)
    expect(doc1.publicationStatus).toBe('published')
    expect(doc2.publicationStatus).toBe('published')

    const front = await context.newPage()
    const bareRes1 = await front.goto(`/listings/${doc1.slug}`)
    expect(bareRes1?.status(), `/listings/${doc1.slug} 应 200`).toBe(200)
    const bareRes2 = await front.goto(`/listings/${doc2.slug}`)
    expect(bareRes2?.status(), `/listings/${doc2.slug} 应 200`).toBe(200)

    // 城市前缀路由仅作路由形态覆盖——它的 200/404 来自未缓存的
    // `resolveListingRouteIdentity`，不构成对 D11 的验证（见上方 CITY_SLUG 注释）。
    const cityRes1 = await front.goto(`/${CITY_SLUG}/listings/${doc1.slug}`)
    expect(cityRes1?.status(), `/${CITY_SLUG}/listings/${doc1.slug} 应 200`).toBe(200)
    const cityRes2 = await front.goto(`/${CITY_SLUG}/listings/${doc2.slug}`)
    expect(cityRes2?.status(), `/${CITY_SLUG}/listings/${doc2.slug} 应 200`).toBe(200)

    // ── Step 4: 幂等实测——同一对编号原样重传，第二批应全部落 updated，
    // 不新增文档（前台房源数不翻倍）；这次重传同时改了标题，用来验证 update
    // 路径下前台会在有界时间内读到新标题，而不是继续陈旧下去（真正验证 D11
    // 失效生效与否的场景——create 是 cold miss，rollback 只看状态码不看内容，
    // 只有"缓存里已经有值、值被改了"这个 update 场景才会暴露"删掉失效调用"的
    // 差别）。──────────────────────────────
    await page.getByRole('button', { name: '再导一批' }).click()
    await page.setInputFiles('input[type=file]', REIMPORT_FIXTURE_PATH)
    await expect(statisticValue(page, '校验通过')).toHaveText('2')
    await page.getByRole('button', { name: '确认导入' }).click()
    await expect(page.getByText('本批导入已完成')).toBeVisible({ timeout: 60_000 })
    await expect(statisticValue(page, '新建')).toHaveText('0')
    await expect(statisticValue(page, '更新')).toHaveText('2')

    const doc1Again = await fetchListingByExternalId(page, EXTERNAL_ID_1)
    const doc2Again = await fetchListingByExternalId(page, EXTERNAL_ID_2)
    // 幂等：命中同一条文档（id 不变），不是又建了一条新的。
    expect(doc1Again.id).toBe(doc1.id)
    expect(doc2Again.id).toBe(doc2.id)

    // 核心断言：裸路径在有界时间内读到新标题——这是本文件对 D11 的真实证据。
    // 直接查页面 HTML（而不是 `getByText(...).isVisible()`）：标题除了出现在可见的
    // 详情标题里，也会出现在 `<title>` / OG meta / JSON-LD 结构化数据里，
    // `getByText` 只认可见文本节点，两者不是一回事——实测发现前者最快 356ms
    // 就已经是新值，但 `getByText(...).isVisible()` 在 60s 内始终不为 true
    // （debug 过程中留下的真实测量，不是猜测）。直接查 HTML 更贴近"前台读到新值"
    // 这个断言本身要表达的意思，也避开了这个不相关的定位器陷阱。
    await expect
      .poll(
        async () => {
          await front.goto(`/listings/${doc1.slug}`)
          return (await front.content()).includes(UPDATED_TITLE_1)
        },
        { timeout: 15_000, message: `等待 /listings/${doc1.slug} 读到新标题` },
      )
      .toBe(true)
    await expect
      .poll(
        async () => {
          await front.goto(`/listings/${doc2.slug}`)
          return (await front.content()).includes(UPDATED_TITLE_2)
        },
        { timeout: 15_000, message: `等待 /listings/${doc2.slug} 读到新标题` },
      )
      .toBe(true)

    // ── Step 5: 回滚本批（第二批，affectedIds 同样指向这两条文档）──────
    // Modal.confirm 的确认按钮文案是「确认下架」（不是通用的「确定」）。
    await page.getByRole('button', { name: '批量下架本批房源' }).click()
    await page.getByRole('button', { name: '确认下架' }).click()
    await expect(page.getByText(/已下架 2/)).toBeVisible()

    // ── Step 6: 前台在有界时间内查不到，但文档仍在库里（只是下架，不是删除）──
    // 核心断言：裸路径 + 有界轮询（不是单次读）。15s 远小于 unstable_cache 的
    // revalidate:300，若 invalidateSupplyImportCache 被整段删掉，缓存要等 5 分钟
    // 才会自然过期，15s 内不可能等到 404，断言必挂——这就是本文件对 D11 的第二处
    // 真实证据（详见 pollBareListingStatus 的函数头注释与「杀伤力验证」记录）。
    await pollBareListingStatus(front, doc1.slug, 404)
    await pollBareListingStatus(front, doc2.slug, 404)

    // 城市前缀路由仅作路由形态覆盖，不构成对 D11 的验证——见上方 CITY_SLUG 注释。
    const cityAfter1 = await front.goto(`/${CITY_SLUG}/listings/${doc1.slug}`)
    expect(cityAfter1?.status(), `回滚后 /${CITY_SLUG}/listings/${doc1.slug} 应 404`).toBe(404)
    const cityAfter2 = await front.goto(`/${CITY_SLUG}/listings/${doc2.slug}`)
    expect(cityAfter2?.status(), `回滚后 /${CITY_SLUG}/listings/${doc2.slug} 应 404`).toBe(404)

    const doc1AfterRollback = await fetchListingByExternalId(page, EXTERNAL_ID_1)
    const doc2AfterRollback = await fetchListingByExternalId(page, EXTERNAL_ID_2)
    expect(doc1AfterRollback.id).toBe(doc1.id)
    expect(doc2AfterRollback.id).toBe(doc2.id)
    expect(doc1AfterRollback.publicationStatus).toBe('unpublished')
    expect(doc2AfterRollback.publicationStatus).toBe('unpublished')
  })
})
