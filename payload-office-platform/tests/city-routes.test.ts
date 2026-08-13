import { describe, expect, it } from 'vitest'

import {
  buildCityPath,
  citySwitchPreservedFilters,
  getCityPageType,
  legacyCanonicalPath,
  prefixedCanonicalPath,
  switchCityUrl,
} from '@/lib/frontend/city-routes'

describe('city route URL contract', () => {
  it('treats root as global home and derives both canonical ownership variants', () => {
    expect(getCityPageType('/')).toBe('home')
    expect(legacyCanonicalPath('/')).toBe('/')
    expect(prefixedCanonicalPath('/', 'hangzhou')).toBe('/hangzhou')
    expect(switchCityUrl('/', 'hangzhou')).toBe('/hangzhou')
  })

  it.each([
    'news',
    'pages',
    'entrust',
    'publish',
    'city-partner',
    'admin',
    'api',
    '_next',
    'media',
    'listings',
    'buildings',
    'dev-story',
    'sitemap',
    'robots',
  ])('refuses reserved root segment %s as a city slug', (reserved) => {
    expect(buildCityPath(reserved, 'home')).toBeNull()
    expect(getCityPageType(`/${reserved}/listings`)).not.toBe('listings')
    expect(prefixedCanonicalPath('/listings', reserved)).toBeNull()
  })

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

  it.each([
    '/%6eews',
    '/%6cistings',
    '/%73hanghai',
    '/shang%68ai/listings',
    '/shanghai/%6cistings',
  ])('rejects encoded aliases for static and city route tokens: %s', (source) => {
    expect(getCityPageType(source)).toBe('unknown')
    expect(legacyCanonicalPath(source)).toBeNull()
    expect(prefixedCanonicalPath(source, 'hangzhou')).toBeNull()
  })

  it('switches a listing list with only portable filters in stable order', () => {
    expect(
      switchCityUrl(
        '/shanghai/listings?sort=rent-desc&district=pudong&q= river &page=3&areaMin=1e2&rentUnit=rmb-sqm-day&type=coworking&extra=drop',
        'hangzhou',
      ),
    ).toBe('/hangzhou/listings?type=coworking&areaMin=100&rentUnit=rmb-sqm-day&q=river&sort=rent-desc')
  })

  it('uses the current type query key and retains future structured price keys only when valid', () => {
    expect(
      switchCityUrl(
        '/shanghai/listings?priceBasis=total&availableBefore=2026-12-31&listingType=traditional-office&type=traditional-office&pricePeriod=month&rentMax=999&rentMin=100&areaMax=200&areaMin=10&q=first&district=x&businessArea=y&metro=z&page=0&unknown=keep-no',
        'hangzhou',
      ),
    ).toBe('/hangzhou/listings?type=traditional-office&areaMin=10&areaMax=200&rentMin=100&rentMax=999&pricePeriod=month&priceBasis=total&availableBefore=2026-12-31&q=first')
  })

  it('drops duplicate scalar values while normalizing current parser number and q forms', () => {
    expect(
      switchCityUrl(
        '/shanghai/listings?q=one&q=two&areaMin=001&areaMax=100.9&rentMin=30&rentMax=20&rentUnit=usd&pricePeriod=year&priceBasis=unit&listingType=unknown&type=unknown&availableBefore=2026-02-30&sort=price-desc',
        'hangzhou',
      ),
    ).toBe('/hangzhou/listings?areaMin=1&areaMax=100')
    expect(
      switchCityUrl(
        `/shanghai/listings?q=%20${'a'.repeat(101)}%20&availableBefore=2026-08-31&rentUnit=rmb-month&sort=rent-desc`,
        'hangzhou',
      ),
    ).toBe(`/hangzhou/listings?rentUnit=rmb-month&availableBefore=2026-08-31&q=${'a'.repeat(100)}&sort=rent-desc`)
    expect(switchCityUrl('/shanghai/listings?type=coworking&type=full-floor', 'hangzhou')).toBe(
      '/hangzhou/listings',
    )
    expect(switchCityUrl('/shanghai/buildings?grade=grade-a&grade=super-grade-a', 'hangzhou')).toBe(
      '/hangzhou/buildings',
    )
    expect(switchCityUrl('/shanghai/buildings?grade=unknown', 'hangzhou')).toBe('/hangzhou/buildings')
  })

  it('switches a building list with only grade and clears geography and page', () => {
    expect(
      switchCityUrl('/shanghai/buildings?district=pudong&grade=grade-a&page=2&sort=name', 'hangzhou'),
    ).toBe('/hangzhou/buildings?grade=grade-a')
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

  it.each([
    ['/shanghai//listings', 'double segment'],
    ['/shanghai/listings/', 'trailing segment'],
    ['/shanghai\\listings', 'backslash'],
    ['/shanghai/%2e%2e/listings', 'encoded dot segment'],
    ['/shanghai/%2E/listings', 'encoded current segment'],
    ['/shanghai/%2f/listings', 'encoded slash'],
    ['/shanghai/%5c/listings', 'encoded backslash'],
    ['/shanghai/%00/listings', 'encoded control'],
    ['/shanghai/%252e%252e/listings', 'double encoded dot segment'],
    ['/shanghai/%25252e%25252e/listings', 'triple encoded dot segment'],
    ['/shanghai/%255c/listings', 'double encoded backslash'],
    ['/shanghai/%252f/listings', 'double encoded slash'],
    ['/shanghai/%2525252525252e/listings', 'over-depth encoded percent'],
  ])('fails closed before WHATWG URL normalization for %s (%s)', (source) => {
    expect(getCityPageType(source)).toBe('unknown')
    expect(legacyCanonicalPath(source)).toBeNull()
    expect(prefixedCanonicalPath(source, 'hangzhou')).toBeNull()
    expect(switchCityUrl(source, 'hangzhou')).toBe('/hangzhou')
  })

  it('stably decodes benign UTF-8 detail segments and encodes output exactly once', () => {
    expect(getCityPageType('/news/%E5%8A%9E%E5%85%AC%E6%8C%87%E5%8D%97')).toBe('news-detail')
    expect(legacyCanonicalPath('/news/%E5%8A%9E%E5%85%AC%E6%8C%87%E5%8D%97')).toBe(
      '/news/%E5%8A%9E%E5%85%AC%E6%8C%87%E5%8D%97',
    )
  })

  it.each([
    ['/news/100%25', 'news-detail', '/news/100%25', '/hangzhou'],
    ['/shanghai/listings/100%25', 'listing-detail', '/listings/100%25', '/hangzhou/listings'],
    ['/shanghai/buildings/100%25', 'building-detail', '/buildings/100%25', '/hangzhou/buildings'],
    ['/news/100%2525', 'news-detail', '/news/100%2525', '/hangzhou'],
  ] as const)('keeps one-layer percent detail encoding canonical for %s', (
    source,
    pageType,
    legacy,
    switched,
  ) => {
    expect(getCityPageType(source)).toBe(pageType)
    expect(legacyCanonicalPath(source)).toBe(legacy)
    expect(switchCityUrl(source, 'hangzhou')).toBe(switched)
  })

  it.each([
    '/news/100%',
    '/news/100%2',
    '/news/100%GG',
    '/news/%2f%',
    '/news/%252e%252e%',
    '/news/%252f%',
    '/news/%255c%',
    '/news/%2500%',
  ])('rejects malformed percent text that could conceal dangerous encodings: %s', (source) => {
    expect(getCityPageType(source)).toBe('unknown')
    expect(legacyCanonicalPath(source)).toBeNull()
    expect(prefixedCanonicalPath(source, 'hangzhou')).toBeNull()
    expect(switchCityUrl(source, 'hangzhou')).toBe('/hangzhou')
  })

  it.each([
    '/news/%25',
    '/news/%2525',
    '/news/100%25-done',
  ])('accepts a literal percent only after a complete safe encoding: %s', (source) => {
    expect(getCityPageType(source)).toBe('news-detail')
    expect(legacyCanonicalPath(source)).toBe(source)
  })

  it('derives legacy and prefixed canonical paths without retaining unapproved query data', () => {
    expect(
      legacyCanonicalPath('/hangzhou/listings?district=pudong&areaMin=100&page=3&unknown=drop'),
    ).toBe('/listings?areaMin=100')
    expect(
      legacyCanonicalPath('/hangzhou/buildings/central-tower?grade=A&district=pudong'),
    ).toBe('/buildings/central-tower')
    expect(
      prefixedCanonicalPath('/listings?sort=rent-desc&rentUnit=rmb-month&district=pudong&page=3', 'hangzhou'),
    ).toBe('/hangzhou/listings?rentUnit=rmb-month&sort=rent-desc')
    expect(prefixedCanonicalPath('/news/market-report?page=2', 'hangzhou')).toBe('/news/market-report')
    expect(prefixedCanonicalPath('/entrust?city=shanghai&email=private', 'hangzhou')).toBe(
      '/entrust?city=hangzhou',
    )
  })

  it('reports preservation only when an allowed source filter survives in the switched target', () => {
    expect(citySwitchPreservedFilters(
      '/shanghai/listings?district=pudong&areaMin=100&page=3',
      '/hangzhou/listings?areaMin=100',
    )).toBe(true)
    expect(citySwitchPreservedFilters(
      '/shanghai/buildings?grade=grade-a&district=pudong',
      '/hangzhou/buildings?grade=grade-a',
    )).toBe(true)
    expect(citySwitchPreservedFilters('/entrust?city=shanghai', '/entrust?city=hangzhou')).toBe(false)
    expect(citySwitchPreservedFilters('/publish', '/publish?city=hangzhou')).toBe(false)
    expect(citySwitchPreservedFilters('/shanghai/listings', '/hangzhou/listings?city=hangzhou')).toBe(false)
    expect(citySwitchPreservedFilters(
      '/shanghai/listings?areaMin=100',
      '/hangzhou/listings?areaMin=200',
    )).toBe(false)
  })
})
