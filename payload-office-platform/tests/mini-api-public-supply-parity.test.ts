import { describe, expect, it } from 'vitest'
import { mapMiniListings } from '@/domain/mini-program/mappers'
import {
  createSearchContext,
  getSearchFacetsIgnoring,
  parseSearchInput,
  searchListings,
  type ListingSearchInput,
  type SearchContext,
  type SupplyAdapter,
} from '@/domain/public-catalog'
import {
  getEffectiveSupplyWhere,
  isListingEffectivelySupplied,
  isListingPaused,
} from '@/domain/review/effective-supply'
import { buildEffectiveSnapshot } from '@/domain/review/effective-supply-snapshot'
import type { Building, Listing, Location } from '@/payload-types'
import {
  BUILDING_JINGAN_CENTER,
  CITY_SHANGHAI,
  DISTRICT_JINGAN,
  LISTING_DAILY_PER_SQM,
  MEDIA_COVER_A,
} from '@/test/frontend/payload-documents'
import { matchesPriceInput } from './helpers/fake-price-match'

type SupplyState =
  | 'effective-current'
  | 'effective-old-updated-at'
  | 'draft'
  | 'unreviewed'
  | 'frozen'
  | 'reported'
  | 'disabled-city'
  | 'expired-merchant'
  | 'leased'
  | 'deleted'

type SupplyCase = Readonly<{
  state: SupplyState
  listing: Listing
  reportPaused?: boolean
}>

const ACTIVE_MERCHANT = {
  id: 7301,
  name: '公开供给测试商户',
  type: 'OWNER' as const,
  status: 'active' as const,
  qualificationStatus: 'valid' as const,
  qualificationExpiresAt: '2027-12-31T00:00:00.000Z',
  serviceCities: [CITY_SHANGHAI],
  updatedAt: '2026-07-01T00:00:00.000Z',
  createdAt: '2026-07-01T00:00:00.000Z',
}

const ACTIVE_BUILDING: Building = {
  ...BUILDING_JINGAN_CENTER,
  city: CITY_SHANGHAI,
  district: DISTRICT_JINGAN,
}

function listing(
  id: number,
  state: SupplyState,
  overrides: Partial<Listing> = {},
): Listing {
  return {
    ...LISTING_DAILY_PER_SQM,
    id,
    slug: `mini-parity-${state}`,
    title: `Mini parity ${state}`,
    building: ACTIVE_BUILDING,
    businessType: 'lease',
    publicationStatus: 'published',
    reviewStatus: 'approved',
    supplyVisibilityHold: 'normal',
    merchant: ACTIVE_MERCHANT as unknown as Listing['merchant'],
    ...overrides,
  }
}

const DISABLED_CITY: Location = {
  ...CITY_SHANGHAI,
  id: 1301,
  status: 'disabled',
}

const DISABLED_CITY_BUILDING: Building = {
  ...ACTIVE_BUILDING,
  id: 2301,
  city: DISABLED_CITY,
}

const fixture: readonly SupplyCase[] = [
  {
    state: 'effective-current',
    listing: listing(3200, 'effective-current'),
  },
  {
    // 仓库现行有效供给规则没有 updatedAt 陈旧排除：超过 60 天仍须可见。
    state: 'effective-old-updated-at',
    listing: listing(3201, 'effective-old-updated-at', {
      listingType: 'full-floor',
      coverImage: MEDIA_COVER_A,
      updatedAt: '2025-01-01T00:00:00.000Z',
    }),
  },
  {
    state: 'draft',
    listing: listing(3202, 'draft', { publicationStatus: 'draft' }),
  },
  {
    state: 'unreviewed',
    listing: listing(3203, 'unreviewed', { reviewStatus: 'pending' }),
  },
  {
    state: 'frozen',
    listing: listing(3204, 'frozen', {
      supplyVisibilityHold: 'pending_recheck',
    }),
  },
  {
    state: 'reported',
    listing: listing(3205, 'reported'),
    reportPaused: true,
  },
  {
    state: 'disabled-city',
    listing: listing(3206, 'disabled-city', {
      building: DISABLED_CITY_BUILDING,
    }),
  },
  {
    state: 'expired-merchant',
    listing: listing(3207, 'expired-merchant', {
      merchant: {
        ...ACTIVE_MERCHANT,
        qualificationExpiresAt: '2025-01-01T00:00:00.000Z',
      } as unknown as Listing['merchant'],
    }),
  },
  {
    state: 'leased',
    listing: listing(3208, 'leased', { publicationStatus: 'leased' }),
  },
  {
    state: 'deleted',
    listing: listing(3209, 'deleted', {
      deletedAt: '2026-08-20T00:00:00.000Z',
    }),
  },
]

const EFFECTIVE_IDS = ['3200', '3201'] as const
const INVALID_IDS = ['3202', '3203', '3204', '3205', '3206', '3207', '3208', '3209'] as const

function readPath(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => {
    if (typeof value !== 'object' || value === null) return undefined
    return (value as Readonly<Record<string, unknown>>)[key]
  }, source)
}

function matchesAuthoritativeWhere(
  candidate: Listing,
  context: SearchContext,
): boolean {
  const where = getEffectiveSupplyWhere(new Date(context.asOf), {
    businessType: context.businessType,
  })

  return Object.entries(where).every(([path, predicate]) => {
    const value = readPath(candidate, path)
    if ('equals' in predicate) return value === predicate.equals
    return predicate.exists === false ? value == null : false
  })
}

function matchesAuthoritativeSupply(
  candidate: Listing,
  input: ListingSearchInput,
  context: SearchContext,
  pausedIds: readonly (string | number)[],
): boolean {
  if (!matchesAuthoritativeWhere(candidate, context)) return false
  if (isListingPaused(pausedIds, candidate.id)) return false
  if (!matchesPriceInput(candidate, input)) return false
  return isListingEffectivelySupplied(
    buildEffectiveSnapshot(candidate as unknown as Record<string, unknown>),
    new Date(context.asOf),
  ).eligible
}

function createFixtureAdapter(cases: readonly SupplyCase[]): SupplyAdapter {
  const notUsed = async (): Promise<never> => {
    throw new Error('mini_api_parity_adapter_method_not_used')
  }
  const pausedIds = cases
    .filter((item) => item.reportPaused)
    .map((item) => item.listing.id)

  return {
    async findEffectiveListings(input, context) {
      return cases
        .map((item) => item.listing)
        .filter((candidate) =>
          matchesAuthoritativeSupply(candidate, input, context, pausedIds),
        )
    },
    findEffectiveListingsSitemapPage: notUsed,
    findEffectiveListingBySlug: notUsed,
    findListingRouteIdentity: notUsed,
    findEffectiveBuildingBySlug: notUsed,
    findBuildingRouteIdentity: notUsed,
    findEffectiveListingsByBuilding: notUsed,
    aggregateEffectiveSupplyByBuildings: notUsed,
    findEffectiveBuildingsNear: notUsed,
    findEffectiveBuildings: notUsed,
    findEffectiveBuildingsPage: notUsed,
    findFeaturedListings: notUsed,
    findEffectiveDistricts: notUsed,
    findEffectiveBusinessAreas: notUsed,
    assertEffectiveListingBySlug: notUsed,
    findPublishedPageBySlug: notUsed,
    findPublishedPages: notUsed,
    findFeaturedBuildings: notUsed,
    findLatestArticles: notUsed,
    findPublishedArticles: notUsed,
    findPublishedArticleBySlug: notUsed,
  }
}

describe('Mini API and Public Catalog supply parity', () => {
  it('maps exactly the authoritative effective Shanghai Listing ID set', async () => {
    const input = parseSearchInput(
      new URLSearchParams('priceUnit=rmb-sqm-day&page=1'),
    )
    const context = createSearchContext(
      'shanghai',
      new Date('2026-08-26T00:00:00.000Z'),
      'lease',
    )
    const adapter = createFixtureAdapter(fixture)

    const web = await searchListings(input, context, adapter)
    const [district, listingType, priceUnit] = await Promise.all([
      getSearchFacetsIgnoring(input, context, ['district'], adapter),
      getSearchFacetsIgnoring(input, context, ['listingType'], adapter),
      getSearchFacetsIgnoring(input, context, ['priceUnit'], adapter),
    ])
    const mini = mapMiniListings(
      web,
      { district, listingType, priceUnit },
      input.priceUnit ?? null,
      'https://sbh.example',
    )
    const webIds = web.docs.map((item) => String(item.id)).sort()
    const miniIds = mini.items.map((item) => item.id).sort()

    expect(webIds).toEqual([...EFFECTIVE_IDS])
    expect(miniIds).toEqual(webIds)
    for (const invalidId of INVALID_IDS) {
      expect(webIds, `Public Catalog must exclude ${invalidId}`).not.toContain(invalidId)
      expect(miniIds, `Mini mapper must exclude ${invalidId}`).not.toContain(invalidId)
    }
    expect(webIds).toContain('3201')
    expect(JSON.stringify(mini)).not.toMatch(
      /merchant|reviewStatus|report|internalPhone|audit/i,
    )
  })
})
