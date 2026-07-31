/**
 * P1 Task 3 E2E：楼盘详情位置交通面板
 *
 * 设计依据：docs/superpowers/plans/2026-07-30-detail-pages-p1-enhancements.md Task 3
 *
 * 守护不变量：
 *   - 地图 SDK 加载失败仍展示静态地址、复制地址、打开高德地图外链
 *   - 用户未点击"查看地图"前不请求 webapi.amap.com（懒加载）
 *
 * slug 用 seed building `west-nanjing-premium-center`（有完整坐标）。
 */

import { expect, test } from '@playwright/test'

const BUILDING_SLUG = 'west-nanjing-premium-center'

test.describe('楼盘详情位置交通 P1', () => {
  test('地图失败仍显示地址和外部导航', async ({ page }) => {
    // 阻断高德 JS API，模拟加载失败
    await page.route('**/webapi.amap.com/**', (route) => route.abort())
    await page.goto(`/buildings/${BUILDING_SLUG}`)

    // 点击"查看地图"触发懒加载，加载失败降级
    await page.getByRole('button', { name: '查看地图' }).click()
    await expect(page.getByText('地图暂时不可用')).toBeVisible()

    // 静态区始终保留：复制地址 + 打开高德地图外链
    await expect(page.getByRole('button', { name: '复制地址' })).toBeVisible()
    await expect(page.getByRole('link', { name: '打开高德地图' })).toBeVisible()
  })

  test('进入视口前不加载地图 SDK', async ({ page }) => {
    const requests: string[] = []
    page.on('request', (request) => requests.push(request.url()))
    await page.goto(`/buildings/${BUILDING_SLUG}`)
    // 初始未点击，不应请求高德 JS API
    expect(requests.some((url) => url.includes('webapi.amap.com'))).toBe(false)
  })
})
