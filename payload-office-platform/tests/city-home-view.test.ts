import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
import CityHomeView from '@/components/frontend/city/CityHomeView'
// OPT-053：CityHomeView 现在从路由层接收站点设置。本文件验的是编排顺序与
// 数字口径，拿兜底值即可——顺带保证兜底值本身能渲染出完整九个 section。
import { SITE_SETTINGS_FALLBACK } from '@/lib/frontend/site-settings'
import type {
  ArticleCardViewModel,
  BuildingSummaryViewModel,
  DistrictCardViewModel,
  DistrictViewModel,
  HomepageTypeSummary,
  ListingCardViewModel,
  MediaViewModel,
  NearbyListingViewModel,
} from '@/domain/public-catalog/contracts'

function buildCity(avgResponseHours: number | null) {
  return {
    id: 1, slug: 'shanghai', name: '上海', serviceStatus: 'live' as const,
    profile: {
      citySlug: 'shanghai', cityName: '上海', serviceStatus: 'live' as const,
      seoTitle: '', seoDescription: '', cityId: 1, switcherVisible: true, sortOrder: 1, avgResponseHours,
      hero: { eyebrow: 'Custom eyebrow', heading: 'Custom heading', body: 'Custom summary', media: null, video: null, videoEnabled: true },
      intro: { heading: '', body: '' }, contact: { heading: '', body: '' }, featuredRegions: [],
      typeCardOverrides: [],
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
  price: null, area: 200, floor: null, seats: null, businessType: 'lease', decorationStatus: null, listingType: 'traditional-office',
  availableFrom: null, isFeatured: false, building, coverImage: null, highlights: [], stableSortKey: 'listing-21',
} as unknown as ListingCardViewModel

const nearbyListing: NearbyListingViewModel = { ...listing, id: 22, slug: 'listing-22', distanceKm: 1.2 } as unknown as NearbyListingViewModel

const article: ArticleCardViewModel = {
  id: 31, slug: 'news-31', title: '首页改版上线', category: null, excerpt: null, coverImage: null,
  publishedAt: '2026-08-01T00:00:00.000Z', stableSortKey: 'article-31',
}

function buildHomepage(
  stats = { listings: 120, buildings: 45, businessAreas: 12 },
  // OPT-060 回归：默认 {} 与既有用例保持不变，新用例按需传入让某个 slot 的
  // summary.cover 非空，才能触到「配置全空回落到该类型首条房源封面」这条链。
  typeSummaries: Readonly<Record<string, HomepageTypeSummary>> = {},
) {
  return {
    featuredListings: [listing],
    districts,
    featuredBuildings: [building],
    districtCards,
    latestArticles: [article],
    stats,
    typeSummaries,
    nearbyListings: [nearbyListing],
  }
}

const bandStats = { listings: 120, buildings: 45, businessAreas: 12 }

describe('CityHomeView 编排层（OPT-035 Task 9）', () => {
  // Hero 文案在实现层固定（见 HomeHero.tsx 顶部说明）：产品裁定「slogan 全站
  // 共用一句」，两条路由渲染同一句，且不读 city.profile.hero.heading/body。
  it('legacy 与 prefixed 的 Hero 文案共用同一句，不读 city.profile.hero', () => {
    const city = buildCity(2.5)
    const homepage = buildHomepage()
    const legacy = renderToStaticMarkup(createElement(CityHomeView, { city, homepage, routeMode: 'legacy', bandStats , siteSettings: SITE_SETTINGS_FALLBACK }))
    const prefixed = renderToStaticMarkup(createElement(CityHomeView, { city, homepage, routeMode: 'prefixed', bandStats , siteSettings: SITE_SETTINGS_FALLBACK }))
    for (const html of [legacy, prefixed]) {
      expect(html).toContain('汇聚高端商务空间，赋能企业卓越成长')
      expect(html).toContain('覆盖核心商务区、总部型整层、精装办公与高规格写字楼资源，帮企业更快完成选址决策')
      expect(html).not.toContain('Custom heading')
      expect(html).not.toContain('Custom summary')
    }
  })

  it('legacy 路由不带城市前缀，prefixed 路由带 /shanghai 前缀', () => {
    const city = buildCity(2.5)
    const homepage = buildHomepage()
    const legacy = renderToStaticMarkup(createElement(CityHomeView, { city, homepage, routeMode: 'legacy', bandStats , siteSettings: SITE_SETTINGS_FALLBACK }))
    const prefixed = renderToStaticMarkup(createElement(CityHomeView, { city, homepage, routeMode: 'prefixed', bandStats , siteSettings: SITE_SETTINGS_FALLBACK }))
    expect(legacy).toContain('href="/listings"')
    expect(legacy).not.toContain('href="/shanghai/listings"')
    expect(prefixed).toContain('href="/shanghai/listings"')
  })

  it('按设计顺序编排九个 section：Hero → 类型 → 商圈 → 楼盘 → 数据带 → 精选房源 → 选择我们 → 核心商圈 → 资讯', () => {
    const city = buildCity(2.5)
    const homepage = buildHomepage()
    const html = renderToStaticMarkup(createElement(CityHomeView, { city, homepage, routeMode: 'prefixed', bandStats , siteSettings: SITE_SETTINGS_FALLBACK }))
    // 数据带用「收录楼盘」而不是「在租房源」定位：Hero 副标随时可能被产品换掉，
    // 一旦其中出现「在租房源」字样，indexOf 就会被拉到页面最前面（历史上的设计稿
    // 文案「7 座城市 · 在租房源实时同步 · …」正是如此）。
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

  /**
   * 回归（最终评审 F2）：三处 section 链接的数字必须与链接落点同口径。
   *
   * 「全部 N 个商圈」/「全部 N 个楼盘」/「查看 N 套在租」分别指向 `/listings`
   * `/buildings`（legacy 下按 defaultCity 收敛，prefixed 下按路径城市收敛），
   * 全是**城市域**路由；一旦第二座城市置为 live，根页把跨城汇总喂进来，
   * 数字就会大于点进去能看到的量。因此它们只准取 homepage.stats（单城口径），
   * 数据带（无链接的平台规模陈述）才允许用 bandStats。
   */
  it('三处 section 链接数字取单城 homepage.stats，数据带才取 bandStats', () => {
    const city = buildCity(2.5)
    // 单城 45 楼盘 / 12 商圈 / 120 房源；平台汇总（两城）翻倍
    const homepage = buildHomepage({ listings: 120, buildings: 45, businessAreas: 12 })
    const html = renderToStaticMarkup(createElement(CityHomeView, {
      city,
      homepage,
      routeMode: 'legacy',
      bandStats: { listings: 999, buildings: 888, businessAreas: 777 },
      siteSettings: SITE_SETTINGS_FALLBACK,
    }))
    expect(html).toContain('>12</span> 个商圈')
    expect(html).toContain('>45</span> 个楼盘')
    expect(html).toContain('>120</span> 套在租')
    // 跨城汇总数字绝不出现在任何 section 链接上
    for (const platformOnly of ['777', '888', '999']) {
      expect(html).not.toContain(`>${platformOnly}</span> 个`)
      expect(html).not.toContain(`>${platformOnly}</span> 套`)
    }
    // 数据带仍然是平台口径
    expect(html).toContain('999')
    expect(html).toContain('收录楼盘')
  })

  it('bandStats 全零时（无 live 城市）section 链接仍展示单城真实数字，不出现字面 0', () => {
    const city = buildCity(2.5)
    const homepage = buildHomepage({ listings: 120, buildings: 45, businessAreas: 12 })
    const html = renderToStaticMarkup(createElement(CityHomeView, {
      city,
      homepage,
      routeMode: 'legacy',
      bandStats: { listings: 0, buildings: 0, businessAreas: 0 },
      siteSettings: SITE_SETTINGS_FALLBACK,
    }))
    expect(html).toContain('>12</span> 个商圈')
    expect(html).toContain('>45</span> 个楼盘')
    expect(html).toContain('>120</span> 套在租')
    expect(html).not.toContain('>0</span>')
  })

  it('avgResponseHours 存在时数据带展示「平均响应」，为 null 时不展示', () => {
    const homepage = buildHomepage()
    const withResponse = renderToStaticMarkup(createElement(CityHomeView, { city: buildCity(3.5), homepage, routeMode: 'prefixed', bandStats , siteSettings: SITE_SETTINGS_FALLBACK }))
    const withoutResponse = renderToStaticMarkup(createElement(CityHomeView, { city: buildCity(null), homepage, routeMode: 'prefixed', bandStats , siteSettings: SITE_SETTINGS_FALLBACK }))
    expect(withResponse).toContain('平均响应')
    expect(withoutResponse).not.toContain('平均响应')
  })

  it('核心商圈房源以城市名起算，资讯展示传入的文章标题', () => {
    const city = buildCity(2.5)
    const homepage = buildHomepage()
    const html = renderToStaticMarkup(createElement(CityHomeView, { city, homepage, routeMode: 'prefixed', bandStats , siteSettings: SITE_SETTINGS_FALLBACK }))
    expect(html).toContain('以上海市中心起算')
    expect(html).toContain('首页改版上线')
  })

  /**
   * 回归（OPT-060 Task 4 复核 Important）：类型卡封面的四级优先级里，
   * 「城市覆盖」「全局默认」两级已被 `type-card-covers.test.ts` 锁住，但组件内
   * 「都为空才回落到该类型首条房源封面」这最后一级此前完全没有测试覆盖——
   * 变异测试证实把 HomeTypeCards.tsx 的 `?? summary?.cover` 删掉，全量用例零红。
   * 下面两条把回落链与优先级方向都锁进契约。
   */
  it('类型卡封面全空（SITE_SETTINGS_FALLBACK）时回落到该类型首条房源的封面', () => {
    const city = buildCity(2.5)
    const summaryCover: MediaViewModel = { src: '/media/summary-cover.jpg', alt: '联合办公封面' }
    const homepage = buildHomepage(undefined, {
      coworking: { count: 8, cover: summaryCover },
    })
    const html = renderToStaticMarkup(createElement(CityHomeView, {
      city, homepage, routeMode: 'prefixed', bandStats, siteSettings: SITE_SETTINGS_FALLBACK,
    }))
    expect(html).toContain('src="/media/summary-cover.jpg"')
  })

  it('类型卡配置了封面时，优先于同类型首条房源的封面', () => {
    const city = buildCity(2.5)
    const summaryCover: MediaViewModel = { src: '/media/summary-cover.jpg', alt: '联合办公封面' }
    const configuredCover: MediaViewModel = { src: '/media/configured-cover.jpg', alt: '运营配置封面' }
    const siteSettings = {
      ...SITE_SETTINGS_FALLBACK,
      typeCards: SITE_SETTINGS_FALLBACK.typeCards.map((card) =>
        card.slot === 'coworking' ? { ...card, coverImage: configuredCover } : card,
      ),
    }
    const homepage = buildHomepage(undefined, {
      coworking: { count: 8, cover: summaryCover },
    })
    const html = renderToStaticMarkup(createElement(CityHomeView, {
      city, homepage, routeMode: 'prefixed', bandStats, siteSettings,
    }))
    expect(html).toContain('src="/media/configured-cover.jpg"')
    expect(html).not.toContain('src="/media/summary-cover.jpg"')
  })

  it('精选区域能把候选池里第 6 名的商圈拉进 bento 的 5 张里（OPT-060）', () => {
    // 8 张候选，模拟 facade 放宽后的池子。第 6 张（rank-6）是我们要拉上来的。
    const pool: readonly DistrictCardViewModel[] = Array.from({ length: 8 }, (_, i) => ({
      id: 100 + i,
      slug: `rank-${i + 1}`,
      name: `商圈${i + 1}`,
      coverImage: null,
      buildings: [`楼盘${i + 1}`],
    }))

    const city = buildCity(null)
    // 精选区域按 slug 匹配（orderByFeaturedRegions 的口径）
    const cityWithFeatured = {
      ...city,
      profile: { ...city.profile, featuredRegions: [{ slug: 'rank-6' }] },
    }

    const html = renderToStaticMarkup(
      createElement(CityHomeView, {
        city: cityWithFeatured,
        homepage: { ...buildHomepage(), districtCards: pool },
        routeMode: 'prefixed',
        bandStats: { listings: 120, buildings: 45, businessAreas: 12 },
        siteSettings: SITE_SETTINGS_FALLBACK,
      } as never),
    )

    // 第 6 名被拉进来了
    expect(html).toContain('商圈6')
    // 仍然只渲染 5 张——池子变大不等于卡片变多
    const rendered = [...html.matchAll(/hm-bento-card__name">([^<]+)</g)].map((m) => m[1])
    expect(rendered).toHaveLength(5)
    expect(rendered[0]).toBe('商圈6')
    // 被挤出去的是原本的第 5 名，不是随便某一张
    expect(html).not.toContain('商圈5')
  })
})
