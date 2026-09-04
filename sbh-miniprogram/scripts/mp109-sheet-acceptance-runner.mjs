import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import automator from 'miniprogram-automator'

import {
  ACCEPTANCE_FIXTURE_ID,
  createAcceptanceServer,
} from './acceptance-mock-server.mjs'

const stateNames = [
  'filterPrice',
  'filterAll',
  'homeInquiry',
  'buildingsInquiry',
  'inquiryWechat',
  'inquiryManual',
  'inquiryKeyboard',
  'inquiryError',
  'inquirySubmitting',
  'inquirySuccess',
]

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDirectory, '..')
const artifactsDir = resolve(projectRoot, '../artifacts/verification/MP-109')
const screenshotsDir = join(artifactsDir, 'sheet-screenshots')
const reportPath = join(artifactsDir, 'sheet-acceptance-report.json')
const profileReportPaths = Object.freeze({
  small: join(artifactsDir, 'sheet-acceptance-small.json'),
  large: join(artifactsDir, 'sheet-acceptance-large.json'),
})
const viewportProfiles = Object.freeze({
  small: Object.freeze({ maxWidth: 375 }),
  large: Object.freeze({ minWidth: 400 }),
})
let activeViewportProfile = 'current'
const evidenceRevision = createHash('sha256')
  .update(readFileSync(fileURLToPath(import.meta.url)))
  .digest('hex')
  .slice(0, 16)

function finite(value) {
  const parsed = typeof value === 'string' ? Number.parseFloat(value) : value
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null
}

function safeRect(value) {
  if (typeof value !== 'object' || value === null) return null
  const left = finite(value.left)
  const right = finite(value.right)
  const top = finite(value.top)
  const bottom = finite(value.bottom)
  if ([left, right, top, bottom].some((item) => item === null)) return null
  return { left, right, top, bottom }
}

function positiveRect(rect) {
  return typeof rect === 'object'
    && rect !== null
    && rect.right > rect.left
    && rect.bottom > rect.top
}

function rectInsideRect(rect, container, tolerance = 1) {
  return positiveRect(rect)
    && positiveRect(container)
    && rect.left >= container.left - tolerance
    && rect.right <= container.right + tolerance
    && rect.top >= container.top - tolerance
    && rect.bottom <= container.bottom + tolerance
}

export function evaluateSheetGeometry(input) {
  const failures = []
  if (typeof input !== 'object' || input === null) {
    return { passed: false, failures: ['geometry input missing'] }
  }
  const viewport = safeRect({
    left: 0,
    top: 0,
    right: input.viewport?.width,
    bottom: input.viewport?.height,
  })
  const panel = safeRect(input.panel)
  const header = safeRect(input.header)
  const body = safeRect(input.body)
  const footer = safeRect(input.footer)
  const close = safeRect(input.close)
  const primaryAction = input.primaryAction ? safeRect(input.primaryAction) : null

  if (input.requiredSelectorsPresent !== true) failures.push('required selector missing')
  if (input.tabBarVisible !== false) failures.push('native TabBar still visible')
  if (input.expectedSectionOnly !== true) failures.push('unexpected filter section visible')
  if (![viewport, panel, header, body, footer, close].every(positiveRect)) failures.push('invalid or non-positive geometry')

  if (viewport && panel) {
    if (panel.left < -1 || panel.right > viewport.right + 1) failures.push('panel horizontally clipped')
    if (panel.top < -1 || panel.bottom > viewport.bottom + 1) failures.push('panel outside viewport')
  }
  if (viewport && footer && panel) {
    if (!rectInsideRect(footer, panel)) failures.push('footer outside panel')
    if (footer.top < panel.top || footer.bottom > viewport.bottom + 1) failures.push('footer outside safe viewport')
  }
  if (header && panel && !rectInsideRect(header, panel)) failures.push('header outside panel')
  if (body && panel && !rectInsideRect(body, panel)) failures.push('body outside panel')
  if (body && header && body.top < header.bottom - 1) failures.push('body overlaps header')
  if (body && footer && body.bottom > footer.top + 1) failures.push('body overlaps footer')
  if (viewport && close && panel && header) {
    if (!rectInsideRect(close, panel) || !rectInsideRect(close, header)) failures.push('close target outside panel header')
    if (close.right - close.left < 44 || close.bottom - close.top < 44) failures.push('close target below 44pt')
    if (panel.right - close.right > 32) failures.push('close target not right-aligned')
  }
  if (input.primaryAction && viewport) {
    const safeAreaBottomInset = finite(input.safeAreaBottomInset) ?? 0
    if (!positiveRect(primaryAction)) failures.push('invalid primary CTA geometry')
    else {
      if (!rectInsideRect(primaryAction, footer) || !rectInsideRect(primaryAction, panel)) failures.push('primary CTA outside footer panel')
      if (primaryAction.left < -1 || primaryAction.right > viewport.right + 1) failures.push('primary CTA horizontally clipped')
      if (primaryAction.bottom > viewport.bottom - safeAreaBottomInset + 1) failures.push('primary CTA overlaps bottom safe area')
    }
  }

  return { passed: failures.length === 0, failures }
}

export function assertMp109SheetAcceptance(report) {
  if (typeof report !== 'object' || report === null || report.status !== 'passed') {
    throw new Error('MP-109 抽屉验收状态不是 passed')
  }
  if (typeof report.states !== 'object' || report.states === null) {
    throw new Error('MP-109 抽屉验收缺少 states')
  }
  for (const name of stateNames) {
    if (report.states[name]?.passed !== true) {
      throw new Error(`MP-109 抽屉验收失败或缺失：${name}`)
    }
  }
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}

async function waitUntil(label, read, predicate, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs
  let latest
  while (Date.now() < deadline) {
    latest = await read()
    if (predicate(latest)) return latest
    await delay(100)
  }
  throw new Error(`${label} 超时；最后状态：${JSON.stringify(latest)}`)
}

async function requireSelector(subject, selector) {
  const element = await subject.$(selector)
  if (!element) throw new Error(`MP-109 关键 selector 缺失：${selector}`)
  return element
}

async function elementRect(element) {
  const [size, offset] = await Promise.all([element.size(), element.offset()])
  const width = finite(size.width)
  const height = finite(size.height)
  const left = finite(offset?.left ?? offset?.x)
  const top = finite(offset?.top ?? offset?.y)
  if ([width, height, left, top].some((value) => value === null)) {
    throw new Error(`MP-109 元素几何无效：${JSON.stringify({ size, offset })}`)
  }
  return { left, top, right: left + width, bottom: top + height }
}

async function sheetGeometry({ page, componentName, selectors, viewport, safeAreaBottomInset, tabBarVisible, expectedSectionOnly }) {
  const component = await requireSelector(page, componentName)
  const [panel, header, footer, close, body, primaryAction] = await Promise.all([
    requireSelector(component, selectors.panel),
    requireSelector(component, selectors.header),
    requireSelector(component, selectors.footer),
    requireSelector(component, selectors.close),
    requireSelector(component, selectors.body),
    requireSelector(component, selectors.primaryAction),
  ])
  const result = evaluateSheetGeometry({
    viewport,
    panel: await elementRect(panel),
    header: await elementRect(header),
    body: await elementRect(body),
    footer: await elementRect(footer),
    close: await elementRect(close),
    primaryAction: await elementRect(primaryAction),
    safeAreaBottomInset,
    requiredSelectorsPresent: Boolean(header && body && primaryAction),
    tabBarVisible,
    expectedSectionOnly,
  })
  return {
    ...result,
    geometry: {
      panel: await elementRect(panel),
      header: await elementRect(header),
      footer: await elementRect(footer),
      close: await elementRect(close),
      body: await elementRect(body),
      primaryAction: await elementRect(primaryAction),
    },
  }
}

async function screenshot(miniProgram, name) {
  const fileName = `${name}.png`
  const profileDirectory = join(screenshotsDir, activeViewportProfile)
  mkdirSync(profileDirectory, { recursive: true })
  await miniProgram.screenshot({ path: join(profileDirectory, fileName) })
  return `${activeViewportProfile}/${fileName}`
}

function resolveViewportProfile(system) {
  const requested = process.env.MP109_VIEWPORT_PROFILE
  if (requested !== 'small' && requested !== 'large') {
    throw new Error('MP109_VIEWPORT_PROFILE 必须显式设置为 small 或 large')
  }
  const screenWidth = finite(system.screenWidth)
  if (screenWidth === null) throw new Error('MP-109 无法读取设备屏幕宽度')
  const definition = viewportProfiles[requested]
  const passed = requested === 'small'
    ? screenWidth <= definition.maxWidth
    : screenWidth >= definition.minWidth
  if (!passed) {
    throw new Error(`MP-109 ${requested} 设备宽度不符合门槛：${screenWidth}`)
  }
  activeViewportProfile = requested
  return { name: requested, screenWidth, passed: true }
}

async function clientViewport(page) {
  const size = await page.size()
  const normalized = { width: finite(size?.width), height: finite(size?.height) }
  if (normalized.width === null || normalized.height === null) {
    throw new Error(`MP-109 无法读取 WebView 可视区：${JSON.stringify(size)}`)
  }
  return normalized
}

async function observeNativeTabBar(page, expandedViewport, visibleViewport = null) {
  const current = await clientViewport(page)
  const tabBarVisible = visibleViewport
    ? Math.abs(current.height - visibleViewport.height) <= 2
    : current.height < expandedViewport.height - 24
  return {
    tabBarVisible,
    current,
    expandedViewport,
    visibleViewport,
  }
}

export async function probeAcceptanceServer(port) {
  const response = await fetch(`http://127.0.0.1:${port}/__acceptance-health`, {
    signal: AbortSignal.timeout(1_500),
  })
  const payload = await response.json()
  const fixtureHeader = response.headers.get('x-sbh-acceptance-fixture-id')
  if (
    response.status !== 200
    || fixtureHeader !== ACCEPTANCE_FIXTURE_ID
    || payload?.fixtureId !== ACCEPTANCE_FIXTURE_ID
    || payload?.ok !== true
  ) {
    throw new Error(`3717 端口不是受控 MP-109 fixture：${JSON.stringify({ fixtureHeader, payload })}`)
  }
}

function cleanInquiryFixture(snapshot, phoneMode) {
  return {
    ...snapshot,
    state: phoneMode === 'manual' ? 'manual' : 'choosing-phone',
    submissionRequestId: snapshot?.submissionRequestId ?? '00000000-0000-4000-8000-000000000109',
    phoneMode,
    privacyStatus: 'available',
    errorReason: null,
    errorMessage: '',
    busy: false,
    submitDisabled: true,
    phoneSubmitDisabled: true,
    manualSubmitDisabled: true,
  }
}

async function runInteractiveAcceptance(miniProgram) {
  const system = await miniProgram.systemInfo()
  const viewportProfile = resolveViewportProfile(system)
  const systemViewport = {
    width: finite(system.windowWidth),
    height: finite(system.windowHeight),
  }
  if (systemViewport.width === null || systemViewport.height === null) {
    throw new Error(`MP-109 无法读取视口：${JSON.stringify(system)}`)
  }
  const safeAreaBottomInset = Math.max(
    0,
    (finite(system.screenHeight) ?? 0) - (finite(system.safeArea?.bottom) ?? 0),
  )

  const states = {}
  const listings = await miniProgram.reLaunch('/pages/listings/index')
  if (!listings) throw new Error('MP-109 无法打开找房页')
  await listings.waitFor('#listings-ready')
  await waitUntil('找房页 ready', () => listings.data(), (data) => data.state === 'ready')
  const visibleTabViewport = await clientViewport(listings)

  const filterBar = await requireSelector(listings, '#filter-bar')
  const priceFilter = await requireSelector(filterBar, '.filter-bar__item[data-section="price"]')
  await priceFilter.tap()
  const priceData = await waitUntil(
    '价格抽屉打开',
    () => listings.data(),
    (data) => data.sheetOpen === true && data.sheetSection === 'price' && data.tabBarBoundaryState === 'hidden',
  )
  await delay(240)
  const filterViewport = await clientViewport(listings)
  const priceTabBar = await observeNativeTabBar(listings, filterViewport, visibleTabViewport)
  const priceSheet = await requireSelector(listings, '#filter-sheet')
  const priceOnly = Boolean(await priceSheet.$('.filter-sheet__unit'))
    && Boolean(await priceSheet.$('.filter-sheet__price-range'))
    && !await priceSheet.$('.filter-sheet__location')
    && !await priceSheet.$('.filter-sheet__area')
    && !await priceSheet.$('.filter-sheet__type')
  states.filterPrice = {
    ...(await sheetGeometry({
      page: listings,
      componentName: '#filter-sheet',
      selectors: {
        panel: '.filter-sheet__panel', header: '.filter-sheet__header', footer: '.filter-sheet__footer',
        close: '.filter-sheet__close', body: '.filter-sheet__body', primaryAction: '.filter-sheet__apply',
      },
      viewport: filterViewport,
      safeAreaBottomInset,
      tabBarVisible: priceTabBar.tabBarVisible,
      expectedSectionOnly: priceOnly,
    })),
    resultCount: priceData.estimatedCount,
    nativeTabBar: priceTabBar,
    screenshot: await screenshot(miniProgram, 'filter-price-open'),
  }

  await (await requireSelector(priceSheet, '.filter-sheet__close')).tap()
  await waitUntil(
    '价格抽屉关闭并恢复 TabBar',
    () => listings.data(),
    (data) => data.sheetOpen === false && data.tabBarBoundaryState === 'visible',
  )
  const priceCloseTabBar = await observeNativeTabBar(listings, filterViewport, visibleTabViewport)
  if (!priceCloseTabBar.tabBarVisible) throw new Error('价格抽屉关闭后原生 TabBar 未恢复')

  const allFilter = await requireSelector(filterBar, '.filter-bar__item[data-section="all"]')
  await allFilter.tap()
  const allData = await waitUntil(
    '全部筛选打开',
    () => listings.data(),
    (data) => data.sheetOpen === true && data.sheetSection === 'all' && data.tabBarBoundaryState === 'hidden',
  )
  await delay(240)
  const allSheet = await requireSelector(listings, '#filter-sheet')
  const allBody = await requireSelector(allSheet, '.filter-sheet__body')
  const allFooter = await requireSelector(allSheet, '.filter-sheet__footer')
  const footerBeforeScroll = await elementRect(allFooter)
  const allScreenshot = await screenshot(miniProgram, 'filter-all-open')
  const scrollHeight = await allBody.scrollHeight()
  await allBody.scrollTo(0, Math.max(200, finite(scrollHeight) ?? 200))
  await delay(120)
  const footerAfterScroll = await elementRect(allFooter)
  const allSections = Boolean(await allSheet.$('.filter-sheet__unit'))
    && Boolean(await allSheet.$('.filter-sheet__location'))
    && Boolean(await allSheet.$('.filter-sheet__area'))
    && Boolean(await allSheet.$('.filter-sheet__type'))
    && Boolean(await allSheet.$('.filter-sheet__available'))
  const allGeometry = await sheetGeometry({
    page: listings,
    componentName: '#filter-sheet',
    selectors: {
      panel: '.filter-sheet__panel', header: '.filter-sheet__header', footer: '.filter-sheet__footer',
      close: '.filter-sheet__close', body: '.filter-sheet__body', primaryAction: '.filter-sheet__apply',
    },
    viewport: filterViewport,
    safeAreaBottomInset,
    tabBarVisible: (await observeNativeTabBar(listings, filterViewport, visibleTabViewport)).tabBarVisible,
    expectedSectionOnly: allSections,
  })
  if (Math.abs(footerBeforeScroll.top - footerAfterScroll.top) > 1) {
    allGeometry.failures.push('footer moved with internal scroll')
    allGeometry.passed = false
  }
  states.filterAll = {
    ...allGeometry,
    scrollHeight: finite(scrollHeight),
    footerFixed: Math.abs(footerBeforeScroll.top - footerAfterScroll.top) <= 1,
    screenshot: allScreenshot,
  }
  await (await requireSelector(allSheet, '.filter-sheet__backdrop')).tap()
  await waitUntil(
    '遮罩关闭筛选并恢复 TabBar',
    () => listings.data(),
    (data) => data.sheetOpen === false && data.tabBarBoundaryState === 'visible',
  )
  const allCloseTabBar = await observeNativeTabBar(listings, filterViewport, visibleTabViewport)
  if (!allCloseTabBar.tabBarVisible) throw new Error('全部筛选关闭后原生 TabBar 未恢复')

  const inquirySelectors = {
    panel: '.inquiry-sheet__panel', header: '.inquiry-sheet__header', footer: '.inquiry-sheet__footer',
    close: '.inquiry-sheet__close', body: '.inquiry-sheet__body', primaryAction: '.inquiry-sheet__submit',
  }

  const home = await miniProgram.switchTab('/pages/home/index')
  if (!home) throw new Error('MP-109 无法打开首页')
  await home.waitFor('#home-ready')
  await waitUntil('首页 ready', () => home.data(), (data) => data.state === 'ready')
  const homeVisibleViewport = await clientViewport(home)
  const homeInquiryCta = await requireSelector(home, '.home-entrust-card__action')
  await homeInquiryCta.tap()
  const homeOpened = await waitUntil(
    '首页咨询抽屉打开',
    () => home.data(),
    (data) => data.inquiryOpen === true && data.tabBarBoundaryState === 'hidden',
  )
  const homeCleanFixture = cleanInquiryFixture(homeOpened.inquirySheet, 'wechat')
  await home.setData({ inquiryOpen: true, inquirySheet: homeCleanFixture })
  await delay(180)
  const homeTabBar = await observeNativeTabBar(home, filterViewport, homeVisibleViewport)
  const homeSheet = await requireSelector(home, '#inquiry-sheet')
  states.homeInquiry = {
    ...(await sheetGeometry({
      page: home,
      componentName: '#inquiry-sheet',
      selectors: inquirySelectors,
      viewport: filterViewport,
      safeAreaBottomInset,
      tabBarVisible: homeTabBar.tabBarVisible,
      expectedSectionOnly: Boolean(await homeSheet.$('.inquiry-sheet__wechat-submit')),
    })),
    openedByRealTap: true,
    nativeTabBar: homeTabBar,
    screenshot: await screenshot(miniProgram, 'home-inquiry-open'),
  }
  await (await requireSelector(homeSheet, '.inquiry-sheet__backdrop')).tap()
  await waitUntil('首页咨询关闭', () => home.data(), (data) => data.inquiryOpen === false)
  const homeRestoredTabBar = await observeNativeTabBar(home, filterViewport, homeVisibleViewport)
  if (!homeRestoredTabBar.tabBarVisible) throw new Error('首页咨询关闭后原生 TabBar 未恢复')

  const buildings = await miniProgram.switchTab('/pages/buildings/index')
  if (!buildings) throw new Error('MP-109 无法打开楼盘页')
  await buildings.waitFor('#buildings-ready')
  await waitUntil('楼盘页 ready', () => buildings.data(), (data) => data.state === 'ready')
  const buildingsVisibleViewport = await clientViewport(buildings)
  const buildingsInquiryCta = await requireSelector(buildings, '.buildings-advisor-card__action')
  await buildingsInquiryCta.tap()
  const buildingsOpened = await waitUntil(
    '楼盘咨询抽屉打开',
    () => buildings.data(),
    (data) => data.inquiryOpen === true && data.tabBarBoundaryState === 'hidden',
  )
  const buildingsCleanFixture = cleanInquiryFixture(buildingsOpened.inquirySheet, 'wechat')
  await buildings.setData({ inquiryOpen: true, inquirySheet: buildingsCleanFixture })
  await delay(180)
  const buildingsTabBar = await observeNativeTabBar(buildings, filterViewport, buildingsVisibleViewport)
  const buildingsSheet = await requireSelector(buildings, '#inquiry-sheet')
  states.buildingsInquiry = {
    ...(await sheetGeometry({
      page: buildings,
      componentName: '#inquiry-sheet',
      selectors: inquirySelectors,
      viewport: filterViewport,
      safeAreaBottomInset,
      tabBarVisible: buildingsTabBar.tabBarVisible,
      expectedSectionOnly: Boolean(await buildingsSheet.$('.inquiry-sheet__wechat-submit')),
    })),
    openedByRealTap: true,
    nativeTabBar: buildingsTabBar,
    screenshot: await screenshot(miniProgram, 'buildings-inquiry-open'),
  }
  await (await requireSelector(buildingsSheet, '.inquiry-sheet__backdrop')).tap()
  await waitUntil('楼盘咨询关闭', () => buildings.data(), (data) => data.inquiryOpen === false)
  const buildingsRestoredTabBar = await observeNativeTabBar(buildings, filterViewport, buildingsVisibleViewport)
  if (!buildingsRestoredTabBar.tabBarVisible) throw new Error('楼盘咨询关闭后原生 TabBar 未恢复')

  const activeListings = await miniProgram.switchTab('/pages/listings/index')
  if (!activeListings) throw new Error('MP-109 无法返回找房页')
  await activeListings.waitFor('#listings-ready')
  await waitUntil('返回找房页 ready', () => activeListings.data(), (data) => data.state === 'ready')
  const listingsData = await activeListings.data()
  const targetSlug = listingsData.items?.[0]?.slug
  if (typeof targetSlug !== 'string' || !targetSlug) throw new Error('MP-109 缺少可打开的房源夹具')
  const listingDetail = await miniProgram.navigateTo(`/pages/listing-detail/index?slug=${encodeURIComponent(targetSlug)}`)
  if (!listingDetail) throw new Error('MP-109 无法打开房源详情')
  await listingDetail.waitFor('#listing-detail-ready')
  await waitUntil('房源详情 ready', () => listingDetail.data(), (data) => data.state === 'ready')
  const inquiryCta = await requireSelector(listingDetail, '.listing-detail__bar-action--inquiry')
  await inquiryCta.tap()
  const openedInquiry = await waitUntil(
    '咨询抽屉打开',
    () => listingDetail.data(),
    (data) => data.inquiryOpen === true,
  )
  const cleanWechatFixture = {
    ...openedInquiry.inquirySheet,
    state: 'choosing-phone',
    submissionRequestId: openedInquiry.inquirySheet?.submissionRequestId ?? '00000000-0000-4000-8000-000000000109',
    phoneMode: 'wechat',
    privacyStatus: 'available',
    errorReason: null,
    errorMessage: '',
    busy: false,
    submitDisabled: true,
    phoneSubmitDisabled: true,
    manualSubmitDisabled: true,
  }
  await listingDetail.setData({ inquiryOpen: true, inquirySheet: cleanWechatFixture })
  await delay(240)
  const inquiryViewport = await clientViewport(listingDetail)
  const detailTabBar = await observeNativeTabBar(listingDetail, filterViewport)

  states.inquiryWechat = {
    ...(await sheetGeometry({
      page: listingDetail,
      componentName: '#inquiry-sheet',
      selectors: inquirySelectors,
      viewport: inquiryViewport,
      safeAreaBottomInset,
      tabBarVisible: detailTabBar.tabBarVisible,
      expectedSectionOnly: Boolean(await (await requireSelector(listingDetail, '#inquiry-sheet')).$('.inquiry-sheet__wechat-submit')),
    })),
    openedByRealTap: true,
    actualOpenState: openedInquiry.inquirySheet?.state,
    evidenceMode: 'real-tap-open-with-local-devtools-visual-fixture',
    nativeTabBar: detailTabBar,
    screenshot: await screenshot(miniProgram, 'inquiry-wechat'),
  }

  let inquirySheet = await requireSelector(listingDetail, '#inquiry-sheet')
  await (await requireSelector(inquirySheet, '.inquiry-sheet__manual-entry')).tap()
  let manualData = await waitUntil(
    '咨询手填模式',
    () => listingDetail.data(),
    (data) => data.inquirySheet?.phoneMode === 'manual',
  )
  const cleanManualFixture = {
    ...manualData.inquirySheet,
    state: 'manual',
    submissionRequestId: manualData.inquirySheet?.submissionRequestId ?? cleanWechatFixture.submissionRequestId,
    phoneMode: 'manual',
    privacyStatus: 'available',
    errorReason: null,
    errorMessage: '',
    busy: false,
    submitDisabled: true,
    phoneSubmitDisabled: true,
    manualSubmitDisabled: true,
  }
  await listingDetail.setData({ inquiryOpen: true, inquirySheet: cleanManualFixture })
  manualData = await listingDetail.data()
  await delay(120)
  inquirySheet = await requireSelector(listingDetail, '#inquiry-sheet')
  states.inquiryManual = {
    ...(await sheetGeometry({
      page: listingDetail,
      componentName: '#inquiry-sheet',
      selectors: inquirySelectors,
      viewport: inquiryViewport,
      safeAreaBottomInset,
      tabBarVisible: (await observeNativeTabBar(listingDetail, filterViewport)).tabBarVisible,
      expectedSectionOnly: Boolean(await inquirySheet.$('.inquiry-sheet__phone')),
    })),
    phoneMode: manualData.inquirySheet.phoneMode,
    openedByRealTap: true,
    evidenceMode: 'real-mode-tap-with-local-devtools-visual-fixture',
    screenshot: await screenshot(miniProgram, 'inquiry-manual'),
  }

  const phoneInput = await requireSelector(inquirySheet, '.inquiry-sheet__phone')
  const preFocusInputRect = await elementRect(phoneInput)
  const inputVisibleBeforeTap = preFocusInputRect.top >= 0
    && preFocusInputRect.bottom <= inquiryViewport.height + 1
  await phoneInput.tap()
  let focusedByRealTap = false
  try {
    await waitUntil(
      '咨询手机号输入聚焦',
      () => inquirySheet.data(),
      (data) => data.focusedField === 'phone',
      1_500,
    )
    focusedByRealTap = true
  } catch {
    // DevTools 不支持真实软键盘时保留失败态，继续收集其余视觉证据。
  }
  await delay(320)
  const keyboardViewport = await clientViewport(listingDetail)
  const keyboardInputRect = await elementRect(phoneInput)
  const keyboardFooter = await elementRect(await requireSelector(inquirySheet, '.inquiry-sheet__footer'))
  const keyboardViewportDelta = inquiryViewport.height - keyboardViewport.height
  const keyboardVisible = keyboardInputRect.bottom <= keyboardViewport.height + 1
    && keyboardFooter.bottom <= keyboardViewport.height + 1
    && keyboardViewportDelta >= 80
    && inputVisibleBeforeTap
    && focusedByRealTap
  states.inquiryKeyboard = {
    passed: keyboardVisible,
    failures: keyboardVisible
      ? []
      : ['keyboard did not materially shrink viewport or focused controls are obscured'],
    focusedField: focusedByRealTap ? 'phone' : '',
    focusedByRealTap,
    inputVisibleBeforeTap,
    preFocusViewport: inquiryViewport,
    viewport: keyboardViewport,
    keyboardViewportDelta,
    input: keyboardInputRect,
    footer: keyboardFooter,
    screenshot: await screenshot(miniProgram, 'inquiry-keyboard-focus'),
  }
  await miniProgram.callWxMethod('hideKeyboard').catch(() => undefined)
  await delay(220)

  const visualBase = manualData.inquirySheet
  const visualFixtures = [
    ['inquiryError', {
      ...visualBase,
      state: 'recoverable-error', busy: false, errorReason: 'network',
      errorMessage: '网络连接失败，请检查网络后重试', privacyStatus: 'unavailable',
      consentAccepted: false, submitDisabled: true, phoneSubmitDisabled: true, manualSubmitDisabled: true,
    }, 'inquiry-error'],
    ['inquirySubmitting', {
      ...visualBase,
      state: 'submitting', busy: true, privacyStatus: 'available', consentAccepted: true,
      submitDisabled: true, phoneSubmitDisabled: true, manualSubmitDisabled: true,
    }, 'inquiry-submitting'],
    ['inquirySuccess', {
      ...visualBase,
      state: 'success', busy: false, successMessage: '已收到该房源咨询',
      successFollowUp: '已记录本次提交，可稍后查看处理进度',
      submitDisabled: true, phoneSubmitDisabled: true, manualSubmitDisabled: true,
    }, 'inquiry-success'],
  ]

  for (const [name, fixture, screenshotName] of visualFixtures) {
    await listingDetail.setData({ inquiryOpen: true, inquirySheet: fixture })
    await delay(160)
    const activeSheet = await requireSelector(listingDetail, '#inquiry-sheet')
    const requiredStateSelector = name === 'inquirySuccess'
      ? '.inquiry-sheet__success'
      : name === 'inquiryError'
        ? '.inquiry-sheet__live'
        : '.inquiry-sheet__submit'
    const requiredStateElement = await activeSheet.$(requiredStateSelector)
    const hasRequiredState = Boolean(requiredStateElement)
    let visibleError = null
    if (name === 'inquiryError') {
      const errorBody = await requireSelector(activeSheet, '.inquiry-sheet__body')
      await errorBody.scrollTo(0, await errorBody.scrollHeight())
      await delay(120)
      const liveError = await requireSelector(activeSheet, '.inquiry-sheet__live')
      const liveErrorText = await liveError.text()
      const liveErrorRect = await elementRect(liveError)
      visibleError = {
        text: liveErrorText,
        rect: liveErrorRect,
        visiblyRendered: liveErrorText.includes('网络连接失败')
          && liveErrorRect.top >= 0
          && liveErrorRect.bottom <= inquiryViewport.height,
      }
    }
    const geometry = await sheetGeometry({
      page: listingDetail,
      componentName: '#inquiry-sheet',
      selectors: inquirySelectors,
      viewport: inquiryViewport,
      safeAreaBottomInset,
      tabBarVisible: (await observeNativeTabBar(listingDetail, filterViewport)).tabBarVisible,
      expectedSectionOnly: hasRequiredState && (visibleError?.visiblyRendered ?? true),
    })
    states[name] = {
      ...geometry,
      evidenceMode: 'local-devtools-visual-fixture',
      ...(visibleError ? { visibleError } : {}),
      screenshot: await screenshot(miniProgram, screenshotName),
    }
    if (name === 'inquirySubmitting') {
      await (await requireSelector(activeSheet, '.inquiry-sheet__backdrop')).tap()
      await delay(80)
      const afterBusyCloseAttempt = await listingDetail.data()
      if (afterBusyCloseAttempt.inquiryOpen !== true) {
        states[name].passed = false
        states[name].failures.push('busy backdrop unexpectedly closed sheet')
      }
    }
  }

  return {
    status: 'passed',
    timestamp: new Date().toISOString(),
    environment: 'local-wechat-devtools-develop-with-controlled-mock',
    evidenceRevision,
    viewportProfile,
    systemInfo: {
      SDKVersion: system.SDKVersion,
      platform: system.platform,
      version: system.version,
      windowWidth: systemViewport.width,
      windowHeight: systemViewport.height,
      filterPageWidth: filterViewport.width,
      filterPageHeight: filterViewport.height,
      inquiryPageWidth: inquiryViewport.width,
      inquiryPageHeight: inquiryViewport.height,
      safeAreaBottomInset,
    },
    states,
    limitations: [
      '首页、楼盘和房源详情咨询均通过真实页面点击打开；微信、手填、错误、提交中和成功展示随后使用本地受控视觉状态夹具',
      '键盘态证明输入发生真实 focus 且输入与 footer 位于 DevTools 收缩后的可视区；不等同于 iOS/Android 真机键盘验收',
      '未执行真实咨询服务写入、trial、隐私后台、iOS/Android 真机或生产验收',
    ],
  }
}

function writeJson(path, report) {
  mkdirSync(screenshotsDir, { recursive: true })
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`)
}

function writeProfileReport(report) {
  const name = report?.viewportProfile?.name
  if (name !== 'small' && name !== 'large') {
    throw new Error('MP-109 profile 报告缺少 small/large 视口标识')
  }
  writeJson(profileReportPaths[name], report)
}

function readProfileReport(name) {
  const path = profileReportPaths[name]
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    return {
      status: 'failed',
      viewportProfile: { name },
      reason: `profile 报告不可解析：${error instanceof Error ? error.message : String(error)}`,
      states: {},
    }
  }
}

function aggregateProfileReports() {
  const reports = {
    small: readProfileReport('small'),
    large: readProfileReport('large'),
  }
  const failures = []
  for (const name of ['small', 'large']) {
    const report = reports[name]
    if (!report) {
      failures.push(`缺少 ${name} 视口报告`)
      continue
    }
    if (report.viewportProfile?.name !== name) failures.push(`${name} 报告视口标识不匹配`)
    if (report.evidenceRevision !== evidenceRevision) failures.push(`${name} 报告来自不同 runner 版本`)
    try {
      assertMp109SheetAcceptance(report)
    } catch (error) {
      failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const states = Object.fromEntries(stateNames.map((stateName) => {
    const smallState = reports.small?.states?.[stateName]
    const largeState = reports.large?.states?.[stateName]
    return [stateName, {
      passed: smallState?.passed === true && largeState?.passed === true,
      profiles: { small: smallState ?? null, large: largeState ?? null },
    }]
  }))
  const report = {
    status: failures.length === 0 ? 'passed' : 'incomplete',
    timestamp: new Date().toISOString(),
    environment: 'local-wechat-devtools-develop-with-controlled-mock',
    evidenceRevision,
    profileReports: {
      small: 'sheet-acceptance-small.json',
      large: 'sheet-acceptance-large.json',
    },
    viewportProfiles: reports,
    states,
    failures,
    limitations: [
      '两档证据均来自微信开发者工具 develop 模式与受控 Mock；不等同于 trial、隐私后台、iOS/Android 真机或生产验收',
      '咨询展示状态使用真实点击打开后的本地视觉夹具，未执行真实业务写入',
    ],
  }
  writeJson(reportPath, report)
  return report
}

async function main() {
  mkdirSync(screenshotsDir, { recursive: true })
  const cliPath = process.env.WECHAT_DEVTOOLS_CLI || '/Applications/wechatwebdevtools.app/Contents/MacOS/cli'
  if (!existsSync(cliPath)) {
    writeJson(reportPath, {
      status: 'environment-unavailable',
      timestamp: new Date().toISOString(),
      reason: `DevTools CLI not found: ${cliPath}`,
      states: {},
    })
    process.exitCode = 2
    return
  }

  let controlledServer = null
  let miniProgram = null
  let connectedToExistingSession = false
  let acceptanceReport = null
  try {
    try {
      controlledServer = await createAcceptanceServer(3717)
    } catch (error) {
      if (error?.code === 'EADDRINUSE') await probeAcceptanceServer(3717)
      else throw error
    }
    const wsEndpoint = process.env.WECHAT_DEVTOOLS_WS_ENDPOINT || 'ws://127.0.0.1:9420'
    try {
      miniProgram = await automator.connect({ wsEndpoint })
      connectedToExistingSession = true
    } catch {
      const configuredPort = Number.parseInt(process.env.WECHAT_DEVTOOLS_PORT ?? '', 10)
      miniProgram = await automator.launch({
        cliPath,
        projectPath: projectRoot,
        trustProject: true,
        ...(Number.isSafeInteger(configuredPort) && configuredPort > 0 && configuredPort <= 65_535
          ? { port: configuredPort }
          : {}),
      })
    }
    acceptanceReport = await runInteractiveAcceptance(miniProgram)
    assertMp109SheetAcceptance(acceptanceReport)
    writeProfileReport(acceptanceReport)
    const aggregateReport = aggregateProfileReports()
    console.log(`MP-109 ${acceptanceReport.viewportProfile.name} 视口验收通过：${profileReportPaths[acceptanceReport.viewportProfile.name]}`)
    console.log(`MP-109 双视口聚合状态 ${aggregateReport.status}：${reportPath}`)
    if (aggregateReport.status !== 'passed') process.exitCode = 1
  } catch (error) {
    const reason = error instanceof Error ? error.stack ?? error.message : String(error)
    const unavailable = miniProgram === null && /(?:launch|DevTools|connection|CLI|closed)/i.test(reason)
    const report = {
      ...(acceptanceReport ?? {}),
      status: unavailable ? 'environment-unavailable' : 'failed',
      timestamp: new Date().toISOString(),
      reason,
      states: acceptanceReport?.states ?? {},
    }
    if (report.viewportProfile?.name === 'small' || report.viewportProfile?.name === 'large') {
      writeProfileReport({ ...report, evidenceRevision })
      aggregateProfileReports()
    } else {
      writeJson(reportPath, { ...report, evidenceRevision })
    }
    console.error(reason)
    process.exitCode = unavailable ? 2 : 1
  } finally {
    if (miniProgram) {
      if (connectedToExistingSession) miniProgram.disconnect()
      else await miniProgram.close().catch(() => undefined)
    }
    if (controlledServer) await controlledServer.close().catch(() => undefined)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
