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
      seoTitle: `${name}办公租赁`,
      seoDescription: `${name}办公租赁与选址服务。`,
      hero: { eyebrow: '', heading: '', body: '', media: null },
      intro: { heading: '', body: '' },
      contact: { heading: '', body: '' },
      featuredRegions: [],
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

  it('keeps every city-partner query variant on one query-free canonical', () => {
    expect(cityPartnerCanonical('?city=hangzhou')).toBe('/city-partner')
    expect(cityPartnerCanonical('?city=hangzhou&phone=13800001111')).toBe('/city-partner')
    expect(cityPartnerCanonical(undefined)).toBe('/city-partner')
  })
})
