import { describe, expect, it } from 'vitest'

import {
  buildCityPath,
  cityAwareHref,
  citySwitchPreservedFilters,
  getCityPageType,
  legacyCanonicalPath,
  prefixedCanonicalPath,
  resolveTrustedRouteCity,
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
        '/shanghai/listings?sort=price-desc&district=pudong&q= river &page=3&areaMin=1e2&priceUnit=rmb-sqm-day&type=coworking&extra=drop',
        'hangzhou',
      ),
    ).toBe('/hangzhou/listings?type=coworking&areaMin=100&priceUnit=rmb-sqm-day&q=river&sort=price-desc')
  })

  it('uses the current type query key and retains future structured price keys only when valid', () => {
    expect(
      switchCityUrl(
        '/shanghai/listings?priceBasis=total&availableBefore=2026-12-31&listingType=traditional-office&type=traditional-office&pricePeriod=month&rentUnit=rmb-month&rentMax=999&rentMin=100&areaMax=200&areaMin=10&q=first&district=x&businessArea=y&metro=z&page=0&unknown=keep-no',
        'hangzhou',
      ),
    ).toBe('/hangzhou/listings?type=traditional-office&areaMin=10&areaMax=200&priceMin=100&priceMax=999&priceUnit=rmb-month&pricePeriod=month&priceBasis=total&availableBefore=2026-12-31&q=first')
  })

  it('drops a price range that has no price unit（跨计价单位比价无意义，解析层已丢弃）', () => {
    // 换城市走的是同一个 `parseListingSearchInput`，因此闸门在这条链路上自动生效：
    // 一个缺单位的 `?rentMax=999` 不会换个名字（priceMax）继续跟着用户跨城市。
    expect(
      switchCityUrl('/shanghai/listings?rentMax=999&rentMin=100&areaMin=10', 'hangzhou'),
    ).toBe('/hangzhou/listings?areaMin=10')
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
        `/shanghai/listings?q=%20${'a'.repeat(101)}%20&availableBefore=2026-08-31&priceUnit=rmb-month&sort=price-desc`,
        'hangzhou',
      ),
    ).toBe(`/hangzhou/listings?priceUnit=rmb-month&availableBefore=2026-08-31&q=${'a'.repeat(100)}&sort=price-desc`)
    expect(switchCityUrl('/shanghai/listings?type=coworking&type=full-floor', 'hangzhou')).toBe(
      '/hangzhou/listings',
    )
    expect(switchCityUrl('/shanghai/buildings?grade=grade-a&grade=super-grade-a', 'hangzhou')).toBe(
      '/hangzhou/buildings',
    )
    expect(switchCityUrl('/shanghai/buildings?grade=unknown', 'hangzhou')).toBe('/hangzhou/buildings')
  })

  it('OPT-096：cityAwareHref 给出售频道与楼盘出售口径加城市前缀', () => {
    expect(cityAwareHref('/sale', 'shanghai', true)).toBe('/shanghai/sale')
    expect(cityAwareHref('/buildings?business=sale', 'shanghai', true)).toBe('/shanghai/buildings?business=sale')
    expect(cityAwareHref('/buildings?business=sale', 'shanghai', false)).toBe('/buildings?business=sale')
  })

  it('OPT-103：共享办公频道是城市页，与 listings 同一套查询白名单', () => {
    expect(getCityPageType('/coworking')).toBe('coworking')
    expect(getCityPageType('/shanghai/coworking')).toBe('coworking')
    expect(buildCityPath('shanghai', 'coworking')).toBe('/shanghai/coworking')
    expect(cityAwareHref('/coworking', 'shanghai', true)).toBe('/shanghai/coworking')
    expect(cityAwareHref('/coworking', 'shanghai', false)).toBe('/coworking')
    expect(switchCityUrl('/shanghai/coworking?district=jingan&areaMin=100&extra=drop', 'hangzhou')).toBe('/hangzhou/coworking?areaMin=100')
    expect(prefixedCanonicalPath('/coworking?district=changning&page=2', 'shanghai')).toBe('/shanghai/coworking?district=changning&page=2')
    expect(legacyCanonicalPath('/shanghai/coworking?district=changning')).toBe('/coworking?district=changning')
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

  // ── 加 / 去城市前缀是同城改写，query 必须原样透传 ─────────────────────────
  // 2026-09-16 线上实测：`/listings?district=changning` 307 到 `/shanghai/listings`，
  // district 被静默丢掉、type 却保留。根因是 prefixedCanonicalPath 借用了
  // switchCityUrl 的**跨城**白名单（换城市时区域 / 页码没意义，所以那份白名单刻意
  // 不含它们），而 legacy → 前缀是同一个城市，目标路由认的参数在这里全部合法。
  // 校验只留给目标路由做（它本来就把输入当 unknown 解析 + 按地点表收口区域），
  // 这里不再维护第二份会漂移的键表。
  it('keeps the whole query verbatim when adding a city prefix to a list route（旧式链接带 district 重定向后 district 仍在）', () => {
    expect(prefixedCanonicalPath('/listings?district=changning', 'shanghai')).toBe(
      '/shanghai/listings?district=changning',
    )
    expect(
      prefixedCanonicalPath('/listings?district=changning&type=coworking&page=2&view=list', 'shanghai'),
    ).toBe('/shanghai/listings?district=changning&type=coworking&page=2&view=list')
    expect(prefixedCanonicalPath('/sale?district=changning&areaMin=100', 'shanghai')).toBe(
      '/shanghai/sale?district=changning&areaMin=100',
    )
    // 楼盘页此前只放行 grade / business，区域、关键词、地铁、竣工年份、分页全丢
    expect(
      prefixedCanonicalPath('/buildings?district=changning&metro=line-2&completedAfter=2015&page=2', 'shanghai'),
    ).toBe('/shanghai/buildings?district=changning&metro=line-2&completedAfter=2015&page=2')
    // 多值与重复键也原样保留：解析层自己会去重 / 取首值，这里不替它做决定
    expect(prefixedCanonicalPath('/listings?district=jingan&district=xuhui', 'shanghai')).toBe(
      '/shanghai/listings?district=jingan&district=xuhui',
    )
    // 旧名 rentUnit / rentMax 也不在这里改名：canonical 归并是目标页 <link rel=canonical> 的事
    expect(
      prefixedCanonicalPath('/listings?district=pudong&rentUnit=rmb-sqm-day&rentMax=10', 'shanghai'),
    ).toBe('/shanghai/listings?district=pudong&rentUnit=rmb-sqm-day&rentMax=10')
  })

  it('keeps the whole query verbatim when removing a city prefix from a list route（与加前缀互为逆运算）', () => {
    expect(
      legacyCanonicalPath('/hangzhou/listings?district=pudong&areaMin=100&page=3&unknown=drop'),
    ).toBe('/listings?district=pudong&areaMin=100&page=3&unknown=drop')
    expect(legacyCanonicalPath('/hangzhou/buildings?district=pudong&grade=grade-a&page=2')).toBe(
      '/buildings?district=pudong&grade=grade-a&page=2',
    )
    const source = '/listings?district=changning&type=coworking&page=2'
    expect(legacyCanonicalPath(prefixedCanonicalPath(source, 'shanghai'))).toBe(source)
  })

  it('still whitelists the query on cross-city switches（跨城白名单只归 switchCityUrl）', () => {
    // 同一个输入：加前缀原样保留，换城市按白名单过滤——两者的差别就是本次修复的边界
    const source = '/listings?district=changning&type=coworking&page=2'
    expect(prefixedCanonicalPath(source, 'shanghai')).toBe(`/shanghai${source}`)
    expect(switchCityUrl(`/shanghai${source}`, 'hangzhou')).toBe('/hangzhou/listings?type=coworking')
  })

  it('detail and global routes still drop their query when re-prefixed', () => {
    // 详情页的 query 从来不承载筛选状态，全站路由也不带城市语义，这几类维持原判
    expect(
      legacyCanonicalPath('/hangzhou/buildings/central-tower?grade=A&district=pudong'),
    ).toBe('/buildings/central-tower')
    expect(prefixedCanonicalPath('/listings/central-office?district=pudong', 'hangzhou')).toBe(
      '/hangzhou/listings/central-office',
    )
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

  it('resolves a lead query only from one trusted canonical city and marks hostile fallback unattributable', () => {
    const cities = [
      { slug: 'shanghai', status: 'live' as const },
      { slug: 'hangzhou', status: 'coming-soon' as const },
      { slug: 'news', status: 'live' as const },
    ]
    expect(resolveTrustedRouteCity('/entrust', new URLSearchParams('city=hangzhou'), cities, 'shanghai')).toEqual({
      city: cities[1], source: 'query', attributable: true,
    })
    expect(resolveTrustedRouteCity('/publish', new URLSearchParams(), cities, 'shanghai')).toEqual({
      city: cities[0], source: 'default', attributable: true,
    })
    for (const query of ['city=', 'city=HangZhou', 'city=news', 'city=unknown', 'city=hangzhou&city=shanghai']) {
      expect(resolveTrustedRouteCity('/city-partner', new URLSearchParams(query), cities, 'shanghai')).toEqual({
        city: cities[0], source: 'default', attributable: false,
      })
    }
    expect(resolveTrustedRouteCity('/hangzhou/listings', new URLSearchParams('city=shanghai'), cities, 'shanghai')).toEqual({
      city: cities[1], source: 'pathname', attributable: true,
    })
  })
})
