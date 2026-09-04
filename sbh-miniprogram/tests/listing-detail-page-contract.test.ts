import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const projectRoot = resolve(import.meta.dirname, '..')
const miniprogramRoot = resolve(projectRoot, 'miniprogram')
const pageRoot = resolve(miniprogramRoot, 'pages/listing-detail')

function readPageFile(filename: string): string {
  return readFileSync(resolve(pageRoot, filename), 'utf8')
}

describe('房源详情页面合同', () => {
  it('注册非 tab 详情路由与 Task2 组件', () => {
    const app = JSON.parse(readFileSync(resolve(miniprogramRoot, 'app.json'), 'utf8')) as {
      pages?: string[]
      tabBar?: { list?: Array<{ pagePath?: string }> }
    }
    const config = JSON.parse(readPageFile('index.json')) as Record<string, unknown>

    expect(app.pages).toEqual([
      'pages/home/index',
      'pages/listings/index',
      'pages/buildings/index',
      'pages/building-detail/index',
      'pages/listing-detail/index',
      'pages/foundation/index',
      'pages/profile/index',
    ])
    expect(app.tabBar?.list?.map((item) => item.pagePath)).not.toContain('pages/listing-detail/index')
    expect(config).toMatchObject({
      navigationBarTitleText: '房源详情',
      enablePullDownRefresh: true,
      usingComponents: {
        'detail-gallery': '/components/detail-gallery/index',
        'monthly-cost-card': '/components/monthly-cost-card/index',
        'spec-grid': '/components/spec-grid/index',
        'listing-card': '/components/listing-card/index',
        'sbh-skeleton': '/components/sbh-skeleton/index',
        'sbh-state': '/components/sbh-state/index',
      },
    })
  })

  it('每个状态可观察，只有 ready/stale 生成 ready marker', () => {
    const markup = readPageFile('index.wxml')

    expect(markup).toContain('data-page-state="{{state}}"')
    for (const state of ['loading', 'ready', 'refreshing', 'stale', 'error', 'not-found']) {
      expect(markup, `缺少 ${state} 状态`).toContain(`state === '${state}'`)
    }
    expect(markup.match(/id="listing-detail-ready"/g)).toHaveLength(1)
    expect(markup).toMatch(/wx:if="\{\{state === 'ready' \|\| state === 'stale'\}\}"\s+id="listing-detail-ready"/)
    expect(markup).toContain('刷新失败，以下为上次核验数据')
  })

  it('可信详情严格按画廊、标题位置核验、主月租单位报价、月度成本、规格、事实、楼盘、推荐排序', () => {
    const markup = readPageFile('index.wxml')
    const orderedSections = [
      'listing-detail__gallery',
      'listing-detail__summary',
      'listing-detail__price',
      'listing-detail__monthly-cost',
      'listing-detail__specifications',
      'listing-detail__facts',
      'listing-detail__building',
      'listing-detail__related',
    ]
    let previous = -1
    for (const section of orderedSections) {
      const index = markup.indexOf(section)
      expect(index, `${section} 缺失`).toBeGreaterThan(previous)
      previous = index
    }

    expect(markup).toContain('{{content.title}}')
    expect(markup).toContain('{{content.location}}')
    expect(markup).toContain('{{content.verification.verifiedAt}}')
    expect(markup).toContain('{{content.verification.priceVerifiedAt}}')
    expect(markup).toContain('{{content.primaryPrice}}')
    expect(markup).toContain('{{content.secondaryPrice}}')
    expect(markup).toContain('<monthly-cost-card cost="{{content.monthlyCost}}"')
    expect(markup).toContain('<spec-grid items="{{content.specifications}}"')
    expect(markup).toContain('wx:for="{{content.factGroups}}"')
    expect(markup).toContain('wx:for="{{content.relatedListings}}"')
    expect(markup).toContain('bindopen="handleRelatedOpen"')
  })

  it('loading/error/not-found 不展示旧价，404 提供返回出口和无关普通推荐', () => {
    const markup = readPageFile('index.wxml')
    const source = readPageFile('index.ts')

    expect(markup).toMatch(/state === 'loading'[\s\S]*?<sbh-skeleton/)
    expect(markup).toMatch(/state === 'error'[\s\S]*?bindretry="handleRetry"[\s\S]*?bindtap="handleBackToListings"/)
    expect(markup).toMatch(/state === 'not-found'[\s\S]*?查看其他房源[\s\S]*?bindtap="handleBackToListings"/)
    expect(markup).toContain('当前可选房源')
    expect(markup).toContain('wx:if="{{loadingFallback}}"')
    expect(markup).toContain('wx:for="{{fallbackListings}}"')
    expect(markup).toMatch(/fallbackListings[\s\S]*?bindopen="handleRelatedOpen"/)
    expect(markup).not.toContain('相似')
    expect(source).toMatch(/handleBackToListings\(\)[\s\S]*listingNavigation\.open\(''\)/)
    expect(source).toContain("catalog.getHome('shanghai')")
    expect(source).toContain('fallbackListings: snapshot.fallbackListings.map(presentListingCard)')
  })

  it('fixed bar 使用原生分享与真实咨询弹层，三种有内容状态均可用且 stale 文案改变', () => {
    const markup = readPageFile('index.wxml')
    const source = readPageFile('index.ts')
    const styles = readPageFile('index.wxss')

    expect(markup).toContain('open-type="share"')
    expect(markup).not.toContain('disabled="{{state')
    expect(markup).toContain("{{state === 'stale' ? '咨询当前状态' : '咨询顾问'}}")
    expect(markup).toContain('bindtap="handleOpenInquiry"')
    expect(source).not.toContain('咨询功能即将开放')
    expect(markup).toContain('<inquiry-sheet')
    expect(markup).toContain('snapshot="{{inquirySheet}}"')
    expect(source).toContain('createInquirySheetController')
    expect(source).toContain('createSubmissionIntentManager')
    expect(source).toContain('createSessionService')
    expect(source).toContain('createInquiryService')
    expect(source).toContain('loginCode')
    expect(source).toContain('openPrivacyContract')
    expect(source).toContain("this.data.state !== 'refreshing'")
    expect(markup).toMatch(/<page-meta[\s\S]*overflow:\s*hidden/)
    expect(markup).toContain('aria-hidden="{{inquiryOpen}}"')
    expect(markup).toMatch(/listing-detail__bar[\s\S]*disabled="{{inquiryOpen}}"/)
    expect(markup).not.toContain('bindrestorefocus')
    expect(markup).not.toContain('data-focus-token')
    expect(source).not.toMatch(/FocusToken|RestoreFocus|restorefocus/)
    expect(source).toContain('VoiceOver/TalkBack 真机验收')
    expect(styles).toMatch(/\.listing-detail__main\s*\{[\s\S]*padding-bottom:\s*calc\(112rpx \+ env\(safe-area-inset-bottom\)\);/)
    expect(styles).toMatch(/\.listing-detail__bar\s*\{[\s\S]*position:\s*fixed;[\s\S]*padding-bottom:\s*env\(safe-area-inset-bottom\);/)
    expect(styles).toMatch(/\.listing-detail__bar-action\s*\{[\s\S]*min-height:\s*var\(--sbh-size-touch-target\);/)
  })

  it('分享路径只由安全 slug 构造，且相关房源真实走详情导航', () => {
    const source = readPageFile('index.ts')
    const shareStart = source.indexOf('onShareAppMessage()')
    const shareEnd = source.indexOf('ensureListingDetailController()', shareStart)
    const shareHandler = source.slice(shareStart, shareEnd)

    expect(source).toMatch(/onShareAppMessage\(\)[\s\S]*buildListingDetailPath\(this\.data\.slug\)/)
    expect(source).toMatch(/handleRelatedOpen[\s\S]*listingNavigation\.openDetail\(slug\)/)
    expect(shareHandler).not.toMatch(/phone|anonymousContextToken|submissionRequestId/)
    expect(source).toContain('暂时无法打开房源详情')
  })

  it('弹层只在可信 content 存在时打开，并在卸载时清详情、session、intent 与 sheet owner', () => {
    const source = readPageFile('index.ts')
    const config = JSON.parse(readPageFile('index.json')) as {
      usingComponents?: Record<string, string>
    }

    expect(config.usingComponents?.['inquiry-sheet']).toBe('/components/inquiry-sheet/index')
    expect(source).toMatch(/handleOpenInquiry\(\)[\s\S]*if \(!this\.data\.content\) return/)
    expect(source).toMatch(/onUnload\(\)[\s\S]*listingDetailController\?\.dispose\(\)[\s\S]*inquirySheetController\?\.dispose\(\)[\s\S]*sessionService\.clear\(\)[\s\S]*submissionIntentManager\.invalidate\(\)/)
    expect(source).not.toMatch(/inquiryCtaFocusToken|handleInquiryRestoreFocus/)
  })

  it('微信登录字段与手机号授权字段分离，组件不缓存一次性 phoneCode', () => {
    const pageSource = readPageFile('index.ts')
    const componentSource = readFileSync(
      resolve(miniprogramRoot, 'components/inquiry-sheet/index.ts'),
      'utf8',
    )
    const loginStart = pageSource.indexOf('function requestLoginCode')
    const loginEnd = pageSource.indexOf('function openPrivacyContract', loginStart)
    const loginAdapter = pageSource.slice(loginStart, loginEnd)

    expect(loginAdapter).toContain('loginCode')
    expect(loginAdapter).not.toContain('phoneCode')
    expect(componentSource).toContain("triggerEvent('phoneauthorize', { phoneCode: detail.code })")
    expect(componentSource).not.toContain('loginCode')
    expect(componentSource).not.toMatch(/data:\s*\{[\s\S]*phoneCode/)
  })

  it('咨询成功不写入客户端旧 tracker，服务端 targetResolution 保持唯一事实源', () => {
    const source = readPageFile('index.ts')

    expect(source).not.toContain('recordInquiry')
    expect(source).not.toContain("statusLabel: '待带看'")
  })

  it('收藏只在服务端写入与 /me 复核后更新，busy 防止重复点击', () => {
    const source = readPageFile('index.ts')
    const markup = readPageFile('index.wxml')

    expect(source).toContain('setFavorite')
    expect(source).toContain('loadUserAssets')
    expect(source).toMatch(/async handleToggleFavorite\(\)[\s\S]*if \(this\.data\.favoriteBusy\) return[\s\S]*await setFavorite/)
    expect(source).toMatch(/catch[\s\S]*收藏状态更新失败/)
    expect(source).not.toMatch(/toggleListingFavorite|isListingFavorite/)
    expect(markup).toContain("{{favoriteBusy ? '处理中' : (isFavorited ? '已收藏' : '收藏')}}")
  })

  it('咨询成功后刷新服务端 /me 投影，不在页面内编造记录', () => {
    const source = readPageFile('index.ts')

    expect(source).toContain('refreshUserAssets')
    expect(source).toMatch(/snapshot\.state === 'success'[\s\S]*refreshUserAssets\(\)/)
    expect(source).not.toMatch(/recordInquiry|statusLabel|submissionRequestId:\s*`req_/)
  })
})
