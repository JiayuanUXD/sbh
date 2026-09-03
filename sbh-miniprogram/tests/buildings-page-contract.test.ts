import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = resolve(import.meta.dirname, '..')
const pageRoot = resolve(projectRoot, 'miniprogram/pages/buildings')

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

  it('模板包含吸顶筛选、在租卡块、暂无在租独立下沉分组和就绪标记', () => {
    const template = readPageFile('index.wxml')

    expect(template).toContain('id="buildings-ready"')
    expect(template).toContain('class="buildings-filter-bar"')
    expect(template).toContain('class="buildings-summary"')
    expect(template).toContain('class="buildings-card-block"')
    expect(template).toContain('class="buildings-inactive-section"')
    expect(template).toContain('暂无在租 · 可留资等通知')
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
})
