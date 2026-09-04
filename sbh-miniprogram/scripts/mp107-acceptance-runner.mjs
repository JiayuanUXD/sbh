import { accessSync, constants, existsSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, isAbsolute, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import automator from 'miniprogram-automator'
import { createAcceptanceServer } from './acceptance-mock-server.mjs'
import { assertAcceptancePassed } from './acceptance-result.mjs'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDirectory, '..')
const artifactsDir = resolve(projectRoot, '../artifacts/verification/MP-107')
const screenshotsDir = join(artifactsDir, 'screenshots')
mkdirSync(screenshotsDir, { recursive: true })

const cliPath = process.env.WECHAT_DEVTOOLS_CLI || '/Applications/wechatwebdevtools.app/Contents/MacOS/cli'
if (!existsSync(cliPath)) {
  console.error(`DevTools CLI not found at ${cliPath}`)
  process.exit(1)
}

const delay = (ms) => new Promise((res) => setTimeout(res, ms))

async function requireSelector(page, selector) {
  const element = await page.$(selector)
  if (!element) throw new Error(`MP-107 关键 selector 缺失：${selector}`)
  return element
}

async function runAcceptance() {
  console.log('🚀 启动 MP-107 全链路资产与“我的”个人中心端到端走查...')

  const mockServer = await createAcceptanceServer(3717)
  let mp

  try {
    mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' })
    console.log('🔗 已连接到现有开发者工具自动化会话 (9420)...')
  } catch {
    mp = await automator.launch({
      cliPath,
      projectPath: projectRoot,
      trustProject: true,
    })
  }

  try {
    const sysInfo = await mp.systemInfo()
    console.log(`📱 运行环境: SDK ${sysInfo.SDKVersion}, 平台 ${sysInfo.platform}, 屏幕 ${sysInfo.windowWidth}x${sysInfo.windowHeight}`)

    const results = {
      timestamp: new Date().toISOString(),
      systemInfo: sysInfo,
      testCases: {},
      interactions: {},
      requiredInteractions: [
        'buildingFavorite',
        'listingFavorite',
        'inquirySheet',
      ],
    }

    // 清理存储以建立确定性测试基线
    console.log('🧹 清理测试存储基线...')
    await mp.evaluate(() => {
      try {
        wx.removeStorageSync('sbh_fav_listings_v1')
        wx.removeStorageSync('sbh_fav_buildings_v1')
        wx.removeStorageSync('sbh_inquiry_records_v1')
      } catch {}
    })

    // ==========================================
    // 1. 首页走查
    // ==========================================
    console.log('🧪 [Case 1] 走查首页...')
    await delay(2000)
    let home = await mp.currentPage()
    if (!home || home.path !== 'pages/home/index') {
      try {
        home = await mp.reLaunch('/pages/home/index')
      } catch {
        await delay(2000)
        home = await mp.currentPage()
      }
    }
    await home.waitFor('#home-ready')
    await delay(1000)
    const homeScreenshotPath = join(screenshotsDir, 'mp107-1-home.png')
    await mp.screenshot({ path: homeScreenshotPath })
    results.testCases.home = {
      state: 'ready',
      passed: true,
      screenshot: 'mp107-1-home.png',
    }

    // ==========================================
    // 2. 找房列表页走查
    // ==========================================
    console.log('🧪 [Case 2] 走查找房列表页...')
    const listings = await mp.switchTab('/pages/listings/index')
    await listings.waitFor('#listings-ready')
    await delay(1000)
    const listingsData = await listings.data()
    const listingsScreenshotPath = join(screenshotsDir, 'mp107-2-listings.png')
    await mp.screenshot({ path: listingsScreenshotPath })
    results.testCases.listings = {
      state: listingsData.state,
      itemCount: listingsData.items?.length || 0,
      passed: listingsData.state === 'ready',
      screenshot: 'mp107-2-listings.png',
    }

    // ==========================================
    // 3. 楼盘列表页走查
    // ==========================================
    console.log('🧪 [Case 3] 走查楼盘列表页...')
    const buildings = await mp.switchTab('/pages/buildings/index')
    await buildings.waitFor('#buildings-ready')
    await delay(1000)
    const buildingsData = await buildings.data()
    const buildingsScreenshotPath = join(screenshotsDir, 'mp107-3-buildings.png')
    await mp.screenshot({ path: buildingsScreenshotPath })
    results.testCases.buildings = {
      state: buildingsData.state,
      totalDocs: buildingsData.totalDocs,
      activeCount: buildingsData.totalActiveCount,
      passed: buildingsData.state === 'ready',
      screenshot: 'mp107-3-buildings.png',
    }

    // ==========================================
    // 4. 楼盘详情页走查与楼盘收藏闭环
    // ==========================================
    console.log('🧪 [Case 4] 走查楼盘详情页并执行【收藏楼盘】交互...')
    const targetBuildingSlug = buildingsData.items?.[0]?.slug || 'heng-long-plaza'
    const buildingDetail = await mp.navigateTo(`/pages/building-detail/index?slug=${targetBuildingSlug}`)
    await buildingDetail.waitFor('#building-detail-ready')
    await delay(1000)

    // 点击收藏楼盘
    console.log('   🔄 [Interaction 4-1] 点击楼盘底栏【♡ 收藏】...')
    const bFavBtn = await requireSelector(buildingDetail, '.building-bottom-fav')
    await bFavBtn.tap()
    await delay(600)
    const bDetailData = await buildingDetail.data()
    const bDetailScreenshotPath = join(screenshotsDir, 'mp107-4-building-detail-favorited.png')
    await mp.screenshot({ path: bDetailScreenshotPath })
    results.testCases.buildingDetail = {
      name: bDetailData.building?.name,
      isFavorited: bDetailData.isFavorited,
      passed: bDetailData.isFavorited === true,
      screenshot: 'mp107-4-building-detail-favorited.png',
    }
    results.interactions.buildingFavorite = {
      passed: bDetailData.isFavorited === true,
    }
    // 返回上一页（回到楼盘列表 tab）
    await mp.navigateBack()
    await delay(600)

    // ==========================================
    // 5. 房源详情页走查与房源收藏、留资交互
    // ==========================================
    console.log('🧪 [Case 5] 走查房源详情页并执行【收藏房源】与【留资咨询】交互...')
    const targetListingSlug = listingsData.items?.[0]?.slug || 'jingan-kerry-center-300sqm'
    const listingDetail = await mp.navigateTo(`/pages/listing-detail/index?slug=${targetListingSlug}`)
    await listingDetail.waitFor('#listing-detail-ready')
    await delay(1000)

    // 点击收藏房源
    console.log('   🔄 [Interaction 5-1] 点击房源底栏【♡ 收藏】...')
    const lFavBtn = await requireSelector(listingDetail, '.listing-detail__bar-fav')
    await lFavBtn.tap()
    await delay(600)

    // 呼出留资弹层
    console.log('   🔄 [Interaction 5-2] 点击【咨询顾问】呼出留资并模拟预约...')
    const inquiryCta = await requireSelector(listingDetail, '.listing-detail__bar-action--inquiry')
    await inquiryCta.tap()
    await delay(800)

    const lDetailData = await listingDetail.data()
    const lDetailScreenshotPath = join(screenshotsDir, 'mp107-5-listing-detail-favorited.png')
    await mp.screenshot({ path: lDetailScreenshotPath })
    results.testCases.listingDetail = {
      title: lDetailData.content?.title,
      isFavorited: lDetailData.isFavorited,
      inquiryOpen: lDetailData.inquiryOpen,
      passed: lDetailData.isFavorited === true,
      screenshot: 'mp107-5-listing-detail-favorited.png',
    }
    results.interactions.listingFavorite = {
      passed: lDetailData.isFavorited === true,
    }
    results.interactions.inquirySheet = {
      passed: lDetailData.inquiryOpen === true,
    }
    console.log(`   ✅ 房源收藏与留资就绪：${lDetailData.content?.title}，收藏: ${lDetailData.isFavorited}，留资弹层呼出: ${lDetailData.inquiryOpen}`)

    if (lDetailData.inquiryOpen) {
      await listingDetail.callMethod('handleInquiryClose')
      await delay(400)
    }

    // 返回上一页
    await mp.navigateBack()
    await delay(600)

    // ==========================================
    // 6. “我的”个人中心页走查与资产汇总验证
    // ==========================================
    console.log('🧪 [Case 6] 走查第 4 个 Tab【我的】(验证 4 格资产指标与留资跟进卡)...')
    const profile = await mp.switchTab('/pages/profile/index')
    await profile.waitFor('#profile-ready')
    await delay(1200)

    const profileData = await profile.data()
    const profileScreenshotPath = join(screenshotsDir, 'mp107-6-profile.png')
    await mp.screenshot({ path: profileScreenshotPath })

    results.testCases.profile = {
      nickname: profileData.user?.nickname,
      city: profileData.user?.city,
      listingCount: profileData.summary?.listingCount,
      buildingCount: profileData.summary?.buildingCount,
      inquiriesCount: profileData.inquiries?.length || 0,
      passed: profileData.summary?.listingCount >= 1 && profileData.summary?.buildingCount >= 1,
      screenshot: 'mp107-6-profile.png',
    }

    console.log(`   ✅ 【我的】个人中心（初始态）渲染就绪：`)
    console.log(`      - 用户: ${profileData.user?.nickname} (${profileData.user?.city})`)
    console.log(`      - 资产指标: 收藏房源 ${profileData.summary?.listingCount} 套，收藏楼盘 ${profileData.summary?.buildingCount} 座`)

    const reportPath = join(artifactsDir, 'acceptance-report.json')
    assertAcceptancePassed(results)
    writeFileSync(reportPath, JSON.stringify(results, null, 2))
    console.log(`🎉 MP-107 全链路走查与交互验收完成！报告已保存至: ${reportPath}`)
  } catch (err) {
    console.error('❌ 自动化走查失败:', err)
    process.exitCode = 1
  } finally {
    if (mp) {
      console.log('🧹 断开开发者工具连接...')
      try { mp.disconnect() } catch {}
    }
    if (mockServer) {
      console.log('🧹 关闭 Mock 服务...')
      try { await mockServer.close() } catch {}
    }
  }
}

runAcceptance()
