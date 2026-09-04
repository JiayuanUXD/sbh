import {
  LISTING_TYPES,
  PRICE_DISPLAY_UNITS,
  applyListingPatch,
  parseListingQuery,
  serializeListingQuery,
  type ListingQueryPatch,
  type ListingType,
  type PriceDisplayUnit,
} from '../../domain/listing-query.js'
import {
  presentListingCard,
  type ListingCardPresentation,
} from '../../domain/listing-presentation.js'
import type { MiniHomeData, MiniQuickFilter } from '../../services/catalog-contracts.js'

export type HomeLoadState = 'idle' | 'loading' | 'ready' | 'error'

export type HomeQuickFilterOption = Readonly<{
  value: string
  label: string
  count: number
  query: string
}>

export type HomeQuickFilterGroup = Readonly<{
  id: MiniQuickFilter['id']
  label: string
  options: readonly HomeQuickFilterOption[]
}>

export type HomePresentation = Readonly<{
  featuredListings: readonly ListingCardPresentation[]
  featuredBuildings: MiniHomeData['featuredBuildings']
  quickFilters: readonly HomeQuickFilterGroup[]
  stats: MiniHomeData['stats']
}>

export type HomePageSnapshot = Readonly<{
  state: HomeLoadState
  content: HomePresentation | null
  refreshError: boolean
}>

function isListingType(value: string): value is ListingType {
  return (LISTING_TYPES as readonly string[]).includes(value)
}

function isPriceDisplayUnit(value: string): value is PriceDisplayUnit {
  return (PRICE_DISPLAY_UNITS as readonly string[]).includes(value)
}

function toListingQuery(patch: ListingQueryPatch): string {
  const query = applyListingPatch(parseListingQuery(''), patch)
  return serializeListingQuery(query)
}

export function buildSearchNavigation(keyword: string): string {
  return toListingQuery({ q: keyword })
}

export function buildQuickFilterNavigation(
  dimension: MiniQuickFilter['id'],
  value: string,
): string | null {
  if (dimension === 'district') {
    const district = value.trim()
    if (!district) return null
    const query = toListingQuery({ district: [district] })
    return query || null
  }
  if (dimension === 'listingType') {
    return isListingType(value) ? toListingQuery({ type: [value] }) : null
  }
  return isPriceDisplayUnit(value) ? toListingQuery({ priceUnit: value }) : null
}

export function presentHome(home: MiniHomeData): HomePresentation {
  const quickFilters = home.quickFilters.flatMap((group) => {
    const options = group.options
      .flatMap((option) => {
        if (option.count <= 0) return []
        const label = option.label.trim()
        if (!label) return []
        const value = option.value.trim()
        if (!value) return []
        const query = buildQuickFilterNavigation(group.id, value)
        if (query === null) return []
        return [{ ...option, value, label, query }]
      })
      .slice(0, 4)

    return options.length > 0 ? [{ id: group.id, label: group.label, options }] : []
  })

  return {
    featuredListings: home.featuredListings.map(presentListingCard),
    featuredBuildings: home.featuredBuildings,
    quickFilters,
    stats: home.stats,
  }
}

export function beginHomeLoad(
  snapshot: HomePageSnapshot,
  refresh: boolean,
): HomePageSnapshot {
  if (!refresh && snapshot.content === null) {
    return { state: 'loading', content: null, refreshError: false }
  }
  return { ...snapshot, refreshError: false }
}

export function succeedHomeLoad(
  snapshot: HomePageSnapshot,
  content: HomePresentation,
): HomePageSnapshot {
  return { ...snapshot, state: 'ready', content, refreshError: false }
}

export function failHomeLoad(snapshot: HomePageSnapshot): HomePageSnapshot {
  if (snapshot.content === null) {
    return { state: 'error', content: null, refreshError: false }
  }
  return { state: 'ready', content: snapshot.content, refreshError: true }
}
