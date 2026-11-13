import { getArticles } from '../../services/catalog.js'
import type { MiniArticleItem } from '../../services/catalog-contracts.js'

const CATEGORIES = [
  { label: '全部', value: '' },
  { label: '市场洞察', value: 'market' },
  { label: '选址指南', value: 'guide' },
  { label: '楼盘解读', value: 'building' },
  { label: '行业资讯', value: 'industry' },
] as const

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    items: [] as readonly MiniArticleItem[],
    activeCategory: '',
    categories: CATEGORIES as unknown as Array<{ label: string; value: string }>,
    page: 1,
    hasNextPage: false,
    loadMoreState: 'idle' as 'idle' | 'loading' | 'error' | 'end',
  },

  async onLoad() {
    await this.requestArticles(1, false)
  },

  async onPullDownRefresh() {
    try {
      await this.requestArticles(1, false)
    } finally {
      wx.stopPullDownRefresh()
    }
  },

  async onReachBottom() {
    if (!this.data.hasNextPage || this.data.loadMoreState === 'loading') {
      return
    }
    await this.requestArticles(this.data.page + 1, true)
  },

  async handleCategoryTap(e: { currentTarget: { dataset: { value?: string } } }) {
    const value = e.currentTarget.dataset.value ?? ''
    if (value === this.data.activeCategory && this.data.state === 'ready') {
      return
    }
    this.setData({
      activeCategory: value,
      page: 1,
      items: [],
      state: 'loading',
      loadMoreState: 'idle',
    })
    await this.requestArticles(1, false)
  },

  async handleRetry() {
    this.setData({ state: 'loading' })
    await this.requestArticles(1, false)
  },

  handleArticleTap(e: { currentTarget: { dataset: { slug?: string } } }) {
    const slug = e.currentTarget.dataset.slug
    if (!slug) return
    wx.navigateTo({
      url: `/pages/news-detail/index?slug=${encodeURIComponent(slug)}`,
    })
  },

  async requestArticles(page: number, append: boolean) {
    if (append) {
      this.setData({ loadMoreState: 'loading' })
    }

    try {
      const res = await getArticles({
        page,
        pageSize: 10,
        category: this.data.activeCategory,
      })

      const newItems = append ? [...this.data.items, ...res.items] : res.items
      const hasNextPage = Boolean(res.pagination.hasNextPage)

      this.setData({
        state: 'ready',
        items: newItems,
        page: res.pagination.page,
        hasNextPage,
        loadMoreState: hasNextPage ? 'idle' : (newItems.length > 0 ? 'end' : 'idle'),
      })
    } catch (err) {
      if (append) {
        this.setData({ loadMoreState: 'error' })
      } else {
        this.setData({ state: 'error' })
      }
    }
  },
})
