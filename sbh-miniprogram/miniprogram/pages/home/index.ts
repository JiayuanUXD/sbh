import { catalog } from '../../services/catalog.js'
import { listingNavigation } from '../../services/listing-navigation.js'
import {
  createHomeLoadController,
  type HomeLoadController,
} from './controller.js'
import {
  buildSearchNavigation,
  type HomePageSnapshot,
} from './model.js'

type HomePageData = HomePageSnapshot & Readonly<{
  keyword: string
  lastOpenedListingSlug: string
}>

type SearchSubmitEvent = Readonly<{
  detail?: Readonly<{ value?: unknown }>
}>

type NavigationTapEvent = Readonly<{
  currentTarget: Readonly<{
    dataset: Readonly<{ query?: unknown }>
  }>
}>

type ListingOpenEvent = Readonly<{
  detail: Readonly<{ slug?: unknown }>
}>

type HomePageMethods = {
  homeLoadController: HomeLoadController | null
  ensureHomeLoadController(): HomeLoadController
  loadHome(refresh?: boolean): Promise<void>
  handleKeywordInput(event: WechatMiniprogram.Input): void
  handleSearchSubmit(event?: SearchSubmitEvent): void
  handleRetry(): void
  handleQuickFilter(event: NavigationTapEvent): void
  handleBrowseAll(): void
  openListings(query: string): void
  handleListingOpen(event: ListingOpenEvent): void
}

function currentSnapshot(data: HomePageData): HomePageSnapshot {
  return {
    state: data.state,
    content: data.content,
    refreshError: data.refreshError,
  }
}

Page<HomePageData, HomePageMethods>({
  data: {
    state: 'idle',
    content: null,
    refreshError: false,
    keyword: '',
    lastOpenedListingSlug: '',
  },

  homeLoadController: null,

  onLoad() {
    void this.loadHome(false)
  },

  onUnload() {
    this.homeLoadController?.invalidate()
    this.homeLoadController = null
  },

  onPullDownRefresh() {
    return this.loadHome(true)
  },

  ensureHomeLoadController() {
    if (this.homeLoadController === null) {
      this.homeLoadController = createHomeLoadController({
        getHome: () => catalog.getHome('shanghai'),
        getSnapshot: () => currentSnapshot(this.data),
        setSnapshot: (snapshot) => this.setData(snapshot),
        stopPullDownRefresh: () => wx.stopPullDownRefresh(),
      })
    }
    return this.homeLoadController
  },

  loadHome(refresh = false) {
    return this.ensureHomeLoadController().load(refresh)
  },

  handleKeywordInput(event) {
    this.setData({ keyword: event.detail.value })
  },

  handleSearchSubmit(event) {
    const submittedValue = event?.detail?.value
    const keyword = typeof submittedValue === 'string' ? submittedValue : this.data.keyword
    this.setData({ keyword })
    this.openListings(buildSearchNavigation(keyword))
  },

  handleRetry() {
    void this.loadHome(false)
  },

  handleQuickFilter(event) {
    const query = event.currentTarget.dataset.query
    if (typeof query !== 'string') return
    this.openListings(query)
  },

  handleBrowseAll() {
    this.openListings('')
  },

  openListings(query) {
    void listingNavigation.open(query).catch(() => {
      wx.showToast({
        title: '暂时无法打开找房页',
        icon: 'none',
        duration: 1600,
      })
    })
  },

  handleListingOpen(event) {
    const slug = event.detail.slug
    if (typeof slug !== 'string' || !slug) return

    this.setData({ lastOpenedListingSlug: slug })
    wx.showToast({
      title: '详情功能即将开放',
      icon: 'none',
      duration: 1600,
    })
  },
})
