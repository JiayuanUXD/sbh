/**
 * P1 Task 3 E2E：楼盘详情位置交通面板
 *
 * 守护不变量：
 *   - 地图改为进入视口自动加载（IntersectionObserver），用户未滚动到位置区前不请求 webapi.amap.com
 *   - 地图 SDK 加载失败时降级为静态卡片提示
 *
 * slug 用 seed building `west-nanjing-premium-center`（有完整坐标）。
 */

import { expect, test } from '@playwright/test'

const BUILDING_SLUG = 'west-nanjing-premium-center'

test.describe('楼盘详情位置交通 P1', () => {
  test('地图失败显示降级卡片', async ({ page }) => {
    // 阻断高德 JS API，模拟加载失败
    await page.route('**/webapi.amap.com/**', (route) => route.abort())
    await page.goto(`/buildings/${BUILDING_SLUG}`)

    // 滚动到位置交通区，触发 IntersectionObserver 自动加载（加载失败降级为静态卡片）
    await page.locator('#location').first().scrollIntoViewIfNeeded()
    await expect(page.getByText('地图暂时不可用')).toBeVisible()
  })

  test('进入视口前不加载地图 SDK', async ({ page }) => {
    const requests: string[] = []
    page.on('request', (request) => requests.push(request.url()))
    // route abort 仍会触发 request 事件，可用于验证懒加载触发时机
    await page.route('**/webapi.amap.com/**', (route) => route.abort())
    await page.goto(`/buildings/${BUILDING_SLUG}`)
    // 初始未滚动到位置区，不应请求高德 JS API
    expect(requests.some((url) => url.includes('webapi.amap.com'))).toBe(false)

    // 滚动到位置区后触发懒加载
    await page.locator('#location').first().scrollIntoViewIfNeeded()
    await expect.poll(
      () => requests.some((url) => url.includes('webapi.amap.com')),
    ).toBe(true)
  })
})
