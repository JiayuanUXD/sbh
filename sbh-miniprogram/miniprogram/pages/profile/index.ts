import {
  type FavoritesSummary,
  getFavoritesSummary,
} from '../../services/favorites.js'
import {
  type InquiryRecord,
  getPendingInquiryCount,
  getRecentInquiries,
} from '../../services/inquiry-tracker.js'

interface ProfileInquiryItem extends InquiryRecord {
  formattedDate: string
}

interface ProfilePageData {
  user: {
    nickname: string
    city: string
  }
  summary: FavoritesSummary
  inquiries: ProfileInquiryItem[]
  pendingInquiryCount: number
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp)
  const month = date.getMonth() + 1
  const day = date.getDate()
  return `${month} 月 ${day} 日`
}

Page<ProfilePageData, Record<string, any>>({
  data: {
    user: {
      nickname: '微信用户',
      city: '上海',
    },
    summary: {
      listingCount: 0,
      buildingCount: 0,
      historyCount: 0,
      compareCount: 0,
    },
    inquiries: [],
    pendingInquiryCount: 0,
  },

  onShow() {
    this.refreshData()
  },

  refreshData() {
    const summary = getFavoritesSummary()
    const rawInquiries = getRecentInquiries(5)
    const inquiries: ProfileInquiryItem[] = rawInquiries.map((item) => ({
      ...item,
      formattedDate: formatDate(item.submittedAt),
    }))
    const pendingInquiryCount = getPendingInquiryCount()

    this.setData({
      summary,
      inquiries,
      pendingInquiryCount,
    })
  },

  handleUserClick() {
    wx.showToast({
      title: '已通过微信安全授权',
      icon: 'none',
    })
  },

  handleViewFavorites(event: WechatMiniprogram.BaseEvent) {
    const type = event.currentTarget.dataset.type
    if (type === 'listing') {
      const count = this.data.summary.listingCount
      if (count === 0) {
        wx.showToast({ title: '暂未收藏房源，可前往找房添加', icon: 'none' })
        return
      }
      wx.switchTab({ url: '/pages/listings/index' })
    } else if (type === 'building') {
      const count = this.data.summary.buildingCount
      if (count === 0) {
        wx.showToast({ title: '暂未收藏楼盘，可前往楼盘页添加', icon: 'none' })
        return
      }
      wx.switchTab({ url: '/pages/buildings/index' })
    }
  },

  handleViewAllInquiries() {
    const count = this.data.pendingInquiryCount
    wx.showToast({
      title: `共 ${count} 条待跟进咨询`,
      icon: 'none',
    })
  },

  handleInquiryItemClick(event: WechatMiniprogram.BaseEvent) {
    const slug = event.currentTarget.dataset.slug
    if (slug) {
      wx.navigateTo({
        url: `/pages/listing-detail/index?slug=${encodeURIComponent(slug)}`,
      })
    }
  },

  handleCompareClick() {
    wx.showToast({
      title: '对比功能整理中，稍后开放',
      icon: 'none',
    })
  },

  handleCityClick() {
    wx.showActionSheet({
      itemList: ['上海', '北京（即将开放）', '深圳（即将开放）'],
      success: (res) => {
        if (res.tapIndex === 0) {
          wx.showToast({ title: '已选择：上海', icon: 'success' })
        } else {
          wx.showToast({ title: '新城市敬请期待', icon: 'none' })
        }
      },
    })
  },

  handleAdvisorClick() {
    wx.showModal({
      title: '联系商办专属顾问',
      content: '服务时间：工作日 9:00–20:00\n我们将安排陆家嘴/静安核心商圈资深顾问与您直连。',
      confirmText: '呼叫顾问',
      success: (res) => {
        if (res.confirm) {
          wx.showToast({ title: '已为您发起专属顾问对接', icon: 'success' })
        }
      },
    })
  },

  handleSettingsClick() {
    wx.showModal({
      title: '关于 SBH 与隐私保护',
      content: 'SBH 严格遵循《商办找房个人信息保护指引》，不读取通讯录，不骚扰推送，保障企业选址隐私安全。',
      showCancel: false,
      confirmText: '了解',
    })
  },
})
