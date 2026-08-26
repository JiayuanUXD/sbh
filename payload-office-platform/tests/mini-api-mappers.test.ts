import { describe, expect, it } from 'vitest'
import {
  mapMiniHome,
  mapMiniListingCard,
  mapMiniListingDetail,
  mapMiniListings,
} from '@/domain/mini-program/mappers'
import type {
  HomepageData,
  ListingCardViewModel,
  ListingDetailViewModel,
  ListingSearchResult,
  SearchFacets,
} from '@/domain/public-catalog'

const card = {
  id: 42,
  slug: 'jing-an-100',
  title: '静安中心 100㎡',
  citySlug: 'shanghai',
  cityName: '上海',
  price: {
    amount: 8.5,
    currency: 'CNY',
    businessType: 'lease',
    period: 'day',
    basis: 'sqm',
    displayUnit: 'rmb-sqm-day',
    text: '8.5 元/㎡/天',
  },
  area: 100,
  floor: '9',
  seats: null,
  businessType: 'lease',
  decorationStatus: 'fully_fitted',
  listingType: 'traditional-office',
  availableFrom: '2026-09-01',
  isFeatured: true,
  building: {
    id: 7,
    slug: 'jing-an-center',
    name: '静安中心',
    address: '南京西路',
    citySlug: 'shanghai',
    cityName: '上海',
    district: { id: 8, slug: 'jing-an', name: '静安区' },
  },
  coverImage: null,
  highlights: ['近地铁'],
  stableSortKey: '42',
} satisfies ListingCardViewModel

const facets = {
  districts: [{ id: 8, slug: 'jing-an', name: '静安区', count: 6 }],
  listingTypes: [
    { value: 'traditional-office', count: 1 },
    { value: 'coworking', count: 2 },
    { value: 'full-floor', count: 3 },
    { value: 'serviced-office', count: 4 },
  ],
  rentUnits: [
    { value: 'rmb-sqm-day', count: 1 },
    { value: 'rmb-sqm-month', count: 2 },
    { value: 'rmb-sqm-year', count: 3 },
    { value: 'rmb-sqm-total', count: 4 },
    { value: 'rmb-seat-day', count: 5 },
    { value: 'rmb-seat-month', count: 6 },
    { value: 'rmb-seat-year', count: 7 },
    { value: 'rmb-seat-total', count: 8 },
    { value: 'rmb-day', count: 9 },
    { value: 'rmb-month', count: 10 },
    { value: 'rmb-year', count: 11 },
    { value: 'rmb-total', count: 12 },
  ],
  totalDocs: 10,
} satisfies SearchFacets

const MEDIA_ORIGIN = 'https://sbh.example'
const listingFacetBundle = {
  district: facets,
  listingType: facets,
  priceUnit: facets,
}

function detailWithPropertyFee(
  overrides: Partial<ListingDetailViewModel> = {},
): ListingDetailViewModel {
  return {
    ...card,
    gallery: [{ src: '/gallery.jpg', alt: '办公区' }],
    mediaItems: [],
    factGroups: [{
      id: 'cost',
      title: '费用条款',
      facts: [
        {
          label: '物业费',
          value: '不包含',
          magnitude: null,
          unit: null,
          estimated: false,
          critical: false,
        },
        {
          label: '物业费金额',
          value: '28 元/㎡/月',
          magnitude: '28',
          unit: '元/㎡/月',
          estimated: false,
          critical: false,
        },
      ],
    }],
    amenityGroups: [],
    verification: {
      verifiedAt: '2026-08-20T00:00:00.000Z',
      priceVerifiedAt: '2026-08-21T00:00:00.000Z',
    },
    description: {
      root: {
        type: 'root',
        children: [],
        direction: null,
        format: '',
        indent: 0,
        version: 1,
      },
    },
    ...overrides,
  }
}

describe('Mini API mappers', () => {
  it('keeps structural price fields and adds the shared monthly estimate', () => {
    expect(mapMiniListingCard(card, MEDIA_ORIGIN).price).toEqual({
      ...card.price,
      monthlyEstimate: 25_500,
    })
  })

  it('only exposes the explicit mini card whitelist', () => {
    expect(Object.keys(mapMiniListingCard(card, MEDIA_ORIGIN)).sort()).toEqual([
      'area', 'availableFrom', 'building', 'cityName', 'citySlug', 'coverImage', 'highlights',
      'id', 'listingType', 'price', 'seats', 'slug', 'title',
    ])
    expect(mapMiniListingCard(card, MEDIA_ORIGIN)).toMatchObject({
      id: '42',
      listingType: { value: 'traditional-office', label: '传统办公' },
      building: {
        slug: 'jing-an-center',
        name: '静安中心',
        address: '南京西路',
        district: '静安区',
      },
    })
  })

  const unsafeCard = {
    ...card,
    price: { ...card.price, internalRateCode: 'price-secret' },
    coverImage: {
      src: '/cover.jpg',
      alt: '封面',
      storageAudit: 'cover-secret',
    },
  }
  const unsafeStats = {
    listings: 10,
    buildings: 3,
    businessAreas: 2,
    auditTotal: 'stats-secret',
  }
  const unsafePagination = {
    page: 1,
    pageSize: 24 as const,
    totalDocs: 1,
    totalPages: 1,
    hasNextPage: false,
    hasPrevPage: false,
    internalCursor: 'pagination-secret',
  }
  const unsafeGalleryImage = {
    src: '/gallery.jpg',
    alt: '办公区',
    merchantAssetId: 'gallery-secret',
  }
  const unsafeHome = {
    featuredListings: [unsafeCard],
    districts: [],
    featuredBuildings: [],
    districtCards: [],
    latestArticles: [],
    stats: unsafeStats,
    typeSummaries: {},
    nearbyListings: [],
  }
  const unsafeResult = {
    docs: [unsafeCard],
    pagination: unsafePagination,
    canonical: '',
    filteredByRentUnit: false,
  }

  it.each([
    {
      path: 'price',
      secret: 'price-secret',
      output: () => mapMiniListingCard(unsafeCard, MEDIA_ORIGIN),
    },
    {
      path: 'coverImage',
      secret: 'cover-secret',
      output: () => mapMiniListingCard(unsafeCard, MEDIA_ORIGIN),
    },
    {
      path: 'home.stats',
      secret: 'stats-secret',
      output: () => mapMiniHome(unsafeHome, facets, MEDIA_ORIGIN),
    },
    {
      path: 'listings.pagination',
      secret: 'pagination-secret',
      output: () => mapMiniListings(unsafeResult, listingFacetBundle, null, MEDIA_ORIGIN),
    },
    {
      path: 'detail.gallery',
      secret: 'gallery-secret',
      output: () => mapMiniListingDetail(detailWithPropertyFee({
        gallery: [unsafeGalleryImage],
      }), [], MEDIA_ORIGIN),
    },
  ])('recursively whitelists nested $path fields', ({ output, secret }) => {
    expect(JSON.stringify(output())).not.toContain(secret)
  })

  it.each([
    { price: null, area: 100, expected: null },
    { price: card.price, area: null, expected: null },
  ])('does not fabricate monthly estimate: $expected', ({ price, area, expected }) => {
    expect(mapMiniListingCard({ ...card, price, area }, MEDIA_ORIGIN).price?.monthlyEstimate ?? null).toBe(expected)
  })

  it('maps home and listings through explicit transport fields', () => {
    const home = {
      featuredListings: [card],
      districts: [],
      featuredBuildings: [],
      districtCards: [],
      latestArticles: [],
      stats: { listings: 10, buildings: 3, businessAreas: 2 },
      typeSummaries: {},
      nearbyListings: [],
    } satisfies HomepageData
    const result = {
      docs: [card],
      pagination: {
        page: 1,
        pageSize: 24,
        totalDocs: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPrevPage: false,
      },
      canonical: 'district=jing-an',
      filteredByRentUnit: true,
    } satisfies ListingSearchResult

    expect(mapMiniHome(home, facets, MEDIA_ORIGIN)).toEqual({
      featuredListings: [mapMiniListingCard(card, MEDIA_ORIGIN)],
      quickFilters: expect.any(Array),
      stats: home.stats,
    })
    expect(mapMiniListings(result, listingFacetBundle, 'rmb-sqm-day', MEDIA_ORIGIN)).toEqual({
      items: [mapMiniListingCard(card, MEDIA_ORIGIN)],
      pagination: result.pagination,
      canonicalQuery: 'district=jing-an',
      currentPriceUnit: 'rmb-sqm-day',
      filters: expect.any(Array),
    })
  })

  it('builds each list filter from the facet snapshot that ignored that same dimension', () => {
    const bundle = {
      district: {
        ...facets,
        districts: [{ id: 18, slug: 'huang-pu', name: '黄浦区', count: 8 }],
      },
      listingType: {
        ...facets,
        listingTypes: [{ value: 'coworking', count: 7 }],
      },
      priceUnit: {
        ...facets,
        rentUnits: [{ value: 'rmb-month', count: 6 }],
      },
    }
    const mapped = mapMiniListings({
      docs: [],
      pagination: {
        page: 1,
        pageSize: 24,
        totalDocs: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPrevPage: false,
      },
      canonical: 'district=jing-an&listingType=traditional-office&priceUnit=rmb-sqm-day',
      filteredByRentUnit: true,
    }, bundle, 'rmb-sqm-day', MEDIA_ORIGIN)

    expect(mapped.filters).toEqual([
      {
        id: 'district',
        label: '区域',
        options: [{ value: 'huang-pu', label: '黄浦区', count: 8 }],
      },
      {
        id: 'listingType',
        label: '类型',
        options: [{ value: 'coworking', label: '共享办公', count: 7 }],
      },
      {
        id: 'priceUnit',
        label: '计价单位',
        options: [{ value: 'rmb-month', label: '元/月', count: 6 }],
      },
    ])
  })

  it('turns root-relative media into absolute URLs and preserves absolute CDN URLs', () => {
    const rootRelative = mapMiniListingCard({
      ...card,
      coverImage: { src: '/media/cover.jpg', alt: '封面' },
    }, MEDIA_ORIGIN)
    const absolute = mapMiniListingCard({
      ...card,
      coverImage: { src: 'https://cdn.example.com/cover.jpg', alt: '封面' },
    }, MEDIA_ORIGIN)
    const detail = mapMiniListingDetail(detailWithPropertyFee({
      gallery: [{ src: '/media/gallery.jpg', alt: '办公区' }],
    }), [], MEDIA_ORIGIN)

    expect(rootRelative.coverImage?.src).toBe('https://sbh.example/media/cover.jpg')
    expect(absolute.coverImage?.src).toBe('https://cdn.example.com/cover.jpg')
    expect(detail.listing.gallery[0]?.src).toBe('https://sbh.example/media/gallery.jpg')
  })

  it('covers every Chinese listing type and price unit label', () => {
    const filters = mapMiniHome({
      featuredListings: [],
      districts: [],
      featuredBuildings: [],
      districtCards: [],
      latestArticles: [],
      stats: { listings: 0, buildings: 0, businessAreas: 0 },
      typeSummaries: {},
      nearbyListings: [],
    }, facets, MEDIA_ORIGIN).quickFilters

    expect(filters.find((filter) => filter.id === 'listingType')?.options).toEqual([
      { value: 'traditional-office', label: '传统办公', count: 1 },
      { value: 'coworking', label: '共享办公', count: 2 },
      { value: 'full-floor', label: '整层办公', count: 3 },
      { value: 'serviced-office', label: '独栋办公', count: 4 },
    ])
    expect(filters.find((filter) => filter.id === 'priceUnit')?.options).toEqual([
      { value: 'rmb-sqm-day', label: '元/㎡/天', count: 1 },
      { value: 'rmb-sqm-month', label: '元/㎡/月', count: 2 },
      { value: 'rmb-sqm-year', label: '元/㎡/年', count: 3 },
      { value: 'rmb-sqm-total', label: '元/㎡', count: 4 },
      { value: 'rmb-seat-day', label: '元/工位/天', count: 5 },
      { value: 'rmb-seat-month', label: '元/工位/月', count: 6 },
      { value: 'rmb-seat-year', label: '元/工位/年', count: 7 },
      { value: 'rmb-seat-total', label: '元/工位', count: 8 },
      { value: 'rmb-day', label: '元/天', count: 9 },
      { value: 'rmb-month', label: '元/月', count: 10 },
      { value: 'rmb-year', label: '元/年', count: 11 },
      { value: 'rmb-total', label: '元', count: 12 },
    ])
  })

  it('calculates property fee only from a monthly per-sqm amount and complete area', () => {
    expect(mapMiniListingDetail(detailWithPropertyFee(), [], MEDIA_ORIGIN).monthlyCost).toEqual({
      currency: 'CNY',
      period: 'month',
      propertyFeeInclusion: 'excluded',
      rent: 25_500,
      propertyFee: 2_800,
      total: 28_300,
      assumptions: ['日租按 30 天折算月租', '物业费不包含：仅在租金、物业费金额与面积齐全时计算合计'],
    })

    const wrongUnit = detailWithPropertyFee({
      factGroups: [{
        id: 'cost',
        title: '费用条款',
        facts: [{
          label: '物业费金额',
          value: '28 元/天',
          magnitude: '28',
          unit: '元/天',
          estimated: false,
          critical: false,
        }],
      }],
    })
    expect(mapMiniListingDetail(wrongUnit, [], MEDIA_ORIGIN).monthlyCost.propertyFee).toBeNull()
  })

  it.each([
    { name: 'rent', detail: detailWithPropertyFee({ price: null }) },
    { name: 'property fee', detail: detailWithPropertyFee({ factGroups: [] }) },
    { name: 'area', detail: detailWithPropertyFee({ area: null }) },
  ])('keeps total null when $name is missing', ({ detail }) => {
    expect(mapMiniListingDetail(detail, [], MEDIA_ORIGIN).monthlyCost.total).toBeNull()
  })

  it.each([
    {
      name: 'included with a displayable amount',
      inclusion: '包含',
      amount: '28',
      expected: {
        propertyFeeInclusion: 'included',
        propertyFee: 2_800,
        total: 25_500,
        assumption: '物业费已包含在租金中，不重复加总',
      },
    },
    {
      name: 'included without an amount',
      inclusion: '包含',
      amount: null,
      expected: {
        propertyFeeInclusion: 'included',
        propertyFee: null,
        total: 25_500,
        assumption: '物业费已包含在租金中，不重复加总',
      },
    },
    {
      name: 'excluded',
      inclusion: '不包含',
      amount: '28',
      expected: {
        propertyFeeInclusion: 'excluded',
        propertyFee: 2_800,
        total: 28_300,
        assumption: '物业费不包含：仅在租金、物业费金额与面积齐全时计算合计',
      },
    },
    {
      name: 'confirm',
      inclusion: '待确认',
      amount: '28',
      expected: {
        propertyFeeInclusion: 'confirm',
        propertyFee: 2_800,
        total: null,
        assumption: '物业费包含情况待确认，暂不计算合计',
      },
    },
    {
      name: 'missing inclusion',
      inclusion: null,
      amount: '28',
      expected: {
        propertyFeeInclusion: null,
        propertyFee: 2_800,
        total: null,
        assumption: '物业费包含情况缺失，暂不计算合计',
      },
    },
  ])('models property fee state: $name', ({ inclusion, amount, expected }) => {
    const facts = [
      ...(inclusion == null ? [] : [{
        label: '物业费', value: inclusion, magnitude: null, unit: null,
        estimated: false, critical: false,
      }]),
      ...(amount == null ? [] : [{
        label: '物业费金额', value: `${amount} 元/㎡/月`, magnitude: amount,
        unit: '元/㎡/月', estimated: false, critical: false,
      }]),
    ]
    const monthlyCost = mapMiniListingDetail(detailWithPropertyFee({
      factGroups: [{ id: 'cost', title: '费用条款', facts }],
    }), [], MEDIA_ORIGIN).monthlyCost

    expect(monthlyCost).toMatchObject({
      currency: 'CNY',
      period: 'month',
      propertyFeeInclusion: expected.propertyFeeInclusion,
      rent: 25_500,
      propertyFee: expected.propertyFee,
      total: expected.total,
    })
    expect(monthlyCost.assumptions).toContain(expected.assumption)
  })

  it('rounds rent, property fee and total to CNY cents', () => {
    const mapped = mapMiniListingDetail(detailWithPropertyFee({
      area: 3,
      price: { ...card.price, amount: 0.1 },
      factGroups: [{
        id: 'cost',
        title: '费用条款',
        facts: [
          { label: '物业费', value: '不包含', magnitude: null, unit: null, estimated: false, critical: false },
          { label: '物业费金额', value: '0.2 元/㎡/月', magnitude: '0.2', unit: '元/㎡/月', estimated: false, critical: false },
        ],
      }],
    }), [], MEDIA_ORIGIN)

    expect(mapped.listing.price?.monthlyEstimate).toBe(9)
    expect(mapped.monthlyCost).toMatchObject({ rent: 9, propertyFee: 0.6, total: 9.6 })
    expect(mapped.listing.price?.monthlyEstimate).toBe(mapped.monthlyCost.rent)
  })

  it('projects detail facts and excludes rich text and internal-looking fields', () => {
    const unsafeDetail = {
      ...detailWithPropertyFee(),
      merchant: { id: 9, phone: '13800001111' },
      audit: { actor: 'internal-user' },
      reviewStatus: 'approved',
    }
    const mapped = mapMiniListingDetail(unsafeDetail, [card], MEDIA_ORIGIN)
    const serialized = JSON.stringify(mapped)

    expect(mapped.listing.factGroups).toEqual([{
      id: 'cost',
      title: '费用条款',
      facts: [
        { label: '物业费', value: '不包含', estimated: false },
        { label: '物业费金额', value: '28 元/㎡/月', estimated: false },
      ],
    }])
    expect(mapped.relatedListings).toEqual([mapMiniListingCard(card, MEDIA_ORIGIN)])
    expect(serialized).not.toMatch(/"(?:description|merchant|audit|reviewStatus)":/)
    expect(serialized).not.toContain('13800001111')
  })
})
