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

  it('空供给组不会生成 tab，供给浏览器保留 GET 表单与面议卡片', () => {
    const html = renderToStaticMarkup(
      createElement(BuildingSupplyBrowser, { snapshot: LEASE_ONLY_SNAPSHOT }),
    )

    expect(html).toContain('method="get"')
    expect(html).toContain('出租')
    expect(html).toContain('价格面议')
    expect(html).not.toContain('出售')
    expect(html).not.toContain('联合办公')
  })

  it('询盘弹层定义 contact、requirements、success 三步及目标解析成功文案', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/frontend/InquiryModal.tsx'),
      'utf8',
    )

    expect(source).toContain("type InquiryStep = 'contact' | 'requirements' | 'success'")
    expect(source).toContain('团队规模')
    expect(source).toContain('targetResolution')
    expect(source).toContain('团队规模：${teamSize.trim()}')
    expect(source).toContain('messageForRequest().length > LIMITS.MESSAGE_MAX')
    expect(source).not.toContain('teamSize: teamSize')
    expect(source).toContain('该房源状态已变化，已为您登记同楼盘需求。')
    expect(source).toContain('目标状态已变化，已为您登记通用选址需求。')
  })
})
