import { expect, test } from '@playwright/test'

/**
 * 出售频道冒烟（OPT-045）。
 *
 * ## 为什么需要这个文件
 *
 * 出售频道曾由 `NEXT_PUBLIC_SALE_CHANNEL_ENABLED` 控制（ff07d21：「出售功能需要更长的
 * 验证周期」，用开关把代码上线与用户可见解耦），2026-08-24 打开，功能稳定后开关整体
 * 移除，出售能力现在恒定可用。
 *
 * 开关没了，这条冒烟反而更重要：**路由不能静默 404**。
 * 出售频道的失败模式与租赁不同——租赁页坏了会立刻有人报，出售页没人常看，
 * 404 可以挂很久没人发现。
 *
 * ## 刻意不断言内容
 *
 * 只验「路由活着 + 页面骨架在 + 没有客户端报错」。断言具体房源会把这个 spec 绑死在
 * seed 数据上，而 seed 里出售房源的数量随时会变；那样的断言迟早变成噪音，
 * 而噪音会让人开始忽略红灯。真实内容由列表页与详情页各自的 spec 负责。
 */

const routingEnabled = process.env.MULTI_CITY_ROUTING_ENABLED === 'true'

test.describe('出售频道', () => {
  test('/sale 可达且不是 404', async ({ page }) => {
    const response = await page.goto('/sale')
    expect(response?.status(), '/sale 返回非 200：出售频道路由挂了').toBe(200)
    // notFound() 会渲染站内 not-found 页；断言正文不是它，比只看状态码更结实——
    // 某些配置下 not-found 也可能返回 200。
    // 「页面未找到」是 `(frontend)/not-found.tsx` 的 metadata title，只出现在
    // <head>，body 里永远查不到——这条断言曾因此变成一条恒真的死守卫。
    // 真正出现在正文里的是 EmptyState 的标题「这个地址不存在」，两条都留：
    // 前者兜住"以后有人把标题也渲染进正文"，后者才是当下真正生效的那条。
    await expect(page.locator('body')).not.toContainText('页面未找到')
    await expect(page.locator('body')).not.toContainText('这个地址不存在')
  })

  test('/shanghai/sale 可达且不是 404', async ({ page }) => {
    // skip 必须写在用例**内部**：写在 describe 体里 test.skip(cond) 是整组跳过，
    // 会把上下两条无关的用例一起跳掉，而且跳得毫无声响（实测踩到）。
    test.skip(!routingEnabled, '多城市路由关闭时 /[city]/sale 不适用')
    const response = await page.goto('/shanghai/sale')
    expect(response?.status()).toBe(200)
    await expect(page.locator('body')).not.toContainText('页面未找到')
  })

  test('页面加载无客户端报错', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))
    await page.goto('/sale')
    await page.waitForLoadState('networkidle')
    expect(errors, `客户端报错：${errors.join(' | ')}`).toHaveLength(0)
  })
})
