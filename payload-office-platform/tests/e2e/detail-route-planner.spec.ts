/**
 * P2 Task 2 E2E：用户主动触发的路线建议
 *
 * 设计依据：docs/superpowers/plans/2026-07-30-detail-pages-p2-guidance.md Task 2
 *
 * 守护不变量：
 *   - 页面加载不调用 geolocation.getCurrentPosition（仅点击后一次）
 *   - 拒绝定位后显示"无法获取当前位置"并保留"打开高德地图"外部导航
 *
 * slug 用 seed building `west-nanjing-premium-center`（有完整坐标；计划示例
 * `jingan-center` 是 listing 而非 building，不存在对应楼盘详情页）。
 */

import { expect, test } from '@playwright/test'

const BUILDING_SLUG = 'west-nanjing-premium-center'

// 在页面脚本执行前打桩 geolocation：记录调用次数，并可控制成功/失败。
const INSTRUMENT = `
  window.__geoCalls = 0;
  const denied = { code: 1, message: 'User denied Geolocation' };
  navigator.geolocation.getCurrentPosition = (success, error) => {
    window.__geoCalls++;
    if (error) error(denied);
  };
`

test.describe('楼盘详情路线规划 P2', () => {
  test('页面加载时不请求定位', async ({ page }) => {
    await page.addInitScript(INSTRUMENT)
    await page.goto(`/buildings/${BUILDING_SLUG}`)
    // 初始按钮为空闲文案，且未调用定位
    await expect(page.getByRole('button', { name: '查看到这里的路线' })).toBeVisible()
    expect(await page.evaluate(() => (window as unknown as { __geoCalls: number }).__geoCalls)).toBe(0)
  })

  test('拒绝定位后保留外部导航', async ({ page }) => {
    await page.addInitScript(INSTRUMENT)
    await page.goto(`/buildings/${BUILDING_SLUG}`)
    await page.getByRole('button', { name: '查看到这里的路线' }).click()
    await expect(page.getByText('无法获取当前位置')).toBeVisible()
    // 降级：位置交通面板始终保留打开高德地图外链
    await expect(
      page.getByRole('link', { name: '打开高德地图' }).first(),
    ).toBeVisible()
    // 定位只被触发一次（点击那次）
    expect(await page.evaluate(() => (window as unknown as { __geoCalls: number }).__geoCalls)).toBe(1)
  })
})
