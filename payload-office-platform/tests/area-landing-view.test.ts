import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/shanghai/area/xuhui',
}))

import AreaLandingView from '@/components/frontend/city/AreaLandingView'
import { summarizeAreaPrice } from '@/domain/public-catalog/area-landing'
import type { AreaLandingEntry, AreaLandingPage } from '@/domain/public-catalog/area-landing-facade'
import type { ArticleCardViewModel, BuildingSummaryViewModel } from '@/domain/public-catalog/contracts'

function entry(overrides: Partial<AreaLandingEntry> = {}): AreaLandingEntry {
  return {
    kind: 'district', id: 15, slug: 'xuhui', name: '徐汇区', parentSlug: null, parentName: null, listingCount: 6216, buildingCount: 323,
    priceSampleCount: 6200, priceMin: 1.4, priceP25: 3.96, priceMedian: 4.31, priceP75: 5.1, priceMax: 9.78, otherUnitCount: 16,
    areaMedian: 313, lastUpdatedAt: '2026-10-15T08:00:00.000Z', description: null, indexable: true, ...overrides,
  }
}
const caohejing = entry({ kind: 'business_area', id: 40, slug: 'caohejing', name: '漕河泾', parentSlug: 'xuhui', parentName: '徐汇区', listingCount: 1837, priceMedian: 4.14 })
const longhua = entry({ kind: 'business_area', id: 41, slug: 'longhua', name: '龙华', parentSlug: 'xuhui', parentName: '徐汇区', listingCount: 1052, priceSampleCount: 3 })
const building = { id: 1, slug: 'fenglin-park', name: '枫林科创园', address: '枫林路', citySlug: 'shanghai', cityName: '上海', listingCount: 388, leasableArea: 20000 } as BuildingSummaryViewModel
const article: ArticleCardViewModel = { id: 9, slug: 'xuhui-guide', title: '徐汇办公选址指南', category: 'guide', excerpt: null, coverImage: null, publishedAt: '2026-10-01T00:00:00.000Z', updatedAt: null, stableSortKey: 'article-9' }

function page(overrides: Partial<AreaLandingPage> = {}): AreaLandingPage {
  const e = overrides.entry ?? entry()
  return { entry: e, parent: null, childAreas: [caohejing, longhua], siblingAreas: [], price: summarizeAreaPrice(e), topBuildings: [building], articles: [article], ...overrides }
}

const city = { slug: 'shanghai', name: '上海' }
const render = (p: AreaLandingPage) => renderToStaticMarkup(createElement(AreaLandingView, { city, page: p }))

describe('AreaLandingView', () => {
  it('恰好一个 H1，写区域名 + 写字楼出租', () => {
    const html = render(page())
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1)
    expect(html).toMatch(/<h1[^>]*>徐汇区写字楼出租<\/h1>/)
  })

  it('数据摘要：在租套数、楼盘数、租金中位数都来自统计行，且注明挂牌价', () => {
    const html = render(page())
    expect(html).toContain('6,216')
    expect(html).toContain('323')
    expect(html).toContain('4.31')
    expect(html).toContain('挂牌价')
    expect(html).toContain('2026.10.15')
  })

  it('租金参考区块：分位区间、100㎡ 月租估算与估算口径', () => {
    const html = render(page())
    expect(html).toContain('3.96')
    expect(html).toContain('5.10')
    expect(html).toContain('12,930')
    expect(html).toContain('× 30')
  })

  it('价格样本不足时整块租金参考不渲染，也不出现 0 或占位数字', () => {
    const thin = entry({ priceSampleCount: 2 })
    // 不带下辖商圈：商圈卡自己有（足量样本的）中位价，会让「整页没有元/㎡/天」这条断言失真
    const html = render(page({ entry: thin, price: summarizeAreaPrice(thin), childAreas: [] }))
    expect(html).not.toContain('租金参考')
    expect(html).not.toContain('元/㎡/天')
  })

  it('行政区页：下辖商圈互链到落地页；样本不足的商圈不显示中位价', () => {
    const html = render(page())
    expect(html).toContain('href="/shanghai/area/caohejing"')
    expect(html).toContain('href="/shanghai/area/longhua"')
    expect(html).toMatch(/漕河泾[\s\S]*?4\.14/)
    const longhuaBlock = html.slice(html.indexOf('/shanghai/area/longhua'))
    expect(longhuaBlock.slice(0, longhuaBlock.indexOf('</a>'))).not.toContain('元/㎡/天')
  })

  it('商圈页：面包屑与「同区商圈」链到行政区，且筛选入口使用 businessArea 参数', () => {
    const area = entry({ kind: 'business_area', id: 40, slug: 'caohejing', name: '漕河泾', parentSlug: 'xuhui', parentName: '徐汇区' })
    const html = render(page({ entry: area, parent: entry(), childAreas: [], siblingAreas: [longhua] }))
    expect(html).toContain('href="/shanghai/area/xuhui"')
    expect(html).toContain('href="/shanghai/listings?businessArea=caohejing"')
    expect(html).toContain('href="/shanghai/buildings?businessArea=caohejing"')
    expect(html).toContain('href="/shanghai/area/longhua"')
  })

  it('行政区页的筛选入口使用 district 参数', () => {
    const html = render(page())
    expect(html).toContain('href="/shanghai/listings?district=xuhui"')
    expect(html).toContain('href="/shanghai/buildings?district=xuhui"')
  })

  it('热门楼盘与相关资讯：有数据才渲染对应分区', () => {
    const html = render(page())
    expect(html).toContain('枫林科创园')
    expect(html).toContain('href="/shanghai/buildings/fenglin-park"')
    expect(html).toContain('徐汇办公选址指南')
    expect(html).toContain('href="/news/xuhui-guide"')
    const bare = render(page({ topBuildings: [], articles: [] }))
    expect(bare).not.toContain('热门楼盘')
    expect(bare).not.toContain('相关资讯')
  })

  it('FAQ 由数字生成并可见（不是隐藏的 JSON）', () => {
    const html = render(page())
    expect(html).toContain('常见问题')
    expect(html).toContain('徐汇区写字楼租金大概多少？')
    expect(html).toContain('不是成交价')
  })

  it('优先使用运营写的介绍', () => {
    const html = render(page({ entry: entry({ description: '运营手写的徐汇介绍。' }) }))
    expect(html).toContain('运营手写的徐汇介绍。')
  })

  it('零供给：诚实空态，不出现 0 套 / 租金区块，并给出回到全城的出口', () => {
    const empty = entry({ listingCount: 0, buildingCount: 0, priceSampleCount: 0, priceMin: null, priceP25: null, priceMedian: null, priceP75: null, priceMax: null, lastUpdatedAt: null, indexable: false })
    const html = render({ entry: empty, parent: null, childAreas: [], siblingAreas: [], price: null, topBuildings: [], articles: [] })
    expect(html).toContain('暂无在租房源')
    expect(html).not.toContain('租金参考')
    expect(html).not.toContain('常见问题')
    expect(html).toContain('href="/shanghai/listings"')
    expect(html).not.toMatch(/>\s*0\s*<\/?(strong|span|dd)/)
  })
})
