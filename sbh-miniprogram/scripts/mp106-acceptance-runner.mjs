import { accessSync, constants, existsSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import automator from 'miniprogram-automator'
import { assertAcceptancePassed } from './acceptance-result.mjs'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDirectory, '..')
const artifactsDir = resolve(projectRoot, '../artifacts/verification/MP-106')
const screenshotsDir = join(artifactsDir, 'screenshots')

const cliPath = process.env.WECHAT_DEVTOOLS_CLI || '/Applications/wechatwebdevtools.app/Contents/MacOS/cli'
if (!existsSync(cliPath)) {
  console.error(`DevTools CLI not found at ${cliPath}`)
  process.exit(1)
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function requireSelector(page, selector) {
  const element = await page.$(selector)
  if (!element) throw new Error(`MP-106 关键 selector 缺失：${selector}`)
  return element
}

async function runAcceptance() {
  console.log('🚀 启动 MP-106 找房主链路交互与高保真端到端走查...')
  const mp = await automator.launch({
    cliPath,
    projectPath: projectRoot,
    trustProject: true,
  })

  const results = {
    timestamp: new Date().toISOString(),
    systemInfo: {},
    testCases: {},
    interactions: {},
    requiredInteractions: [
      'homeSearch',
      'filterSheet',
      'sortToggle',
      'buildingListingOpen',
      'inquirySheet',
    ],
  }

  try {
    const sys = await mp.systemInfo()
    results.systemInfo = {
      SDKVersion: sys.SDKVersion,
      platform: sys.platform,
      version: sys.version,
      windowWidth: sys.windowWidth,
      windowHeight: sys.windowHeight,
    }
    console.log(`📱 运行环境: SDK ${sys.SDKVersion}, 平台 ${sys.platform}, 屏幕 ${sys.windowWidth}x${sys.windowHeight}`)

    // ==========================================
    // 1. 首页走查与搜索交互链路
    // ==========================================
    console.log('🧪 [Case 1] 走查首页视觉规范 (Hero视频海报/58px浮动搜索/双入口/精选好楼/紧凑筛选/推荐流)...')
    const home = await mp.reLaunch('/pages/home/index')
    await home.waitFor('#home-ready')
    await delay(1000)
    const homeData = await home.data()
    const homeScreenshotPath = join(screenshotsDir, 'mp106-1-home.png')
    await mp.screenshot({ path: homeScreenshotPath })
    results.testCases.home = {
      state: homeData.state,
      passed: homeData.state === 'ready',
      screenshot: 'mp106-1-home.png',
    }
    console.log(`   ✅ 首页高保真渲染完成`)

    console.log('   🔄 [Interaction 1-1] 首页搜索关键字并提交跳转...')
    const searchInput = await requireSelector(home, '.home-search__input')
    await searchInput.input('静安')
    await delay(300)
    const searchBtn = await requireSelector(home, '.home-search__submit')
    await searchBtn.tap()
    await delay(1200)
    const currentListingsPage = await mp.currentPage()
    const searchResultScreenshot = join(screenshotsDir, 'mp106-1b-home-search-result.png')
    await mp.screenshot({ path: searchResultScreenshot })
    const lData = await currentListingsPage.data()
    results.interactions.homeSearch = {
      keyword: '静安',
      navigatedPath: currentListingsPage.path,
      totalDocs: lData.totalDocs,
      passed: currentListingsPage.path.includes('listings') && lData.totalDocs > 0,
      screenshot: 'mp106-1b-home-search-result.png',
    }
    console.log(`   ✅ 搜索交互成功：导航至找房列表，匹配房源 ${lData.totalDocs} 套`)

    // ==========================================
    // 2. 找房列表页走查与筛选/排序交互链路
    // ==========================================
    console.log('🧪 [Case 2] 走查找房列表页 (34px独立搜索栏/吸顶筛选/大白卡内嵌分割线/排序)...')
    const listings = await mp.switchTab('/pages/listings/index')
    await listings.waitFor('#listings-ready')
    await delay(1000)
    const listingsData = await listings.data()
    const listingsScreenshotPath = join(screenshotsDir, 'mp106-2-listings.png')
    await mp.screenshot({ path: listingsScreenshotPath })
    results.testCases.listings = {
      state: listingsData.state,
      totalDocs: listingsData.totalDocs,
      itemCount: listingsData.items?.length || 0,
      passed: listingsData.state === 'ready',
      screenshot: 'mp106-2-listings.png',
    }
    console.log(`   ✅ 找房列表页就绪，在租房源 ${listingsData.totalDocs} 套`)

    console.log('   🔄 [Interaction 2-1] 唤起半屏筛选弹层 (filter-sheet)...')
    await requireSelector(listings, '.listings-filter-shell')
    await listings.callMethod('handleOpenFilter', { detail: { section: 'price' } })
    await delay(800)
    const filterSheetScreenshot = join(screenshotsDir, 'mp106-2b-filter-sheet-opened.png')
    await mp.screenshot({ path: filterSheetScreenshot })
    const postOpenData = await listings.data()
    results.interactions.filterSheet = {
      sheetOpen: postOpenData.sheetOpen,
      sheetSection: postOpenData.sheetSection,
      passed: postOpenData.sheetOpen === true,
      screenshot: 'mp106-2b-filter-sheet-opened.png',
    }
    console.log(`   ✅ 筛选弹层成功唤起，当前定位分区: ${postOpenData.sheetSection}`)

    // 关闭筛选弹层
    await listings.callMethod('handleFilterClose')
    await delay(500)

    console.log('   🔄 [Interaction 2-2] 点击排序切换单价排序 (handleToggleSort)...')
    const sortBtn = await requireSelector(listings, '.listings-summary__sort')
    await sortBtn.tap()
    await delay(800)
    const sortedScreenshot = join(screenshotsDir, 'mp106-2c-sorted-listings.png')
    await mp.screenshot({ path: sortedScreenshot })
    const sortedData = await listings.data()
    results.interactions.sortToggle = {
      sortOrder: sortedData.query.sort,
      passed: sortedData.query.sort === 'price-desc',
      screenshot: 'mp106-2c-sorted-listings.png',
    }
    console.log(`   ✅ 排序切换成功：当前排序为 ${sortedData.query.sort}`)

    // ==========================================
    // 3. 楼盘列表页走查 (在租楼盘 + 暂无在租独立下沉)
    // ==========================================
    console.log('🧪 [Case 3] 走查楼盘列表页 (在租楼盘 / 暂无在租独立下沉分组)...')
    const buildings = await mp.switchTab('/pages/buildings/index')
    await buildings.waitFor('#buildings-ready')
    await delay(1000)
    const buildingsData = await buildings.data()
    const buildingsScreenshotPath = join(screenshotsDir, 'mp106-3-buildings.png')
    await mp.screenshot({ path: buildingsScreenshotPath })
    results.testCases.buildings = {
      state: buildingsData.state,
      totalDocs: buildingsData.totalDocs,
      activeCount: buildingsData.totalActiveCount,
      inactiveCount: buildingsData.totalInactiveCount,
      passed: buildingsData.state === 'ready' && buildingsData.totalDocs > 0,
      screenshot: 'mp106-3-buildings.png',
    }
    console.log(`   ✅ 楼盘列表就绪: 共收录 ${buildingsData.totalDocs} 座，在租 ${buildingsData.totalActiveCount} 座，暂无在租 ${buildingsData.totalInactiveCount} 座`)

    // ==========================================
    // 4. 楼盘详情页走查与“在租房源跳转”闭环
    // ==========================================
    console.log('🧪 [Case 4] 走查楼盘详情页 (4格指标竖分割线/面积段在租房源/双胶囊底部操作栏)...')
    const targetBuildingSlug = buildingsData.items?.[0]?.slug || 'heng-long-plaza'
    const buildingDetail = await mp.navigateTo(`/pages/building-detail/index?slug=${targetBuildingSlug}`)
    await buildingDetail.waitFor('#building-detail-ready')
    await delay(1200)
    const bDetailData = await buildingDetail.data()
    const bDetailScreenshotPath = join(screenshotsDir, 'mp106-4-building-detail.png')
    await mp.screenshot({ path: bDetailScreenshotPath })
    results.testCases.buildingDetail = {
      state: bDetailData.state,
      name: bDetailData.building?.name,
      activeListingCount: bDetailData.building?.activeListingCount,
      groupCount: bDetailData.building?.groupedListings?.length || 0,
      passed: bDetailData.state === 'ready' && !!bDetailData.building?.name,
      screenshot: 'mp106-4-building-detail.png',
    }
    console.log(`   ✅ 楼盘详情就绪: ${bDetailData.building?.name}，在租 ${bDetailData.building?.activeListingCount} 套`)

    console.log('   🔄 [Interaction 4-1] 点击楼盘在租房源行，跳转至房源详情...')
    const firstRow = await requireSelector(buildingDetail, '.building-listing-row')
    await firstRow.tap()
    await delay(1200)
    const afterJumpPage = await mp.currentPage()
    results.interactions.buildingListingOpen = {
      navigatedPath: afterJumpPage.path,
      passed: afterJumpPage.path.includes('listing-detail'),
    }
    console.log(`   ✅ 成功从楼盘在租房源跳转至: ${afterJumpPage.path}`)

    // ==========================================
    // 5. 房源详情页与留资转化交互链路
    // ==========================================
    console.log('🧪 [Case 5] 走查房源详情与留资弹层呼出转化链路...')
    const targetListingSlug = listingsData.items?.[0]?.slug || 'jingan-kerry-center-300sqm'
    const listingDetail = await mp.navigateTo(`/pages/listing-detail/index?slug=${targetListingSlug}`)
    await listingDetail.waitFor('#listing-detail-ready')
    await delay(1000)
    const lDetailData = await listingDetail.data()
    const lDetailScreenshotPath = join(screenshotsDir, 'mp106-5-listing-detail.png')
    await mp.screenshot({ path: lDetailScreenshotPath })
    results.testCases.listingDetail = {
      state: lDetailData.state,
      title: lDetailData.content?.title,
      buildingName: lDetailData.content?.building?.name,
      passed: lDetailData.state === 'ready' && !!lDetailData.content?.building?.name,
      screenshot: 'mp106-5-listing-detail.png',
    }
    console.log(`   ✅ 房源详情就绪: ${lDetailData.content?.title}，所在楼盘: ${lDetailData.content?.building?.name}`)

    console.log('   🔄 [Interaction 5-1] 点击底部主 CTA (咨询顾问/预约看房)，呼出留资半屏弹层...')
    const inquiryCta = await requireSelector(listingDetail, '.listing-detail__bar-action--inquiry')
    await inquiryCta.tap()
    await delay(800)
    const inquiryScreenshotPath = join(screenshotsDir, 'mp106-5b-inquiry-sheet-opened.png')
    await mp.screenshot({ path: inquiryScreenshotPath })
    const postInquiryData = await listingDetail.data()
    results.interactions.inquirySheet = {
      inquiryOpen: postInquiryData.inquiryOpen,
      prefilledTitle: postInquiryData.inquirySheet?.listingTitle,
      passed: postInquiryData.inquiryOpen === true,
      screenshot: 'mp106-5b-inquiry-sheet-opened.png',
    }
    console.log(`   ✅ 留资弹层成功呼出，已自动预填房源: ${postInquiryData.inquirySheet?.listingTitle}`)

    // 关闭留资弹层
    await listingDetail.callMethod('handleInquiryClose')
    await delay(400)

    const reportPath = join(artifactsDir, 'acceptance-report.json')
    assertAcceptancePassed(results)
    writeFileSync(reportPath, JSON.stringify(results, null, 2))
    console.log(`🎉 全链路走查与交互验收完成！测试报告已写入: ${reportPath}`)
  } catch (err) {
    console.error('❌ 自动化走查失败:', err)
    process.exitCode = 1
  } finally {
    console.log('🧹 断开开发者工具连接...')
    await mp.close()
  }
}

runAcceptance()
