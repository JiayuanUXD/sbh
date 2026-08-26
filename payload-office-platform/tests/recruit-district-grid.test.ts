import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import RecruitDistrictGrid, {
  recruitDistrictLead,
  type RecruitDistrict,
} from '@/components/frontend/city-partner/RecruitDistrictGrid'

function district(overrides: Partial<RecruitDistrict> = {}): RecruitDistrict {
  return {
    id: 4,
    slug: 'nanjing-west-road',
    name: '南京西路',
    type: 'business_area',
    parentName: '静安区',
    description: '上海高端商务、零售与企业总部办公核心商圈。',
    ...overrides,
  }
}

function render(props: Parameters<typeof RecruitDistrictGrid>[0]): string {
  return renderToStaticMarkup(React.createElement(RecruitDistrictGrid, props))
}

describe('recruit district grid', () => {
  it('renders nothing at all when the city has no featured regions', () => {
    // 空态整段不渲染：只剩标题与「即将覆盖……」的空货架比不渲染更糟。
    // 这里没有「诚实空态」可言——商圈列表不是用户发起的查询，给不出下一步动作。
    expect(render({ cityName: '嘉兴', districts: [] })).toBe('')
  })

  it('joins the locality from parent district and description, and omits the line when both are missing', () => {
    const markup = render({
      cityName: '上海',
      districts: [
        district(),
        district({ id: 2, slug: 'jingan', name: '静安区', type: 'district', parentName: null }),
        district({ id: 11, slug: 'hongqiao', name: '虹桥', parentName: null, description: null }),
      ],
    })

    expect(markup).toContain('静安区 · 上海高端商务、零售与企业总部办公核心商圈。')
    // 行政区的上级就是本城，parentName 恒为 null → 只剩区域介绍，不重复城市名
    expect(markup).not.toContain('上海 · ')
    // 两段都缺 → 整行不渲染。**不是**一个「—」：那条约束是数字口径，
    // 六个商圈都没填时会摆出一整排破折号。
    expect(markup.match(/rc-district__area/g)).toHaveLength(2)
    expect(markup).not.toContain('—')
    // 名字这一行始终在，六格数量与入参一致
    expect(markup.match(/class="rc-district"/g)).toHaveLength(3)
  })

  it('renders every region uniformly, with no first-batch / preparing status label', () => {
    // 工作项 §3.3 的裁定：整条数据链路没有「招募位状态」这个维度，
    // 按列表位置挑前三个标成「首批上线」= 编造。这条守卫钉住裁定本身。
    const markup = render({
      cityName: '杭州',
      districts: Array.from({ length: 6 }, (_, index) =>
        district({ id: index + 1, slug: `area-${index + 1}`, name: `商圈 ${index + 1}` }),
      ),
    })

    expect(markup).not.toMatch(/首批|筹备中|规划服务区/)
    expect(markup.match(/class="rc-district"/g)).toHaveLength(6)
  })

  it('drops the copy that promised a distinction the UI does not make', () => {
    // 稿子原文是「首批三个商圈开放独家席位，其余为筹备中」。文案与界面必须同口径：
    // 界面统一渲染，文案就不能承诺批次。
    const lead = recruitDistrictLead('杭州')
    expect(lead).toContain('即将覆盖杭州核心商务区与高新产业聚集地')
    expect(lead).not.toMatch(/首批|独家席位|筹备中/)
    expect(lead).toContain('暂不区分开放批次')
  })
})
