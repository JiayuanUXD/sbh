/**
 * 单测：C 端公开导航数据（委托找房 / 投放房源 入口调整）
 *
 * 守护不变量：
 *   - 主导航为 6 项，顺序固定，「委托找房」「投放房源」紧跟「共享办公」之后、「资讯」之前；
 *   - 主导航与页脚都不再出现「服务式办公」入口；
 *   - 页脚「服务」分组包含两个新入口。
 */

import { describe, expect, it } from 'vitest'
import { FOOTER_COLUMNS, MAIN_NAV_ITEMS } from '@/lib/frontend/public-nav'

describe('MAIN_NAV_ITEMS', () => {
  it('按固定顺序暴露 6 个入口', () => {
    expect(MAIN_NAV_ITEMS.map((i) => i.label)).toEqual([
      '找办公室',
      '找楼盘',
      '共享办公',
      '委托找房',
      '投放房源',
      '资讯',
    ])
  })

  it('委托找房与投放房源指向独立路由', () => {
    const byLabel = new Map(MAIN_NAV_ITEMS.map((i) => [i.label, i.href]))
    expect(byLabel.get('委托找房')).toBe('/entrust')
    expect(byLabel.get('投放房源')).toBe('/publish')
  })

  it('不再包含服务式办公导航入口', () => {
    expect(MAIN_NAV_ITEMS.some((i) => i.label === '服务式办公')).toBe(false)
    expect(MAIN_NAV_ITEMS.some((i) => i.href.includes('serviced-office'))).toBe(false)
  })
})

describe('FOOTER_COLUMNS', () => {
  it('页脚不再包含服务式办公链接', () => {
    const allLinks = FOOTER_COLUMNS.flatMap((c) => c.links)
    expect(allLinks.some((l) => l.href.includes('serviced-office'))).toBe(false)
  })

  it('页脚「服务」分组包含两个新入口', () => {
    const service = FOOTER_COLUMNS.find((c) => c.title === '服务')
    expect(service).toBeDefined()
    expect(service?.links.map((l) => l.href)).toEqual(['/entrust', '/publish'])
  })
})
