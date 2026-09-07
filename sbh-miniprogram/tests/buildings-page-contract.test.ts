import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = resolve(import.meta.dirname, '..')
const pageRoot = resolve(projectRoot, 'miniprogram/pages/buildings')
const buildingCardRoot = resolve(projectRoot, 'miniprogram/components/building-card')

function readPageFile(filename: string): string {
  return readFileSync(resolve(pageRoot, filename), 'utf8')
}

describe('楼盘列表页面合同', () => {
  it('注册下拉刷新、状态组件与楼盘卡', () => {
    const config = JSON.parse(readPageFile('index.json')) as Record<string, unknown>

    expect(config).toMatchObject({
      navigationBarTitleText: '楼盘',
      enablePullDownRefresh: true,
      usingComponents: {
        'building-card': '../../components/building-card/index',
        'sbh-skeleton': '../../components/sbh-skeleton/index',
        'sbh-state': '../../components/sbh-state/index',
      },
    })
  })

  it('模板包含吸顶筛选、在租卡块、暂无在租楼盘独立下沉分组和就绪标记', () => {
    const template = readPageFile('index.wxml')

    expect(template).toContain('id="buildings-ready"')
    expect(template).toContain('class="buildings-filter-bar"')
    expect(template).toContain('class="buildings-summary"')
    expect(template).toContain('class="buildings-card-block"')
    expect(template).toContain('class="buildings-inactive-section"')
    expect(template).toContain('暂无在租楼盘')
    expect(template).toContain('building-card')
    expect(template).toContain('bindopen="handleBuildingOpen"')
  })

  it('脚本包含筛选逻辑与跳转楼盘详情', () => {
    const source = readPageFile('index.ts')

    expect(source).toContain('loadBuildings')
    expect(source).toContain('handleBuildingOpen')
    expect(source).toContain('/pages/building-detail/index?slug=')
    expect(source).toContain('handleDistrictFilter')
    expect(source).toContain('handleGradeFilter')
    expect(source).toContain('handleSortFilter')
  })

  it('等级筛选发送公开合同枚举，不再伪装为 A/B', () => {
    const source = readPageFile('index.ts')

    for (const grade of ['grade-a', 'super-grade-a', 'creative-park', 'serviced-office']) {
      expect(source).toContain(`'${grade}'`)
    }
    expect(source).not.toMatch(/gradeMap[\s\S]*?['"]A['"]|gradeMap[\s\S]*?['"]B['"]/)
  })

  it('默认排序如实显示服务端的在租数量排序，不伪称综合排序', () => {
    const template = readPageFile('index.wxml')
    const source = readPageFile('index.ts')

    expect(source).toContain("sortLabel: '在租最多'")
    expect(template).not.toContain('综合排序')
    expect(source).not.toContain('综合排序')
  })

  it('暂无在租楼盘只陈述 DTO 事实，不伪造通知成功或提供未接线留资动作', () => {
    const template = readPageFile('index.wxml')
    const source = readPageFile('index.ts')
    const cardTemplate = readFileSync(resolve(buildingCardRoot, 'index.wxml'), 'utf8')

    expect(template).toContain('暂无在租')
    expect(template).not.toContain('可留资等通知')
    expect(template).not.toContain('有房源时通知你')
    expect(template).not.toContain('bindinquiry="handleBuildingInquiry"')
    expect(source).not.toContain('handleBuildingInquiry')
    expect(source).not.toContain("icon: 'success'")
    expect(cardTemplate).toContain('wx:if="{{inquiryEnabled && building.activeListingCount === 0}}"')
  })

  it('共享楼盘卡缺图使用不含“图”字的中性品牌占位', () => {
    const cardTemplate = readFileSync(resolve(buildingCardRoot, 'index.wxml'), 'utf8')

    expect(cardTemplate).toContain('class="building-card__placeholder">尚办好</view>')
    expect(cardTemplate).not.toContain('暂无图片')
  })
})
