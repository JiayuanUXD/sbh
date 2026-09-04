import { availabilityDay } from '@/domain/public-catalog/building-supply'
import { estimateMonthlyRent } from '@/domain/public-catalog/monthly-estimate'
import type {
  BuildingDetailResult,
  BuildingDetailViewModel,
  BuildingFilteredResult,
  BuildingSummaryViewModel,
  FactGroupViewModel,
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
  MiniBuildingGrade,
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

function miniBuildingGrade(
  value: BuildingSummaryViewModel['grade'],
): MiniBuildingGrade | null {
  switch (value) {
    case 'grade-a':
    case 'super-grade-a':
    case 'creative-park':
    case 'serviced-office':
      return value
    default:
      return null
  }
}

function normalizedBuildingCount(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null
}

function completedYear(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(normalized)
  if (!match) return null
  const timestamp = Date.parse(normalized)
  if (!Number.isFinite(timestamp)) return null
  const parsed = new Date(timestamp)
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() + 1 !== month
    || parsed.getUTCDate() !== day
  ) {
    return null
  }
  return year
}

function findBuildingFact(
  groups: readonly FactGroupViewModel[],
  label: string,
): FactGroupViewModel['facts'][number] | undefined {
  return groups.flatMap((group) => group.facts).find((fact) => fact.label === label)
}

function buildingFactNumber(
  groups: readonly FactGroupViewModel[],
  label: string,
  unit: string,
  integer = false,
): number | null {
  const fact = findBuildingFact(groups, label)
  if (fact?.unit !== unit || typeof fact.magnitude !== 'string') return null
  const normalized = fact.magnitude.trim().replaceAll(',', '')
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(normalized)) return null
  const value = Number(normalized)
  if (!Number.isFinite(value) || value < 0 || (integer && !Number.isSafeInteger(value))) {
    return null
  }
  return value
}

function buildingFactString(
  groups: readonly FactGroupViewModel[],
  label: string,
): string | null {
  const value = findBuildingFact(groups, label)?.value
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized || null
}

function buildingNearestMetro(
  building: Pick<BuildingSummaryViewModel, 'nearestMetro'>,
): MiniBuildingCard['nearestMetro'] {
  const station = building.nearestMetro?.name.trim()
  return station
    ? { station, line: null, distanceMeters: null }
    : null
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
  inquiryPolicyVersion: string,
): MiniHomeData {
  return {
    featuredListings: home.featuredListings.map((card) => mapMiniListingCard(card, mediaOrigin)),
    featuredBuildings: home.featuredBuildings.map((building) => (
      mapMiniBuildingCard(building, mediaOrigin)
    )),
    quickFilters: filtersFromFacetParts(facets.districts, facets.listingTypes, facets.rentUnits),
    stats: {
      listings: home.stats.listings,
      buildings: home.stats.buildings,
      businessAreas: home.stats.businessAreas,
    },
    inquiryPolicy: { version: inquiryPolicyVersion },
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
    grade: miniBuildingGrade(building.grade),
    completedYear: completedYear(building.completionDate),
    totalFloors: null,
    occupancyRate: null,
    activeListingCount: normalizedBuildingCount(building.listingCount),
    priceRange: null,
    coverImage: building.coverImage ? mapMiniImage(building.coverImage, mediaOrigin) : null,
    nearestMetro: buildingNearestMetro(building),
  }
}

export function mapMiniBuildings(
  result: BuildingFilteredResult,
  pageSize: MiniBuildingsData['pagination']['pageSize'],
  mediaOrigin: string,
  inquiryPolicyVersion: string,
): MiniBuildingsData {
  const activeItems = result.groups.withStock.map((doc) =>
    mapMiniBuildingCard(doc, mediaOrigin),
  )
  const inactiveItems = result.groups.withoutStock.map((doc) => ({
    ...mapMiniBuildingCard(doc, mediaOrigin),
    // 分组来自完整的有效供给快照；即使摘要省略 listingCount，此处的 0 也是已知事实。
    activeListingCount: 0,
  }))

  return {
    items: activeItems,
    inactiveItems,
    pagination: {
      page: result.page,
      pageSize,
      totalDocs: result.totalDocs,
      totalPages: result.totalPages,
      hasNextPage: result.page < result.totalPages,
      hasPrevPage: result.page > 1,
    },
    totalActiveCount: result.withStockTotal,
    totalInactiveCount: result.withoutStockTotal,
    districtOptions: result.facets.districts.map((district) => ({
      value: district.slug,
      label: district.name,
      count: district.count,
    })),
    inquiryPolicy: { version: inquiryPolicyVersion },
  }
}

export function mapMiniBuildingDetail(
  detail: BuildingDetailViewModel,
  supply: BuildingDetailResult['supply'],
  comparable: readonly BuildingSummaryViewModel[],
  mediaOrigin: string,
  inquiryPolicyVersion: string,
): MiniBuildingDetailData {
  const allListings = supply.groups.flatMap((g) => g.listings)
  // 同一房源不应因上游组投影重叠而被计数/展示多次。
  const activeCards = Array.from(new Map(
    allListings
      .map((listing) => mapMiniListingCard(listing, mediaOrigin))
      .map((listing) => [listing.id, listing] as const),
  ).values())

  const over1000 = activeCards.filter((listing) => listing.area !== null && listing.area >= 1000)
  const from300to1000 = activeCards.filter((listing) => (
    listing.area !== null && listing.area >= 300 && listing.area < 1000
  ))
  const under300 = activeCards.filter((listing) => listing.area !== null && listing.area < 300)
  const unknownArea = activeCards.filter((listing) => listing.area === null)

  const passengerElevators = buildingFactNumber(detail.factGroups, '客梯', '部', true)
  const cargoElevators = buildingFactNumber(detail.factGroups, '货梯', '部', true)

  const groupedListings = [
    { areaRange: '1,000 ㎡ 以上', count: over1000.length, items: over1000 },
    { areaRange: '300–1,000 ㎡', count: from300to1000.length, items: from300to1000 },
    { areaRange: '300 ㎡ 以下', count: under300.length, items: under300 },
    { areaRange: '面积待确认', count: unknownArea.length, items: unknownArea },
  ].filter((g) => g.count > 0)

  return {
    id: String(detail.id),
    slug: detail.slug,
    name: detail.name,
    address: detail.address,
    district: detail.district?.name ?? null,
    grade: miniBuildingGrade(detail.grade),
    completedYear: completedYear(buildingFactString(detail.factGroups, '竣工时间')),
    totalFloors: buildingFactNumber(detail.factGroups, '总楼层', '层', true),
    standardFloorArea: buildingFactNumber(detail.factGroups, '标准层面积', '㎡'),
    elevators: passengerElevators === null && cargoElevators === null
      ? null
      : { passenger: passengerElevators, cargo: cargoElevators },
    parkingSpaces: buildingFactNumber(detail.factGroups, '停车位', '个', true),
    propertyManagementCompany: buildingFactString(detail.factGroups, '物业公司'),
    propertyFee: buildingFactNumber(detail.factGroups, '物业费', '元/㎡/月'),
    gallery: detail.gallery.map((img) => mapMiniImage(img, mediaOrigin)),
    activeListingCount: activeCards.length,
    groupedListings,
    nearestMetro: buildingNearestMetro(detail),
    comparableBuildings: comparable.map((b) => mapMiniBuildingCard(b, mediaOrigin)),
    inquiryPolicy: { version: inquiryPolicyVersion },
  }
}
