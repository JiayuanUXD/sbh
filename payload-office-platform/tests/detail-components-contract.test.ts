import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import DetailAnchorNav from '@/components/frontend/DetailAnchorNav'
import DetailFacts from '@/components/frontend/DetailFacts'
import DetailGallery from '@/components/frontend/DetailGallery'
import ListingCard from '@/components/frontend/ListingCard'
import * as BuildingSupplyBrowserModule from '@/components/frontend/BuildingSupplyBrowser'
import type {
  BuildingSupplySnapshot,
  DetailMediaViewModel,
  FactGroupViewModel,
  ListingCardViewModel,
} from '@/domain/public-catalog'

const BuildingSupplyBrowser = BuildingSupplyBrowserModule.default

const DETAIL_COMPONENT_FILES = [
  'DetailGallery.tsx',
  'DetailAnchorNav.tsx',
  'DetailFacts.tsx',
  'BuildingSupplyBrowser.tsx',
  'InquiryModal.tsx',
] as const

function makeCard(overrides: Partial<ListingCardViewModel> = {}): ListingCardViewModel {
  return {
    id: 1,
    slug: 'jingan-center-101',
    title: '静安中心 101 室',
    price: null,
    area: 101,
    businessType: 'lease',
    decorationStatus: 'fully_fitted',
    listingType: 'traditional-office',
    availableFrom: null,
    isFeatured: false,
    building: null,
    coverImage: null,
    highlights: [],
    stableSortKey: 'listing-1',
    ...overrides,
  }
}

const LEASE_ONLY_SNAPSHOT: BuildingSupplySnapshot = {
  asOf: '2026-07-30T10:00:00.000Z',
  totalEffectiveListings: 1,
  validationErrors: [],
  groups: [
    { key: 'lease', listings: [makeCard()], priceRanges: [] },
    { key: 'sale', listings: [], priceRanges: [] },
    { key: 'coworking', listings: [], priceRanges: [] },
  ],
}

describe('detail component contracts', () => {
  it('所有前台详情组件不导入 payload-types 或 payload', () => {
    for (const file of DETAIL_COMPONENT_FILES) {
      const source = readFileSync(
        join(process.cwd(), 'src/components/frontend', file),
        'utf8',
      )
      expect(source).not.toMatch(/from ['"]payload['"]|from ['"]@\/payload-types['"]/)
      expect(source).not.toMatch(/payload-types/)
    }
  })

  it('画廊为有效媒体使用原生媒体语义，并为无效媒体提供确定性回退', () => {
    const media: DetailMediaViewModel[] = [
      {
        id: 'image-1',
        kind: 'image',
        category: 'interior',
        resource: { src: '/office.jpg', alt: '办公室内部' },
        capturedAt: null,
        isSchematic: false,
      },
      {
        id: 'video-1',
        kind: 'video',
        category: 'tour',
        resource: { src: '/tour.mp4', alt: '办公室视频' },
        capturedAt: null,
        isSchematic: false,
      },
    ]

    const html = renderToStaticMarkup(createElement(DetailGallery, { media, title: '静安中心' }))
    const fallback = renderToStaticMarkup(
      createElement(DetailGallery, { media: [], title: '静安中心' }),
    )

    expect(html).toContain('<figure')
    expect(html).toContain('<img')
    expect(html).toContain('<video')
    expect(html).toContain('controls=""')
    expect(fallback).toContain('暂无可展示媒体')
    expect(fallback).toContain('role="img"')
  })

  it('画廊防御性拒绝 mapper 之外流入的不安全媒体 URL', () => {
    const html = renderToStaticMarkup(createElement(DetailGallery, {
      title: '静安中心',
      media: [{
        id: 'unsafe',
        kind: 'image',
        category: 'interior',
        resource: { src: 'javascript:alert(1)', alt: '不应渲染' },
        capturedAt: null,
        isSchematic: false,
      }],
    }))

    expect(html).toContain('暂无可展示媒体')
    expect(html).not.toContain('javascript:alert')
  })

  it('画廊媒体交互只暴露匿名类别、序号和页面类型', () => {
    const html = renderToStaticMarkup(createElement(DetailGallery, {
      title: '静安中心',
      pageType: 'listing',
      media: [{
        id: 'image-1',
        kind: 'image',
        category: 'interior',
        resource: { src: '/office.jpg', alt: '办公室内部' },
        capturedAt: null,
        isSchematic: false,
      }],
    }))

    expect(html).toContain('data-detail-analytics-event="media_view"')
    expect(html).toContain('data-analytics-page-type="listing"')
    expect(html).toContain('data-analytics-media-category="interior"')
    expect(html).not.toContain('data-analytics-title')
  })

  it('锚点导航只输出可见项', () => {
    const html = renderToStaticMarkup(
      createElement(DetailAnchorNav, {
        items: [
          { id: 'overview', label: '概览', visible: true },
          { id: 'supply', label: '房源', visible: false },
        ],
      }),
    )

    expect(html).toContain('href="#overview"')
    expect(html).not.toContain('房源')
  })

  it('事实组件将关键缺失值标为咨询确认，并忽略普通缺失值', () => {
    const groups: FactGroupViewModel[] = [
      {
        id: 'basic',
        title: '基本信息',
        facts: [
          { label: '交付标准', value: null, estimated: false, critical: true },
          { label: '层高', value: null, estimated: false, critical: false },
          { label: '面积', value: '101 ㎡', estimated: true, critical: false },
        ],
      },
    ]

    const html = renderToStaticMarkup(createElement(DetailFacts, { groups }))

    expect(html).toContain('交付标准')
    expect(html).toContain('咨询确认')
    expect(html).not.toContain('层高')
    expect(html).toContain('估算')
  })

  it('供给组是原生 GET 筛选按钮，不伪装为 ARIA tab，并暴露当前筛选', () => {
    const html = renderToStaticMarkup(
      createElement(BuildingSupplyBrowser, {
        snapshot: LEASE_ONLY_SNAPSHOT,
        input: { group: 'lease' },
      }),
    )

    expect(html).toContain('method="get"')
    expect(html).toContain('type="submit"')
    expect(html).toContain('aria-current="true"')
    expect(html).toContain('按供给类型筛选')
    expect(html).not.toContain('role="tab"')
    expect(html).not.toContain('role="tablist"')
    expect(html).toContain('aria-label="供给展示方式"')
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('卡片视图')
    expect(html).toContain('表格视图')
    expect(html).not.toContain('<table')
    expect(html).toContain('出租')
    expect(html).toContain('价格面议')
    expect(html).not.toContain('出售')
    expect(html).not.toContain('联合办公')
  })

  it('价格排序缺少单位时显示可访问的降级说明，同时保留已选排序', () => {
    const html = renderToStaticMarkup(
      createElement(BuildingSupplyBrowser, {
        snapshot: { ...LEASE_ONLY_SNAPSHOT, validationErrors: ['price_unit_required'] },
        input: { sort: 'price-asc' },
      }),
    )

    expect(html).toContain('role="status"')
    expect(html).toContain('请选择价格单位后再按价格排序')
    expect(html).toContain('当前按稳定默认顺序显示')
    expect(html).toContain('value="price-asc" selected=""')
  })

  it('供给筛选埋点从提交时的 FormData 读取安全枚举，不使用初始筛选', () => {
    const getSupplyFilterAnalyticsProps = Reflect.get(
      BuildingSupplyBrowserModule,
      'getSupplyFilterAnalyticsProps',
    )
    expect(typeof getSupplyFilterAnalyticsProps).toBe('function')
    if (typeof getSupplyFilterAnalyticsProps !== 'function') return

    const submitted = new FormData()
    submitted.set('group', 'sale')
    submitted.set('areaMin', '100')
    submitted.set('areaMax', '200')
    submitted.set('priceUnit', 'rmb-sqm-day')
    submitted.set('decorationStatus', 'furnished')
    submitted.set('availableBefore', '2026-08-01')
    submitted.set('sort', 'price-asc')
    const props = getSupplyFilterAnalyticsProps(88, LEASE_ONLY_SNAPSHOT, submitted)

    expect(props).toEqual({
      building_id: 88,
      supply_group: 'sale',
      sort: 'price-asc',
      price_unit: 'rmb-sqm-day',
      decoration_status: 'furnished',
      result_count: 1,
      as_of: '2026-07-30T10:00:00.000Z',
      filter_completeness: 2,
    })
    expect(props).not.toHaveProperty('areaMin')
    expect(props).not.toHaveProperty('availableBefore')
  })

  it('供给筛选埋点丢弃无效和 PII 形态枚举，仅保留筛选存在摘要', () => {
    const getSupplyFilterAnalyticsProps = Reflect.get(
      BuildingSupplyBrowserModule,
      'getSupplyFilterAnalyticsProps',
    )
    expect(typeof getSupplyFilterAnalyticsProps).toBe('function')
    if (typeof getSupplyFilterAnalyticsProps !== 'function') return

    const submitted = new FormData()
    submitted.set('group', 'lease&phone=13800001111')
    submitted.set('sort', 'phoneNumber')
    submitted.set('priceUnit', 'javascript:alert(1)')
    submitted.set('decorationStatus', 'note=请联系我')
    submitted.set('areaMin', 'phone=13800001111')
    submitted.set('availableBefore', 'message=private')
    const props = getSupplyFilterAnalyticsProps(88, LEASE_ONLY_SNAPSHOT, submitted)

    expect(props).toEqual({
      building_id: 88,
      sort: 'recommended',
      result_count: 1,
      as_of: '2026-07-30T10:00:00.000Z',
      filter_completeness: 2,
    })
    expect(JSON.stringify(props)).not.toContain('phone')
    expect(JSON.stringify(props)).not.toContain('note')
    expect(JSON.stringify(props)).not.toContain('message')
  })

  it('供给分组 submitter 覆盖当前 GET group，且只接受表单 group 枚举', () => {
    const getSupplyFilterAnalyticsProps = Reflect.get(
      BuildingSupplyBrowserModule,
      'getSupplyFilterAnalyticsProps',
    )
    expect(typeof getSupplyFilterAnalyticsProps).toBe('function')
    if (typeof getSupplyFilterAnalyticsProps !== 'function') return

    const submitted = new FormData()
    submitted.set('sort', 'recommended')
    const groupClick = getSupplyFilterAnalyticsProps(88, LEASE_ONLY_SNAPSHOT, submitted, {
      isCurrentFormButton: true,
      name: 'group',
      value: 'coworking',
    })
    const maliciousSubmitter = getSupplyFilterAnalyticsProps(88, LEASE_ONLY_SNAPSHOT, submitted, {
      isCurrentFormButton: true,
      name: 'phone',
      value: '13800001111',
    })
    const maliciousValue = getSupplyFilterAnalyticsProps(88, LEASE_ONLY_SNAPSHOT, submitted, {
      isCurrentFormButton: true,
      name: 'group',
      value: 'lease&phone=13800001111',
    })

    expect(groupClick).toMatchObject({ supply_group: 'coworking' })
    expect(maliciousSubmitter).not.toHaveProperty('phone')
    expect(maliciousSubmitter).not.toHaveProperty('supply_group')
    expect(JSON.stringify(maliciousSubmitter)).not.toContain('13800001111')
    expect(maliciousValue).not.toHaveProperty('supply_group')
  })

  it('推荐房源卡只写入匿名点击上下文', () => {
    const html = renderToStaticMarkup(createElement(ListingCard, {
      listing: makeCard({ id: 102, title: '静安中心 102 室' }),
      detailAnalytics: {
        event: 'recommendation_click',
        parentId: 101,
        rank: 1,
        section: 'related',
        recommendationType: 'same_building',
      },
    }))

    expect(html).toContain('data-detail-analytics-event="recommendation_click"')
    expect(html).toContain('data-analytics-parent-id="101"')
    expect(html).toContain('data-analytics-rank="1"')
    expect(html).not.toContain('data-analytics-title')
  })

})
