import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const projectRoot = resolve(import.meta.dirname, '..')
const pageRoot = resolve(projectRoot, 'miniprogram/pages/home')

function readPageFile(filename: string): string {
  return readFileSync(resolve(pageRoot, filename), 'utf8')
}

describe('首页页面合同', () => {
  it('注册下拉刷新、状态组件与房源卡', () => {
    const config = JSON.parse(readPageFile('index.json')) as Record<string, unknown>

    expect(config).toMatchObject({
      navigationBarTitleText: '尚办好',
      enablePullDownRefresh: true,
      usingComponents: {
        'building-card': '/components/building-card/index',
        'listing-card': '/components/listing-card/index',
        'sbh-skeleton': '/components/sbh-skeleton/index',
        'sbh-state': '/components/sbh-state/index',
      },
    })
  })

  it('首屏按短品牌区、搜索、API 快捷筛选、精选房源排序', () => {
    const template = readPageFile('index.wxml')
    const brand = template.indexOf('home-brand')
    const search = template.indexOf('home-search')
    const quickFilters = template.indexOf('home-quick-filters')
    const featured = template.indexOf('home-featured')

    expect(brand).toBeGreaterThan(-1)
    expect(search).toBeGreaterThan(brand)
    expect(quickFilters).toBeGreaterThan(search)
    expect(featured).toBeGreaterThan(quickFilters)
    expect(template).toContain('wx:for="{{content.quickFilters}}"')
    expect(template).toContain('wx:for="{{item.options}}"')
    expect(template).toContain('bindopen="handleListingOpen"')
    expect(template).toContain('data-query="{{item.query}}"')
  })

  it('输入只更新本地值，提交后才导航，并展示首载与刷新错误的不同反馈', () => {
    const template = readPageFile('index.wxml')
    const source = readPageFile('index.ts')

    expect(template).toContain('bindinput="handleKeywordInput"')
    expect(template).toContain('bindconfirm="handleSearchSubmit"')
    expect(template).toContain('bindtap="handleSearchSubmit"')
    expect(template).toContain("state === 'loading'")
    expect(template).toContain("state === 'error'")
    expect(template).toContain('refreshError')
    expect(template).toContain('bindretry="handleRetry"')
    expect(source).toMatch(/handleKeywordInput[\s\S]*setData\(\{ keyword:/)
    expect(source).toMatch(/handleSearchSubmit[\s\S]*this\.openListings/)
    expect(source).toMatch(/handleRetry\(\)[\s\S]*this\.loadHome\(false\)/)
    expect(source).not.toContain('wx.navigateTo')
    expect(source).toContain('listingNavigation.open(query)')
    expect(source).toContain('暂时无法打开找房页')
  })

  it('单城市阶段不伪装可交互城市下拉', () => {
    const template = readPageFile('index.wxml')
    const styles = readPageFile('index.wxss')

    expect(template).toContain('当前城市 · 上海')
    expect(template).not.toContain('home-search__arrow')
    expect(template).not.toContain('home-search__divider')
    expect(styles).not.toMatch(/\.home-search__(?:arrow|divider)\s*\{/)
  })

  it('品牌区保持 320–360rpx，页面加载具备请求版本守卫且刷新最终停止', () => {
    const styles = readPageFile('index.wxss')
    const source = readPageFile('index.ts')
    const brandHeight = /\.home-brand\s*\{[\s\S]*?height:\s*(\d+)rpx;/.exec(styles)

    expect(Number(brandHeight?.[1])).toBeGreaterThanOrEqual(320)
    expect(Number(brandHeight?.[1])).toBeLessThanOrEqual(360)
    expect(source).toContain("catalog.getHome('shanghai')")
    expect(source).toContain('createHomeLoadController')
    expect(source).toContain('stopPullDownRefresh: () => wx.stopPullDownRefresh()')
  })

  it('点击精选房源统一调用安全详情导航，失败时给非阻断提示', () => {
    const source = readPageFile('index.ts')

    expect(source).toMatch(/handleListingOpen[\s\S]*listingNavigation\.openDetail\(slug\)/)
    expect(source).not.toContain('详情功能即将开放')
    expect(source).toContain('暂时无法打开房源详情')
    expect(source).toContain('wx.showToast')
  })

  it('精选楼盘循环消费 content.featuredBuildings，并为真实空数组展示空态', () => {
    const template = readPageFile('index.wxml')

    expect(template).toContain('wx:for="{{content.featuredBuildings}}"')
    expect(template).toContain('<building-card')
    expect(template).toContain('building="{{item}}"')
    expect(template).toContain('bindopen="handleBuildingOpenDirect"')
    expect(template).toContain('!content.featuredBuildings.length')
    expect(template).toContain('暂无精选楼盘')
    expect(template).not.toMatch(/heng-long-plaza|wheelock-square|hkri-taikoo-hui/)
    expect(template).not.toMatch(/恒隆广场|越洋国际广场|兴业太古汇/)
    expect(template).not.toMatch(/14 套|9 套|7 套|10\.2 起|6\.8 起|11\.4 起/)
  })

  it('首页不展示无真实 DTO 的售卖、认证背书、伪筛选或时效承诺', () => {
    const template = readPageFile('index.wxml')
    const source = readPageFile('index.ts')
    const combined = `${template}\n${source}`

    for (const unsupportedCopy of [
      '售卖专区',
      '12,000 元/㎡',
      '在租房源实时同步',
      '逐条核过',
      '逐条实勘',
      '30 分钟内',
    ]) {
      expect(combined).not.toContain(unsupportedCopy)
    }
    expect(template).not.toMatch(/bindtap="handleAssuranceTap"/)
    expect(template).not.toMatch(/>附近<|>新上</)
    expect(source).not.toContain('handleAssuranceTap')
    expect(source).not.toContain("icon: 'success'")
  })

  it('本地验收路由 mock 使用当前楼盘枚举、24 条分页和必填精选楼盘', () => {
    const mockServer = readFileSync(resolve(projectRoot, 'scripts/acceptance-mock-server.mjs'), 'utf8')

    expect(mockServer).toContain('featuredBuildings: mockBuildings')
    expect(mockServer).toMatch(/pageSize:\s*24/)
    expect(mockServer).toMatch(/grade:\s*'grade-a'/)
    expect(mockServer).not.toMatch(/grade:\s*'[ABC]'/)
  })
})
