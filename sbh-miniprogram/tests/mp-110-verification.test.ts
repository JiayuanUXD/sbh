import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = resolve(import.meta.dirname, '..')

function read(relativePath: string): string {
  return readFileSync(resolve(projectRoot, relativePath), 'utf8')
}

describe('MP-110 源码约束', () => {
  it('T4 / A1: 房源详情底栏约束原生 button 的网格尺寸', () => {
    const wxss = read('miniprogram/pages/listing-detail/index.wxss')
    const wxml = read('miniprogram/pages/listing-detail/index.wxml')

    // 结构：收藏、分享、咨询顺序
    expect(wxml).toMatch(/listing-detail__bar-fav[\s\S]*open-type="share"[\s\S]*listing-detail__bar-action--inquiry/)

    // 样式约束：明确给按钮 100% 宽度，避免微信 UA 默认 184px 溢出重叠
    expect(wxss).toMatch(/\.listing-detail__bar\s*\{[\s\S]*grid-template-columns:\s*auto\s+minmax\(0,\s*1fr\)\s+minmax\(0,\s*2fr\);/)
    expect(wxss).toMatch(/\.listing-detail__bar\s*\{[\s\S]*gap:\s*var\(--sbh-layout-space-sm\);/)
    expect(wxss).toMatch(/\.listing-detail__bar-action\s*\{[\s\S]*box-sizing:\s*border-box;[\s\S]*width:\s*100%;[\s\S]*max-width:\s*100%;[\s\S]*min-height:\s*var\(--sbh-size-touch-target\);/)
  })

  it('T5 / B1: 8 个指定交互入口使用最小触控尺寸样式', () => {
    const homeWxss = read('miniprogram/pages/home/index.wxss')
    const listingsWxss = read('miniprogram/pages/listings/index.wxss')
    const buildingsWxss = read('miniprogram/pages/buildings/index.wxss')
    const profileWxss = read('miniprogram/pages/profile/index.wxss')

    // 1. 首页搜索提交
    expect(homeWxss).toMatch(/\.home-search__submit\s*\{[\s\S]*min-width:\s*var\(--sbh-size-touch-target\);[\s\S]*min-height:\s*var\(--sbh-size-touch-target\);/)

    // 2. 首页全部楼盘
    expect(homeWxss).toMatch(/\.home-buildings__all\s*\{[\s\S]*min-height:\s*var\(--sbh-size-touch-target\);[\s\S]*min-width:\s*var\(--sbh-size-touch-target\);/)

    // 3. 找房搜索输入
    expect(listingsWxss).toMatch(/\.listings-search-bar\s*\{[\s\S]*min-height:\s*var\(--sbh-size-touch-target\);/)

    // 4. 找房排序
    expect(listingsWxss).toMatch(/\.listings-summary__sort\s*\{[\s\S]*min-height:\s*var\(--sbh-size-touch-target\);[\s\S]*min-width:\s*var\(--sbh-size-touch-target\);/)

    // 5, 6, 7. 楼盘区域筛选、等级筛选、排序
    expect(buildingsWxss).toMatch(/\.buildings-filter-item\s*\{[\s\S]*height:\s*100%;[\s\S]*min-height:\s*var\(--sbh-size-touch-target\);/)

    // 8. 我的连接失败重新连接
    expect(profileWxss).toMatch(/\.profile-connect-error__action\s*\{[\s\S]*min-width:\s*152rpx;[\s\S]*min-height:\s*var\(--sbh-size-touch-target\);/)
  })

  it('T6 / C1: 首页背景媒体收口为静态图片与降级，不声明未验证的视频能力', () => {
    const homeWxml = read('miniprogram/pages/home/index.wxml')
    const homeTs = read('miniprogram/pages/home/index.ts')

    expect(homeWxml).not.toContain('<video')
    expect(homeWxml).toContain('class="home-brand__poster"')
    expect(homeTs).not.toContain('heroVideoUrl')
    expect(homeTs).not.toContain('handleVideoError')
  })

  it('T6 / C2: 两类详情页在 onShow 生命周期中重新同步收藏状态', () => {
    const buildingTs = read('miniprogram/pages/building-detail/index.ts')
    const listingTs = read('miniprogram/pages/listing-detail/index.ts')

    expect(buildingTs).toMatch(/onShow\(\)[\s\S]*loadFavoriteState\(this\.data\.slug\)/)
    expect(listingTs).toMatch(/onShow\(\)[\s\S]*loadFavoriteState\(this\.data\.slug\)/)
    expect(buildingTs).not.toContain('toggleBuildingFavorite')
  })

  it('T6 / C4: 组件 WXSS 中不含非法标签名或属性选择器警告规则', () => {
    const listingCardWxss = read('miniprogram/components/listing-card/index.wxss')
    const buildingCardWxss = read('miniprogram/components/building-card/index.wxss')
    const inquirySheetWxss = read('miniprogram/components/inquiry-sheet/index.wxss')

    expect(listingCardWxss).not.toMatch(/\.listing-card__media\s+image/)
    expect(buildingCardWxss).not.toMatch(/\.building-card__media\s+image/)
    expect(inquirySheetWxss).not.toMatch(/\[\s*disabled\s*\]/)
  })
})
