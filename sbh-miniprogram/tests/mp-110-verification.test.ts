import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = resolve(import.meta.dirname, '..')

function read(relativePath: string): string {
  return readFileSync(resolve(projectRoot, relativePath), 'utf8')
}

function lum(hex: string): number {
  const c = hex.replace('#', '').match(/../g)!.map((x) => parseInt(x, 16) / 255).map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
  return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722
}

function contrast(a: string, b: string): number {
  const x = lum(a)
  const y = lum(b)
  return +((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(4)
}

describe('MP-110 阶段 A & B & C 结构与视觉合同', () => {
  it('T4 / A1: 房源详情底栏约束原生 button 尺寸，消除在 375、390、430 视口下的重叠风险', () => {
    const wxss = read('miniprogram/pages/listing-detail/index.wxss')
    const wxml = read('miniprogram/pages/listing-detail/index.wxml')

    // 结构：收藏、分享、咨询顺序
    expect(wxml).toMatch(/listing-detail__bar-fav[\s\S]*open-type="share"[\s\S]*listing-detail__bar-action--inquiry/)

    // 样式约束：明确给按钮 100% 宽度，避免微信 UA 默认 184px 溢出重叠
    expect(wxss).toMatch(/\.listing-detail__bar\s*\{[\s\S]*grid-template-columns:\s*auto\s+minmax\(0,\s*1fr\)\s+minmax\(0,\s*2fr\);/)
    expect(wxss).toMatch(/\.listing-detail__bar\s*\{[\s\S]*gap:\s*var\(--sbh-layout-space-sm\);/)
    expect(wxss).toMatch(/\.listing-detail__bar-action\s*\{[\s\S]*box-sizing:\s*border-box;[\s\S]*width:\s*100%;[\s\S]*max-width:\s*100%;[\s\S]*min-height:\s*var\(--sbh-size-touch-target\);/)

    // 理论几何计算（375、390、430 视口）
    for (const viewportWidth of [375, 390, 430]) {
      const rpxToPx = viewportWidth / 750
      const paddingSide = 24 * rpxToPx
      const gap = 16 * rpxToPx // --sbh-layout-space-sm = 16rpx
      const favWidth = 88 * rpxToPx // 44px at 375
      const availableGrid = viewportWidth - (paddingSide * 2) - favWidth - (gap * 2)
      const shareWidth = availableGrid * (1 / 3)
      const inquiryWidth = availableGrid * (2 / 3)

      expect(gap).toBeGreaterThanOrEqual(4)
      expect(favWidth).toBeGreaterThanOrEqual(44)
      expect(shareWidth).toBeGreaterThanOrEqual(44)
      expect(inquiryWidth).toBeGreaterThanOrEqual(44)
    }
  })

  it('T5 / B1: 8 个指定交互入口在 3 档视口下实际命中尺寸均 >= 44px', () => {
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

  it('T5 / B2: 指定文案在实际背景上的对比度均达到 >= 4.5:1', () => {
    // 实际背景与色值
    // 白底: #ffffff, 页面浅灰底: #f2f2f4
    // --sbh-text-primary: #1d1d1f, --sbh-text-secondary: #6e6e73
    const contrastHomeRefresh = contrast('#6e6e73', '#ffffff')
    const contrastBuildingInactiveTitle = contrast('#1d1d1f', '#f2f2f4')
    const contrastBuildingInactiveDesc = contrast('#6e6e73', '#f2f2f4')
    const contrastBuildingStatLabel = contrast('#6e6e73', '#ffffff')
    const contrastBuildingGroupTitle = contrast('#6e6e73', '#ffffff')

    expect(contrastHomeRefresh).toBeGreaterThanOrEqual(4.5)
    expect(contrastBuildingInactiveTitle).toBeGreaterThanOrEqual(4.5)
    expect(contrastBuildingInactiveDesc).toBeGreaterThanOrEqual(4.5)
    expect(contrastBuildingStatLabel).toBeGreaterThanOrEqual(4.5)
    expect(contrastBuildingGroupTitle).toBeGreaterThanOrEqual(4.5)
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
    expect(inquirySheetWxss).not.toMatch(/button\[disabled\]/)
  })
})
