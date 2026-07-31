/**
 * P1 Task 4 E2E：详情媒体分类体验（视频延迟加载 + 平面图示意声明）
 *
 * 设计依据：docs/superpowers/plans/2026-07-30-detail-pages-p1-enhancements.md Task 4
 *
 * 守护不变量：
 *   - 视频仅在用户切换到「视频」分类后才挂载（不进入首屏关键链路）
 *   - 视频不自动播放、preload="none"
 *   - 平面图分类展示示意声明
 *
 * slug 用 seed listing `media-rich-listing`（2 图片 + 1 视频 + 1 平面图，三类齐全）。
 */

import { expect, test } from '@playwright/test'

const LISTING_SLUG = 'media-rich-listing'

test.describe('详情媒体分类 P1', () => {
  test('默认展示图片分类，视频与平面图未挂载', async ({ page }) => {
    const response = await page.goto(`/listings/${LISTING_SLUG}`)
    expect(response?.status()).toBe(200)

    // 图片为默认分类，至少一张图片可见
    await expect(page.getByRole('region', { name: /详情媒体/ })).toBeVisible()
    await expect(page.locator('.detail-gallery__item img').first()).toBeVisible()
    // 默认未切到视频/平面图分类，不应挂载 video 元素
    await expect(page.locator('video')).toHaveCount(0)
  })

  test('视频仅在切换分类后挂载且不自动播放', async ({ page }) => {
    await page.goto(`/listings/${LISTING_SLUG}`)
    // 初始无 video
    await expect(page.locator('video')).toHaveCount(0)

    await page.getByRole('tab', { name: '视频' }).click()
    const video = page.locator('video')
    await expect(video).toHaveCount(1)
    await expect(video).toHaveJSProperty('autoplay', false)
    await expect(video).toHaveAttribute('preload', 'none')
  })

  test('平面图分类展示示意声明', async ({ page }) => {
    await page.goto(`/listings/${LISTING_SLUG}`)
    await page.getByRole('tab', { name: '平面图' }).click()

    // 面板底部示意声明
    await expect(page.locator('.detail-gallery__schematic-declaration')).toBeVisible()
    // 平面图项 figcaption 亦标注示意
    await expect(
      page.locator('.detail-gallery__schematic-note').first(),
    ).toBeVisible()
  })
})
