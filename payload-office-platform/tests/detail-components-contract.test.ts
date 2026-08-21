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
    floor: null,
    seats: null,
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
    expect(fallback).toContain('暂无图片')
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

    expect(html).toContain('暂无图片')
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

  it('桌面服务端默认输出单一密度表，按 URL 而非 GET 表单驱动组切换/筛选/排序', () => {
    const html = renderToStaticMarkup(
      createElement(BuildingSupplyBrowser, {
        snapshot: LEASE_ONLY_SNAPSHOT,
        basePath: '/buildings/jingan-center',
        currentSearch: '',
      }),
    )

    expect(html).toContain('<table')
    expect(html).toContain('租赁房源列表')
    expect(html).toContain('面积')
    expect(html).toContain('排序')
    // 单一业务组时仍渲染组 tab（只有一个），但不使用 GET 表单/tab 部件语义
    expect(html).toContain('aria-current="true"')
    expect(html).not.toContain('method="get"')
    expect(html).not.toContain('type="submit"')
    expect(html).not.toContain('role="tab"')
    expect(html).not.toContain('role="tablist"')
    expect(html).not.toContain('卡片视图')
    expect(html).not.toContain('表格视图')
    expect(html).not.toContain('供给展示方式')
  })

  it('组切换 href 只在非默认组时写入 group 参数，默认组省略', () => {
    const snapshot: BuildingSupplySnapshot = {
      ...LEASE_ONLY_SNAPSHOT,
      groups: [
        LEASE_ONLY_SNAPSHOT.groups[0]!,
        { key: 'sale', listings: [makeCard({ id: 2, businessType: 'sale' })], priceRanges: [], areaRange: null, immediateAvailabilityCount: 1 },
      ],
      availableGroups: [
        LEASE_ONLY_SNAPSHOT.availableGroups[0]!,
        { key: 'sale', totalEffectiveListings: 1, priceRanges: [], areaRange: null, immediateAvailabilityCount: 1 },
      ],
    }
    const html = renderToStaticMarkup(
      createElement(BuildingSupplyBrowser, { snapshot, basePath: '/buildings/jingan-center', currentSearch: '' }),
    )

    // 默认组（数组第一个，lease）不带 group 参数；非默认组（sale）带
    expect(html).toContain('href="/buildings/jingan-center"')
    expect(html).toContain('href="/buildings/jingan-center?group=sale"')
  })

  it('组切换后读取 URL 上的 group 参数展示对应组，而非始终展示第一个', () => {
    const snapshot: BuildingSupplySnapshot = {
      ...LEASE_ONLY_SNAPSHOT,
      groups: [
        LEASE_ONLY_SNAPSHOT.groups[0]!,
        { key: 'sale', listings: [makeCard({ id: 2, title: '出售样例房源', businessType: 'sale' })], priceRanges: [], areaRange: null, immediateAvailabilityCount: 1 },
      ],
      availableGroups: [
        LEASE_ONLY_SNAPSHOT.availableGroups[0]!,
        { key: 'sale', totalEffectiveListings: 1, priceRanges: [], areaRange: null, immediateAvailabilityCount: 1 },
      ],
    }
    const html = renderToStaticMarkup(
      createElement(BuildingSupplyBrowser, { snapshot, basePath: '/buildings/jingan-center', currentSearch: 'group=sale' }),
    )

    expect(html).toContain('出售样例房源')
    expect(html).toContain('总价 万元')
    expect(html).not.toContain('静安中心 101 室')
  })

  it('空组（priceRanges 空）仍渲染表格，「—」代表价格缺失而非分桶控件', () => {
    const html = renderToStaticMarkup(
      createElement(BuildingSupplyBrowser, {
        snapshot: {
          ...LEASE_ONLY_SNAPSHOT,
          groups: [{
            key: 'lease',
            listings: [
              makeCard({ id: 1, price: null }),
            ],
            priceRanges: [],
            areaRange: null,
            immediateAvailabilityCount: 0,
          }],
        },
        basePath: '/buildings/jingan-center',
        currentSearch: '',
      }),
    )

    expect(html).toContain('<table')
    // 价格缺失渲染为 —，不渲染成 0 或伪造分桶控件
    expect(html).not.toContain('8 元以下')
    expect(html).not.toContain('9–10 元')
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
