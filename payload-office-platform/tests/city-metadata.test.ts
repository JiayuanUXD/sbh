import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/frontend/site-config', () => ({
  siteConfig: { siteOrigin: 'https://example.com', siteUrl: new URL('https://example.com') },
}))

import type { CityContext } from '@/domain/city-site-profile/resolver'
import { buildCityPageMetadata, cityPartnerCanonical } from '@/lib/frontend/metadata'

function city(
  slug: string,
  name: string,
  serviceStatus: CityContext['serviceStatus'],
): CityContext {
  return {
    id: slug,
    slug,
    name,
    serviceStatus,
    profile: {
      cityId: slug,
      citySlug: slug,
      cityName: name,
      serviceStatus,
      switcherVisible: true,
      sortOrder: 10,
      avgResponseHours: null,
      seoTitle: `${name}办公租赁`,
      seoDescription: `${name}办公租赁与选址服务。`,
      hero: { eyebrow: '', heading: '', body: '', media: null, video: null, videoEnabled: true },
      intro: { heading: '', body: '' },
      contact: { heading: '', body: '' },
      featuredRegions: [],
      typeCardOverrides: [],
      featuredDistrictCount: 5,
    },
  }
}

describe('city metadata observation contract', () => {
  const liveShanghai = city('shanghai', '上海', 'live')
  const comingHangzhou = city('hangzhou', '杭州', 'coming-soon')

  it('gives a live city unique profile SEO and prefixed canonical when routing is enabled', () => {
    const metadata = buildCityPageMetadata({
      city: liveShanghai,
      pageType: 'home',
      multiCityRoutingEnabled: true,
    })

    expect(metadata).toMatchObject({
      title: expect.stringContaining('上海'),
      description: expect.stringContaining('上海'),
      alternates: { canonical: '/shanghai' },
      openGraph: { url: 'https://example.com/shanghai' },
      robots: { index: true, follow: true },
    })
  })

  it('keeps coming-soon city pages noindex/follow while retaining their city canonical', () => {
    expect(buildCityPageMetadata({
      city: comingHangzhou,
      pageType: 'listings',
      multiCityRoutingEnabled: true,
    })).toMatchObject({
      title: expect.stringContaining('杭州'),
      description: expect.stringContaining('杭州'),
      alternates: { canonical: '/hangzhou/listings' },
      robots: { index: false, follow: true },
    })
  })

  it('returns canonical ownership to legacy URLs and noindexes prefixed pages when the flag is off', () => {
    expect(buildCityPageMetadata({
      city: liveShanghai,
      pageType: 'buildings',
      multiCityRoutingEnabled: false,
      routeMode: 'prefixed',
    })).toMatchObject({
      alternates: { canonical: '/buildings' },
      openGraph: { url: 'https://example.com/buildings' },
      robots: { index: false, follow: true },
    })
  })

  // 2026-09-16：出售频道曾借用 pageType 'listings'，canonical 因此指向租赁列表
  // （`/shanghai/sale?district=changning` → `/shanghai/listings?district=changning`）。
  // 频道多数时候 noindex 把影响压住了，一旦过了 shouldIndexSaleChannel 门槛就会被
  // 搜索引擎并进租赁列表。canonical 必须指向出售频道自身，文案也要是出售语境。
  it('gives the sale channel its own canonical and copy instead of folding it into listings', () => {
    expect(buildCityPageMetadata({
      city: liveShanghai,
      pageType: 'sale',
      multiCityRoutingEnabled: true,
      canonicalQuery: 'district=changning',
    })).toMatchObject({
      title: expect.stringContaining('上海'),
      description: expect.stringContaining('出售'),
      alternates: { canonical: '/shanghai/sale?district=changning' },
      openGraph: { url: 'https://example.com/shanghai/sale?district=changning' },
      robots: { index: true, follow: true },
    })
  })

  it('returns sale canonical ownership to the legacy /sale URL while the flag is off', () => {
    expect(buildCityPageMetadata({
      city: liveShanghai,
      pageType: 'sale',
      multiCityRoutingEnabled: false,
      routeMode: 'prefixed',
      canonicalQuery: 'district=changning',
    })).toMatchObject({
      alternates: { canonical: '/sale?district=changning' },
      openGraph: { url: 'https://example.com/sale?district=changning' },
      robots: { index: false, follow: true },
    })
  })

  it('keeps every city-partner query variant on one query-free canonical', () => {
    expect(cityPartnerCanonical('?city=hangzhou')).toBe('/city-partner')
    expect(cityPartnerCanonical('?city=hangzhou&phone=13800001111')).toBe('/city-partner')
    expect(cityPartnerCanonical(undefined)).toBe('/city-partner')
  })
})
