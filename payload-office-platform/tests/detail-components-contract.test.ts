import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
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
    citySlug: overrides.citySlug ?? 'shanghai',
    cityName: overrides.cityName ?? '上海市',
  }
}

const LEASE_ONLY_SNAPSHOT: BuildingSupplySnapshot = {
  asOf: '2026-07-30T10:00:00.000Z',
  totalEffectiveListings: 1,
  resultCount: 1,
  validationErrors: [],
  groups: [
    {
      key: 'lease',
      listings: [makeCard()],
      priceRanges: [],
      areaRange: { min: 101, max: 101 },
      immediateAvailabilityCount: 1,
    },
  ],
  availableGroups: [{
    key: 'lease',
    totalEffectiveListings: 1,
    priceRanges: [],
    areaRange: { min: 101, max: 101 },
    immediateAvailabilityCount: 1,
  }],
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
    const imageMedia: DetailMediaViewModel[] = [
      {
        id: 'image-1',
        kind: 'image',
        category: 'interior',
        resource: { src: '/office.jpg', alt: '办公室内部' },
        capturedAt: null,
        isSchematic: false,
      },
    ]
    const videoMedia: DetailMediaViewModel[] = [
      {
        id: 'video-1',
        kind: 'video',
        category: 'tour',
        resource: { src: '/tour.mp4', alt: '办公室视频' },
        capturedAt: null,
        isSchematic: false,
      },
    ]

    // 图片分类默认渲染，使用原生 figure/img
    const imageHtml = renderToStaticMarkup(
      createElement(DetailGallery, { media: imageMedia, title: '静安中心' }),
    )
    // 视频分类单独渲染时默认即视频 Tab，使用原生 video controls（P1: 视频延迟挂载
    // 不进首屏，但单一视频分类下视频 Tab 即默认 Tab，SSR 仍输出原生 video 语义）
    const videoHtml = renderToStaticMarkup(
      createElement(DetailGallery, { media: videoMedia, title: '静安中心' }),
    )
    const fallback = renderToStaticMarkup(
      createElement(DetailGallery, { media: [], title: '静安中心' }),
    )

    expect(imageHtml).toContain('<figure')
    expect(imageHtml).toContain('<img')
    expect(videoHtml).toContain('<video')
    expect(videoHtml).toContain('controls=""')
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

  it('详情画廊为全屏预览提供语义化触发按钮与可访问名称', () => {
    const html = renderToStaticMarkup(createElement(DetailGallery, {
      title: '静安中心',
      media: [{
        id: 'image-1',
        kind: 'image',
        category: 'interior',
        resource: { src: '/office.jpg', alt: '办公室内部' },
        capturedAt: null,
        isSchematic: false,
      }],
    }))

    expect(html).toContain('<button')
    expect(html).toContain('查看全屏媒体')
    expect(html).toContain('aria-haspopup="dialog"')
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

  it('桌面服务端默认输出单一表格与面积/价格分桶，不使用 GET 表单或 tab 语义', () => {
    const html = renderToStaticMarkup(
      createElement(BuildingSupplyBrowser, { snapshot: LEASE_ONLY_SNAPSHOT }),
    )

    expect(html).toContain('<table')
    expect(html).toContain('在租房源列表')
    expect(html).toContain('面积')
    expect(html).toContain('价格')
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('价格面议')
    expect(html).not.toContain('method="get"')
    expect(html).not.toContain('type="submit"')
    expect(html).not.toContain('role="tab"')
    expect(html).not.toContain('role="tablist"')
    expect(html).not.toContain('卡片视图')
    expect(html).not.toContain('表格视图')
    expect(html).not.toContain('供给展示方式')
    expect(html).not.toContain('按供给类型筛选')
  })

  it('价格分桶只统计元/㎡/天房源，空桶不渲染', () => {
    const html = renderToStaticMarkup(
      createElement(BuildingSupplyBrowser, {
        snapshot: {
          ...LEASE_ONLY_SNAPSHOT,
          groups: [{
            key: 'lease',
            listings: [
              makeCard({ id: 1, price: { amount: 8.5, currency: 'CNY', businessType: 'lease', period: 'day', basis: 'sqm', displayUnit: 'rmb-sqm-day', text: '8.5 元/㎡/天' } }),
              makeCard({ id: 2, price: { amount: 100000, currency: 'CNY', businessType: 'lease', period: 'month', basis: 'total', displayUnit: 'rmb-total', text: '10 万元/月' } }),
            ],
            priceRanges: [],
            areaRange: null,
            immediateAvailabilityCount: 2,
          }],
        },
      }),
    )

    // 8.5 落在「8–9 元」桶；总价单位不参与日租桶，仅计入「全部」
    expect(html).toContain('8–9 元')
    expect(html).toContain('8.5 元/㎡/天')
    expect(html).toContain('10 万元/月')
    expect(html).not.toContain('8 元以下')
    expect(html).not.toContain('9–10 元')
    expect(html).not.toContain('10 元以上')
  })

  it('面积分桶计数正确，空桶与 null 面积房源不落入具体桶', () => {
    const html = renderToStaticMarkup(
      createElement(BuildingSupplyBrowser, {
        snapshot: {
          ...LEASE_ONLY_SNAPSHOT,
          groups: [{
            key: 'lease',
            listings: [
              makeCard({ id: 1, area: 50 }),
              makeCard({ id: 2, area: 150 }),
              makeCard({ id: 3, area: 500 }),
              makeCard({ id: 4, area: null }),
            ],
            priceRanges: [],
            areaRange: { min: 50, max: 500 },
            immediateAvailabilityCount: 4,
          }],
        },
      }),
    )

    expect(html).toContain('0–100 ㎡')
    expect(html).toContain('100–300 ㎡')
    expect(html).toContain('500–1000 ㎡')
    // 500 落入 [500,1000)，300–500 桶为空；null 面积仅出现在「全部」
    expect(html).not.toContain('300–500 ㎡')
    expect(html).not.toContain('1000 ㎡ 以上')
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
