import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import automator from 'miniprogram-automator'

import { createAcceptanceServer } from './acceptance-mock-server.mjs'

const stateNames = [
  'filterPrice',
  'filterAll',
  'inquiryWechat',
  'inquiryManual',
  'inquiryError',
  'inquirySubmitting',
  'inquirySuccess',
]

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDirectory, '..')
const artifactsDir = resolve(projectRoot, '../artifacts/verification/MP-109')
const screenshotsDir = join(artifactsDir, 'sheet-screenshots')
const reportPath = join(artifactsDir, 'sheet-acceptance-report.json')

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
  const footer = safeRect(input.footer)
  const close = safeRect(input.close)
  const primaryAction = input.primaryAction ? safeRect(input.primaryAction) : null

  if (input.requiredSelectorsPresent !== true) failures.push('required selector missing')
  if (input.tabBarVisible !== false) failures.push('native TabBar still visible')
  if (input.expectedSectionOnly !== true) failures.push('unexpected filter section visible')
  if (!viewport || !panel || !footer || !close) failures.push('invalid geometry')

  if (viewport && panel) {
    if (panel.left < -1 || panel.right > viewport.right + 1) failures.push('panel horizontally clipped')
    if (panel.top < -1 || panel.bottom > viewport.bottom + 1) failures.push('panel outside viewport')
  }
  if (viewport && footer && panel) {
    if (footer.left < panel.left - 1 || footer.right > panel.right + 1) failures.push('footer outside panel')
    if (footer.top < panel.top || footer.bottom > viewport.bottom + 1) failures.push('footer outside safe viewport')
  }
  if (viewport && close && panel) {
    if (close.left < panel.left - 1 || close.right > panel.right + 1) failures.push('close target outside panel')
    if (close.right - close.left < 44 || close.bottom - close.top < 44) failures.push('close target below 44pt')
    if (panel.right - close.right > 32) failures.push('close target not right-aligned')
  }
  if (input.primaryAction && viewport) {
    const safeAreaBottomInset = finite(input.safeAreaBottomInset) ?? 0
    if (!primaryAction) failures.push('invalid primary CTA geometry')
    else {
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
  const [panel, footer, close, body, primaryAction] = await Promise.all([
    requireSelector(component, selectors.panel),
    requireSelector(component, selectors.footer),
    requireSelector(component, selectors.close),
    requireSelector(component, selectors.body),
    requireSelector(component, selectors.primaryAction),
  ])
  const result = evaluateSheetGeometry({
    viewport,
    panel: await elementRect(panel),
    footer: await elementRect(footer),
    close: await elementRect(close),
    primaryAction: await elementRect(primaryAction),
    safeAreaBottomInset,
    requiredSelectorsPresent: Boolean(body && primaryAction),
    tabBarVisible,
    expectedSectionOnly,
  })
  return {
    ...result,
    geometry: {
      panel: await elementRect(panel),
      footer: await elementRect(footer),
      close: await elementRect(close),
      body: await elementRect(body),
      primaryAction: await elementRect(primaryAction),
    },
  }
}

async function screenshot(miniProgram, name) {
  const fileName = `${name}.png`
  await miniProgram.screenshot({ path: join(screenshotsDir, fileName) })
  return fileName
}

async function runInteractiveAcceptance(miniProgram) {
  const system = await miniProgram.systemInfo()
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

  const filterBar = await requireSelector(listings, '#filter-bar')
  const priceFilter = await requireSelector(filterBar, '.filter-bar__item[data-section="price"]')
  await priceFilter.tap()
  const priceData = await waitUntil(
    '价格抽屉打开',
    () => listings.data(),
    (data) => data.sheetOpen === true && data.sheetSection === 'price' && data.tabBarBoundaryState === 'hidden',
  )
  await delay(240)
  const filterViewport = await listings.size()
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
        panel: '.filter-sheet__panel', footer: '.filter-sheet__footer',
        close: '.filter-sheet__close', body: '.filter-sheet__body', primaryAction: '.filter-sheet__apply',
      },
      viewport: filterViewport,
      safeAreaBottomInset,
      tabBarVisible: priceData.tabBarBoundaryState !== 'hidden',
      expectedSectionOnly: priceOnly,
    })),
    resultCount: priceData.estimatedCount,
    screenshot: await screenshot(miniProgram, 'filter-price-open'),
  }

  await (await requireSelector(priceSheet, '.filter-sheet__close')).tap()
  await waitUntil(
    '价格抽屉关闭并恢复 TabBar',
    () => listings.data(),
    (data) => data.sheetOpen === false && data.tabBarBoundaryState === 'visible',
  )

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
      panel: '.filter-sheet__panel', footer: '.filter-sheet__footer',
      close: '.filter-sheet__close', body: '.filter-sheet__body', primaryAction: '.filter-sheet__apply',
    },
    viewport: filterViewport,
    safeAreaBottomInset,
    tabBarVisible: allData.tabBarBoundaryState !== 'hidden',
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

  const listingsData = await listings.data()
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
  const inquiryViewport = await listingDetail.size()

  const inquirySelectors = {
    panel: '.inquiry-sheet__panel', footer: '.inquiry-sheet__footer',
    close: '.inquiry-sheet__close', body: '.inquiry-sheet__body', primaryAction: '.inquiry-sheet__submit',
  }
  states.inquiryWechat = {
    ...(await sheetGeometry({
      page: listingDetail,
      componentName: '#inquiry-sheet',
      selectors: inquirySelectors,
      viewport: inquiryViewport,
      safeAreaBottomInset,
      tabBarVisible: false,
      expectedSectionOnly: Boolean(await (await requireSelector(listingDetail, '#inquiry-sheet')).$('.inquiry-sheet__wechat-submit')),
    })),
    openedByRealTap: true,
    actualOpenState: openedInquiry.inquirySheet?.state,
    evidenceMode: 'real-tap-open-with-local-devtools-visual-fixture',
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
      tabBarVisible: false,
      expectedSectionOnly: Boolean(await inquirySheet.$('.inquiry-sheet__phone')),
    })),
    phoneMode: manualData.inquirySheet.phoneMode,
    openedByRealTap: true,
    evidenceMode: 'real-mode-tap-with-local-devtools-visual-fixture',
    screenshot: await screenshot(miniProgram, 'inquiry-manual'),
  }

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
    const hasRequiredState = Boolean(await activeSheet.$(requiredStateSelector))
    const geometry = await sheetGeometry({
      page: listingDetail,
      componentName: '#inquiry-sheet',
      selectors: inquirySelectors,
      viewport: inquiryViewport,
      safeAreaBottomInset,
      tabBarVisible: false,
      expectedSectionOnly: hasRequiredState,
    })
    states[name] = {
      ...geometry,
      evidenceMode: 'local-devtools-visual-fixture',
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
      '咨询错误、提交中、成功为真实交互打开后的受控视觉状态夹具，不代表真实服务写入验收',
      '本报告不等同于 trial、iOS/Android 真机或生产验收',
    ],
  }
}

function writeReport(report) {
  mkdirSync(screenshotsDir, { recursive: true })
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
}

async function main() {
  mkdirSync(screenshotsDir, { recursive: true })
  const cliPath = process.env.WECHAT_DEVTOOLS_CLI || '/Applications/wechatwebdevtools.app/Contents/MacOS/cli'
  if (!existsSync(cliPath)) {
    writeReport({
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
      if (error?.code !== 'EADDRINUSE') throw error
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
    writeReport(acceptanceReport)
    console.log(`MP-109 抽屉真实打开态验收通过：${reportPath}`)
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
    writeReport(report)
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
