import { expect, test, type Page } from '@playwright/test'

import { blockUmamiScript } from './_umami-stub'

/**
 * 线索 ↔ 浏览路径关联（OPT-067）
 *
 * ## 为什么这三条必须是 E2E，单测覆盖不了
 *
 * 「匿名浏览全程不 identify」已有静态守卫（扫全仓调用点），但**静态守卫证明
 * 不了运行时行为**——间接调用、未来有人把 identify 包一层、或者某个第三方
 * 脚本自己调，静态扫描都看不见。只有真的在浏览器里拦住
 * `window.umami.identify` 才是行为层面的证据。
 *
 * 「同会话第二条线索复用同一 ID」跨了客户端（sessionStorage 回传）与服务端
 * （读到回传值则复用）。两边单测各自绿，接不上仍然可能。
 */

/** 桩把调用记录写进 sessionStorage 的键名——必须跨导航累积，见下方注释 */
const SPY_KEY = '__e2eIdentifyCalls'

/**
 * 在任何页面脚本执行前装桩，记录每一次 identify 调用。
 *
 * ⚠️ 记录**存进 sessionStorage 而不是 window 上的数组**：`addInitScript` 在
 * 每次导航前都会重跑，挂在 window 上的数组会被重置成空。那样第三条用例
 * （跨两次页面导航数调用次数）永远数不到 2，而第一条的「零调用」也只证明了
 * 当前这一页——比它看起来的弱得多。
 *
 * sessionStorage 与被测代码自身用的是不同的键，互不干扰。
 */
async function installIdentitySpy(page: Page): Promise<void> {
  await blockUmamiScript(page)
  await page.addInitScript((key: string) => {
    const read = (): string[] => {
      try {
        const raw = window.sessionStorage.getItem(key)
        return raw ? (JSON.parse(raw) as string[]) : []
      } catch {
        return []
      }
    }
    Reflect.set(window, 'umami', {
      track: () => {},
      identify: (id: string) => {
        const calls = read()
        calls.push(id)
        try {
          window.sessionStorage.setItem(key, JSON.stringify(calls))
        } catch {
          // 存不进去会让断言失败，这正是我们要的——不静默吞掉
        }
      },
    })
  }, SPY_KEY)
}

async function readIdentifyCalls(page: Page): Promise<string[]> {
  return page.evaluate((key: string) => {
    try {
      const raw = window.sessionStorage.getItem(key)
      return raw ? (JSON.parse(raw) as string[]) : []
    } catch {
      return []
    }
  }, SPY_KEY)
}

async function submitInquiry(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: /询价|预约看房|留电/ }).first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('称呼').fill(name)
  await dialog.getByLabel('手机号').fill('13800001111')
  await dialog.getByLabel('团队规模').fill('10-20 人')
  await dialog.getByRole('checkbox').check()
  await dialog.getByRole('button', { name: '下一步', exact: true }).click()
  await dialog.getByRole('button', { name: '提交', exact: true }).click()
  await expect(dialog.getByText(/已收到/)).toBeVisible()
}

test.describe('OPT-067 线索访客标识', () => {
  test('匿名浏览全程不调用 identify（spec D5）', async ({ page }) => {
    // 提交成功前 identify = 在用户同意留资之前把浏览行为挂到持久身份上，
    // 与隐私政策的表述相悖。这条走一遍真实浏览路径来证明它没发生。
    await installIdentitySpy(page)

    await page.goto('/listings')
    await expect(page.locator('.ls-card').first()).toBeVisible()
    expect(await readIdentifyCalls(page)).toEqual([])

    const href = await page.locator('.ls-card').first().getAttribute('href')
    await page.goto(href!)
    await expect(page.locator('h1').first()).toBeVisible()
    expect(await readIdentifyCalls(page)).toEqual([])

    // 打开咨询弹窗、填完表单、但**不提交**——到这一刻仍不得 identify
    await page.getByRole('button', { name: /询价|预约看房|留电/ }).first().click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('称呼').fill('E2E 用户')
    await dialog.getByLabel('手机号').fill('13800001111')
    await dialog.getByRole('checkbox').check()
    expect(
      await readIdentifyCalls(page),
      '填完表单但未提交时不得 identify——此刻用户尚未完成留资',
    ).toEqual([])
  })

  test('提交成功后 identify，且参数与响应的 visitorRef 一致', async ({ page }) => {
    await installIdentitySpy(page)

    let responseVisitorRef: unknown = undefined
    page.on('response', async (res) => {
      if (res.url().endsWith('/api/inquiries') && res.request().method() === 'POST') {
        const body = (await res.json().catch(() => null)) as { visitorRef?: unknown } | null
        responseVisitorRef = body?.visitorRef
      }
    })

    await page.goto('/listings')
    const href = await page.locator('.ls-card').first().getAttribute('href')
    await page.goto(href!)
    await submitInquiry(page, 'E2E 访客标识')

    await expect.poll(async () => (await readIdentifyCalls(page)).length).toBe(1)
    const calls = await readIdentifyCalls(page)

    expect(responseVisitorRef, '服务端应在成功响应里返回 visitorRef').toMatch(
      /^[0-9a-f]{32}$/,
    )
    // 两者必须是同一个值：对不上的话，客户端 identify 的 ID 与后台深链用的 ID
    // 不同，整条关联链断掉——而两边各自看都「有值、格式正确」
    expect(calls[0]).toBe(responseVisitorRef)
  })

  test('同会话第二次提交复用同一个 visitorRef', async ({ page }) => {
    // 跨客户端与服务端：sessionStorage 回传 → 服务端读到合法回传则复用。
    // 不复用的话，umami.identify 的会话级后写覆盖会让第一条线索的深链失效。
    await installIdentitySpy(page)

    await page.goto('/listings')
    const cards = page.locator('.ls-card')
    await expect(cards.first()).toBeVisible()
    const firstHref = await cards.nth(0).getAttribute('href')
    const secondHref = await cards.nth(1).getAttribute('href')
    test.skip(!secondHref || secondHref === firstHref, '夹具房源不足两套，跳过')

    await page.goto(firstHref!)
    await submitInquiry(page, 'E2E 首次')
    await expect.poll(async () => (await readIdentifyCalls(page)).length).toBe(1)

    // 换一套房源再提交：idempotencyKey 含 targetSlug，若不回传就会派生出新 ID
    await page.goto(secondHref!)
    await submitInquiry(page, 'E2E 二次')
    await expect.poll(async () => (await readIdentifyCalls(page)).length).toBe(2)

    const calls = await readIdentifyCalls(page)
    expect(calls[0]).toMatch(/^[0-9a-f]{32}$/)
    expect(calls[1], '同会话第二条线索必须复用首个 ID').toBe(calls[0])
  })
})
