import {
  parseListingQuery,
  type ListingQuery,
} from '../../domain/listing-query.js'
import type { RelaxationSuggestion } from '../../domain/relaxations.js'
import {
  presentListingCard,
  type ListingCardPresentation,
} from '../../domain/listing-presentation.js'
import { catalog } from '../../services/catalog.js'
import type { MiniQuickFilter } from '../../services/catalog-contracts.js'
import { listingNavigation } from '../../services/listing-navigation.js'
import {
  createListingsController,
  type ListingsController,
  type ListingsLoadState,
  type ListingsSnapshot,
} from './controller.js'

const LISTING_QUERY_OPTION_KEYS = [
  'q',
  'district',
  'type',
  'areaMin',
  'areaMax',
  'priceMin',
  'priceMax',
  'priceUnit',
  'availableBefore',
  'sort',
  'page',
] as const

type ListingQueryOptionKey = (typeof LISTING_QUERY_OPTION_KEYS)[number]
type ListingPageOptions = Readonly<Partial<Record<ListingQueryOptionKey, string>>>

type ListingsPageData = {
  state: ListingsLoadState
  query: ListingQuery
  items: readonly ListingCardPresentation[]
  filters: readonly MiniQuickFilter[]
  totalDocs: number
  hasNextPage: boolean
  refreshing: boolean
  refreshError: boolean
  loadingMore: boolean
  loadMoreError: boolean
  relaxations: readonly RelaxationSuggestion[]
  loadingRelaxations: boolean
  estimating: boolean
  estimateUnavailable: boolean
  estimatedCount: number
  activeFilterCount: number
  sheetOpen: boolean
  sheetSection: 'location' | 'price' | 'area' | 'all'
}

type FilterOpenEvent = Readonly<{
  detail: Readonly<{ section?: unknown }>
}>

type FilterQueryEvent = Readonly<{
  detail: Readonly<{ query: ListingQuery }>
}>

type RelaxationTapEvent = Readonly<{
  currentTarget: Readonly<{
    dataset: Readonly<{ query?: unknown }>
  }>
}>

type ListingOpenEvent = Readonly<{
  detail: Readonly<{ slug?: unknown }>
}>

type ListingsPageMethods = {
  listingsController: ListingsController | null
  initialQuery: ListingQuery
  hasLoaded: boolean
  ensureListingsController(): ListingsController
  handleRetry(): void
  handleRetryLoadMore(): void
  handleOpenFilter(event: FilterOpenEvent): void
  handleFilterEstimate(event: FilterQueryEvent): void
  handleFilterClear(event: FilterQueryEvent): void
  handleFilterApply(event: FilterQueryEvent): void
  handleFilterClose(): void
  handleApplyRelaxation(event: RelaxationTapEvent): void
  handleClearAll(): void
  handleListingOpen(event: ListingOpenEvent): void
  handleSearchSubmit(event: WechatMiniprogram.CustomEvent<{ value: string }>): void
  handleToggleSort(): void
  handleToggleMap(): void
}

function buildWhitelistedQuery(options: ListingPageOptions): string {
  return LISTING_QUERY_OPTION_KEYS.flatMap((key) => {
    const value = options[key]
    return typeof value === 'string'
      ? [`${encodeURIComponent(key)}=${encodeURIComponent(value)}`]
      : []
  }).join('&')
}

function activeFilterCount(query: ListingQuery): number {
  return [
    Boolean(query.q),
    Boolean(query.district?.length),
    Boolean(query.type?.length),
    query.areaMin !== undefined || query.areaMax !== undefined,
    query.priceUnit !== undefined || query.priceMin !== undefined || query.priceMax !== undefined,
    Boolean(query.availableBefore),
    query.sort !== 'recommended',
  ].filter(Boolean).length
}

function projectSnapshot(snapshot: ListingsSnapshot): Partial<ListingsPageData> {
  return {
    state: snapshot.state,
    query: snapshot.query,
    items: snapshot.items.map(presentListingCard),
    filters: snapshot.filters,
    totalDocs: snapshot.totalDocs,
    hasNextPage: snapshot.pagination?.hasNextPage ?? false,
    refreshing: snapshot.refreshing,
    refreshError: snapshot.refreshError,
    loadingMore: snapshot.loadingMore,
    loadMoreError: snapshot.loadMoreError,
    relaxations: snapshot.relaxations,
    loadingRelaxations: snapshot.loadingRelaxations,
    estimating: snapshot.estimating,
    estimateUnavailable: snapshot.estimateUnavailable,
    estimatedCount: snapshot.estimatedCount,
    activeFilterCount: activeFilterCount(snapshot.query),
  }
}

const emptyQuery = parseListingQuery('')

Page<ListingsPageData, ListingsPageMethods>({
  data: {
    state: 'idle',
    query: emptyQuery,
    items: [],
    filters: [],
    totalDocs: 0,
    hasNextPage: false,
    refreshing: false,
    refreshError: false,
    loadingMore: false,
    loadMoreError: false,
    relaxations: [],
    loadingRelaxations: false,
    estimating: false,
    estimateUnavailable: false,
    estimatedCount: 0,
    activeFilterCount: 0,
    sheetOpen: false,
    sheetSection: 'all',
  },

  listingsController: null,
  initialQuery: emptyQuery,
  hasLoaded: false,

  onLoad(options) {
    this.initialQuery = parseListingQuery(buildWhitelistedQuery(options))
  },

  onShow() {
    const pendingQuery = listingNavigation.consume()
    if (pendingQuery !== null) {
      const controller = this.ensureListingsController()
      controller.cancelEstimate()
      this.setData({ sheetOpen: false })
      this.hasLoaded = true
      void controller.load(parseListingQuery(pendingQuery))
      return
    }

    if (!this.hasLoaded) {
      this.hasLoaded = true
      void this.ensureListingsController().load(this.initialQuery)
    }
  },

  onUnload() {
    this.listingsController?.dispose()
    this.listingsController = null
  },

  onPullDownRefresh() {
    this.hasLoaded = true
    return this.ensureListingsController().refresh()
  },

  onReachBottom() {
    void this.ensureListingsController().loadNextPage()
  },

  ensureListingsController() {
    if (this.listingsController === null) {
      this.listingsController = createListingsController({
        getListings: (query) => catalog.getListings(query),
        onChange: (snapshot) => this.setData(projectSnapshot(snapshot)),
        stopPullDownRefresh: () => wx.stopPullDownRefresh(),
      })
    }
    return this.listingsController
  },

  handleRetry() {
    void this.ensureListingsController().load(this.data.query)
  },

  handleRetryLoadMore() {
    void this.ensureListingsController().loadNextPage()
  },

  handleOpenFilter(event) {
    const section = event.detail.section
    const sheetSection = section === 'location' || section === 'price' || section === 'area'
      ? section
      : 'all'
    this.setData({
      sheetOpen: true,
      sheetSection,
      estimatedCount: this.data.totalDocs,
    })
  },

  handleFilterEstimate(event) {
    this.ensureListingsController().estimateDraft(event.detail.query)
  },

  handleFilterClear(event) {
    this.ensureListingsController().estimateDraft(event.detail.query)
  },

  handleFilterApply(event) {
    this.setData({ sheetOpen: false })
    void this.ensureListingsController().applyFilters(event.detail.query)
  },

  handleFilterClose() {
    this.ensureListingsController().cancelEstimate()
    this.setData({ sheetOpen: false })
  },

  handleApplyRelaxation(event) {
    const query = event.currentTarget.dataset.query
    if (typeof query !== 'string') return
    void this.ensureListingsController().applyRelaxation(query)
  },

  handleClearAll() {
    const query = this.data.query.priceUnit
      ? parseListingQuery(`priceUnit=${encodeURIComponent(this.data.query.priceUnit)}`)
      : parseListingQuery('')
    void this.ensureListingsController().applyFilters(query)
  },

  handleListingOpen(event) {
    const slug = event.detail.slug
    if (typeof slug !== 'string' || !slug) return
    void listingNavigation.openDetail(slug).catch(() => {
      wx.showToast({
        title: '暂时无法打开房源详情',
        icon: 'none',
        duration: 1600,
      })
    })
  },

  handleSearchSubmit(event) {
    const keyword = (event.detail.value || '').trim()
    const query = { ...this.data.query, keyword: keyword || undefined }
    void this.ensureListingsController().applyFilters(query)
  },

  handleToggleSort() {
    const currentSort = this.data.query.sort
    const nextSort: 'price-asc' | 'price-desc' = currentSort === 'price-asc' ? 'price-desc' : 'price-asc'
    const query = { ...this.data.query, sort: nextSort }
    void this.ensureListingsController().applyFilters(query)
  },

  handleToggleMap() {
    wx.showToast({
      title: '地图模式即将开放',
      icon: 'none',
      duration: 1600,
    })
  },
})
