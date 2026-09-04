import type {
  MiniFactGroup,
  MiniListingDetailData,
} from '../services/catalog-contracts.js'

export type DetailFactPresentation = Readonly<{
  label: string
  value: string
  estimated: boolean
}>

export type DetailFactGroupPresentation = Readonly<{
  id: string
  title: string
  facts: readonly DetailFactPresentation[]
}>

export type DetailSpecificationPresentation = Readonly<{
  id: 'area' | 'seats' | 'listing-type' | 'available-from'
  label: string
  value: string
  estimated: false
}>

export type MonthlyCostPresentation = Readonly<{
  rent: string
  propertyFee: string
  total: string
  inclusionLabel: string
  assumptions: readonly string[]
}>

export type ListingDetailPresentation = Readonly<{
  title: string
  location: string
  primaryPrice: string
  secondaryPrice: string
  gallery: MiniListingDetailData['listing']['gallery']
  highlights: MiniListingDetailData['listing']['highlights']
  monthlyCost: MonthlyCostPresentation
  specifications: readonly DetailSpecificationPresentation[]
  factGroups: readonly DetailFactGroupPresentation[]
  verification: Readonly<{
    verifiedAt: string
    priceVerifiedAt: string
  }>
  building: MiniListingDetailData['buildingInfo']
  relatedListings: MiniListingDetailData['relatedListings']
  inquiryPolicyVersion: string
}>

const numberFormatter = new Intl.NumberFormat('zh-CN', {
  maximumFractionDigits: 2,
})

function formatNumber(value: number): string {
  return numberFormatter.format(value)
}

function formatCny(value: number | null): string {
  return value === null ? '—' : `¥${formatNumber(value)}`
}

function formatDateParts(year: number, month: number, day: number): string {
  return `${year}年${month}月${day}日`
}

function formatDateOnly(value: string | null): string {
  if (value === null) return '—'
  const [year, month, day] = value.split('-').map(Number)
  return formatDateParts(year ?? 0, month ?? 0, day ?? 0)
}

function formatIsoDate(value: string | null): string {
  if (value === null) return '—'
  const date = new Date(value)
  return formatDateParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
}

function inclusionLabel(
  inclusion: MiniListingDetailData['monthlyCost']['propertyFeeInclusion'],
): string {
  if (inclusion === 'included') return '物业费已包含'
  if (inclusion === 'excluded') return '物业费另计'
  if (inclusion === 'confirm') return '物业费待确认'
  return '物业费包含情况待确认'
}

function presentFactGroups(
  groups: readonly MiniFactGroup[],
): readonly DetailFactGroupPresentation[] {
  return groups.map((group) => ({
    id: group.id,
    title: group.title,
    facts: group.facts.map((fact) => ({
      label: fact.label,
      value: fact.value ?? '—',
      estimated: fact.estimated,
    })),
  }))
}

function compactLocation(detail: MiniListingDetailData): string {
  const district = detail.listing.building?.district ?? ''
  const building = detail.listing.building?.name ?? ''
  return [district, building].filter(Boolean).join(' · ') || detail.listing.cityName
}

export function presentListingDetail(
  detail: MiniListingDetailData,
): ListingDetailPresentation {
  const price = detail.listing.price

  return {
    title: detail.listing.title,
    location: compactLocation(detail),
    primaryPrice: price?.monthlyEstimate == null
      ? '—'
      : `约 ¥${formatNumber(price.monthlyEstimate)}/月`,
    secondaryPrice: price?.text ?? '',
    gallery: detail.listing.gallery,
    highlights: detail.listing.highlights,
    monthlyCost: {
      rent: formatCny(detail.monthlyCost.rent),
      propertyFee: formatCny(detail.monthlyCost.propertyFee),
      total: formatCny(detail.monthlyCost.total),
      inclusionLabel: inclusionLabel(detail.monthlyCost.propertyFeeInclusion),
      assumptions: detail.monthlyCost.assumptions,
    },
    specifications: [
      {
        id: 'area',
        label: '面积',
        value: detail.listing.area === null ? '—' : `${formatNumber(detail.listing.area)} ㎡`,
        estimated: false,
      },
      {
        id: 'seats',
        label: '工位',
        value: detail.listing.seats === null ? '—' : `${formatNumber(detail.listing.seats)} 席`,
        estimated: false,
      },
      {
        id: 'listing-type',
        label: '类型',
        value: detail.listing.listingType.label || '—',
        estimated: false,
      },
      {
        id: 'available-from',
        label: '最早入驻',
        value: formatDateOnly(detail.listing.availableFrom),
        estimated: false,
      },
    ],
    factGroups: presentFactGroups(detail.listing.factGroups),
    verification: {
      verifiedAt: formatIsoDate(detail.listing.verification.verifiedAt),
      priceVerifiedAt: formatIsoDate(detail.listing.verification.priceVerifiedAt),
    },
    building: detail.buildingInfo,
    relatedListings: detail.relatedListings,
    inquiryPolicyVersion: detail.inquiryPolicy.version,
  }
}
