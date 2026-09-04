import { getBuildings } from '../../services/catalog.js'
import type { MiniBuildingCard } from '../../services/catalog-contracts.js'

const BUILDING_GRADE_FILTERS = [
  { label: '全部', value: '' },
  { label: '甲级', value: 'grade-a' },
  { label: '超甲级', value: 'super-grade-a' },
  { label: '创意园区', value: 'creative-park' },
  { label: '服务式办公', value: 'serviced-office' },
] as const

const SORTS: Record<string, string> = {
  '': '在租最多',
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
    gradeFilterLabel: '等级',
    sortFilter: '',
    sortLabel: '在租最多',
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
    wx.showActionSheet({
      itemList: BUILDING_GRADE_FILTERS.map((grade) => grade.label),
      success: (res) => {
        const selected = BUILDING_GRADE_FILTERS[res.tapIndex] ?? BUILDING_GRADE_FILTERS[0]
        this.setData({
          gradeFilter: selected.value,
          gradeFilterLabel: selected.value ? selected.label : '等级',
        })
        this.loadBuildings()
      },
    })
  },

  handleSortFilter() {
    const sortKeys = ['', 'completion-desc', 'grade']
    const sortLabels = ['在租最多', '最新竣工', '等级最高']
    wx.showActionSheet({
      itemList: sortLabels,
      success: (res) => {
        const key = sortKeys[res.tapIndex] ?? ''
        this.setData({
          sortFilter: key,
          sortLabel: SORTS[key] || '在租最多',
        })
        this.loadBuildings()
      },
    })
  },

  handleResetFilters() {
    this.setData({
      districtFilter: '',
      gradeFilter: '',
      gradeFilterLabel: '等级',
      sortFilter: '',
      sortLabel: '在租最多',
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

})
