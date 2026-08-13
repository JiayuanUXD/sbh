import { describe, expect, it } from 'vitest'

import {
  buildCityPath,
  getCityPageType,
  legacyCanonicalPath,
  prefixedCanonicalPath,
  switchCityUrl,
} from '@/lib/frontend/city-routes'

describe('city route URL contract', () => {
  it.each([
    ['home', '/hangzhou'],
    ['listings', '/hangzhou/listings'],
    ['listing-detail', '/hangzhou/listings'],
    ['buildings', '/hangzhou/buildings'],
    ['building-detail', '/hangzhou/buildings'],
    ['news', '/news'],
    ['privacy', '/pages/privacy'],
    ['page-detail', '/pages'],
    ['entrust', '/entrust?city=hangzhou'],
    ['publish', '/publish?city=hangzhou'],
    ['city-partner', '/city-partner?city=hangzhou'],
  ] as const)('builds the canonical %s destination', (pageType, expected) => {
    expect(buildCityPath('hangzhou', pageType)).toBe(expected)
  })

  it.each([
    ['/shanghai', 'home'],
    ['/shanghai/listings', 'listings'],
    ['/shanghai/listings/central-office', 'listing-detail'],
    ['/shanghai/buildings', 'buildings'],
    ['/shanghai/buildings/central-tower', 'building-detail'],
    ['/news', 'news'],
    ['/news/market-report', 'news-detail'],
    ['/pages/privacy', 'privacy'],
    ['/pages/office-guide', 'page-detail'],
    ['/entrust', 'entrust'],
    ['/publish', 'publish'],
    ['/city-partner', 'city-partner'],
    ['/shanghai/listings/too/deep', 'unknown'],
    ['/not a city', 'unknown'],
  ] as const)('classifies %s as %s', (pathname, expected) => {
    expect(getCityPageType(pathname)).toBe(expected)
  })

  it('switches a listing list with only portable filters in stable order', () => {
    expect(
      switchCityUrl(
        '/shanghai/listings?sort=price-desc&district=pudong&q=river&page=3&areaMin=100&rentUnit=rmb-day&extra=drop',
        'hangzhou',
      ),
    ).toBe('/hangzhou/listings?q=river&areaMin=100&rentUnit=rmb-day&sort=price-desc')
  })

  it('preserves every listing portable filter and discards duplicate, malformed, geography, and page values', () => {
    expect(
      switchCityUrl(
        '/shanghai/listings?priceBasis=unit&availableBefore=2026-12-31&listingType=traditional-office&pricePeriod=month&rentMax=999&rentMin=100&areaMax=200&areaMin=10&q=first&q=second&district=x&businessArea=y&metro=z&page=0&unknown=keep-no',
        'hangzhou',
      ),
    ).toBe('/hangzhou/listings?q=first&areaMin=10&areaMax=200&rentMin=100&rentMax=999&pricePeriod=month&priceBasis=unit&listingType=traditional-office&availableBefore=2026-12-31')
  })

  it('switches a building list with only grade and clears geography and page', () => {
    expect(
      switchCityUrl('/shanghai/buildings?district=pudong&grade=A&page=2&sort=name', 'hangzhou'),
    ).toBe('/hangzhou/buildings?grade=A')
  })

  it.each([
    ['/shanghai/listings/central-office?district=pudong&page=2', '/hangzhou/listings'],
    ['/shanghai/buildings/central-tower?grade=A&page=2', '/hangzhou/buildings'],
  ])('returns city detail %s to the destination list', (source, expected) => {
    expect(switchCityUrl(source, 'hangzhou')).toBe(expected)
  })

  it.each([
    ['/news', '/hangzhou'],
    ['/news/market-report?page=2', '/hangzhou'],
    ['/pages/privacy', '/hangzhou'],
    ['/pages/office-guide?preview=true', '/hangzhou'],
  ])('returns global content %s to destination home', (source, expected) => {
    expect(switchCityUrl(source, 'hangzhou')).toBe(expected)
  })

  it.each([
    ['/entrust?city=shanghai&email=private&page=2', '/entrust?city=hangzhou'],
    ['/publish?city=shanghai&district=pudong', '/publish?city=hangzhou'],
    ['/city-partner?city=shanghai&source=nav', '/city-partner?city=hangzhou'],
  ])('keeps lead routes while replacing only their canonical city', (source, expected) => {
    expect(switchCityUrl(source, 'hangzhou')).toBe(expected)
  })

  it('drops fragments, absolute URLs, malformed source paths, and untrusted destination cities', () => {
    expect(switchCityUrl('/shanghai/listings?areaMin=100#private-fragment', 'hangzhou')).toBe(
      '/hangzhou/listings?areaMin=100',
    )
    expect(switchCityUrl('https://attacker.example/shanghai/listings?areaMin=100', 'hangzhou')).toBe(
      '/hangzhou',
    )
    expect(switchCityUrl('/shanghai/listings/too/deep?areaMin=100', 'hangzhou')).toBe(
      '/hangzhou',
    )
    expect(switchCityUrl('/shanghai/listings?areaMin=100', ' Hangzhou ')).toBeNull()
    expect(switchCityUrl('/shanghai/listings?areaMin=100', '../hangzhou')).toBeNull()
    expect(buildCityPath(' Hangzhou ', 'home')).toBeNull()
  })

  it('derives legacy and prefixed canonical paths without retaining unapproved query data', () => {
    expect(
      legacyCanonicalPath('/hangzhou/listings?district=pudong&areaMin=100&page=3&unknown=drop'),
    ).toBe('/listings?areaMin=100')
    expect(
      legacyCanonicalPath('/hangzhou/buildings/central-tower?grade=A&district=pudong'),
    ).toBe('/buildings/central-tower')
    expect(
      prefixedCanonicalPath('/listings?sort=price-desc&district=pudong&page=3', 'hangzhou'),
    ).toBe('/hangzhou/listings?sort=price-desc')
    expect(prefixedCanonicalPath('/news/market-report?page=2', 'hangzhou')).toBe('/news/market-report')
    expect(prefixedCanonicalPath('/entrust?city=shanghai&email=private', 'hangzhou')).toBe(
      '/entrust?city=hangzhou',
    )
  })
})
