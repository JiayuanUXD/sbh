import { expect, test, type Page } from '@playwright/test'

/**
 * 埋点采集链路的端到端验证（OPT-064）
 *
 * ## 为什么必须跑在生产构建上
 *
 * `init.ts` 的 adapter 选择里，开发环境走 ConsoleAdapter——事件根本到不了
 * `window.umami`。在 dev 下打桩观测不到任何东西：用例要么直接失败，要么退化成
 * 「断言了一些与 Umami 接线无关的东西」还显示绿色，比没有更糟。
 *
 * 本仓库的 e2e job 本来就是 `pnpm build` + `next start`（生产 server），
 * 配套在 `quality.yml` 的 job 级 env 里给了 `NEXT_PUBLIC_ANALYTICS_ENABLED` /
 * `NEXT_PUBLIC_UMAMI_SRC` / `NEXT_PUBLIC_UMAMI_WEBSITE_ID`，
 * 这样构建产物里编进去的才是 UmamiAdapter 那条分支。
 *
 * ## 桩为什么装在 addInitScript 里
 *
 * 真实 `script.js` 指向不可达域名，加载必然失败——不影响断言：`addInitScript`
 * 在页面任何脚本执行**之前**就把 `window.umami` 放好了，adapter 找到它就转发。
 * 验的是「我们这边的接线对不对」，不是「Umami 服务通不通」（后者属运维验收）。
 *
 * ## ⚠️ 整页 goto 会清空捕获
 *
 * `page.goto()` 重建 document，`__umamiEvents` 会是一个新数组。要验「站内跳转
 * 触发上报」就**必须点 next/link 走客户端导航**（同一个 document，捕获数组存活）。
 * 用 goto 模拟跳转会得到一个永远为空的数组，然后把它误读成「没上报」。
 */

interface CapturedEvent {
  name: string
  data: Record<string, unknown>
}

const ENGAGEMENT_PAGE_TYPES = [
  'listings',
  'listing-detail',
  'buildings',
  'building-detail',
  'entrust',
  'publish',
]

async function stubUmami(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const captured: Array<{ name: string; data: Record<string, unknown> }> = []
    Reflect.set(window, '__umamiEvents', captured)
    Reflect.set(window, 'umami', {
      track: (name: string, data: Record<string, unknown> = {}) => {
        captured.push({ name, data })
      },
      identify: () => {},
    })
  })
}

async function readEvents(page: Page): Promise<CapturedEvent[]> {
  return page.evaluate(() => (Reflect.get(window, '__umamiEvents') as CapturedEvent[]) ?? [])
}

/** 队列是攒批 + 定时 flush，给它时间把事件推给 adapter */
async function waitForEvent(page: Page, name: string): Promise<CapturedEvent> {
  await expect
    .poll(async () => (await readEvents(page)).filter((e) => e.name === name).length, {
      message: `等待埋点事件 ${name}`,
      timeout: 20_000,
    })
    .toBeGreaterThan(0)
  const all = await readEvents(page)
  return all.find((e) => e.name === name) as CapturedEvent
}

test.describe('埋点采集链路', () => {
  test.beforeEach(async ({ page }) => {
    await stubUmami(page)
  })

  test('房源列表页上报 listing_search', async ({ page }) => {
    await page.goto('/shanghai/listings')
    await expect(page.locator('.ls-page')).toBeVisible()

    const evt = await waitForEvent(page, 'listing_search')
    expect(evt.data.city).toBe('shanghai')
    // 类型必须对：白名单允许 string/number/boolean，但类型错了在分析端会变成
    // 另一种聚合方式（数字被当字符串分组），属于「看着有数据、其实算错了」
    expect(typeof evt.data.result_count).toBe('number')
    expect(typeof evt.data.page_index).toBe('number')
    expect(typeof evt.data.filter_completeness).toBe('number')
  })

  test('楼盘列表页上报 building_search，且不带 price_unit', async ({ page }) => {
    await page.goto('/shanghai/buildings')
    await expect(page.locator('.ls-page')).toBeVisible()

    const evt = await waitForEvent(page, 'building_search')
    expect(evt.data.city).toBe('shanghai')
    expect(typeof evt.data.result_count).toBe('number')
    // 楼盘没有价格单位；带一个空值比不带更糟（分析端会多出一个空分组）
    expect(evt.data).not.toHaveProperty('price_unit')
  })

  test('点击结果卡上报 listing_result_click，并在站内跳转时上报上一页的 page_engagement', async ({ page }) => {
    await page.goto('/shanghai/listings')
    await expect(page.locator('.ls-page')).toBeVisible()
    await waitForEvent(page, 'listing_search')

    const cards = page.locator('[data-list-analytics-event="listing_result_click"]')
    const count = await cards.count()
    test.skip(count === 0, '当前库内无可见房源，点击链路不适用')

    // 制造真实停留与滚动，让 page_engagement 有非零读数
    await page.mouse.wheel(0, 800)
    await page.waitForTimeout(2_000)

    // 点 next/link → 客户端导航 → 同一个 document，捕获数组存活
    await cards.first().click()
    await page.waitForURL(/\/listings\//)

    const clickEvt = await waitForEvent(page, 'listing_result_click')
    expect(clickEvt.data.city).toBe('shanghai')
    expect(clickEvt.data.rank).toBe(1) // 点的是第一张，页内 1 基序号
    expect(typeof clickEvt.data.listing_id).toBe('number')
    expect(['grid', 'row']).toContain(clickEvt.data.section)

    // 站内跳转是 page_engagement 在主路径上的**唯一**触发点：
    // App Router 的客户端导航既不触发 pagehide 也不触发 visibilitychange。
    const engagement = await waitForEvent(page, 'page_engagement')
    expect(engagement.data.page_type).toBe('listings') // 报的是**离开的那一页**
    expect(typeof engagement.data.active_ms).toBe('number')
    expect(engagement.data.active_ms as number).toBeGreaterThan(0)
    expect([0, 25, 50, 75, 90]).toContain(engagement.data.scroll_bucket)
    expect(ENGAGEMENT_PAGE_TYPES).toContain(engagement.data.page_type)
  })

  test('信息纠错弹窗上报 correction_open（此前该事件被静默丢弃）', async ({ page }) => {
    // 本次修复的直接验证：correction_* 四个事件此前不在白名单里，
    // 埋点打了但 collector 一律丢弃，且生产环境连丢弃日志都没有。
    await page.goto('/shanghai/listings')
    await expect(page.locator('.ls-page')).toBeVisible()

    const cards = page.locator('[data-list-analytics-event="listing_result_click"]')
    test.skip((await cards.count()) === 0, '当前库内无可见房源')
    await cards.first().click()
    await page.waitForURL(/\/listings\//)

    const trigger = page.getByRole('button', { name: /纠错|信息有误/ }).first()
    test.skip((await trigger.count()) === 0, '详情页无纠错入口')

    await trigger.click()
    const evt = await waitForEvent(page, 'correction_open')
    expect(evt.data.target_type).toBeTruthy()
  })
})
