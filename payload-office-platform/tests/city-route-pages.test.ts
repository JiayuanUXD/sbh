import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  listPublicCityProfiles: vi.fn(),
  resolveCityContext: vi.fn(),
  getCachedHomepage: vi.fn(),
  getCachedSearchListings: vi.fn(),
  getCachedListingDistrictOptions: vi.fn(),
  getCachedSearchBuildings: vi.fn(),
  getCachedListingBySlug: vi.fn(),
  getCachedBuildingBySlug: vi.fn(),
  getCachedDetailRecommendations: vi.fn(),
  fetchNearbyPois: vi.fn(),
  getServiceSchedule: vi.fn(),
  hasAmapJsKey: vi.fn(),
  cityListingDetailProps: [] as unknown[],
  resolveListingRouteIdentity: vi.fn(),
  resolveBuildingRouteIdentity: vi.fn(),
  parseListingSearchInput: vi.fn(),
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
  getCachedSearchBuildings: io.getCachedSearchBuildings,
  getCachedListingBySlug: io.getCachedListingBySlug,
  getCachedBuildingBySlug: io.getCachedBuildingBySlug,
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
vi.mock('@/domain/public-catalog', () => ({
  resolveListingRouteIdentity: io.resolveListingRouteIdentity,
  resolveBuildingRouteIdentity: io.resolveBuildingRouteIdentity,
  PUBLIC_CACHE_TAG_PREFIX: 'public',
  buildCanonicalSearchParams: () => new URLSearchParams(),
  parseListingSearchInput: io.parseListingSearchInput,
}))
vi.mock('@/lib/frontend/site-config', () => ({
  siteConfig: { defaultCity: 'shanghai', siteOrigin: 'https://example.test', siteUrl: new URL('https://example.test') },
  getMultiCityRoutingEnabled: () => process.env.MULTI_CITY_ROUTING_ENABLED === 'true',
}))

import CityHomePage, {
  dynamicParams,
  generateMetadata,
  generateStaticParams,
  revalidate,
} from '@/app/(frontend)/[city]/page'
import CityListingDetailPage from '@/app/(frontend)/[city]/listings/[slug]/page'
import CityListingsPage, { generateMetadata as generateListingsMetadata } from '@/app/(frontend)/[city]/listings/page'
import CityBuildingsPage, { dynamic as buildingsDynamic, generateMetadata as generateBuildingsMetadata } from '@/app/(frontend)/[city]/buildings/page'
import LegacyHomePage from '@/app/(frontend)/page'
import LegacyListingsPage from '@/app/(frontend)/listings/page'
import LegacyBuildingsPage from '@/app/(frontend)/buildings/page'
import LegacyListingDetailPage from '@/app/(frontend)/listings/[slug]/page'
import LegacyBuildingDetailPage from '@/app/(frontend)/buildings/[slug]/page'
import CityBuildingDetailPage from '@/app/(frontend)/[city]/buildings/[slug]/page'
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
    io.resolveListingRouteIdentity.mockResolvedValue({ slug: 'shanghai-office', citySlug: 'shanghai' })
    const listing = {
      id: 101,
      slug: 'shanghai-office',
      building: { id: 9, slug: 'tower', coordinates: { longitude: 121.5, latitude: 31.2 } },
    }
    io.getCachedListingBySlug.mockResolvedValue(listing)

    const page = await CityListingDetailPage({ params: Promise.resolve({ city: 'shanghai', slug: 'shanghai-office' }) })

    expect(io.getCachedBuildingBySlug).toHaveBeenCalledWith('shanghai', 'tower')
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
    expect(io.getCachedSearchBuildings).not.toHaveBeenCalled()
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
    }) })).rejects.toThrow('redirect:/shanghai/listings?type=coworking&rentUnit=rmb-sqm-day&q=near+metro&sort=rent-asc')
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
