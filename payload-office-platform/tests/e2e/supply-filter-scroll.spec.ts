import { expect, test } from '@playwright/test'

/**
 * OPT-037 终审 I4：供给区筛选 / 排序不得把用户弹回页首。
 *
 * 背景：改造前（master）这些控件是纯客户端 state，原地筛选完全不动滚动条；
 * 改造后全部换成普通 `next/link` 导航，既没有 `scroll={false}`、href 也不带
 * `#supply`。「App Router 对同 pathname、仅 searchParams 变化的导航会不会重置
 * 滚动」当时无人实测，本文件就是那次实测——**结论是会**：
 *
 *   修复前（1440×900，`west-nanjing-premium-center`）：
 *     筛选 before={scrollY:968, supplyTop:45.3} → after={scrollY:0, supplyTop:1013.3}
 *     排序 before={scrollY:968, supplyTop:45.3} → after={scrollY:0, supplyTop:1013.3}
 *   修复后（全部 Link 加 `scroll={false}`）：
 *     两条都是 before === after（scrollY 968 不变、supplyTop 45.3 不变）
 *
 * 于是本文件从一次性探针转正为**回归守卫**：谁把 `scroll={false}` 拿掉、或者
 * 新增一个不带它的供给区 Link，这两条会立刻红。判据用元素相对视口的位移而不是
 * 写死像素——不把被测页面的高度抄进测试。
 */

const BUILDING_SLUG = 'west-nanjing-premium-center'

test('供给区筛选后滚动位置保持不变（I4 回归守卫）', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/buildings/${BUILDING_SLUG}`)
  await page.waitForLoadState('networkidle')

  const supply = page.locator('#supply')
  await expect(supply).toBeVisible()

  // 滚到供给区（用元素自己的位置，不写死像素）
  await supply.scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)

  const before = await page.evaluate(() => ({
    scrollY: window.scrollY,
    supplyTop: document.querySelector('#supply')!.getBoundingClientRect().top,
  }))

  const areaPill = page.getByRole('group', { name: '按面积筛选' }).getByRole('link', { name: '100–300 ㎡' })
  await expect(areaPill).toBeVisible()
  await areaPill.click()

  await page.waitForURL(/areaMin=100/)
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(500)

  const after = await page.evaluate(() => ({
    scrollY: window.scrollY,
    supplyTop: document.querySelector('#supply')!.getBoundingClientRect().top,
  }))

  console.log('[I4] before=', JSON.stringify(before), 'after=', JSON.stringify(after))

  expect.soft(after.scrollY, 'scrollY 归零 = 弹回页首').toBeGreaterThan(0)
  expect.soft(Math.abs(after.supplyTop - before.supplyTop), '#supply 相对视口位移').toBeLessThan(200)
})

test('供给区排序后滚动位置保持不变（I4 回归守卫）', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/buildings/${BUILDING_SLUG}`)
  await page.waitForLoadState('networkidle')

  const supply = page.locator('#supply')
  await supply.scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)

  const before = await page.evaluate(() => ({
    scrollY: window.scrollY,
    supplyTop: document.querySelector('#supply')!.getBoundingClientRect().top,
  }))

  const sortLink = page.getByRole('group', { name: '排序' }).getByRole('link', { name: '面积从小到大' })
  await expect(sortLink).toBeVisible()
  await sortLink.click()

  await page.waitForURL(/sort=area-asc/)
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(500)

  const after = await page.evaluate(() => ({
    scrollY: window.scrollY,
    supplyTop: document.querySelector('#supply')!.getBoundingClientRect().top,
  }))

  console.log('[I4] sort before=', JSON.stringify(before), 'after=', JSON.stringify(after))

  expect.soft(after.scrollY, 'scrollY 归零 = 弹回页首').toBeGreaterThan(0)
  expect.soft(Math.abs(after.supplyTop - before.supplyTop), '#supply 相对视口位移').toBeLessThan(200)
})
