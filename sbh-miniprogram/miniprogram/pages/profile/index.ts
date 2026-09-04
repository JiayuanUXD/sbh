import {
  loadUserAssets,
  refreshUserAssets,
  type UserFavoriteBuilding,
  type UserFavoriteListing,
  type UserInquiry,
} from '../../services/user-assets.js'
import { inquiryDetailRoute } from '../../services/inquiry-tracker.js'

type AssetsState = 'loading' | 'ready' | 'error'
type FavoriteCollection = 'none' | 'listing' | 'building'

type ProfileInquiry = UserInquiry & Readonly<{ formattedDate: string }>

type ProfilePageData = {
  assetsState: AssetsState
  favoriteListings: readonly UserFavoriteListing[]
  favoriteBuildings: readonly UserFavoriteBuilding[]
  inquiries: readonly ProfileInquiry[]
  favoriteCollection: FavoriteCollection
}

type ProfilePageMethods = {
  assetsRequestVersion: number
  loadAssets(force?: boolean, pullDown?: boolean): Promise<void>
  handleRetryAssets(): void
  handleViewFavorites(event: WechatMiniprogram.BaseEvent): void
  handleFavoriteItemClick(event: WechatMiniprogram.BaseEvent): void
  handleCloseFavoriteCollection(): void
  handleInquiryItemClick(event: WechatMiniprogram.BaseEvent): void
}

function formatDate(timestamp: string): string {
  const date = new Date(timestamp)
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`
}

function emptyVisibleAssets(): Pick<
  ProfilePageData,
  'favoriteListings' | 'favoriteBuildings' | 'inquiries' | 'favoriteCollection'
> {
  return {
    favoriteListings: [],
    favoriteBuildings: [],
    inquiries: [],
    favoriteCollection: 'none',
  }
}

Page<ProfilePageData, ProfilePageMethods>({
  data: {
    assetsState: 'loading',
    ...emptyVisibleAssets(),
  },

  assetsRequestVersion: 0,

  onShow() {
    void this.loadAssets(false)
  },

  onHide() {
    this.assetsRequestVersion += 1
  },

  onUnload() {
    this.assetsRequestVersion += 1
  },

  onPullDownRefresh() {
    return this.loadAssets(true, true)
  },

  async loadAssets(force = false, pullDown = false) {
    const requestVersion = this.assetsRequestVersion + 1
    this.assetsRequestVersion = requestVersion
    this.setData({ assetsState: 'loading', ...emptyVisibleAssets() })
    try {
      const assets = await (force ? refreshUserAssets() : loadUserAssets())
      if (requestVersion !== this.assetsRequestVersion) return
      this.setData({
        assetsState: 'ready',
        favoriteListings: assets.favorites.listings,
        favoriteBuildings: assets.favorites.buildings,
        inquiries: assets.inquiries.map((item) => ({
          ...item,
          formattedDate: formatDate(item.submittedAt),
        })),
        favoriteCollection: 'none',
      })
    } catch {
      if (requestVersion !== this.assetsRequestVersion) return
      this.setData({
        assetsState: 'error',
        favoriteListings: [],
        favoriteBuildings: [],
        inquiries: [],
        favoriteCollection: 'none',
      })
    } finally {
      if (pullDown && requestVersion === this.assetsRequestVersion) wx.stopPullDownRefresh()
    }
  },

  handleRetryAssets() {
    void this.loadAssets(true)
  },

  handleViewFavorites(event) {
    const type = event.currentTarget.dataset.type
    if (type !== 'listing' && type !== 'building') return
    const items = type === 'listing' ? this.data.favoriteListings : this.data.favoriteBuildings
    if (items.length === 0) {
      wx.showToast({ title: type === 'listing' ? '暂未收藏房源' : '暂未收藏楼盘', icon: 'none' })
      return
    }
    this.setData({ favoriteCollection: type })
  },

  handleFavoriteItemClick(event) {
    const type = event.currentTarget.dataset.type
    const slug = event.currentTarget.dataset.slug
    if ((type !== 'listing' && type !== 'building') || typeof slug !== 'string' || !slug) return
    const page = type === 'listing' ? 'listing-detail' : 'building-detail'
    wx.navigateTo({ url: `/pages/${page}/index?slug=${encodeURIComponent(slug)}` })
  },

  handleCloseFavoriteCollection() {
    this.setData({ favoriteCollection: 'none' })
  },

  handleInquiryItemClick(event) {
    const submittedAt = event.currentTarget.dataset.submittedAt
    if (typeof submittedAt !== 'string') return
    const inquiry = this.data.inquiries.find((item) => item.submittedAt === submittedAt)
    if (!inquiry) return
    const route = inquiryDetailRoute(inquiry)
    if (route === null) {
      wx.showToast({ title: '通用需求暂无详情页', icon: 'none' })
      return
    }
    wx.navigateTo({ url: route })
  },
})
