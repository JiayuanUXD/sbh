import { getBuildingDetail } from '../../services/catalog.js'
import type { MiniBuildingDetailData } from '../../services/catalog-contracts.js'
import { isBuildingFavorite, toggleBuildingFavorite } from '../../services/favorites.js'
import { recordInquiry } from '../../services/inquiry-tracker.js'

const GRADE_LABELS: Record<string, string> = {
  'super-grade-a': '超甲级',
  'grade-a': '甲级',
  'grade-b': '乙级',
  'grade-c': '丙级',
  'serviced-office': '商务中心',
  'A': '甲级',
  'B': '乙级',
  'C': '丙级',
}

Page({
  data: {
    slug: '',
    state: 'loading' as 'loading' | 'ready' | 'error' | 'not-found',
    building: null as MiniBuildingDetailData | null,
    gradeLabel: '—',
    currentGalleryIndex: 0,
    isFavorited: false,
  },

  onLoad(options: Record<string, string | undefined>) {
    const slug = options.slug ?? ''
    this.setData({ slug })
    if (slug) {
      this.loadBuildingDetail(slug)
    } else {
      this.setData({ state: 'not-found' })
    }
  },

  async loadBuildingDetail(targetSlug?: string) {
    const slug = targetSlug || this.data.slug
    if (!slug) return

    this.setData({ state: 'loading' })
    try {
      const building = await getBuildingDetail(slug)
      const gradeLabel = building.grade
        ? (GRADE_LABELS[building.grade] || (building.grade.endsWith('级') ? building.grade : `${building.grade}级`))
        : '—'
      this.setData({
        state: 'ready',
        building,
        gradeLabel,
        currentGalleryIndex: 0,
        isFavorited: isBuildingFavorite(building.slug),
      })
      wx.setNavigationBarTitle({ title: building.name })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('404') || message.includes('not_found') || message.includes('无效')) {
        this.setData({ state: 'not-found' })
      } else {
        this.setData({ state: 'error' })
      }
    }
  },

  handleGalleryChange(e: WechatMiniprogram.CustomEvent) {
    this.setData({
      currentGalleryIndex: e.detail.current,
    })
  },

  handleListingOpen(e: WechatMiniprogram.BaseEvent) {
    const slug = e.currentTarget.dataset.slug
    if (!slug) return
    wx.navigateTo({
      url: `/pages/listing-detail/index?slug=${encodeURIComponent(slug)}`,
    })
  },

  handleComparableOpen(e: WechatMiniprogram.BaseEvent) {
    const slug = e.currentTarget.dataset.slug
    if (!slug) return
    wx.navigateTo({
      url: `/pages/building-detail/index?slug=${encodeURIComponent(slug)}`,
    })
  },

  handleFav() {
    const building = this.data.building
    if (!building?.slug) return
    const isNowFav = toggleBuildingFavorite({
      slug: building.slug,
      name: building.name,
    })
    this.setData({ isFavorited: isNowFav })
    wx.showToast({
      title: isNowFav ? '已收藏该楼盘' : '已取消收藏',
      icon: 'success',
    })
  },

  handleInquiryAdvisor() {
    const building = this.data.building
    wx.showModal({
      title: `咨询 ${building?.name || '该楼盘'}`,
      content: '专属商办顾问将在 30 分钟内致电沟通带看与免租期优惠。',
      confirmText: '确认咨询',
      success: (res) => {
        if (res.confirm) {
          recordInquiry({
            submissionRequestId: `req_b_${Date.now()}`,
            targetType: 'building',
            targetSlug: building?.slug,
            targetTitle: `${building?.name || '精选楼盘'} · 顾问带看咨询`,
            status: 'pending',
            statusLabel: '待带看',
          })
          wx.showToast({ title: '顾问已接单', icon: 'success' })
        }
      },
    })
  },

  handleBackToList() {
    wx.switchTab({ url: '/pages/buildings/index' })
  },

  handleScrollToListings() {
    wx.pageScrollTo({
      selector: '.building-listings-card',
      duration: 300,
    })
  },
})
