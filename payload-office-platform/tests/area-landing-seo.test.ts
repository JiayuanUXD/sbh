import { describe, expect, it } from 'vitest'

import type { AreaLandingEntry } from '@/domain/public-catalog/area-landing-facade'
import type { BuildingSummaryViewModel } from '@/domain/public-catalog/contracts'
import { buildAreaLandingJsonLd, buildAreaLandingMetadata, type AreaLandingJsonLd } from '@/lib/frontend/area-landing-seo'

function entry(overrides: Partial<AreaLandingEntry> = {}): AreaLandingEntry {
  return {
    kind: 'business_area', id: 40, slug: 'caohejing', name: '漕河泾', parentSlug: 'xuhui', parentName: '徐汇区',
    listingCount: 1837, buildingCount: 72, priceSampleCount: 1800, priceMin: 1.9, priceP25: 3.52,
    priceMedian: 4.14, priceP75: 4.34, priceMax: 8.5, otherUnitCount: 37, areaMedian: 280,
    lastUpdatedAt: '2026-10-15T08:00:00.000Z', description: null, indexable: true, ...overrides,
  }
}
const parent = entry({ kind: 'district', id: 15, slug: 'xuhui', name: '徐汇区', parentSlug: null, parentName: null })
const buildings = [
  { id: 1, slug: 'fenglin-park', name: '枫林科创园' },
  { id: 2, slug: '东航 中心', name: '东航滨江中心' },
] as unknown as BuildingSummaryViewModel[]

type Doc = { '@type': string; numberOfItems?: number; itemListElement: Array<Record<string, unknown>> }
/** JSON 往返成宽松形态，断言只看输出内容，不被只读联合类型绊住。 */
const asDoc = (document: AreaLandingJsonLd): Doc => JSON.parse(JSON.stringify(document)) as Doc

const origin = 'https://shangban.cc'
const city = { slug: 'shanghai', name: '上海' }

describe('buildAreaLandingMetadata', () => {
  const copy = { title: '漕河泾写字楼出租 · 办公室租金与热门楼盘', description: '描述', intro: '', faq: [] }
  const base = { entry: entry(), copy, citySlug: 'shanghai', serviceStatus: 'live' as const, multiCityRoutingEnabled: true }

  it('自 canonical 到落地页路径，达标页可索引', () => {
    const metadata = buildAreaLandingMetadata(base)
    expect(metadata.title).toBe(copy.title)
    expect(metadata.description).toBe('描述')
    expect(metadata.alternates?.canonical).toBe('/shanghai/area/caohejing')
    expect(metadata.robots).toMatchObject({ index: true, follow: true })
  })

  it.each([
    ['未达收录门槛', { entry: entry({ indexable: false, listingCount: 3 }) }],
    ['多城路由开关关闭（前缀路径本身是 noindex）', { multiCityRoutingEnabled: false }],
    ['城市未开通', { serviceStatus: 'coming-soon' as const }],
  ])('%s → noindex, follow', (_, patch) => {
    const metadata = buildAreaLandingMetadata({ ...base, ...patch })
    expect(metadata.robots).toMatchObject({ index: false, follow: true })
  })

  it('OG url 是绝对 URL', () => {
    const og = buildAreaLandingMetadata(base).openGraph as { url?: string }
    expect(og.url).toMatch(/^https?:\/\/.+\/shanghai\/area\/caohejing$/)
  })
})

describe('buildAreaLandingJsonLd', () => {
  it('商圈页：BreadcrumbList 经由行政区，所有 URL 绝对', () => {
    const [breadcrumb] = buildAreaLandingJsonLd({ origin, city, entry: entry(), parent, topBuildings: buildings })
    expect(breadcrumb).toMatchObject({ '@context': 'https://schema.org', '@type': 'BreadcrumbList' })
    const items = asDoc(breadcrumb).itemListElement
    expect(items.map((item) => [item.position, item.name, item.item])).toEqual([
      [1, '首页', 'https://shangban.cc/'],
      [2, '上海', 'https://shangban.cc/shanghai'],
      [3, '徐汇区', 'https://shangban.cc/shanghai/area/xuhui'],
      [4, '漕河泾', 'https://shangban.cc/shanghai/area/caohejing'],
    ])
  })

  it('行政区页：面包屑不含行政区这一层重复；所属行政区不可见时商圈面包屑跳过它', () => {
    const [districtCrumb] = buildAreaLandingJsonLd({ origin, city, entry: parent, parent: null, topBuildings: [] })
    expect(asDoc(districtCrumb).itemListElement).toHaveLength(3)
    const [orphan] = buildAreaLandingJsonLd({ origin, city, entry: entry(), parent: null, topBuildings: [] })
    expect(asDoc(orphan).itemListElement).toHaveLength(3)
  })

  it('ItemList：热门楼盘，URL 绝对且 slug 只编码一次；没有楼盘时不输出', () => {
    const lists = buildAreaLandingJsonLd({ origin, city, entry: entry(), parent, topBuildings: buildings })
    expect(lists).toHaveLength(2)
    expect(lists[1]).toMatchObject({ '@context': 'https://schema.org', '@type': 'ItemList', numberOfItems: 2 })
    const items = asDoc(lists[1]).itemListElement
    expect(items[0]).toEqual({ '@type': 'ListItem', position: 1, name: '枫林科创园', url: 'https://shangban.cc/shanghai/buildings/fenglin-park' })
    expect(items[1].url).toBe('https://shangban.cc/shanghai/buildings/%E4%B8%9C%E8%88%AA%20%E4%B8%AD%E5%BF%83')
    expect(buildAreaLandingJsonLd({ origin, city, entry: entry(), parent, topBuildings: [] })).toHaveLength(1)
  })

  it('不输出任何价格 / 评分 / FAQ 结构化数据（区域不是商品，不虚构）', () => {
    const json = JSON.stringify(buildAreaLandingJsonLd({ origin, city, entry: entry(), parent, topBuildings: buildings }))
    for (const forbidden of ['Offer', 'price', 'aggregateRating', 'FAQPage', 'lowPrice']) {
      expect(json).not.toContain(forbidden)
    }
  })

  it('拒绝非法站点 origin（带尾斜杠 / 相对路径）', () => {
    expect(() => buildAreaLandingJsonLd({ origin: 'https://shangban.cc/', city, entry: entry(), parent, topBuildings: [] })).toThrow()
    expect(() => buildAreaLandingJsonLd({ origin: '/relative', city, entry: entry(), parent, topBuildings: [] })).toThrow()
  })
})
