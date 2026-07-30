import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import DetailAnchorNav from '@/components/frontend/DetailAnchorNav'
import DetailFacts from '@/components/frontend/DetailFacts'
import DetailGallery from '@/components/frontend/DetailGallery'
import BuildingSupplyBrowser from '@/components/frontend/BuildingSupplyBrowser'
import type {
  BuildingSupplySnapshot,
  DetailMediaViewModel,
  FactGroupViewModel,
  ListingCardViewModel,
} from '@/domain/public-catalog'

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

})
