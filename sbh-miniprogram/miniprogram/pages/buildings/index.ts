import { getBuildings } from '../../services/catalog.js'
import type { MiniBuildingCard } from '../../services/catalog-contracts.js'

const SORTS: Record<string, string> = {
  '': '综合排序',
  'stock-desc': '在租最多',
  'completion-desc': '最新竣工',
  'grade': '等级最高',
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    items: [] as MiniBuildingCard[],
    inactiveItems: [] as MiniBuildingCard[],
    totalDocs: 0,
    totalActiveCount: 0,
    totalInactiveCount: 0,
    districtFilter: '',
    gradeFilter: '',
    sortFilter: '',
    sortLabel: '综合排序',
  },

  onLoad() {
    this.loadBuildings()
  },

  onPullDownRefresh() {
    this.loadBuildings().finally(() => {
      wx.stopPullDownRefresh()
    })
  },

  async loadBuildings() {
    this.setData({ state: 'loading' })
    try {
      const queryParts: string[] = []
      if (this.data.districtFilter) queryParts.push(`district=${encodeURIComponent(this.data.districtFilter)}`)
      if (this.data.gradeFilter) queryParts.push(`grade=${encodeURIComponent(this.data.gradeFilter)}`)
      if (this.data.sortFilter) queryParts.push(`sort=${encodeURIComponent(this.data.sortFilter)}`)

      const res = await getBuildings(queryParts.join('&'))
      this.setData({
        state: 'ready',
        items: [...res.items],
        inactiveItems: [...res.inactiveItems],
        totalDocs: res.pagination.totalDocs,
        totalActiveCount: res.totalActiveCount,
        totalInactiveCount: res.totalInactiveCount,
      })
    } catch {
      this.setData({ state: 'error' })
    }
  },

  handleDistrictFilter() {
    const districts = ['全部', '黄浦区', '静安区', '浦东新区', '长宁区', '徐汇区']
    wx.showActionSheet({
      itemList: districts,
      success: (res) => {
        const selected = res.tapIndex === 0 ? '' : districts[res.tapIndex] ?? ''
        this.setData({ districtFilter: selected })
        this.loadBuildings()
      },
    })
  },

  handleGradeFilter() {
    const grades = ['全部', '甲级', '乙级']
    wx.showActionSheet({
      itemList: grades,
      success: (res) => {
        const gradeMap: Record<number, string> = { 0: '', 1: 'A', 2: 'B' }
        this.setData({ gradeFilter: gradeMap[res.tapIndex] ?? '' })
        this.loadBuildings()
      },
    })
  },

  handleSortFilter() {
    const sortKeys = ['', 'stock-desc', 'completion-desc', 'grade']
    const sortLabels = ['综合排序', '在租最多', '最新竣工', '等级最高']
    wx.showActionSheet({
      itemList: sortLabels,
      success: (res) => {
        const key = sortKeys[res.tapIndex] ?? ''
        this.setData({
          sortFilter: key,
          sortLabel: SORTS[key] || '综合排序',
        })
        this.loadBuildings()
      },
    })
  },

  handleResetFilters() {
    this.setData({
      districtFilter: '',
      gradeFilter: '',
      sortFilter: '',
      sortLabel: '综合排序',
    })
    this.loadBuildings()
  },

  handleBuildingOpen(event: WechatMiniprogram.CustomEvent<{ slug: string }>) {
    const slug = event.detail.slug
    if (!slug) return
    wx.navigateTo({
      url: `/pages/building-detail/index?slug=${encodeURIComponent(slug)}`,
    })
  },

  handleBuildingInquiry(event: WechatMiniprogram.CustomEvent<{ slug: string; name: string }>) {
    wx.showToast({
      title: `已记录${event.detail.name || '楼盘'}关注`,
      icon: 'success',
    })
  },
})
