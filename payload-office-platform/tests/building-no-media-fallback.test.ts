import { describe, expect, it } from 'vitest'
import {
  buildBuildingNoMediaKeySpecs,
  buildBuildingNoMediaMeta,
} from '@/components/frontend/building-detail/no-media-fallback'
import { mapBuildingDetail } from '@/domain/public-catalog/mappers'
import type { AmenityGroupViewModel, FactGroupViewModel } from '@/domain/public-catalog'

/**
 * 楼盘详情「无图替代构图」的字段清单守卫（OPT-037 Task 10b）。
 *
 * 这份清单是**按"右侧信息面板已经说了什么"反选出来的**，不是按稿子抄的，所以
 * 它天然招来"怎么连总建筑面积/竣工年份都没有"的好意修改。理由写在
 * `no-media-fallback.ts` 的文件头注释里，但本项目已经证明过注释拦不住
 * （Task 6 的「认证」行就是被注释拦不住的那一类），所以这里用测试锁住。
 */

const CITY = { id: 9, slug: 'shanghai', name: '上海市', type: 'city', status: 'active' }

function buildingDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    slug: 'demo-tower',
    name: '示例大厦',
    address: '上海市静安区示例路 1 号',
    city: CITY,
    district: { id: 2, slug: 'jingan', name: '静安区' },
    buildingType: 'office_building',
    registrationCapability: 'supported',
    totalFloors: 28,
    parkingSpaces: 120,
    developerAndScale: { typicalFloorArea: 1500, efficiencyRate: 70 },
    verticalTransport: { passengerElevators: 6, freightElevators: 1 },
    summary: '面向成长型团队的甲级办公。',
    ...overrides,
  }
}

describe('楼盘无图替代构图 · 关键规格六格', () => {
  it('六格清单固定，且不与信息面板 HERO_FACT_LABELS 的字段重叠', () => {
    const detail = mapBuildingDetail(buildingDoc())!
    const rows = buildBuildingNoMediaKeySpecs(detail)

    expect(rows.map((row) => row.label)).toEqual([
      '物业类型',
      '标准层面积',
      '得房率',
      '客梯',
      '停车位',
      '可注册',
    ])

    // `HeroSummaryPanel.HERO_FACT_LABELS` 用 `label.includes(wanted)` 子串命中，
    // 所以这里也按子串判重——「总建筑面积」会被「建筑面积」命中，「标准层高」
    // 会被「层高」命中。任何一格落进这份清单，就是同一屏里把同一个数字排两遍。
    const heroFactLabels = ['建筑面积', '竣工时间', '物业公司', '物业费', '层高', '总楼层']
    for (const row of rows) {
      expect(heroFactLabels.some((wanted) => row.label.includes(wanted))).toBe(false)
    }
    // 地址 / 地铁 也由信息面板渲染，同样不许出现在宫格或底条里。
    expect(rows.map((row) => row.label)).not.toContain('地址')
    expect(rows.map((row) => row.label)).not.toContain('地铁')
  })

  it('数值格拆成「数值 + 单位」，不把单位排进 32px 大字', () => {
    const rows = buildBuildingNoMediaKeySpecs(mapBuildingDetail(buildingDoc())!)
    const byLabel = (label: string) => rows.find((row) => row.label === label)

    expect(byLabel('标准层面积')).toEqual({ label: '标准层面积', value: '1500', unit: '㎡' })
    expect(byLabel('得房率')).toEqual({ label: '得房率', value: '70', unit: '%' })
    expect(byLabel('客梯')).toEqual({ label: '客梯', value: '6', unit: '部' })
    expect(byLabel('停车位')).toEqual({ label: '停车位', value: '120', unit: '个' })
    // 文本格没有单位字段，不能凭空造一个。
    expect(byLabel('物业类型')).toEqual({ label: '物业类型', value: '写字楼' })
    expect(byLabel('可注册')).toEqual({ label: '可注册', value: '支持注册' })
  })

  it('字段全空的楼盘：六格全部 value=null（渲染 —），绝不出现 0', () => {
    const detail = mapBuildingDetail(
      buildingDoc({
        buildingType: null,
        registrationCapability: null,
        totalFloors: null,
        parkingSpaces: null,
        developerAndScale: {},
        verticalTransport: {},
      }),
    )!
    const rows = buildBuildingNoMediaKeySpecs(detail)
    expect(rows).toHaveLength(6)
    for (const row of rows) {
      expect(row.value).toBeNull()
      expect(row.value).not.toBe('0')
    }
  })

  /**
   * 0 是真实取值时必须照实显示 0（"车位 0 个" 是有意义的事实），
   * 「缺失显示 —」针对的是 null/undefined，两者不能混为一谈。
   */
  it('真实为 0 的字段显示 0，不当作缺失', () => {
    const detail = mapBuildingDetail(buildingDoc({ parkingSpaces: 0 }))!
    const rows = buildBuildingNoMediaKeySpecs(detail)
    expect(rows.find((row) => row.label === '停车位')).toEqual({
      label: '停车位',
      value: '0',
      unit: '个',
    })
  })

  it('手写 FactValue（无 magnitude/unit 的老形态）退回整串，不报错也不丢内容', () => {
    const factGroups: readonly FactGroupViewModel[] = [
      {
        id: 'legacy',
        title: '基本参数',
        facts: [{ label: '标准层面积', value: '约 2200 ㎡', estimated: true, critical: false }],
      },
    ]
    const rows = buildBuildingNoMediaKeySpecs({ factGroups })
    expect(rows.find((row) => row.label === '标准层面积')).toEqual({
      label: '标准层面积',
      value: '约 2200 ㎡（估算）',
    })
  })
})

describe('楼盘无图替代构图 · 底条', () => {
  const amenityGroups: readonly AmenityGroupViewModel[] = [
    { id: 'amenities', title: '配套', items: ['健身房'] },
    { id: 'certifications', title: '认证', items: ['消防验收合格', 'LEED 金级认证'] },
  ]

  it('放「楼盘简介 / 认证」而不是信息面板已经在说的「地址 / 交通」', () => {
    expect(buildBuildingNoMediaMeta({ summary: '甲级办公。', amenityGroups })).toEqual([
      { label: '楼盘简介', value: '甲级办公。' },
      { label: '认证', value: '消防验收合格 · LEED 金级认证' },
    ])
  })

  it('mapper 对缺失 summary 给的空串归一成 null（渲染 —，不是一格空白）', () => {
    expect(
      buildBuildingNoMediaMeta({ summary: '   ', amenityGroups: [] }),
    ).toEqual([
      { label: '楼盘简介', value: null },
      { label: '认证', value: null },
    ])
  })
})
