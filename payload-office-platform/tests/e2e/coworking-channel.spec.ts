import { expect, test } from '@playwright/test'

import { expectCanonical } from './_canonical'

/**
 * 共享办公频道冒烟（OPT-103）。与 sale-channel.spec.ts 同一取舍：只验路由活着、
 * 类型行确实没有、页内链接不带 type、没有客户端报错；不断言具体房源。
 */

const routingEnabled = process.env.MULTI_CITY_ROUTING_ENABLED === 'true'

test.describe('共享办公频道', () => {
  test('/coworking 可达且不是 404，canonical 指向频道自身', async ({ page }) => {
    const response = await page.goto('/coworking')
    expect(response?.status(), '/coworking 返回非 200：频道路由挂了').toBe(200)
    await expect(page.locator('body')).not.toContainText('这个地址不存在')
    await expectCanonical(page, routingEnabled ? '/shanghai/coworking' : '/coworking')
  })

  test('没有类型行、没有单位行、没有底栏计数；标题是共享办公', async ({ page }) => {
    await page.goto('/coworking')
    await expect(page.locator('h1')).toContainText('共享办公')
    await expect(page.locator('.ls-filterc__label', { hasText: '类型' })).toHaveCount(0)
    await expect(page.locator('.ls-unitband')).toHaveCount(0)
    await expect(page.locator('.ls-filterc__count')).toHaveCount(0)
    await expect(page.locator('body')).not.toContainText('符合条件')
  })

  test('带筛选的 canonical 不含 type，且 ?type= 被锁定覆盖', async ({ page }) => {
    const response = await page.goto('/coworking?areaMin=100&type=full-floor&unknown=drop')
    expect(response?.status()).toBe(200)
    await expectCanonical(page, routingEnabled ? '/shanghai/coworking?areaMin=100' : '/coworking?areaMin=100')
    const filterHrefs = await page.locator('.ls-filterc a[href]').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''))
    expect(filterHrefs.every((h) => !h.includes('type='))).toBe(true)
  })

  test('主导航「共享办公」指向频道', async ({ page }) => {
    await page.goto('/')
    const link = page.locator('header a', { hasText: '共享办公' }).first()
    await expect(link).toHaveAttribute('href', routingEnabled ? '/shanghai/coworking' : '/coworking')
  })

  test('页面加载无客户端报错', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))
    await page.goto('/coworking')
    await page.waitForLoadState('networkidle')
    expect(errors, `客户端报错：${errors.join(' | ')}`).toHaveLength(0)
  })
})
