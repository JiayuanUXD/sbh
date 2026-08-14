/**
 * P1 Task 5 E2E：canonical 分享与本地收藏
 *
 * 守护不变量：
 *   - 分享复制 canonical URL，query/hash 不进入剪贴板
 *   - 收藏刷新后保留（localStorage 持久化）
 *   - 禁用 localStorage 时显示非阻断提示，分享仍可用、收藏按钮禁用
 *
 * slug 用 seed listing `media-rich-listing`（有效供给，详情页渲染 ShareSaveActions）。
 */

import { expect, test } from '@playwright/test'

const LISTING_SLUG = 'media-rich-listing'

test.describe('详情页分享与本地收藏 P1', () => {
  test('分享复制 canonical URL，不含 query 和 hash', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    // 页面 URL 带 utm/hash，但分享的应是 canonical（origin + pathname）
    await page.goto(`/listings/${LISTING_SLUG}?utm_source=x#gallery`)

    await page.getByRole('button', { name: '分享' }).click()

    // headless Chromium 无 navigator.share，降级到剪贴板
    await expect(page.locator('.share-save-actions__feedback')).toBeVisible()
    const clipboard = await page.evaluate(() => navigator.clipboard.readText())
    expect(clipboard).not.toContain('utm_source')
    expect(clipboard).not.toContain('#')
    expect(clipboard).toMatch(new RegExp(`/listings/${LISTING_SLUG}$`))
  })

  test('收藏刷新后保留', async ({ page }) => {
    await page.goto(`/listings/${LISTING_SLUG}`)
    const saveButton = page.getByRole('button', { name: '收藏' })
    await expect(saveButton).toBeVisible()
    await saveButton.click()
    await expect(saveButton).toHaveAttribute('aria-pressed', 'true')
    await expect(saveButton).toHaveText('已收藏')

    // localStorage 持久化跨刷新
    await page.reload()
    const savedButton = page.getByRole('button', { name: '取消收藏' })
    await expect(savedButton).toHaveAttribute('aria-pressed', 'true')
    await expect(savedButton).toHaveText('已收藏')
  })

  test('禁用 localStorage 时显示非阻断提示且分享仍可用', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new DOMException('localStorage disabled', 'SecurityError')
        },
      })
    })
    await page.goto(`/listings/${LISTING_SLUG}`)

    await expect(page.getByText('本地存储不可用，无法收藏')).toBeVisible()
    // 非阻断：分享仍可用，收藏按钮禁用
    await expect(page.getByRole('button', { name: '分享' })).toBeEnabled()
    await expect(page.getByRole('button', { name: '收藏' })).toBeDisabled()
  })
})
