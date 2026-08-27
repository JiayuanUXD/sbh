import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const projectRoot = resolve(import.meta.dirname, '..')
const pageRoot = resolve(projectRoot, 'miniprogram/pages/listings')

function readPageFile(filename: string): string {
  return readFileSync(resolve(pageRoot, filename), 'utf8')
}

describe('房源列表页面合同', () => {
  it('注册下拉刷新、吸顶筛选、半屏筛选、房源卡和状态组件', () => {
    const config = JSON.parse(readPageFile('index.json')) as Record<string, unknown>

    expect(config).toMatchObject({
      navigationBarTitleText: '找办公室',
      enablePullDownRefresh: true,
      usingComponents: {
        'filter-bar': '/components/filter-bar/index',
        'filter-sheet': '/components/filter-sheet/index',
        'listing-card': '/components/listing-card/index',
        'sbh-skeleton': '/components/sbh-skeleton/index',
        'sbh-state': '/components/sbh-state/index',
      },
    })
  })

  it('列表包含 ready 标记、骨架、错误重试、空结果退路、卡片和分页状态', () => {
    const markup = readPageFile('index.wxml')

    expect(markup).toContain('id="listings-ready"')
    expect(markup).toContain('<filter-bar')
    expect(markup).toContain('<filter-sheet')
    expect(markup).toContain('<listing-card')
    expect(markup).toContain('<sbh-skeleton')
    expect(markup).toContain("state === 'error'")
    expect(markup).toContain('bindretry="handleRetry"')
    expect(markup).toContain('refreshError')
    expect(markup).toContain('loadingMore')
    expect(markup).toContain('loadMoreError')
    expect(markup).toContain('bindtap="handleRetryLoadMore"')
  })

  it('空态按零结果、真实逐项放宽、清除全部、顾问即将开放的顺序出现', () => {
    const markup = readPageFile('index.wxml')
    const zeroResult = markup.indexOf('没有找到符合当前条件的房源')
    const relaxations = markup.indexOf('逐项放宽')
    const clearAll = markup.indexOf('清除全部条件')
    const advisor = markup.indexOf('顾问找房功能即将开放')

    expect(zeroResult).toBeGreaterThan(-1)
    expect(relaxations).toBeGreaterThan(zeroResult)
    expect(clearAll).toBeGreaterThan(relaxations)
    expect(advisor).toBeGreaterThan(clearAll)
    expect(markup).toContain('wx:for="{{relaxations}}"')
    expect(markup).toContain('{{item.count}} 套')
    expect(markup).toContain('data-query="{{item.query}}"')
    expect(markup).toContain('bindtap="handleApplyRelaxation"')
    expect(markup).not.toMatch(/<button[^>]*>\s*顾问找房功能即将开放/)
  })

  it('onLoad 只从白名单构造分享查询，真正加载由 onShow consume 决定且手动切 tab 保持现状', () => {
    const source = readPageFile('index.ts')
    const onLoadBlock = /onLoad\(options\)[\s\S]*?\n\s*},/.exec(source)?.[0] ?? ''
    const pendingBranch = /if \(pendingQuery !== null\) \{[\s\S]*?\n\s*}/.exec(source)?.[0] ?? ''

    expect(source).toContain('LISTING_QUERY_OPTION_KEYS')
    expect(source).toContain('buildWhitelistedQuery')
    expect(onLoadBlock).toContain('this.initialQuery = parseListingQuery(buildWhitelistedQuery(options))')
    expect(onLoadBlock).not.toMatch(/\b(?:load|applyFilters)\(/)
    expect(source).toMatch(/onShow\(\)[\s\S]*listingNavigation\.consume\(\)/)
    expect(source).toContain('if (pendingQuery !== null)')
    expect(source).toContain('if (!this.hasLoaded)')
    expect(source).toMatch(/if \(!this\.hasLoaded\)[\s\S]*this\.initialQuery/)
    expect(pendingBranch).toContain('cancelEstimate()')
    expect(pendingBranch).toContain('sheetOpen: false')
  })

  it('filter clear 仅更新草稿估算，最终 apply 才替换列表；关闭面板使估算失效', () => {
    const markup = readPageFile('index.wxml')
    const source = readPageFile('index.ts')
    const clearHandler = /handleFilterClear\(event\) \{[\s\S]*?\n\s*},/.exec(source)?.[0] ?? ''

    expect(markup).toContain('bindestimate="handleFilterEstimate"')
    expect(markup).toContain('bindclear="handleFilterClear"')
    expect(markup).toContain('bindapply="handleFilterApply"')
    expect(markup).toContain('bindclose="handleFilterClose"')
    expect(clearHandler).toContain('estimateDraft')
    expect(clearHandler).not.toContain('applyFilters')
    expect(source).toMatch(/handleFilterApply\([\s\S]*?applyFilters/)
    expect(source).toMatch(/handleFilterClose\(\)[\s\S]*?cancelEstimate/)
  })

  it('页面把估算不可用状态封闭投影到筛选面板', () => {
    const markup = readPageFile('index.wxml')
    const source = readPageFile('index.ts')

    expect(source).toContain('estimateUnavailable: boolean')
    expect(source).toContain('estimateUnavailable: snapshot.estimateUnavailable')
    expect(source).toMatch(/data:[\s\S]*estimateUnavailable: false/)
    expect(markup).toContain('estimate-unavailable="{{estimateUnavailable}}"')
  })

  it('刷新和触底委托控制器，详情只显示固定 toast 而不假导航', () => {
    const source = readPageFile('index.ts')

    expect(source).toMatch(/onPullDownRefresh\(\)[\s\S]*?\.refresh\(\)/)
    expect(source).toMatch(/onReachBottom\(\)[\s\S]*?\.loadNextPage\(\)/)
    expect(source).toContain("title: '详情功能即将开放'")
    expect(source).not.toContain('wx.navigateTo')
    expect(source).not.toMatch(/pages\/listings\/detail|pages\/listing-detail/)
  })

  it('页面使用共享 token、灰底白卡和不小于 88rpx 的核心触达区', () => {
    const styles = readPageFile('index.wxss')

    expect(styles).toContain('var(--sbh-page-background)')
    expect(styles).toContain('var(--sbh-surface-background)')
    expect(styles).toContain('var(--sbh-shape-surface-radius)')
    expect(styles).toMatch(/\.listings-empty__clear[\s\S]*min-height:\s*var\(--sbh-size-touch-target\)/)
    expect(styles).toMatch(/\.listings-relaxation[\s\S]*min-height:\s*var\(--sbh-size-touch-target\)/)
  })
})
