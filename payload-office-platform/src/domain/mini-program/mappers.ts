import { availabilityDay } from '@/domain/public-catalog/building-supply'
import { estimateMonthlyRent } from '@/domain/public-catalog/monthly-estimate'
import type {
  BuildingDetailResult,
  BuildingDetailViewModel,
  BuildingFilteredResult,
  BuildingSummaryViewModel,
  HomepageData,
  ListingCardViewModel,
  ListingDetailViewModel,
  ListingSearchResult,
  MediaViewModel,
  PriceDisplayUnit,
  SearchFacets,
} from '@/domain/public-catalog'
import type {
  MiniBuildingCard,
  MiniBuildingDetailData,
  MiniBuildingsData,
  MiniFactGroup,
  MiniHomeData,
  MiniImage,
  MiniListingCard,
  MiniListingDetailData,
  MiniListingsData,
  MiniPrice,
  MiniQuickFilter,
} from './contracts'

const LISTING_TYPE_LABELS: Readonly<Record<ListingCardViewModel['listingType'], string>> = {
  'traditional-office': '传统办公',
  coworking: '共享办公',
  'full-floor': '整层办公',
  'serviced-office': '独栋办公',
}

const PRICE_UNIT_LABELS: Readonly<Record<PriceDisplayUnit, string>> = {
  'rmb-sqm-day': '元/㎡/天',
  'rmb-sqm-month': '元/㎡/月',
  'rmb-sqm-year': '元/㎡/年',
  'rmb-sqm-total': '元/㎡',
  'rmb-seat-day': '元/工位/天',
  'rmb-seat-month': '元/工位/月',
  'rmb-seat-year': '元/工位/年',
  'rmb-seat-total': '元/工位',
  'rmb-day': '元/天',
  'rmb-month': '元/月',
  'rmb-year': '元/年',
  'rmb-total': '元',
}

export type MiniListingFacetBundle = Readonly<{
  district: SearchFacets
  listingType: SearchFacets
  priceUnit: SearchFacets
}>

function absoluteMiniMediaUrl(src: string, mediaOrigin: string): string {
  return src.startsWith('/') ? new URL(src, mediaOrigin).toString() : src
}

function mapMiniImage(image: MediaViewModel, mediaOrigin: string): MiniImage {
  return {
    src: absoluteMiniMediaUrl(image.src, mediaOrigin),
    width: image.width,
    height: image.height,
    alt: image.alt,
    blurDataURL: image.blurDataURL,
  }
}

function mapMiniPrice(card: ListingCardViewModel): MiniPrice | null {
  if (!card.price) return null
  return {
    amount: card.price.amount,
    currency: card.price.currency,
    businessType: card.price.businessType,
    period: card.price.period,
    basis: card.price.basis,
    displayUnit: card.price.displayUnit,
    text: card.price.text,
    monthlyEstimate: estimateMonthlyRent(card.price, {
      area: card.area,
      seats: card.seats,
    }),
  }
}

export function mapMiniListingCard(
  card: ListingCardViewModel,
  mediaOrigin: string,
): MiniListingCard {
  return {
    id: String(card.id),
    slug: card.slug,
    title: card.title,
    citySlug: card.citySlug,
    cityName: card.cityName,
    price: mapMiniPrice(card),
    area: card.area,
    seats: card.seats,
    listingType: {
      value: String(card.listingType),
      label: LISTING_TYPE_LABELS[card.listingType],
    },
    availableFrom: card.availableFrom === null ? null : availabilityDay(card.availableFrom),
    building: card.building
      ? {
          slug: card.building.slug,
          name: card.building.name,
          address: card.building.address,
          district: card.building.district?.name ?? null,
        }
      : null,
    coverImage: card.coverImage ? mapMiniImage(card.coverImage, mediaOrigin) : null,
    highlights: card.highlights,
  }
}

function isPriceDisplayUnit(value: string): value is PriceDisplayUnit {
  return Object.prototype.hasOwnProperty.call(PRICE_UNIT_LABELS, value)
}

function labelForPriceUnit(value: string): string {
  return isPriceDisplayUnit(value) ? PRICE_UNIT_LABELS[value] : value
}

function filtersFromFacetParts(
  districts: SearchFacets['districts'],
  listingTypes: SearchFacets['listingTypes'],
  rentUnits: SearchFacets['rentUnits'],
): readonly MiniQuickFilter[] {
  return [
    {
      id: 'district',
      label: '区域',
      options: districts.map((item) => ({
        value: item.slug,
        label: item.name,
        count: item.count,
      })),
    },
    {
      id: 'listingType',
      label: '类型',
      options: listingTypes.map((item) => ({
        value: item.value,
        label:
          LISTING_TYPE_LABELS[item.value as ListingCardViewModel['listingType']] ?? item.value,
        count: item.count,
      })),
    },
    {
      id: 'priceUnit',
      label: '计价单位',
      options: rentUnits.map((item) => ({
        value: item.value,
        label: labelForPriceUnit(item.value),
        count: item.count,
      })),
    },
  ]
}

export function mapMiniHome(
  home: HomepageData,
  facets: SearchFacets,
  mediaOrigin: string,
): MiniHomeData {
  return {
    featuredListings: home.featuredListings.map((card) => mapMiniListingCard(card, mediaOrigin)),
    quickFilters: filtersFromFacetParts(facets.districts, facets.listingTypes, facets.rentUnits),
    stats: {
      listings: home.stats.listings,
      buildings: home.stats.buildings,
      businessAreas: home.stats.businessAreas,
    },
  }
}

export function mapMiniListings(
  result: ListingSearchResult,
  facets: MiniListingFacetBundle,
  currentPriceUnit: MiniListingsData['currentPriceUnit'],
  mediaOrigin: string,
): MiniListingsData {
  return {
    items: result.docs.map((card) => mapMiniListingCard(card, mediaOrigin)),
    pagination: {
      page: result.pagination.page,
      pageSize: result.pagination.pageSize,
      totalDocs: result.pagination.totalDocs,
      totalPages: result.pagination.totalPages,
      hasNextPage: result.pagination.hasNextPage,
      hasPrevPage: result.pagination.hasPrevPage,
    },
    canonicalQuery: result.canonical,
    currentPriceUnit,
    filters: filtersFromFacetParts(
      facets.district.districts,
      facets.listingType.listingTypes,
      facets.priceUnit.rentUnits,
    ),
  }
}

function publicFacts(detail: ListingDetailViewModel): readonly MiniFactGroup[] {
  return detail.factGroups.map((group) => ({
    id: group.id,
    title: group.title,
    facts: group.facts.map((fact) => ({
      label: fact.label,
      value: fact.value,
      estimated: fact.estimated,
    })),
  }))
}

function factAmount(
  detail: ListingDetailViewModel,
  label: string,
  unit: string,
): number | null {
  const fact = detail.factGroups
    .flatMap((group) => group.facts)
    .find((item) => item.label === label)
  if (fact?.unit !== unit || !fact.magnitude?.trim()) return null
  const value = Number(fact.magnitude.replaceAll(',', ''))
  return Number.isFinite(value) ? value : null
}

function propertyFeeInclusion(
  detail: ListingDetailViewModel,
): MiniListingDetailData['monthlyCost']['propertyFeeInclusion'] {
  const value = detail.factGroups
    .flatMap((group) => group.facts)
    .find((item) => item.label === '物业费')
    ?.value?.trim()
  if (value === '包含') return 'included'
  if (value === '不包含') return 'excluded'
  if (value === '待确认') return 'confirm'
  return null
}

function roundCny(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function mapMiniListingDetail(
  detail: ListingDetailViewModel,
  related: readonly ListingCardViewModel[],
  mediaOrigin: string,
  inquiryPolicyVersion: string,
): MiniListingDetailData {
  const card = mapMiniListingCard(detail, mediaOrigin)
  const rawRent = card.price?.monthlyEstimate ?? null
  const rent = rawRent == null ? null : roundCny(rawRent)
  const feePerSqmMonth = factAmount(detail, '物业费金额', '元/㎡/月')
  const propertyFee = feePerSqmMonth != null
      && detail.area != null
      && Number.isFinite(detail.area)
      && detail.area >= 0
    ? roundCny(feePerSqmMonth * detail.area)
    : null
  const inclusion = propertyFeeInclusion(detail)
  const total = inclusion === 'included'
    ? rent
    : inclusion === 'excluded' && rent != null && propertyFee != null
      ? roundCny(rent + propertyFee)
      : null
  const assumptions = [
    ...(detail.price?.businessType === 'lease' && detail.price.period === 'day'
      ? ['日租按 30 天折算月租']
      : []),
    inclusion === 'included'
      ? '物业费已包含在租金中，不重复加总'
      : inclusion === 'excluded'
        ? '物业费不包含：仅在租金、物业费金额与面积齐全时计算合计'
        : inclusion === 'confirm'
          ? '物业费包含情况待确认，暂不计算合计'
          : '物业费包含情况缺失，暂不计算合计',
  ]

  return {
    listing: {
      id: card.id,
      slug: card.slug,
      title: card.title,
      citySlug: card.citySlug,
      cityName: card.cityName,
      price: card.price
        ? {
            amount: card.price.amount,
            currency: card.price.currency,
            businessType: card.price.businessType,
            period: card.price.period,
            basis: card.price.basis,
            displayUnit: card.price.displayUnit,
            text: card.price.text,
            monthlyEstimate: card.price.monthlyEstimate,
          }
        : null,
      area: card.area,
      seats: card.seats,
      listingType: {
        value: card.listingType.value,
        label: card.listingType.label,
      },
      availableFrom: card.availableFrom === null ? null : availabilityDay(card.availableFrom),
      building: card.building
        ? {
            slug: card.building.slug,
            name: card.building.name,
            address: card.building.address,
            district: card.building.district,
          }
        : null,
      coverImage: card.coverImage,
      highlights: card.highlights.map((highlight) => highlight),
      gallery: detail.gallery.map((image) => mapMiniImage(image, mediaOrigin)),
      factGroups: publicFacts(detail),
      verification: {
        verifiedAt: detail.verification.verifiedAt,
        priceVerifiedAt: detail.verification.priceVerifiedAt,
      },
    },
    monthlyCost: {
      currency: 'CNY',
      period: 'month',
      propertyFeeInclusion: inclusion,
      rent,
      propertyFee,
      total,
      assumptions,
    },
    inquiryPolicy: { version: inquiryPolicyVersion },
    relatedListings: related.map((item) => mapMiniListingCard(item, mediaOrigin)),
    buildingInfo: detail.building ? mapMiniBuildingCard(detail.building, mediaOrigin) : null,
  }
}

export function mapMiniBuildingCard(
  building: BuildingSummaryViewModel,
  mediaOrigin: string,
): MiniBuildingCard {
  return {
    id: String(building.id),
    slug: building.slug,
    name: building.name,
    district: building.district?.name ?? null,
    address: building.address,
    grade: (building.grade as 'A' | 'B' | 'C') ?? null,
    completedYear: building.completionDate
      ? Number.parseInt(building.completionDate.slice(0, 4), 10) || null
      : null,
    totalFloors: null,
    occupancyRate: null,
    activeListingCount: building.listingCount ?? 0,
    priceRange: null,
    coverImage: building.coverImage ? mapMiniImage(building.coverImage, mediaOrigin) : null,
    nearestMetro: building.nearestMetro
      ? {
          line: building.nearestMetro.name,
          station: building.nearestMetro.name,
          distanceMeters: 0,
        }
      : null,
  }
}

export function mapMiniBuildings(
  result: BuildingFilteredResult,
  mediaOrigin: string,
): MiniBuildingsData {
  const activeItems = (result.groups?.withStock ?? result.docs?.filter(d => (d.listingCount ?? 0) > 0) ?? []).map((doc) =>
    mapMiniBuildingCard(doc, mediaOrigin),
  )
  const inactiveItems = (result.groups?.withoutStock ?? result.docs?.filter(d => (d.listingCount ?? 0) === 0) ?? []).map((doc) =>
    mapMiniBuildingCard(doc, mediaOrigin),
  )

  const page = result.page ?? 1
  const totalPages = result.totalPages ?? 1
  const totalDocs = result.totalDocs ?? (activeItems.length + inactiveItems.length)

  return {
    items: activeItems,
    inactiveItems,
    pagination: {
      page,
      pageSize: 20,
      totalDocs,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
    totalActiveCount: result.withStockTotal ?? activeItems.length,
    totalInactiveCount: result.withoutStockTotal ?? inactiveItems.length,
  }
}

export function mapMiniBuildingDetail(
  detail: BuildingDetailViewModel,
  supply: BuildingDetailResult['supply'],
  comparable: readonly BuildingSummaryViewModel[],
  mediaOrigin: string,
): MiniBuildingDetailData {
  const allListings = supply.groups.flatMap((g) => g.listings)
  const activeCards = allListings.map((l) => mapMiniListingCard(l, mediaOrigin))

  const over1000 = activeCards.filter((l) => (l.area ?? 0) >= 1000)
  const from300to1000 = activeCards.filter((l) => (l.area ?? 0) >= 300 && (l.area ?? 0) < 1000)
  const under300 = activeCards.filter((l) => (l.area ?? 0) < 300)

  const groupedListings = [
    { areaRange: '1,000 ㎡ 以上', count: over1000.length, items: over1000 },
    { areaRange: '300–1,000 ㎡', count: from300to1000.length, items: from300to1000 },
    { areaRange: '300 ㎡ 以下', count: under300.length, items: under300 },
  ].filter((g) => g.count > 0)

  return {
    id: String(detail.id),
    slug: detail.slug,
    name: detail.name,
    address: detail.address,
    district: detail.district?.name ?? null,
    grade: (detail.grade as 'A' | 'B' | 'C') ?? null,
    completedYear: null,
    totalFloors: null,
    standardFloorArea: null,
    elevators: null,
    parkingSpaces: null,
    propertyManagementCompany: null,
    propertyFee: null,
    gallery: detail.gallery.map((img) => mapMiniImage(img, mediaOrigin)),
    activeListingCount: activeCards.length,
    groupedListings,
    nearestMetro: detail.nearestMetro
      ? {
          line: detail.nearestMetro.name,
          station: detail.nearestMetro.name,
          distanceMeters: 0,
        }
      : null,
    comparableBuildings: comparable.map((b) => mapMiniBuildingCard(b, mediaOrigin)),
  }
}

