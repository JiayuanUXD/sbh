import { getArticleDetail } from '../../services/catalog.js'
import type { MiniArticleDetailData } from '../../services/catalog-contracts.js'

const SAFE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    slug: '',
    article: null as MiniArticleDetailData | null,
  },

  async onLoad(options?: { slug?: string }) {
    const rawSlug = options?.slug ?? ''
    if (!rawSlug || !SAFE_SLUG_PATTERN.test(rawSlug)) {
      this.setData({ state: 'error' })
      return
    }
    this.setData({ slug: rawSlug })
    await this.loadDetail(rawSlug)
  },

  async handleRetry() {
    if (!this.data.slug || !SAFE_SLUG_PATTERN.test(this.data.slug)) {
      this.setData({ state: 'error' })
      return
    }
    this.setData({ state: 'loading' })
    await this.loadDetail(this.data.slug)
  },

  async loadDetail(slug: string) {
    try {
      const article = await getArticleDetail(slug)
      this.setData({
        state: 'ready',
        article,
      })
    } catch {
      this.setData({
        state: 'error',
      })
    }
  },

  handleBuildingTap(e: { currentTarget: { dataset: { slug?: string } } }) {
    const slug = e.currentTarget.dataset.slug
    if (!slug) return
    wx.navigateTo({
      url: `/pages/building-detail/index?slug=${encodeURIComponent(slug)}`,
    })
  },

  onShareAppMessage() {
    const article = this.data.article
    if (!article) {
      return {
        title: '尚办好资讯',
        path: '/pages/news/index',
      }
    }
    return {
      title: article.title,
      path: `/pages/news-detail/index?slug=${encodeURIComponent(article.slug)}`,
      imageUrl: article.coverImage?.src,
    }
  },

  onShareTimeline() {
    const article = this.data.article
    if (!article) {
      return {
        title: '尚办好资讯',
      }
    }
    return {
      title: article.title,
      query: `slug=${encodeURIComponent(article.slug)}`,
      imageUrl: article.coverImage?.src,
    }
  },
})
