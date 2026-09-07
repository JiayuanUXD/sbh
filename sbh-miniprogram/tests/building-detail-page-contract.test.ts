import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = resolve(import.meta.dirname, '..')
const pageRoot = resolve(projectRoot, 'miniprogram/pages/building-detail')

function readPageFile(filename: string): string {
  return readFileSync(resolve(pageRoot, filename), 'utf8')
}

describe('楼盘详情页面合同', () => {
  it('注册页面组件与标题', () => {
    const config = JSON.parse(readPageFile('index.json')) as Record<string, unknown>

    expect(config).toMatchObject({
      navigationBarTitleText: '楼盘详情',
      usingComponents: {
        'sbh-skeleton': '../../components/sbh-skeleton/index',
        'sbh-state': '../../components/sbh-state/index',
        'inquiry-sheet': '/components/inquiry-sheet/index',
      },
    })
  })

  it('模板包含画廊、4格参数、在租房源分组、楼盘参数、通勤位置与底部操作栏', () => {
    const template = readPageFile('index.wxml')

    expect(template).toContain('id="building-detail-ready"')
    expect(template).toContain('building-gallery')
    expect(template).toContain('building-stats-card')
    expect(template).toContain('building-listings-card')
    expect(template).toContain('building-params-card')
    expect(template).toContain('building-location-card')
    expect(template).toContain('building-bottom-bar')
    expect(template).toContain('找顾问问楼')
    expect(template).toContain('handleListingOpen')
  })

  it('画廊、房源与可比楼盘图片都按独立身份降级并保留可读替代文本', () => {
    const template = readPageFile('index.wxml')
    const source = readPageFile('index.ts')

    expect(template).toMatch(/building-gallery__image[\s\S]*alt="\{\{item\.alt \|\| building\.name\}\}"[\s\S]*binderror="handleGalleryImageError"/)
    expect(template).toMatch(/building-listing-image[\s\S]*alt="\{\{item\.coverImage\.alt \|\| item\.title\}\}"[\s\S]*binderror="handleListingImageError"/)
    expect(template).toMatch(/building-comparable-image[\s\S]*alt="\{\{item\.coverImage\.alt \|\| item\.name\}\}"[\s\S]*binderror="handleComparableImageError"/)
    expect(source).toContain('markImageFailed')
    expect(template.match(/>尚办好<\/view>/g)?.length ?? 0).toBeGreaterThanOrEqual(4)
  })

  it('脚本包含跳转房源详情与可比楼盘的穿梭逻辑', () => {
    const source = readPageFile('index.ts')

    expect(source).toContain('loadBuildingDetail')
    expect(source).toContain('handleListingOpen')
    expect(source).toContain('/pages/listing-detail/index?slug=')
    expect(source).toContain('handleComparableOpen')
    expect(source).toContain('/pages/building-detail/index?slug=')
  })

  it('楼盘咨询复用 Task 4 building target 真实 inquiry sheet', () => {
    const source = readPageFile('index.ts')
    const template = readPageFile('index.wxml')

    expect(source).toContain('createInquirySheetController')
    expect(source).toContain('createInquiryService')
    expect(source).toContain("targetType: 'building'")
    expect(source).toContain('buildingSlug: building.slug')
    expect(source).toContain('policyVersion: building.inquiryPolicy.version')
    expect(source).not.toContain("policyVersion: 'MVP-R1'")
    expect(source).toMatch(/snapshot\.state === 'success'[\s\S]*refreshUserAssets\(\)/)
    expect(template).toContain('<inquiry-sheet')
    expect(template).toContain('snapshot="{{inquirySheet}}"')
    expect(source).not.toMatch(/recordInquiry|待带看|已接单|30\s*分钟内/)
    expect(template).not.toMatch(/待带看|已接单|30\s*分钟内/)
  })

  it('楼盘收藏异步等待服务端确认并用 busy 防重复', () => {
    const source = readPageFile('index.ts')
    const template = readPageFile('index.wxml')
    const styles = readPageFile('index.wxss')

    expect(source).toContain('setFavorite')
    expect(source).toContain('loadUserAssets')
    expect(source).toMatch(/async handleFav\(\)[\s\S]*if \(this\.data\.favoriteBusy\) return[\s\S]*await setFavorite/)
    expect(source).toMatch(/catch[\s\S]*收藏状态更新失败/)
    expect(source).not.toMatch(/toggleBuildingFavorite|isBuildingFavorite/)
    expect(template).toContain("{{favoriteBusy ? '处理中' : (isFavorited ? '已收藏' : '收藏')}}")
    expect(template).toMatch(/building-bottom-fav[\s\S]*aria-role="button"[\s\S]*aria-label="\{\{favoriteBusy \? '收藏处理中' : \(isFavorited \? '取消收藏' : '收藏'\)\}\}"/)
    expect(styles).toMatch(/\.building-bottom-fav\s*\{[\s\S]*min-width:\s*var\(--sbh-size-touch-target\);[\s\S]*min-height:\s*var\(--sbh-size-touch-target\);/)
  })

  it('只展示 DTO 支持的楼盘事实，缺失值使用横线或隐藏且不渲染地图占位', () => {
    const template = readPageFile('index.wxml')

    for (const unsupportedCopy of [
      '商办认证',
      '可注册',
      '专业港资',
      '知名物业',
      '上海核心商务区',
      '30分钟内',
      '30 分钟内',
    ]) {
      expect(template).not.toContain(unsupportedCopy)
    }
    expect(template).not.toContain('building-map-preview')
    expect(template).not.toContain('building-map-placeholder')
    expect(template).not.toContain('building-map-pin')
    expect(template).not.toMatch(/placeholder[^>]*>[^<]*图/)
    expect(template).toContain("building.propertyManagementCompany || '—'")
    expect(template).toContain("building.district || '—'")
  })
})
