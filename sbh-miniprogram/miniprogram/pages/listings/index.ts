import {
  applyListingPatch,
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
  createModalTabBarBoundary,
  type ModalTabBarBoundary,
} from '../../utils/modal-tab-bar-boundary.js'
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
  tabBarBoundaryState: 'visible' | 'hidden'
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
  modalTabBarBoundary: ModalTabBarBoundary | null
  filterOpenPromise: Promise<void> | null
  modalOpenGeneration: number
  pageActive: boolean
  ensureListingsController(): ListingsController
  ensureModalTabBarBoundary(): ModalTabBarBoundary
  showModalTabBarBoundary(): Promise<boolean>
  restoreModalTabBarBoundary(): Promise<void>
  handleRetry(): void
  handleRetryLoadMore(): void
  handleOpenFilter(event: FilterOpenEvent): Promise<void>
  handleFilterEstimate(event: FilterQueryEvent): void
  handleFilterClear(event: FilterQueryEvent): void
  handleFilterApply(event: FilterQueryEvent): void
  handleFilterClose(): void
  handleApplyRelaxation(event: RelaxationTapEvent): void
  handleClearAll(): void
  handleListingOpen(event: ListingOpenEvent): void
  handleSearchSubmit(event: WechatMiniprogram.CustomEvent<{ value: string }>): void
  handleToggleSort(): void
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
    tabBarBoundaryState: 'visible',
  },

  listingsController: null,
  initialQuery: emptyQuery,
  hasLoaded: false,
  modalTabBarBoundary: null,
  filterOpenPromise: null,
  modalOpenGeneration: 0,
  pageActive: true,

  onLoad(options) {
    this.initialQuery = parseListingQuery(buildWhitelistedQuery(options))
  },

  onShow() {
    this.pageActive = true
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

  onHide() {
    this.pageActive = false
    this.modalOpenGeneration += 1
    this.filterOpenPromise = null
    this.listingsController?.cancelEstimate()
    this.setData({ sheetOpen: false })
    void this.restoreModalTabBarBoundary()
  },

  onUnload() {
    this.pageActive = false
    this.modalOpenGeneration += 1
    this.filterOpenPromise = null
    this.listingsController?.cancelEstimate()
    this.setData({ sheetOpen: false })
    void this.restoreModalTabBarBoundary()
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

  ensureModalTabBarBoundary() {
    if (this.modalTabBarBoundary === null) {
      this.modalTabBarBoundary = createModalTabBarBoundary({
        hideTabBar: () => new Promise<void>((resolve, reject) => {
          wx.hideTabBar({ animation: false, success: () => resolve(), fail: reject })
        }),
        showTabBar: () => new Promise<void>((resolve, reject) => {
          wx.showTabBar({ animation: false, success: () => resolve(), fail: reject })
        }),
        onChange: (state) => this.setData({ tabBarBoundaryState: state }),
      })
    }
    return this.modalTabBarBoundary
  },

  async showModalTabBarBoundary() {
    return this.ensureModalTabBarBoundary().hide()
  },

  async restoreModalTabBarBoundary() {
    await this.modalTabBarBoundary?.restore()
  },

  handleRetry() {
    void this.ensureListingsController().load(this.data.query)
  },

  handleRetryLoadMore() {
    void this.ensureListingsController().loadNextPage()
  },

  handleOpenFilter(event) {
    if (this.data.sheetOpen) return Promise.resolve()
    if (this.filterOpenPromise !== null) return this.filterOpenPromise

    const section = event.detail.section
    const sheetSection = section === 'location' || section === 'price' || section === 'area'
      ? section
      : 'all'
    const owner = ++this.modalOpenGeneration
    let opening!: Promise<void>
    opening = (async () => {
      const hidden = await this.showModalTabBarBoundary()
      if (owner !== this.modalOpenGeneration || !this.pageActive) return
      if (!hidden) {
        wx.showToast({ title: '暂时无法打开筛选', icon: 'none', duration: 1600 })
        return
      }
      this.setData({
        sheetOpen: true,
        sheetSection,
        estimatedCount: this.data.totalDocs,
      })
    })().finally(() => {
      if (this.filterOpenPromise === opening) this.filterOpenPromise = null
    })
    this.filterOpenPromise = opening
    return opening
  },

  handleFilterEstimate(event) {
    this.ensureListingsController().estimateDraft(event.detail.query)
  },

  handleFilterClear(event) {
    this.ensureListingsController().estimateDraft(event.detail.query)
  },

  handleFilterApply(event) {
    this.setData({ sheetOpen: false })
    void this.restoreModalTabBarBoundary()
    void this.ensureListingsController().applyFilters(event.detail.query)
  },

  handleFilterClose() {
    this.ensureListingsController().cancelEstimate()
    this.setData({ sheetOpen: false })
    void this.restoreModalTabBarBoundary()
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
    const q = (event.detail.value || '').trim()
    const query = applyListingPatch(this.data.query, { q: q || undefined })
    void this.ensureListingsController().applyFilters(query)
  },

  handleToggleSort() {
    if (!this.data.query.priceUnit) {
      wx.showToast({
        title: '请先选择计价单位',
        icon: 'none',
        duration: 1600,
      })
      return
    }
    const currentSort = this.data.query.sort
    const nextSort: 'price-asc' | 'price-desc' = currentSort === 'price-asc' ? 'price-desc' : 'price-asc'
    const query = applyListingPatch(this.data.query, { sort: nextSort })
    void this.ensureListingsController().applyFilters(query)
  },
})
