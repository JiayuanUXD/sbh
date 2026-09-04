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

    expect(source).toContain('setFavorite')
    expect(source).toContain('loadUserAssets')
    expect(source).toMatch(/async handleFav\(\)[\s\S]*if \(this\.data\.favoriteBusy\) return[\s\S]*await setFavorite/)
    expect(source).toMatch(/catch[\s\S]*收藏状态更新失败/)
    expect(source).not.toMatch(/toggleBuildingFavorite|isBuildingFavorite/)
    expect(template).toContain("{{favoriteBusy ? '处理中' : (isFavorited ? '已收藏' : '收藏')}}")
  })
})
