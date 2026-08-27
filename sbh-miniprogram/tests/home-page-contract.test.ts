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

  it('MP-104 前不导航到不存在的详情页，点击只记录 slug 并给非阻断提示', () => {
    const source = readPageFile('index.ts')

    expect(source).not.toMatch(/pages\/listings\/detail|pages\/listing-detail/)
    expect(source).toContain('lastOpenedListingSlug')
    expect(source).toContain('详情功能即将开放')
    expect(source).toContain('wx.showToast')
  })
})
