import { expect, test, type Page } from '@playwright/test'

const LISTING_SLUG = 'jingan-serviced-office-42-seats'
const PRICE_ON_REQUEST_SLUG = 'jingan-price-on-request-300sqm'
const PUBLISHED_INEFFECTIVE_SLUG = 'jingan-published-pending-recheck'
const ROUTING_ENABLED = process.env.MULTI_CITY_ROUTING_ENABLED === 'true'
const DETAIL_VIEWPORTS = [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
] as const

async function expectMobileCtaDoesNotObscureLastContent(page: Page) {
  const bounds = await page.evaluate(async () => {
    window.scrollTo({
      top: document.documentElement.scrollHeight,
      // Chromium supports immediate scrolling; it avoids the site's smooth-scroll CSS.
      behavior: 'instant' as ScrollBehavior,
    })
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))

    const mobileBar = document.querySelector<HTMLElement>('[role="region"][aria-label="询价操作栏"]')
    const content = Array.from(document.querySelectorAll<HTMLElement>('.detail > section'))
      .at(-1)
    if (!mobileBar || !content) return null
    return {
      ctaTop: mobileBar.getBoundingClientRect().top,
      lastContentBottom: content.getBoundingClientRect().bottom,
    }
  })

  expect(bounds).not.toBeNull()
  expect(bounds!.lastContentBottom).toBeLessThanOrEqual(bounds!.ctaTop)
}

function collectPageRuntimeErrors(page: Page) {
  const consoleErrors: string[] = []
  const pageErrors: string[] = []

  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text())
    }
  })
  page.on('pageerror', (error) => {
    pageErrors.push(error.message)
  })

  return { consoleErrors, pageErrors }
}

function expectNoPageRuntimeErrors(errors: ReturnType<typeof collectPageRuntimeErrors>) {
  expect(errors.consoleErrors, '页面不应输出 console.error').toEqual([])
  expect(errors.pageErrors, '页面不应产生未捕获异常').toEqual([])
}

async function stubUnavailableSeedMedia(page: Page) {
  await page.route('**/api/media/file/**', (route) => route.fulfill({ status: 204, body: '' }))
}

test.describe('房源详情 P0', () => {
  test('旧详情和错误城市详情遵循精确所有权', async ({ request }) => {
    const legacy = await request.get(`/listings/${LISTING_SLUG}`, { maxRedirects: 0 })
    const wrongCity = await request.get(`/hangzhou/listings/${LISTING_SLUG}`, { maxRedirects: 0 })
    if (ROUTING_ENABLED) {
      expect(legacy.status()).toBe(307)
      expect(legacy.headers().location).toBe(`/shanghai/listings/${LISTING_SLUG}`)
      expect(wrongCity.status()).toBe(307)
      expect(wrongCity.headers().location).toBe(`/shanghai/listings/${LISTING_SLUG}`)
    } else {
      expect(legacy.status()).toBe(200)
      expect(wrongCity.status()).toBe(307)
      expect(wrongCity.headers().location).toBe(`/shanghai/listings/${LISTING_SLUG}`)
    }
  })

  test('有效房源按决策顺序展示概况和咨询入口', async ({ page }) => {
    const response = await page.goto(`/listings/${LISTING_SLUG}`)

    expect(response?.status()).toBe(200)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: '房源概况' })).toBeVisible()
    await expect(page.locator('.detail-hero #overview')).toHaveCount(1)
    await expect(page.getByRole('link', { name: '查看楼盘' })).toBeVisible()
    await expect(
      page.locator('button[data-source-section="hero"]', { hasText: '询价 / 预约看房' }),
    ).toBeVisible()
  })

  test('存在但待复核的已发布房源仍统一返回 404', async ({ page, request }) => {
    const fixture = await request.get(
      `/api/listings?where[slug][equals]=${PUBLISHED_INEFFECTIVE_SLUG}&limit=1`,
    )
    expect(fixture.status()).toBe(200)
    const fixtureData = await fixture.json() as { docs: Array<{
      slug: string
      publicationStatus: string
      reviewStatus: string
      supplyVisibilityHold: string
    }> }
    expect(fixtureData.docs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        slug: PUBLISHED_INEFFECTIVE_SLUG,
        publicationStatus: 'published',
        reviewStatus: 'approved',
        supplyVisibilityHold: 'pending_recheck',
      }),
    ]))

    const response = await page.goto(`/listings/${PUBLISHED_INEFFECTIVE_SLUG}`)

    expect(response?.status()).toBe(404)
  })

  test('价格面议房源不显示零元且窄屏没有水平溢出', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    const response = await page.goto(`/listings/${PRICE_ON_REQUEST_SLUG}`)

    expect(response?.status()).toBe(200)
    const heroPrice = page.locator('.detail-hero .detail__rent').first()
    const mobilePrice = page.locator('.detail__mobile-bar-rent')
    await expect(heroPrice).toBeVisible()
    await expect(heroPrice).toHaveText('价格面议')
    // F-016：底部栏价格在页内价格滚出视口后才显示，先滚出首屏再断言
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await expect(mobilePrice).toBeVisible()
    await expect(mobilePrice).toHaveText('价格面议')
    expect(await page.locator('main').evaluate(
      (element) => !/(?<![\d.])0\s*元(?![\d.])/.test(element.textContent ?? ''),
    )).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
  })

  for (const viewport of DETAIL_VIEWPORTS) {
    test(`房源详情在 ${viewport.width}px 无横向溢出，移动操作栏不遮挡内容`, async ({ page }) => {
      await stubUnavailableSeedMedia(page)
      const runtimeErrors = collectPageRuntimeErrors(page)
      await page.setViewportSize(viewport)
      const response = await page.goto(`/listings/${LISTING_SLUG}`)

      expect(response?.status()).toBe(200)
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
      expect(await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      )).toBe(true)

      if (viewport.width <= 767) {
        const mobileBar = page.getByRole('region', { name: '询价操作栏' })
        await expect(mobileBar).toBeVisible()
        await expectMobileCtaDoesNotObscureLastContent(page)
      }

      expectNoPageRuntimeErrors(runtimeErrors)
    })
  }

  test('图片加载失败时在对应图库项显示稳定兜底', async ({ page }) => {
    const response = await page.goto(`/listings/${LISTING_SLUG}`)

    expect(response?.status()).toBe(200)
    const galleryItems = page.locator('.detail-gallery__item')
    const imageItemIndex = await galleryItems.evaluateAll(
      (items) => items.findIndex((item) => item.querySelector('img') !== null),
    )
    expect(imageItemIndex).toBeGreaterThanOrEqual(0)
    const imageItem = galleryItems.nth(imageItemIndex)
    const image = imageItem.locator('img')
    await expect(image).toBeVisible()

    await image.dispatchEvent('error')

    await expect(imageItem.getByRole('img', { name: '图片暂未加载' })).toBeVisible()
    await expect(imageItem.locator('img')).toHaveCount(0)
  })

  test('媒体画廊支持全屏、左右键、Escape 和焦点归还', async ({ page }) => {
    await page.goto(`/listings/${LISTING_SLUG}`)
    const gallery = page.getByRole('region', { name: /详情媒体/ })
    const openGallery = gallery.getByRole('button', { name: /查看全屏媒体/ }).first()
    await expect(openGallery).toBeVisible()
    await openGallery.focus()
    await openGallery.press('Enter')

    const dialog = page.getByRole('dialog', { name: /全屏媒体预览/ })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: '关闭全屏媒体预览' })).toBeFocused()
    const counter = dialog.getByRole('status')
    const before = await counter.textContent()
    await page.keyboard.press('ArrowRight')
    await expect(counter).not.toHaveText(before ?? '')
    await page.keyboard.press('ArrowLeft')
    await expect(counter).toHaveText(before ?? '')

    await page.keyboard.press('Shift+Tab')
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(openGallery).toBeFocused()
  })

  test('视频对话框的原生控件参与双向焦点循环', async ({ page }) => {
    await page.goto(`/listings/${LISTING_SLUG}`)
    const gallery = page.getByRole('region', { name: /详情媒体/ })
    // 视频在独立分类 Tab，需先切换才出现视频入口
    await gallery.getByRole('tab', { name: '视频' }).click()
    const videoTrigger = gallery.getByRole('button', { name: /查看全屏媒体：.*视频/ })
    await expect(videoTrigger).toBeVisible()
    await videoTrigger.click()

    const dialog = page.getByRole('dialog', { name: /全屏媒体预览/ })
    const close = dialog.getByRole('button', { name: '关闭全屏媒体预览' })
    const video = dialog.locator('video[controls]')
    await expect(video).toBeVisible()
    // 单个视频项：对话框无上一张/下一张翻页按钮
    await expect(dialog.getByRole('button', { name: '下一张媒体' })).toHaveCount(0)

    // 等待对话框 effect 的 rAF 初始聚焦关闭按钮：这同时保证 effect 已注册 keydown
    // 焦点循环处理（handler 先于 rAF 注册），避免在套件负载下 press 早于 handler 注册
    // 导致 Shift+Tab 焦点循环不触发、视频控件拿不到焦点。
    await expect(close).toBeFocused()
    await close.press('Shift+Tab')
    await expect(video).toBeFocused()
    await video.press('Tab')
    await expect(close).toBeFocused()
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)
  })

  test('详情画廊遵守减少动效偏好', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(`/listings/${LISTING_SLUG}`)
    expect(await page.locator('.detail-gallery__open').first().evaluate(
      (element) => Number.parseFloat(getComputedStyle(element).transitionDuration),
    )).toBeLessThanOrEqual(0.01)
  })
})

test.describe('楼盘详情 P0', () => {
  // 楼盘详情页含 LocationPanel，地图进入视口会自动加载高德 JS API。
  // CI 用假 Key（NEXT_PUBLIC_AMAP_JS_KEY=e2e-fake-amap-js-key-not-real），真实加载会
  // 触发 SDK 内部 error 污染 console.error 断言。route abort 让地图走 error 降级，
  // 不影响布局/供给/无横向溢出等断言（这些测试不断言地图本身）。
  test.beforeEach(async ({ page }) => {
    await page.route('**/webapi.amap.com/**', (route) => route.abort())
  })

  test('楼盘页按有效供给显示在租房源表格', async ({ page }) => {
    const response = await page.goto('/buildings/west-nanjing-premium-center')

    expect(response?.status()).toBe(200)
    await expect(page.getByRole('heading', { name: '在租房源' })).toBeVisible()
    const rows = page.locator('.building-supply-browser__table tbody tr')
    await expect(rows.first()).toBeVisible()
    await expect(page.locator(`a[href$="/listings/${PUBLISHED_INEFFECTIVE_SLUG}"]`)).toHaveCount(0)
  })

  test('楼盘供给分桶筛选默认全选且可切换', async ({ page }) => {
    await page.goto('/buildings/west-nanjing-premium-center')
    const canonicalJsonLd = await page.locator('script[type="application/ld+json"]').textContent()
    const areaGroup = page.getByRole('group', { name: '按面积筛选' })
    const priceGroup = page.getByRole('group', { name: '按价格筛选' })
    await expect(areaGroup).toBeVisible()
    await expect(priceGroup).toBeVisible()
    await expect(areaGroup.getByRole('button', { name: /全部/ })).toHaveAttribute('aria-pressed', 'true')
    await expect(priceGroup.getByRole('button', { name: /全部/ })).toHaveAttribute('aria-pressed', 'true')

    // 切换到任一非空面积桶后，antd list 仍可渲染且 canonical JSON-LD 不变
    const firstAreaBucket = areaGroup.getByRole('button').nth(1)
    if (await firstAreaBucket.isVisible()) {
      await firstAreaBucket.click()
      await expect(firstAreaBucket).toHaveAttribute('aria-pressed', 'true')
      await expect(page.locator('.building-supply-browser__table')).toBeVisible()
    }
    expect(await page.locator('script[type="application/ld+json"]').textContent()).toBe(canonicalJsonLd)
  })

  test('待复核房源不进入楼盘公开供给', async ({ page }) => {
    const response = await page.goto('/buildings/west-nanjing-premium-center')

    expect(response?.status()).toBe(200)
    await expect(page.locator(`a[href$="/listings/${PUBLISHED_INEFFECTIVE_SLUG}"]`)).toHaveCount(0)
    await expect(page.locator('.building-supply-browser__bucket').first()).toBeVisible()
  })

  test('楼盘详情供给聚合和列表使用同一 asOf 快照', async ({ page }) => {
    const response = await page.goto('/buildings/west-nanjing-premium-center')

    expect(response?.status()).toBe(200)
    const aggregate = page.locator('[data-supply-as-of]').first()
    const list = page.locator('.building-supply-browser[data-supply-as-of]')
    await expect(aggregate).toHaveAttribute('data-supply-as-of', /.+/)
    const asOf = await aggregate.getAttribute('data-supply-as-of')
    expect(asOf).not.toBeNull()
    await expect(list).toHaveAttribute('data-supply-as-of', asOf ?? '')
  })

  test('桌面楼盘供给默认紧凑表格且无视图切换', async ({ page }) => {
    const response = await page.goto('/buildings/west-nanjing-premium-center')

    expect(response?.status()).toBe(200)
    await expect(page.getByRole('group', { name: '供给展示方式' })).toHaveCount(0)
    await expect(page.locator('.building-supply-browser__table')).toBeVisible()
    await expect(page.locator('[data-listing-card-variant="building-supply"]')).toHaveCount(0)
  })

  test('桌面有供给楼盘首屏提供唯一可见咨询入口', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/buildings/west-nanjing-premium-center')

    await expect(
      page.locator('button[data-source-section="hero"]', { hasText: '询价 / 预约看房' }),
    ).toBeVisible()
    await expect(page.getByRole('region', { name: '询价操作栏' })).toBeHidden()
  })

  test('窄屏楼盘供给始终使用卡片', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    const response = await page.goto('/buildings/west-nanjing-premium-center')

    expect(response?.status()).toBe(200)
    const cards = page.locator('[data-listing-card-variant="building-supply"]')
    await expect(cards.first()).toBeVisible()
    expect(await cards.count()).toBeLessThanOrEqual(5)
    await expect(page.locator(`a[href$="/listings/${PUBLISHED_INEFFECTIVE_SLUG}"]`)).toHaveCount(0)
    await expect(page.locator('.building-supply-browser__table')).toHaveCount(0)
  })

  for (const viewport of DETAIL_VIEWPORTS) {
    test(`楼盘详情在 ${viewport.width}px 无横向溢出`, async ({ page }) => {
      await stubUnavailableSeedMedia(page)
      const runtimeErrors = collectPageRuntimeErrors(page)
      await page.setViewportSize(viewport)
      const response = await page.goto('/buildings/west-nanjing-premium-center?group=lease')

      expect(response?.status()).toBe(200)
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
      expect(await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      )).toBe(true)

      if (viewport.width <= 767) {
        const mobileBar = page.getByRole('region', { name: '询价操作栏' })
        await expect(mobileBar).toBeVisible()
        await expectMobileCtaDoesNotObscureLastContent(page)
      }

      expectNoPageRuntimeErrors(runtimeErrors)
    })
  }
})
