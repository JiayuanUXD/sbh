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
})
