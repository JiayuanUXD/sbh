import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
import CityHomeView from '@/components/frontend/city/CityHomeView'
import type {
  ArticleCardViewModel,
  BuildingSummaryViewModel,
  DistrictCardViewModel,
  DistrictViewModel,
  ListingCardViewModel,
  NearbyListingViewModel,
} from '@/domain/public-catalog/contracts'

function buildCity(avgResponseHours: number | null) {
  return {
    id: 1, slug: 'shanghai', name: '上海', serviceStatus: 'live' as const,
    profile: {
      citySlug: 'shanghai', cityName: '上海', serviceStatus: 'live' as const,
      seoTitle: '', seoDescription: '', cityId: 1, switcherVisible: true, sortOrder: 1, avgResponseHours,
      hero: { eyebrow: 'Custom eyebrow', heading: 'Custom heading', body: 'Custom summary', media: null },
      intro: { heading: '', body: '' }, contact: { heading: '', body: '' }, featuredRegions: [],
    },
  }
}

const districts: readonly DistrictViewModel[] = [{ id: 1, slug: 'jingan', name: '静安' }]

const districtCards: readonly DistrictCardViewModel[] = [
  { id: 1, slug: 'jingan', name: '静安', coverImage: null, buildings: ['环球港'] },
  { id: 2, slug: 'huangpu', name: '黄浦', coverImage: null, buildings: [] },
]

const building: BuildingSummaryViewModel = {
  citySlug: 'shanghai', cityName: '上海', id: 11, slug: 'global-harbor', name: '环球港',
  address: '上海市普陀区中山北路 3300 号',
} as unknown as BuildingSummaryViewModel

const listing: ListingCardViewModel = {
  citySlug: 'shanghai', cityName: '上海', id: 21, slug: 'listing-21', title: '精装办公室',
  price: null, area: 200, businessType: 'lease', decorationStatus: null, listingType: 'traditional-office',
  availableFrom: null, isFeatured: false, building, coverImage: null, highlights: [], stableSortKey: 'listing-21',
} as unknown as ListingCardViewModel

const nearbyListing: NearbyListingViewModel = { ...listing, id: 22, slug: 'listing-22', distanceKm: 1.2 } as unknown as NearbyListingViewModel

const article: ArticleCardViewModel = {
  id: 31, slug: 'news-31', title: '首页改版上线', category: null, excerpt: null, coverImage: null,
  publishedAt: '2026-08-01T00:00:00.000Z', stableSortKey: 'article-31',
}

function buildHomepage() {
  return {
    featuredListings: [listing],
    districts,
    featuredBuildings: [building],
    districtCards,
    latestArticles: [article],
    stats: { listings: 120, buildings: 45, businessAreas: 12 },
    typeSummaries: {},
    nearbyListings: [nearbyListing],
  }
}

const stats = { listings: 120, buildings: 45, businessAreas: 12 }

describe('CityHomeView 编排层（OPT-035 Task 9）', () => {
  // OPT-035 改版后 Hero 文案按设计稿固定（见 HomeHero.tsx 顶部说明）：
  // profile 里存的是旧版营销文案，`profile.hero.x || 设计稿文案` 的写法让设计稿
  // 分支永远走不到，首屏因此一直是旧口吻。两条路由都必须渲染设计稿文案。
  it('legacy 与 prefixed 的 Hero 文案都按设计稿固定，不再读 city.profile.hero', () => {
    const city = buildCity(2.5)
    const homepage = buildHomepage()
    const legacy = renderToStaticMarkup(createElement(CityHomeView, { city, homepage, routeMode: 'legacy', stats }))
    const prefixed = renderToStaticMarkup(createElement(CityHomeView, { city, homepage, routeMode: 'prefixed', stats }))
    for (const html of [legacy, prefixed]) {
      expect(html).toContain('把每一平米算清楚。')
      expect(html).toContain('7 座城市 · 在租房源实时同步 · 面积与租金逐条核过')
      expect(html).not.toContain('Custom heading')
      expect(html).not.toContain('Custom summary')
    }
  })

  it('legacy 路由不带城市前缀，prefixed 路由带 /shanghai 前缀', () => {
    const city = buildCity(2.5)
    const homepage = buildHomepage()
    const legacy = renderToStaticMarkup(createElement(CityHomeView, { city, homepage, routeMode: 'legacy', stats }))
    const prefixed = renderToStaticMarkup(createElement(CityHomeView, { city, homepage, routeMode: 'prefixed', stats }))
    expect(legacy).toContain('href="/listings"')
    expect(legacy).not.toContain('href="/shanghai/listings"')
    expect(prefixed).toContain('href="/shanghai/listings"')
  })

  it('按设计顺序编排九个 section：Hero → 类型 → 商圈 → 楼盘 → 数据带 → 精选房源 → 选择我们 → 核心商圈 → 资讯', () => {
    const city = buildCity(2.5)
    const homepage = buildHomepage()
    const html = renderToStaticMarkup(createElement(CityHomeView, { city, homepage, routeMode: 'prefixed', stats }))
    // 数据带用「收录楼盘」而不是「在租房源」定位：后者也出现在 Hero 副标
    // （「7 座城市 · 在租房源实时同步 · …」）里，会把 indexOf 拉到页面最前面。
    const labels = ['按类型浏览', '热门商圈', '热门楼盘', '收录楼盘', '精选房源', '为什么选择我们', '核心商圈房源', '资讯']
    const markers = labels.map((marker) => {
      const index = html.indexOf(marker)
      expect(index, marker).toBeGreaterThan(-1)
      return index
    })
    for (let i = 1; i < markers.length; i += 1) {
      expect(markers[i], `${labels[i]} 应晚于前一个 section`).toBeGreaterThan(markers[i - 1])
    }
  })

  it('stats prop（而非 homepage.stats）驱动商圈/楼盘/房源三处汇总数字', () => {
    const city = buildCity(2.5)
    const homepage = buildHomepage()
    const html = renderToStaticMarkup(createElement(CityHomeView, {
      city,
      homepage,
      routeMode: 'prefixed',
      stats: { listings: 999, buildings: 888, businessAreas: 777 },
    }))
    expect(html).toContain('777')
    expect(html).toContain('个商圈')
    expect(html).toContain('888')
    expect(html).toContain('个楼盘')
    expect(html).toContain('999')
    expect(html).toContain('套在租')
  })

  it('avgResponseHours 存在时数据带展示「平均响应」，为 null 时不展示', () => {
    const homepage = buildHomepage()
    const withResponse = renderToStaticMarkup(createElement(CityHomeView, { city: buildCity(3.5), homepage, routeMode: 'prefixed', stats }))
    const withoutResponse = renderToStaticMarkup(createElement(CityHomeView, { city: buildCity(null), homepage, routeMode: 'prefixed', stats }))
    expect(withResponse).toContain('平均响应')
    expect(withoutResponse).not.toContain('平均响应')
  })

  it('核心商圈房源以城市名起算，资讯展示传入的文章标题', () => {
    const city = buildCity(2.5)
    const homepage = buildHomepage()
    const html = renderToStaticMarkup(createElement(CityHomeView, { city, homepage, routeMode: 'prefixed', stats }))
    expect(html).toContain('以上海市中心起算')
    expect(html).toContain('首页改版上线')
  })
})
