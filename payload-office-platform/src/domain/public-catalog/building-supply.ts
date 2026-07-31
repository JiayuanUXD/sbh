import type {
  BuildingSupplyAreaRange,
  BuildingSupplyGroup,
  BuildingSupplyGroupAvailability,
  BuildingSupplyGroupViewModel,
  BuildingSupplyPriceRange,
  BuildingSupplySnapshot,
  ListingCardViewModel,
  PriceViewModel,
} from './contracts'
import { priceKeyOf } from './stable-sort'

export type BuildingSupplyInput = Readonly<{
  group?: BuildingSupplyGroup
  areaMin?: number
  areaMax?: number
  decorationStatus?: string
  availableBefore?: string
  priceUnit?: PriceViewModel['displayUnit']
  sort?: 'recommended' | 'area-asc' | 'area-desc' | 'price-asc' | 'price-desc'
}>

const GROUP_ORDER: readonly BuildingSupplyGroup[] = ['lease', 'sale', 'coworking']

function groupOf(card: ListingCardViewModel): BuildingSupplyGroup {
  // Listing type is the domain discriminator for coworking. It intentionally
  // wins over businessType because coworking listings are normally leases.
  if (card.listingType === 'coworking') return 'coworking'
  return card.businessType
}

function matchesInput(card: ListingCardViewModel, input: BuildingSupplyInput): boolean {
  if (input.group && groupOf(card) !== input.group) return false
  if (input.areaMin != null && (card.area == null || card.area < input.areaMin)) return false
  if (input.areaMax != null && (card.area == null || card.area > input.areaMax)) return false
  if (input.decorationStatus && card.decorationStatus !== input.decorationStatus) return false
  if (input.availableBefore && card.availableFrom && card.availableFrom > input.availableBefore) return false
  // A price-on-request card stays visible when the caller chooses a price unit.
  if (input.priceUnit && card.price && card.price.displayUnit !== input.priceUnit) return false
  return true
}

function compareIds(a: ListingCardViewModel, b: ListingCardViewModel): number {
  return a.id - b.id
}

function compareRecommended(a: ListingCardViewModel, b: ListingCardViewModel): number {
  if (a.isFeatured !== b.isFeatured) return a.isFeatured ? -1 : 1
  return compareIds(a, b)
}

function compareArea(a: ListingCardViewModel, b: ListingCardViewModel, direction: 'asc' | 'desc'): number {
  const av = a.area ?? (direction === 'asc' ? Infinity : -Infinity)
  const bv = b.area ?? (direction === 'asc' ? Infinity : -Infinity)
  if (av !== bv) return direction === 'asc' ? av - bv : bv - av
  return compareIds(a, b)
}

function comparePrice(a: ListingCardViewModel, b: ListingCardViewModel, direction: 'asc' | 'desc'): number {
  const av = a.price?.amount ?? (direction === 'asc' ? Infinity : -Infinity)
  const bv = b.price?.amount ?? (direction === 'asc' ? Infinity : -Infinity)
  if (av !== bv) return direction === 'asc' ? av - bv : bv - av
  return compareIds(a, b)
}

function hasMixedPriceKeys(cards: readonly ListingCardViewModel[]): boolean {
  let key: string | null = null
  for (const card of cards) {
    const current = priceKeyOf(card.price)
    if (!current) continue
    if (key && key !== current) return true
    key = current
  }
  return false
}

function sortCards(
  cards: readonly ListingCardViewModel[],
  input: BuildingSupplyInput,
  canComparePrices: boolean,
): ListingCardViewModel[] {
  const sort = input.sort ?? 'recommended'
  return cards.slice().sort((a, b) => {
    switch (sort) {
      case 'area-asc':
        return compareArea(a, b, 'asc')
      case 'area-desc':
        return compareArea(a, b, 'desc')
      case 'price-asc':
        return canComparePrices ? comparePrice(a, b, 'asc') : compareIds(a, b)
      case 'price-desc':
        return canComparePrices ? comparePrice(a, b, 'desc') : compareIds(a, b)
      case 'recommended':
        return compareRecommended(a, b)
    }
  })
}

function buildPriceRanges(cards: readonly ListingCardViewModel[]): readonly BuildingSupplyPriceRange[] {
  const ranges = new Map<string, BuildingSupplyPriceRange>()
  for (const card of cards) {
    const price = card.price
    const key = priceKeyOf(price)
    if (!price || !key) continue
    const existing = ranges.get(key)
    if (existing) {
      ranges.set(key, {
        ...existing,
        min: Math.min(existing.min, price.amount),
        max: Math.max(existing.max, price.amount),
        count: existing.count + 1,
      })
    } else {
      ranges.set(key, {
        key,
        businessType: price.businessType,
        currency: price.currency,
        period: price.period,
        basis: price.basis,
        displayUnit: price.displayUnit,
        min: price.amount,
        max: price.amount,
        count: 1,
      })
    }
  }
  return Array.from(ranges.values()).sort((a, b) => a.key.localeCompare(b.key))
}

function buildAreaRange(cards: readonly ListingCardViewModel[]): BuildingSupplyAreaRange | null {
  const areas = cards
    .map((card) => card.area)
    .filter((area): area is number => typeof area === 'number' && Number.isFinite(area) && area >= 0)
  if (areas.length === 0) return null
  return { min: Math.min(...areas), max: Math.max(...areas) }
}

function isImmediatelyAvailable(card: ListingCardViewModel, asOf: string): boolean {
  if (!card.availableFrom) return true
  const availableAt = Date.parse(card.availableFrom)
  const snapshotAt = Date.parse(asOf)
  return Number.isFinite(availableAt) && Number.isFinite(snapshotAt) && availableAt <= snapshotAt
}

function aggregateGroup(
  key: BuildingSupplyGroup,
  cards: readonly ListingCardViewModel[],
  asOf: string,
): Omit<BuildingSupplyGroupAvailability, 'totalEffectiveListings'> {
  return {
    key,
    areaRange: buildAreaRange(cards),
    immediateAvailabilityCount: cards.filter((card) => isImmediatelyAvailable(card, asOf)).length,
    priceRanges: buildPriceRanges(cards),
  }
}

export function emptyBuildingSupplySnapshot(asOf: string): BuildingSupplySnapshot {
  return {
    asOf,
    groups: [],
    availableGroups: [],
    totalEffectiveListings: 0,
    resultCount: 0,
    validationErrors: [],
  }
}

export function buildBuildingSupplySnapshot(
  cards: readonly ListingCardViewModel[],
  input: BuildingSupplyInput,
  asOf: string,
): BuildingSupplySnapshot {
  const filtered = cards.filter((card) => matchesInput(card, input))
  const isPriceSort = input.sort === 'price-asc' || input.sort === 'price-desc'
  const mixedPricesWithoutUnit = isPriceSort && !input.priceUnit && hasMixedPriceKeys(filtered)
  const validationErrors = mixedPricesWithoutUnit ? (['price_unit_required'] as const) : []
  const canComparePrices = !isPriceSort || Boolean(input.priceUnit) || !mixedPricesWithoutUnit
  const groups: BuildingSupplyGroupViewModel[] = []
  const availableGroups: BuildingSupplyGroupAvailability[] = []

  for (const key of GROUP_ORDER) {
    const availableCards = cards.filter((card) => groupOf(card) === key)
    if (availableCards.length > 0) {
      availableGroups.push({
        ...aggregateGroup(key, availableCards, asOf),
        totalEffectiveListings: availableCards.length,
      })
    }

    const groupCards = filtered.filter((card) => groupOf(card) === key)
    if (groupCards.length === 0) continue
    const sorted = sortCards(groupCards, input, canComparePrices && !hasMixedPriceKeys(groupCards))
    groups.push({
      ...aggregateGroup(key, sorted, asOf),
      listings: sorted,
    })
  }

  return {
    asOf,
    groups,
    availableGroups,
    totalEffectiveListings: cards.length,
    resultCount: filtered.length,
    validationErrors,
  }
}
