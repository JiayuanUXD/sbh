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
  heroVideoUrl: string
  heroPosterUrl: string
  videoFailed: boolean
  imageFailed: boolean
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

type BuildingOpenEvent = Readonly<{
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
  openListings(query: string): void
  handleListingOpen(event: ListingOpenEvent): void
  handleBrowseBuildings(): void
  handleBuildingOpenDirect(event: BuildingOpenEvent): void
  handleVideoError(): void
  handleImageError(): void
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
    heroVideoUrl: '/api/media/file/hero-bg.mp4?prefix=media',
    heroPosterUrl: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?q=80&w=1200&auto=format&fit=crop',
    videoFailed: false,
    imageFailed: false,
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

    void listingNavigation.openDetail(slug).catch(() => {
      wx.showToast({
        title: '暂时无法打开房源详情',
        icon: 'none',
        duration: 1600,
      })
    })
  },

  handleBrowseBuildings() {
    void listingNavigation.openBuildings().catch(() => {
      wx.showToast({
        title: '暂时无法打开楼盘页',
        icon: 'none',
        duration: 1600,
      })
    })
  },

  handleBuildingOpenDirect(event) {
    const slug = event.detail.slug
    if (typeof slug !== 'string' || !slug) return
    void listingNavigation.openBuildingDetail(slug).catch(() => {
      wx.showToast({
        title: '暂时无法打开楼盘详情',
        icon: 'none',
        duration: 1600,
      })
    })
  },

  handleVideoError() {
    this.setData({ videoFailed: true })
  },

  handleImageError() {
    this.setData({ imageFailed: true })
  },
})
