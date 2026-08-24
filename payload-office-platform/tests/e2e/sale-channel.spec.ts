import { expect, test } from '@playwright/test'

/**
 * 出售频道冒烟（OPT-045）。
 *
 * ## 为什么需要这个文件
 *
 * 出售频道由 `NEXT_PUBLIC_SALE_CHANNEL_ENABLED` 控制，2026-08-24 之前生产一直关着
 *（ff07d21：「出售功能需要更长的验证周期」，用开关把代码上线与用户可见解耦）。
 * 打开它等于把 `/sale` 与 `/[city]/sale` 两个公开页放给用户，而在此之前
 * **出售频道一条 e2e 都没有**——关着的时候恒 404，测什么都没意义。
 *
 * 开关一开，最需要守住的就是这条：**路由不能静默 404**。
 * 出售频道的失败模式与租赁不同——租赁页坏了会立刻有人报，出售页刚上线、没人常看，
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
    expect(response?.status(), '/sale 返回非 200 说明出售频道开关没生效（NEXT_PUBLIC_* 是构建期内联的，改了要重新构建）').toBe(200)
    // notFound() 会渲染 Next 的 not-found 页；断言标题不是它，比只看状态码更结实——
    // 某些配置下 not-found 也可能返回 200。
    await expect(page.locator('body')).not.toContainText('页面未找到')
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
