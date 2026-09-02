import { expect, test, type Page } from '@playwright/test'

import { blockUmamiScript } from './_umami-stub'

const LISTING_SLUG = 'jingan-serviced-office-42-seats'
const PRICE_ON_REQUEST_SLUG = 'jingan-price-on-request-300sqm'
const PUBLISHED_INEFFECTIVE_SLUG = 'jingan-published-pending-recheck'
const ROUTING_ENABLED = process.env.MULTI_CITY_ROUTING_ENABLED === 'true'
// 1024 与 1180 不是凑数：详情页两栏（主栏 + `--dt-side` 372 + 列间 32）总宽
// 1180，而 `.dt-container` 是 min(--dt-w, 100% - 32px)。视口 < 1212 时容器已
// 比 1180 窄，定宽轨道却不缩 → 横向溢出。区间是 1024–1195：1023 及以下塌单列
// 幸免，1212 及以上容器拿满幸免，**恰好整段落在原有 768/1440 两档之间**，
// 所以下面那条 scrollWidth <= clientWidth 断言存在归存在，从没在会红的宽度上
// 跑过。1024 取区间最左（曾溢出 172px），1180 取接近右端（曾溢出 16px，
// 用来钉住「差一点点」的回归）。删这两档等于把守卫关掉。
const DETAIL_VIEWPORTS = [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1180, height: 900 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
] as const
const KNOWN_UNAVAILABLE_SEED_MEDIA = [
  'building-facilities.jpg',
  'common-lounge.jpg',
  'cover-empty-building.jpg',
  'cover-west-nanjing-premium-center-3.jpg',
  'lobby-reception.jpg',
  'meeting-room.jpg',
  'workspace-open.jpg',
] as const
const browserErrors = new WeakMap<Page, string[]>()
const allowedBrowserErrors = new WeakMap<Page, RegExp[]>()

async function expectMobileCtaDoesNotObscureLastContent(page: Page) {
  // 前置条件：页面真的布局完了。少了这一步，下面的 scrollTo 可能在文档还不够高时
  // 发出——此时它是空操作，而随后长出来的内容让 lastContentBottom 停在未滚动时的值，
  // 断言假阳性（OPT-037 Task 8 之后 3~5 次偶发 1 次，失败值恒为同一个数）。
  await page.waitForLoadState('networkidle')
  const bounds = await page.evaluate(async () => {
    const nextFrame = () => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
    // 等文档高度不再增长（懒加载图片落位会把页面撑高）。
    let previousHeight = -1
    for (let i = 0; i < 30 && document.documentElement.scrollHeight !== previousHeight; i += 1) {
      previousHeight = document.documentElement.scrollHeight
      await nextFrame()
    }
    // 反复「滚到底 + 等一帧」直到 scrollY 稳定。单帧不够：页面在 hydration 与
    // 懒加载图片落位期间还在长高，而 OPT-037 Task 8 的 sticky 锚点条挂载时
    // Chromium 的 scroll anchoring 会再调一次 scrollY，可能把刚发出的 instant
    // 滚动整个吃掉——实测 3 次里偶发 1 次 scrollY 停在 0，measure 到的
    // lastContentBottom 就是未滚动时的值（5195 ≈ 最大滚动距离），假阳性。
    // 稳定判据用「连续两帧 scrollY 不变」，而不是「等于某个预期值」——
    // 后者要重新推导一遍页面高度，等于把被测逻辑抄进测试。
    let previousScrollY = -1
    for (let i = 0; i < 30 && window.scrollY !== previousScrollY; i += 1) {
      previousScrollY = window.scrollY
      window.scrollTo({
        top: document.documentElement.scrollHeight,
        // Chromium supports immediate scrolling; it avoids the site's smooth-scroll CSS.
        behavior: 'instant' as ScrollBehavior,
      })
      await nextFrame()
    }

    const mobileBar = document.querySelector<HTMLElement>('[role="region"][aria-label="询价操作栏"]')
    // 两个详情页的根类名不同：楼盘页仍是 `.detail`，房源页 OPT-037 Task 9 接线后
    // 换成 `.dt-page`（`.detail` 的 max-width:100% 会把 100vw 出血夹回容器宽）。
    // 取两者的直接子 section，末尾那个就是页尾最后一块内容。
    const content = Array.from(
      document.querySelectorAll<HTMLElement>('.detail > section, .dt-page > section'),
    ).at(-1)
    if (!mobileBar || !content) return null
    return {
      ctaTop: mobileBar.getBoundingClientRect().top,
      lastContentBottom: content.getBoundingClientRect().bottom,
    }
  })

  expect(bounds).not.toBeNull()
  expect(bounds!.lastContentBottom).toBeLessThanOrEqual(bounds!.ctaTop)
}

test.beforeEach(async ({ page }) => {
  // OPT-064：拦掉 Umami 采集脚本请求。CI 给了构建期 NEXT_PUBLIC_UMAMI_*（否则
  // 埋点接线验不到），于是每页都会去拉一个不可达域名的 script，
  // 在控制台留下 ERR_NAME_NOT_RESOLVED，把下面的「零错误」断言拖红。
  await blockUmamiScript(page)
  const errors: string[] = []
  browserErrors.set(page, errors)
  allowedBrowserErrors.set(page, [])
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  for (const filename of KNOWN_UNAVAILABLE_SEED_MEDIA) {
    await page.route(`**/api/media/file/${filename}?*`, (route) =>
      route.fulfill({ status: 204, body: '' }))
  }
})

test.afterEach(async ({ page }) => {
  const allowed = allowedBrowserErrors.get(page) ?? []
  const unexpected = (browserErrors.get(page) ?? [])
    .filter((error) => !allowed.some((pattern) => pattern.test(error)))
  expect(unexpected).toEqual([])
})

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
    // 概况面板通栏落在核心区（`.dt-core`）第 2 行，不是独立段落——
    // 决策簇（画廊 + 决策卡 + 概况）必须留在同一个网格里
    await expect(page.locator('.dt-core #overview')).toHaveCount(1)
    await expect(page.getByRole('link', { name: '查看楼盘' })).toBeVisible()
    await expect(
      page.locator('button[data-source-section="hero"]', { hasText: '询价 / 预约看房' }),
    ).toBeVisible()
  })

  test('存在但待复核的已发布房源仍统一返回 404', async ({ page, request }) => {
    // 夹具前置校验必须**带登录态**读。
    //
    // `Listings.access.read` 已把匿名读收窄到有效供给（未发布 / 未过审 /
    // 可见性冻结一律不可见），而本用例的夹具恰恰是「已发布 + 已过审 +
    // supplyVisibilityHold=pending_recheck」——匿名查它必然返回 []。
    //
    // 不能因此把前置校验删掉：它防的是**假绿**。夹具一旦缺失或状态漂了，
    // 下面那句 404 会因为「房源根本不存在」而通过，测到的就不再是
    // 「待复核房源被拦」这件事。所以换通道（登录）而不是降标准。
    const login = await request.post('/api/users/login', {
      data: { email: 'e2e-adm@example.com', password: 'Test1234!' },
      failOnStatusCode: false,
    })
    expect(login.status(), 'ADM 测试账号应成功登录（夹具前置校验需要登录态）').toBe(200)

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

    allowedBrowserErrors.set(page, [/Failed to load resource: the server responded with a status of 404/])
    const response = await page.goto(`/listings/${PUBLISHED_INEFFECTIVE_SLUG}`)

    expect(response?.status()).toBe(404)
  })

  test('价格面议房源不显示零元且窄屏没有水平溢出', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    const response = await page.goto(`/listings/${PRICE_ON_REQUEST_SLUG}`)

    expect(response?.status()).toBe(200)
    const heroPrice = page.locator('.dt-decision__price-num').first()
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

  // 与上一条互补：上一条在页面已可交互后合成 error 事件，走的是 React onError；
  // 这一条守护真实生产时序——SSR 出来的 <img> 一进 HTML 解析器就开始加载，可能
  // 早于本客户端组件 hydration 完成就 404。error 事件不冒泡，React 也不会为
  // hydration 之前错过的 load/error 补发事件，只挂 onError 会整段漏掉这个窗口，
  // 用户看到的是浏览器破图框而不是兜底（回归见 DetailGallery 的挂载时判定）。
  test('图片在 hydration 之前就加载失败时同样显示兜底', async ({ page }) => {
    await page.route('**/api/media/file/**', (route) => route.fulfill({ status: 404, body: '' }))
    allowedBrowserErrors.set(page, [
      /Failed to load resource: the server responded with a status of 404/,
    ])
    const response = await page.goto(`/listings/${LISTING_SLUG}`)

    expect(response?.status()).toBe(200)
    const imageItem = page.locator('.detail-gallery__item').first()
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
  // route.abort() 本身会让 Chromium 记一条 `Failed to load resource: net::ERR_FAILED`
  // 进 console.error。此前没暴露，是因为地图**滚入视口才加载**（IntersectionObserver）：
  // 未筛选的楼盘页足够长，地图在折叠线以下，请求根本不发生。OPT-037 Task 7 把筛选从
  // 内存态改成真实导航后，筛完表格收缩、页面变短，地图进了视口——于是 abort 真的发生，
  // 守卫被这条我们自己制造的错误打红（本地与 CI 一致，非 flake）。
  // 这里只豁免这一条：它是上面 route abort 的直接产物，不是被测代码的问题。
  test.beforeEach(async ({ page }) => {
    await page.route('**/webapi.amap.com/**', (route) => route.abort())
    allowedBrowserErrors.set(page, [/Failed to load resource: net::ERR_FAILED/])
  })

  test('楼盘页按有效供给显示在租房源表格', async ({ page }) => {
    const response = await page.goto('/buildings/west-nanjing-premium-center')

    expect(response?.status()).toBe(200)
    await expect(page.getByRole('heading', { name: '在租房源' })).toBeVisible()
    const rows = page.locator('.building-supply-browser__table tbody tr')
    await expect(rows.first()).toBeVisible()
    await expect(page.locator(`a[href$="/listings/${LISTING_SLUG}"]`).first()).toBeVisible()
    await expect(page.locator(`a[href$="/listings/${PUBLISHED_INEFFECTIVE_SLUG}"]`)).toHaveCount(0)
  })

  /**
   * 面积/价格筛选在 OPT-037 Task 7 从客户端内存态迁移到 URL：控件从
   * `button + aria-pressed` 变成真实导航链接 `Link + aria-current`
   * （`aria-pressed` 只在 `role="button"` 下有效，这些是真实链接，不许挂
   * `role="button"`）。价格分桶是**迁移**不是删除——`priceMin`/`priceMax`
   * 现在与 `priceUnit` 一起进 URL，见 BuildingSupplyBrowser.tsx。
   */
  test('楼盘供给分桶筛选默认全选且切换后进 URL', async ({ page }) => {
    await page.goto('/buildings/west-nanjing-premium-center')
    const canonicalJsonLd = await page.locator('script[type="application/ld+json"]').textContent()
    const areaGroup = page.getByRole('group', { name: '按面积筛选' })
    const priceGroup = page.getByRole('group', { name: '按价格筛选' })
    await expect(areaGroup).toBeVisible()
    await expect(priceGroup).toBeVisible()
    // 真实链接的当前态用 aria-current；全站不得再出现 aria-pressed 版本
    await expect(areaGroup.getByRole('link', { name: '全部' })).toHaveAttribute('aria-current', 'true')
    await expect(priceGroup.getByRole('link', { name: '全部' })).toHaveAttribute('aria-current', 'true')
    await expect(page.locator('.building-supply-browser [aria-pressed]')).toHaveCount(0)

    // 切换到任一非「全部」面积桶：真实导航，参数进 URL，激活态跟着走
    const areaBucket = areaGroup.getByRole('link').nth(1)
    const areaBucketLabel = (await areaBucket.textContent())?.trim() ?? ''
    await areaBucket.click()
    await expect(page).toHaveURL(/[?&]area(Min|Max)=/)
    await expect(areaGroup.getByRole('link', { name: areaBucketLabel })).toHaveAttribute('aria-current', 'true')

    // 价格桶必须带上 priceUnit —— 单位闸门：不同计价单位之间不可比价
    const priceBucket = priceGroup.getByRole('link').nth(1)
    const priceBucketLabel = (await priceBucket.textContent())?.trim() ?? ''
    await priceBucket.click()
    await expect(page).toHaveURL(/[?&]priceUnit=rmb-sqm-day/)
    await expect(page).toHaveURL(/[?&]price(Min|Max)=/)
    await expect(priceGroup.getByRole('link', { name: priceBucketLabel })).toHaveAttribute('aria-current', 'true')

    // 聚合 JSON-LD 走未过滤口径，筛选不得改变它
    expect(await page.locator('script[type="application/ld+json"]').textContent()).toBe(canonicalJsonLd)
  })

  /**
   * 筛到空结果不得变成死路：控件区必须还在，用户才能取消刚点下的筛选。
   */
  test('楼盘供给筛到空结果时筛选控件仍在且可取消', async ({ page }) => {
    // 先落到真实路由（多城路由开启时 /buildings/... 会 301 到 /<city>/buildings/...，
    // 而 redirect() 不带 query），再在最终 URL 上加参数——否则筛选参数会被重定向吃掉。
    await page.goto('/buildings/west-nanjing-premium-center')
    // 面积区间刻意取一个楼内不可能命中的值
    await page.goto(`${page.url()}?areaMin=999999`)

    await expect(page.getByText('当前筛选下暂无匹配空间')).toBeVisible()
    const areaGroup = page.getByRole('group', { name: '按面积筛选' })
    await expect(areaGroup).toBeVisible()
    await expect(page.getByRole('group', { name: '排序' })).toBeVisible()
    // 聚合区取未过滤口径，因此空结果时仍有内容
    await expect(page.getByText('面积区间')).toBeVisible()

    await areaGroup.getByRole('link', { name: '全部' }).click()
    await expect(page.locator('.building-supply-browser__table')).toBeVisible()
  })

  test('empty-building exposes the no-public-supply state', async ({ page }) => {
    const response = await page.goto('/buildings/empty-building')

    expect(response?.status()).toBe(200)
    await expect(page.getByText('当前暂无公开可选空间').first()).toBeVisible()
    await expect(page.getByText('最低价', { exact: false })).toHaveCount(0)
    await expect(page.locator('.building-supply-browser__filter')).toHaveCount(0)
    await expect(
      page.locator('button[data-source-section="hero"]', { hasText: '登记找房需求' }),
    ).toBeVisible()
  })

  test('待复核房源不进入楼盘公开供给', async ({ page }) => {
    const response = await page.goto('/buildings/west-nanjing-premium-center')

    expect(response?.status()).toBe(200)
    await expect(page.locator(`a[href$="/listings/${PUBLISHED_INEFFECTIVE_SLUG}"]`)).toHaveCount(0)
    await expect(page.locator('.building-supply-browser__filter').first()).toBeVisible()
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
    await expect(page.locator(`a[href$="/listings/${LISTING_SLUG}"]`).first()).toBeVisible()
    await expect(page.locator(`a[href$="/listings/${PUBLISHED_INEFFECTIVE_SLUG}"]`)).toHaveCount(0)
    await expect(page.locator('.building-supply-browser__table')).toHaveCount(0)
  })

  /**
   * 稿子落地数值 + 触控规范：视觉高度按稿子（筛选 pill 32），命中盒补到 44。
   * 二者不是二选一，所以两条都断言——只测其中一条会让另一条被静默改掉。
   */
  test('筛选 pill 视觉 32 / 命中盒 44 且不被横滑容器裁掉', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/buildings/west-nanjing-premium-center')
    const pill = page.locator('.building-supply-browser__filter').first()
    const measured = await pill.evaluate((el) => {
      const after = getComputedStyle(el, '::after')
      const group = el.closest('.building-supply-browser__filter-group')!
      const p = el.getBoundingClientRect()
      const g = group.getBoundingClientRect()
      return {
        visualHeight: p.height,
        afterTop: after.top,
        afterBottom: after.bottom,
        hitTop: p.top - 6,
        hitBottom: p.bottom + 6,
        groupTop: g.top,
        groupBottom: g.bottom,
      }
    })
    expect(Math.round(measured.visualHeight)).toBe(32)
    expect(measured.afterTop).toBe('-6px')
    expect(measured.afterBottom).toBe('-6px')
    // 横滑容器 `overflow-x:auto` 会把另一轴一并算成 auto，纵向 padding 不够就会裁掉命中盒
    expect(measured.hitTop).toBeGreaterThanOrEqual(measured.groupTop - 0.5)
    expect(measured.hitBottom).toBeLessThanOrEqual(measured.groupBottom + 0.5)
  })

  test('供给行高不低于稿子的 56', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/buildings/west-nanjing-premium-center')
    const row = page.locator('.building-supply-browser__table tbody tr').first()
    expect(await row.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(56)
  })

  /**
   * footer 三件事必须都真渲染：「共 M」是未过滤口径（与 tab 计数、聚合区同源）、
   * 「当前筛选 N 条」是结果集口径、asOf 是数据诚实性元素（不能只活在 data- 属性里）。
   */
  test('供给区 footer 同时给出未过滤总数、当前筛选数与快照日期', async ({ page }) => {
    await page.goto('/buildings/west-nanjing-premium-center')
    const footnote = page.locator('.building-supply-browser__footnote')
    await expect(footnote).toBeVisible()
    const text = (await footnote.textContent()) ?? ''
    expect(text).toMatch(/共 \d+ /)
    expect(text).toMatch(/当前筛选 \d+ 条/)
    expect(text).toMatch(/数据截至 \d{4}-\d{2}-\d{2}/)
  })

  for (const viewport of DETAIL_VIEWPORTS) {
    test(`楼盘详情在 ${viewport.width}px 无横向溢出`, async ({ page }) => {
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
    })
  }
})
