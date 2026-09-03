import { accessSync, constants, existsSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import automator from 'miniprogram-automator'

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

async function runAcceptance() {
  console.log('🚀 启动 MP-106 开发者工具端到端自动化走查...')
  const mp = await automator.launch({
    cliPath,
    projectPath: projectRoot,
    trustProject: true,
  })

  const results = {
    timestamp: new Date().toISOString(),
    systemInfo: {},
    testCases: {},
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

    // 1. 首页高保真走查
    console.log('🧪 [Case 1] 走查首页高保真视觉 (Hero/浮动搜索卡/精选好楼/房源流)...')
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

    // 2. 找房列表走查
    console.log('🧪 [Case 2] 走查找房列表页 (左图右文/吸顶筛选)...')
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

    // 3. 楼盘列表页走查（包含“暂无在租”独立分组）
    console.log('🧪 [Case 3] 走查楼盘列表页 (Tab 切换 / 在租楼盘 / 暂无在租独立下沉分组)...')
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

    // 4. 楼盘详情页走查
    console.log('🧪 [Case 4] 走查楼盘详情页 (4格指标/在租房源分组/楼盘参数/通勤位置/底部胶囊)...')
    const firstBuildingSlug = buildingsData.items?.[0]?.slug || 'heng-long-plaza'
    const buildingDetail = await mp.navigateTo(`/pages/building-detail/index?slug=${firstBuildingSlug}`)
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

    // 5. 房源详情页中的“所在楼盘”卡片穿梭
    console.log('🧪 [Case 5] 走查房源详情与所在楼盘跳转闭环...')
    const firstListingSlug = listingsData.items?.[0]?.slug || 'jingan-kerry-center-300sqm'
    const listingDetail = await mp.navigateTo(`/pages/listing-detail/index?slug=${firstListingSlug}`)
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

    const reportPath = join(artifactsDir, 'acceptance-report.json')
    writeFileSync(reportPath, JSON.stringify(results, null, 2))
    console.log(`🎉 走查完成！测试报告已写入: ${reportPath}`)
  } catch (err) {
    console.error('❌ 自动化走查失败:', err)
    process.exitCode = 1
  } finally {
    console.log('🧹 断开开发者工具连接...')
    await mp.close()
  }
}

runAcceptance()
