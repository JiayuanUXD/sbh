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

  test('筛选条已渲染但没有类型行；全站已移除的单位行 / 底栏计数在本频道同样不存在', async ({ page }) => {
    await page.goto('/coworking')
    await expect(page.locator('h1')).toContainText('共享办公')
    // 先证明筛选条本身渲染了：下面几条 toHaveCount(0) 断言如果在整个 .ls-filterc
    // 都没挂出来的情况下也会全部通过，那就什么都没证明——同类「消失的不是我要
    // 测的东西，是它的容器」的假阴性已经在别处踩过（见 OPT-103 复审）。
    await expect(page.locator('.ls-filterc__label', { hasText: '位置' })).toHaveCount(1)
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
    // 同一类假阴性：空数组的 .every() 恒为 true，链接全没渲染出来也会「通过」。
    expect(filterHrefs.length).toBeGreaterThan(0)
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
