import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  listPublicCityProfiles: vi.fn(),
  resolveCityContext: vi.fn(),
  getCachedHomepage: vi.fn(),
  getCachedSearchListings: vi.fn(),
  getCachedListingDistrictOptions: vi.fn(),
  getCachedSearchBuildingsFiltered: vi.fn(),
  getCachedListingBySlug: vi.fn(),
  getCachedBuildingBySlug: vi.fn(),
  getCachedBuildingDetail: vi.fn(),
  getCachedRelatedBuildings: vi.fn(),
  getCachedDetailRecommendations: vi.fn(),
  fetchNearbyPois: vi.fn(),
  getServiceSchedule: vi.fn(),
  hasAmapJsKey: vi.fn(),
  cityListingDetailProps: [] as unknown[],
  resolveListingRouteIdentity: vi.fn(),
  resolveBuildingRouteIdentity: vi.fn(),
  parseListingSearchInput: vi.fn(),
  parseBuildingSearchInput: vi.fn(),
  parseBuildingSupplySearchParams: vi.fn(),
  createSearchContext: vi.fn(),
  getBuildingDetail: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`)
  }),
  notFound: vi.fn(() => {
    throw new Error('not-found')
  }),
}))

vi.mock('next/navigation', () => ({
  redirect: io.redirect,
  notFound: io.notFound,
}))
vi.mock('@/app/(frontend)/_lib/city-context', () => ({
  listPublicCityProfiles: io.listPublicCityProfiles,
  resolveCityContext: io.resolveCityContext,
}))
vi.mock('@/lib/frontend/cached-queries', () => ({
  getCachedHomepage: io.getCachedHomepage,
  getCachedSearchListings: io.getCachedSearchListings,
  getCachedListingDistrictOptions: io.getCachedListingDistrictOptions,
  getCachedSearchBuildingsFiltered: io.getCachedSearchBuildingsFiltered,
  getCachedListingBySlug: io.getCachedListingBySlug,
  getCachedBuildingBySlug: io.getCachedBuildingBySlug,
  getCachedBuildingDetail: io.getCachedBuildingDetail,
  getCachedRelatedBuildings: io.getCachedRelatedBuildings,
  getCachedDetailRecommendations: io.getCachedDetailRecommendations,
}))
vi.mock('@/lib/frontend/location-pois', () => ({ fetchNearbyPois: io.fetchNearbyPois }))
vi.mock('@/lib/frontend/service-schedule', () => ({ getServiceSchedule: io.getServiceSchedule }))
vi.mock('@/lib/frontend/amap-public-config', () => ({ hasAmapJsKey: io.hasAmapJsKey }))
vi.mock('@/components/frontend/city/CityListingDetailView', () => ({
  default: (props: unknown) => {
    io.cityListingDetailProps.push(props)
    return null
  },
}))
// OPT-053：路由层现在会读站点设置。本文件不该为此起真实 payload 实例——
// getPayload 在单测里会挂住，表现为 Unhandled Rejection（用例照样绿，但退出码非零）。
vi.mock('@/lib/frontend/site-settings', async () => {
  const actual = await vi.importActual<typeof import('@/lib/frontend/site-settings')>(
    '@/lib/frontend/site-settings',
  )
  return {
    ...actual,
    getCachedSiteSettings: async () => actual.SITE_SETTINGS_FALLBACK,
  }
})

vi.mock('@/domain/public-catalog', () => ({
  resolveListingRouteIdentity: io.resolveListingRouteIdentity,
  resolveBuildingRouteIdentity: io.resolveBuildingRouteIdentity,
  PUBLIC_CACHE_TAG_PREFIX: 'public',
  // OPT-053：站点设置的缓存 tag 与 TTL。本文件整体 mock 了 public-catalog，
  // 新增导出必须在这里补齐，否则 site-settings.ts 的 import 会拿到 undefined。
  SITE_SETTINGS_TAG: 'public:site-settings',
  SITE_SETTINGS_REVALIDATE_SECONDS: 60,
  buildCanonicalSearchParams: () => new URLSearchParams(),
  buildBuildingCanonicalParams: () => new URLSearchParams(),
  parseBuildingSearchInput: io.parseBuildingSearchInput,
  parseListingSearchInput: io.parseListingSearchInput,
  parseBuildingSupplySearchParams: io.parseBuildingSupplySearchParams,
  buildBuildingSupplyCanonicalSearchParams: () => new URLSearchParams(),
  createSearchContext: io.createSearchContext,
  getBuildingDetail: io.getBuildingDetail,
  normalizePublicMediaUrl: (value: unknown) => typeof value === 'string' ? value : null,
}))
vi.mock('@/lib/frontend/site-config', () => ({
  siteConfig: { defaultCity: 'shanghai', siteOrigin: 'https://example.test', siteUrl: new URL('https://example.test') },
  getMultiCityRoutingEnabled: () => process.env.MULTI_CITY_ROUTING_ENABLED === 'true',
  // 出售功能开关：默认关闭，让既有断言在「功能不可见」这个默认态下验证。
  // 需要验证开启态的用例请在自己的文件里单独 mock 为 true。
  getSaleChannelEnabled: () => process.env.NEXT_PUBLIC_SALE_CHANNEL_ENABLED === 'true',
}))

import CityHomePage, {
  dynamicParams,
  generateMetadata,
  generateStaticParams,
  revalidate,
} from '@/app/(frontend)/[city]/page'
import CityListingDetailPage, { generateMetadata as generateCityListingDetailMetadata } from '@/app/(frontend)/[city]/listings/[slug]/page'
import CityListingsPage, { generateMetadata as generateListingsMetadata } from '@/app/(frontend)/[city]/listings/page'
import CityBuildingsPage, { dynamic as buildingsDynamic, generateMetadata as generateBuildingsMetadata } from '@/app/(frontend)/[city]/buildings/page'
import LegacyHomePage from '@/app/(frontend)/page'
import LegacyListingsPage from '@/app/(frontend)/listings/page'
import LegacyBuildingsPage from '@/app/(frontend)/buildings/page'
import LegacyListingDetailPage from '@/app/(frontend)/listings/[slug]/page'
import LegacyBuildingDetailPage from '@/app/(frontend)/buildings/[slug]/page'
import CityBuildingDetailPage, { generateMetadata as generateCityBuildingDetailMetadata } from '@/app/(frontend)/[city]/buildings/[slug]/page'
import { buildListingJsonLd } from '@/lib/frontend/detail-metadata'
import { siteConfig } from '@/lib/frontend/site-config'

const liveCity = {
  id: 1,
  slug: 'shanghai',
  name: '上海',
  serviceStatus: 'live' as const,
  profile: {
    citySlug: 'shanghai', cityName: '上海', serviceStatus: 'live' as const,
    seoTitle: '上海办公选址', seoDescription: '上海办公选址服务',
    hero: { eyebrow: '', heading: '', body: '', media: null },
    intro: { heading: '', body: '' }, contact: { heading: '', body: '' },
    featuredRegions: [], cityId: 1, switcherVisible: true, sortOrder: 1,
  },
}

const comingSoonCity = {
  ...liveCity,
  id: 2,
  slug: 'hangzhou',
  name: '杭州',
  serviceStatus: 'coming-soon' as const,
  profile: { ...liveCity.profile, citySlug: 'hangzhou', cityName: '杭州', serviceStatus: 'coming-soon' as const },
}

describe('city route boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.MULTI_CITY_ROUTING_ENABLED
    Reflect.set(siteConfig, 'defaultCity', 'shanghai')
    io.listPublicCityProfiles.mockResolvedValue([liveCity.profile, comingSoonCity.profile])
    io.resolveCityContext.mockImplementation(async (slug: string) => (
      slug === 'shanghai' ? liveCity : slug === 'hangzhou' ? comingSoonCity : null
    ))
    io.getCachedHomepage.mockResolvedValue({
      featuredListings: [], districts: [], featuredBuildings: [], districtCards: [], latestArticles: [],
    })
    io.getCachedBuildingBySlug.mockResolvedValue({ id: 9, amenityGroups: [] })
    io.getCachedDetailRecommendations.mockResolvedValue([])
    io.fetchNearbyPois.mockResolvedValue({})
    io.getServiceSchedule.mockResolvedValue(undefined)
    io.hasAmapJsKey.mockReturnValue(true)
    io.parseListingSearchInput.mockReturnValue({ page: 1 })
    io.parseBuildingSupplySearchParams.mockReturnValue({})
    io.createSearchContext.mockReturnValue({ citySlug: 'shanghai' })
    io.getCachedRelatedBuildings.mockResolvedValue([])
  })

  it('enumerates all valid profiles for ISR with runtime fallback enabled', async () => {
    io.listPublicCityProfiles.mockResolvedValue([
      liveCity.profile,
      comingSoonCity.profile,
      { ...liveCity.profile, citySlug: 'news' },
    ])
    await expect(generateStaticParams()).resolves.toEqual([{ city: 'shanghai' }, { city: 'hangzhou' }])
    expect(dynamicParams).toBe(true)
    expect(revalidate).toBe(300)
  })

  it('fails closed for an unknown city before loading home inventory', async () => {
    await expect(CityHomePage({ params: Promise.resolve({ city: 'unknown' }) })).rejects.toThrow('not-found')
    expect(io.getCachedHomepage).not.toHaveBeenCalled()
  })

  it('marks a coming-soon city home noindex without loading inventory', async () => {
    await expect(generateMetadata({ params: Promise.resolve({ city: 'hangzhou' }) }))
      .resolves.toMatchObject({ robots: { index: false, follow: true } })
    await CityHomePage({ params: Promise.resolve({ city: 'hangzhou' }) })
    expect(io.getCachedHomepage).not.toHaveBeenCalled()
  })

  it('loads cached city-scoped inventory for a live city', async () => {
    await CityHomePage({ params: Promise.resolve({ city: 'shanghai' }) })
    expect(io.getCachedHomepage).toHaveBeenCalledWith('shanghai')
  })

  it('redirects a wrong-city detail from minimal identity without loading the document', async () => {
    io.resolveListingRouteIdentity.mockResolvedValue({ slug: 'shanghai-office', citySlug: 'shanghai' })
    await expect(CityListingDetailPage({
      params: Promise.resolve({ city: 'hangzhou', slug: 'shanghai-office' }),
    })).rejects.toThrow('redirect:/shanghai/listings/shanghai-office')
    expect(io.resolveListingRouteIdentity).toHaveBeenCalledWith('shanghai-office')
  })

  it('loads complete city-scoped detail enrichments before rendering the shared listing view', async () => {
    process.env.MULTI_CITY_ROUTING_ENABLED = 'true'
    io.resolveListingRouteIdentity.mockResolvedValue({ slug: 'shanghai-office', citySlug: 'shanghai' })
    const listing = {
      id: 101,
      slug: 'shanghai-office',
      building: { id: 9, slug: 'tower', coordinates: { longitude: 121.5, latitude: 31.2 } },
    }
    io.getCachedListingBySlug.mockResolvedValue(listing)

    const page = await CityListingDetailPage({ params: Promise.resolve({ city: 'shanghai', slug: 'shanghai-office' }) })

    // OPT-037 Task 9：楼盘详情文档随「配套设施」段一并移除（见
    // CityListingDetailView 文件头），房源详情路由不再取它。
    expect(io.getCachedBuildingBySlug).not.toHaveBeenCalled()
    expect(io.getCachedDetailRecommendations).toHaveBeenCalledWith('shanghai', 'shanghai-office', 6)
    expect(io.fetchNearbyPois).toHaveBeenCalledWith(9, listing.building.coordinates)
    expect(io.getServiceSchedule).toHaveBeenCalledTimes(1)
    expect(page).toMatchObject({ props: expect.objectContaining({
      city: liveCity,
      listing,
      routeMode: 'prefixed',
      mapEnabled: true,
    }) })
  })

  it('returns prefixed listing detail ownership to the exact legacy canonical while the flag is off', async () => {
    const listing = {
      id: 101, slug: 'shanghai-office', title: 'Shanghai Office', citySlug: 'shanghai', cityName: 'Shanghai',
      price: null, area: 100, floor: null, businessType: 'lease' as const, decorationStatus: null,
      listingType: 'traditional-office' as const, availableFrom: null, isFeatured: false,
      building: { id: 9, slug: 'tower', name: 'Tower', citySlug: 'shanghai', cityName: 'Shanghai', address: 'Road' },
      coverImage: null, highlights: [], stableSortKey: '101', seats: null, gallery: [], mediaItems: [],
      factGroups: [], amenityGroups: [], verification: { verifiedAt: null, priceVerifiedAt: null }, description: null,
    }
    io.resolveListingRouteIdentity.mockResolvedValue({ slug: listing.slug, citySlug: 'shanghai' })
    io.getCachedListingBySlug.mockResolvedValue(listing)

    const metadata = await generateCityListingDetailMetadata({
      params: Promise.resolve({ city: 'shanghai', slug: listing.slug }),
    })
    expect(metadata).toMatchObject({
      alternates: { canonical: '/listings/shanghai-office' },
      openGraph: { url: 'https://example.test/listings/shanghai-office' },
      robots: { index: false, follow: true },
    })
    const page = await CityListingDetailPage({ params: Promise.resolve({ city: 'shanghai', slug: listing.slug }) })
    expect(page).toMatchObject({ props: expect.objectContaining({ routeMode: 'legacy' }) })
    const jsonLd = buildListingJsonLd(listing, siteConfig.siteOrigin)
    expect(jsonLd.url).toBe('https://example.test/listings/shanghai-office')
    expect(jsonLd.breadcrumb.itemListElement.map((item) => item.item)).toEqual([
      'https://example.test/',
      'https://example.test/listings',
      'https://example.test/buildings/tower',
      'https://example.test/listings/shanghai-office',
    ])
  })

  it('returns prefixed building detail metadata and structured data to exact legacy ownership while the flag is off', async () => {
    const building = {
      id: 9, slug: 'tower', name: 'Tower', citySlug: 'shanghai', cityName: 'Shanghai', address: 'Road',
      district: null, coverImage: null, gallery: [], mediaItems: [], factGroups: [], amenityGroups: [], amenities: [],
      verification: { verifiedAt: null, priceVerifiedAt: null }, summary: 'Summary', description: null, coordinates: null,
    }
    const supply = { asOf: '2026-08-13T00:00:00.000Z', totalEffectiveListings: 0, resultCount: 0,
      validationErrors: [], groups: [], availableGroups: [] }
    io.resolveBuildingRouteIdentity.mockResolvedValue({ slug: building.slug, citySlug: 'shanghai' })
    io.getCachedBuildingDetail.mockResolvedValue({ building, supply })
    io.getBuildingDetail.mockResolvedValue({ building, supply })

    const props = { params: Promise.resolve({ city: 'shanghai', slug: building.slug }), searchParams: Promise.resolve({}) }
    const metadata = await generateCityBuildingDetailMetadata(props)
    expect(metadata).toMatchObject({
      alternates: { canonical: '/buildings/tower' },
      openGraph: { url: 'https://example.test/buildings/tower' },
      robots: { index: false, follow: true },
    })
    const page = await CityBuildingDetailPage(props)
    const script = Array.isArray(page.props.children) ? page.props.children[0] : null
    const jsonLd = JSON.parse(script.props.dangerouslySetInnerHTML.__html)
    expect(jsonLd.url).toBe('https://example.test/buildings/tower')
    expect(jsonLd.breadcrumb.itemListElement.map((item: { item: string }) => item.item)).toEqual([
      'https://example.test/',
      'https://example.test/listings',
      'https://example.test/buildings/tower',
    ])
  })

  it('serves a coming-soon listings URL as noindex without listing or facet queries', async () => {
    const props = { params: Promise.resolve({ city: 'hangzhou' }), searchParams: Promise.resolve({}) }
    await expect(generateListingsMetadata(props)).resolves.toMatchObject({ robots: { index: false, follow: true } })
    await CityListingsPage(props)
    expect(io.getCachedSearchListings).not.toHaveBeenCalled()
    expect(io.getCachedListingDistrictOptions).not.toHaveBeenCalled()
  })

  it('keeps coming-soon buildings dynamic and noindex without inventory queries', async () => {
    const props = { params: Promise.resolve({ city: 'hangzhou' }), searchParams: Promise.resolve({}) }
    await expect(generateBuildingsMetadata(props)).resolves.toMatchObject({ robots: { index: false, follow: true } })
    await CityBuildingsPage(props)
    expect(buildingsDynamic).toBe('force-dynamic')
    // 未开城不查库：Task 12 把楼盘列表改成走筛选版查询，断言跟着换成同一个入口
    // （未筛选版 getCachedSearchBuildings 已在 Task 13 删除，不再需要单独断言其未被调用）
    expect(io.getCachedSearchBuildingsFiltered).not.toHaveBeenCalled()
  })

  it('uses the first Next.js array query value for legacy and prefixed listings', async () => {
    const props = { searchParams: Promise.resolve({ q: ['first', 'second'] }) }
    await LegacyListingsPage(props)
    await CityListingsPage({ ...props, params: Promise.resolve({ city: 'shanghai' }) })
    expect(io.parseListingSearchInput.mock.calls.map(([value]) => value.get('q'))).toEqual(['first', 'first'])
  })

  it('redirects the legacy home to the configured default city while routing is enabled', async () => {
    process.env.MULTI_CITY_ROUTING_ENABLED = 'true'
    await expect(LegacyHomePage()).rejects.toThrow('redirect:/shanghai')
    expect(io.getCachedHomepage).not.toHaveBeenCalled()
  })

  it('redirects legacy listing and building roots only when the runtime flag is enabled', async () => {
    process.env.MULTI_CITY_ROUTING_ENABLED = 'true'
    await expect(LegacyListingsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('redirect:/shanghai/listings')
    await expect(LegacyBuildingsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('redirect:/shanghai/buildings')
  })

  it('redirects legacy list and building queries through the city URL canonicalizer', async () => {
    process.env.MULTI_CITY_ROUTING_ENABLED = 'true'
    await expect(LegacyListingsPage({ searchParams: Promise.resolve({
      type: 'coworking', rentUnit: 'rmb-sqm-day', sort: 'rent-asc', q: 'near metro', page: '3', unknown: 'drop',
    }) })).rejects.toThrow('redirect:/shanghai/listings?type=coworking&priceUnit=rmb-sqm-day&q=near+metro&sort=price-asc')
    await expect(LegacyBuildingsPage({ searchParams: Promise.resolve({ grade: 'grade-a', page: '2', unknown: 'drop' }) }))
      .rejects.toThrow('redirect:/shanghai/buildings?grade=grade-a')
  })

  it('fails closed instead of redirecting legacy roots through an invalid default-city configuration', async () => {
    process.env.MULTI_CITY_ROUTING_ENABLED = 'true'
    Reflect.set(siteConfig, 'defaultCity', 'news')
    await expect(LegacyHomePage()).rejects.toThrow('not-found')
    await expect(LegacyListingsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('not-found')
    await expect(LegacyBuildingsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('not-found')
  })

  it('redirects a legacy detail by minimal identity without querying a default-city document', async () => {
    process.env.MULTI_CITY_ROUTING_ENABLED = 'true'
    io.resolveListingRouteIdentity.mockResolvedValue({ slug: 'hangzhou-office', citySlug: 'hangzhou' })
    await expect(LegacyListingDetailPage({ params: Promise.resolve({ slug: 'hangzhou-office' }) }))
      .rejects.toThrow('redirect:/hangzhou/listings/hangzhou-office')
    expect(io.getCachedListingBySlug).not.toHaveBeenCalled()
  })

  it('redirects legacy and wrong-city building details using identity before loading a document', async () => {
    process.env.MULTI_CITY_ROUTING_ENABLED = 'true'
    io.resolveBuildingRouteIdentity.mockResolvedValue({ slug: 'hangzhou-tower', citySlug: 'hangzhou' })
    const legacy = { params: Promise.resolve({ slug: 'hangzhou-tower' }), searchParams: Promise.resolve({}) }
    await expect(LegacyBuildingDetailPage(legacy)).rejects.toThrow('redirect:/hangzhou/buildings/hangzhou-tower')
    await expect(CityBuildingDetailPage({
      ...legacy,
      params: Promise.resolve({ city: 'shanghai', slug: 'hangzhou-tower' }),
    })).rejects.toThrow('redirect:/hangzhou/buildings/hangzhou-tower')
    expect(io.resolveBuildingRouteIdentity).toHaveBeenCalledWith('hangzhou-tower')
  })

  it('redirects legacy building metadata by identity before loading the default-city detail', async () => {
    process.env.MULTI_CITY_ROUTING_ENABLED = 'true'
    io.resolveBuildingRouteIdentity.mockResolvedValue({ slug: 'hangzhou-tower', citySlug: 'hangzhou' })
    const { generateMetadata: generateLegacyBuildingMetadata } = await import('@/app/(frontend)/buildings/[slug]/page')
    await expect(generateLegacyBuildingMetadata({ params: Promise.resolve({ slug: 'hangzhou-tower' }) }))
      .rejects.toThrow('redirect:/hangzhou/buildings/hangzhou-tower')
    expect(io.getCachedBuildingBySlug).not.toHaveBeenCalled()
  })

  it('fails static city enumeration closed when the profile query is unavailable', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    io.listPublicCityProfiles.mockRejectedValue(new Error('database unavailable'))
    await expect(generateStaticParams()).resolves.toEqual([])
    expect(error).toHaveBeenCalledWith('city_static_params_unavailable')
    error.mockRestore()
  })
})
