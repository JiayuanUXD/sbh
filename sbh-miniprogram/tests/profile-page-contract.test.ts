import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const projectRoot = resolve(import.meta.dirname, '..')
const miniprogramRoot = resolve(projectRoot, 'miniprogram')
const pageRoot = resolve(miniprogramRoot, 'pages/profile')

function readPageFile(filename: string): string {
  return readFileSync(resolve(pageRoot, filename), 'utf8')
}

describe('我的页面服务端资产合同', () => {
  it('注册 profile-ready 标记与基本元数据', () => {
    const markup = readPageFile('index.wxml')
    const config = JSON.parse(readPageFile('index.json')) as Record<string, unknown>

    expect(markup).toContain('id="profile-ready"')
    expect(config).toMatchObject({
      navigationBarTitleText: '我的',
      navigationBarBackgroundColor: '#ffffff',
      navigationBarTextStyle: 'black',
      backgroundColor: '#f2f2f4',
      enablePullDownRefresh: true,
    })
  })

  it('只声明微信连接状态，不展示 PII 或伪造授权资料', () => {
    const markup = readPageFile('index.wxml')
    const source = readPageFile('index.ts')

    expect(markup).toContain('微信用户')
    expect(markup).toContain('已连接当前微信')
    expect(markup).not.toMatch(/手机号|openid|头像昵称|顾问已分配|已接单|30\s*分钟内|待带看/)
    expect(source).not.toMatch(/phone|openid|handleUserClick|已通过微信安全授权/)
  })

  it('只在服务端资产 ready 后声明已连接，加载与失败使用真实状态文案', () => {
    const markup = readPageFile('index.wxml')

    expect(markup).toContain("assetsState === 'ready' ? '已连接当前微信'")
    expect(markup).toContain("assetsState === 'loading' ? '正在连接当前微信'")
    expect(markup).toContain("'未能连接当前微信'")
    expect(markup.match(/已连接当前微信/g)).toHaveLength(1)
  })

  it('具有 loading/ready/error 三态，错误可重试且失败时清空可见资产', () => {
    const markup = readPageFile('index.wxml')
    const source = readPageFile('index.ts')

    expect(markup).toContain("assetsState === 'loading'")
    expect(markup).toContain("assetsState === 'ready'")
    expect(markup).toContain("assetsState === 'error'")
    expect(markup).toContain('bindretry="handleRetryAssets"')
    expect(source).toContain('loadUserAssets')
    expect(source).toContain('refreshUserAssets')
    expect(source).toMatch(/catch[\s\S]*assetsState:\s*'error'[\s\S]*favoriteListings:\s*\[\][\s\S]*favoriteBuildings:\s*\[\][\s\S]*inquiries:\s*\[\]/)
  })

  it('收藏指标只打开已确认收藏集合，不跳转普通全列表', () => {
    const markup = readPageFile('index.wxml')
    const source = readPageFile('index.ts')

    expect(markup).toContain('{{favoriteListings.length}}')
    expect(markup).toContain('{{favoriteBuildings.length}}')
    expect(markup).toContain("favoriteCollection === 'listing'")
    expect(markup).toContain("favoriteCollection === 'building'")
    expect(markup).toContain('wx:for="{{favoriteListings}}"')
    expect(markup).toContain('wx:for="{{favoriteBuildings}}"')
    expect(source).not.toContain("wx.switchTab({ url: '/pages/listings/index' })")
    expect(source).not.toContain("wx.switchTab({ url: '/pages/buildings/index' })")
    expect(source).toMatch(/type === 'listing' \? 'listing-detail' : 'building-detail'/)
    expect(source).toContain('/pages/${page}/index?slug=')
  })

  it('咨询历史按 targetType 导航，general 明确不伪造详情', () => {
    const markup = readPageFile('index.wxml')
    const source = readPageFile('index.ts')

    expect(markup).toContain('wx:for="{{inquiries}}"')
    expect(markup).toContain('{{item.status.label}}')
    expect(markup).toContain('data-target-type="{{item.targetType}}"')
    expect(source).toContain('inquiryDetailRoute')
    expect(source).toMatch(/if \(route === null\)[\s\S]*通用需求暂无详情页/)
    expect(source).not.toMatch(/recordInquiry|addSampleInquiryForDemo|getPendingInquiryCount/)
  })

  it('删除类型逃逸与旧本地演示 API', () => {
    const source = readPageFile('index.ts')
    const favorites = readFileSync(resolve(miniprogramRoot, 'services/favorites.ts'), 'utf8')
    const tracker = readFileSync(resolve(miniprogramRoot, 'services/inquiry-tracker.ts'), 'utf8')
    const combined = `${source}\n${favorites}\n${tracker}`

    expect(combined).not.toMatch(/Record<string,\s*any>|\bas any\b|@ts-ignore|@ts-nocheck/)
    expect(combined).not.toMatch(/toggleListingFavorite|toggleBuildingFavorite|recordInquiry|clearFavoritesForTesting|clearInquiryRecordsForTesting/)
    expect(combined).not.toMatch(/getStorageSync|setStorageSync/)
  })
})
