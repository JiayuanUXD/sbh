import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MiniArticlesData } from '../miniprogram/services/catalog-contracts.js'

const projectRoot = resolve(import.meta.dirname, '..')
const pageRoot = resolve(projectRoot, 'miniprogram/pages/news')

function readPageFile(filename: string): string {
  return readFileSync(resolve(pageRoot, filename), 'utf8')
}

const getArticles = vi.hoisted(() => vi.fn<(query?: unknown) => Promise<MiniArticlesData>>())

vi.mock('../miniprogram/services/catalog.js', () => ({
  getArticles,
}))

const mockPage1: MiniArticlesData = {
  items: [
    {
      id: 'art-1',
      slug: 'beiwaitan-office-guide',
      title: '北外滩写字楼选址指南',
      category: 'guide',
      categoryLabel: '选址指南',
      publishedAt: '2026-10-25T08:00:00.000Z',
      publishedDateFormatted: '2026-10-25',
      coverImage: {
        src: 'https://example.com/cover1.jpg',
        alt: '北外滩封面',
      },
      excerpt: '北外滩作为上海新一代商务核心区...',
    },
  ],
  pagination: {
    page: 1,
    pageSize: 10,
    totalDocs: 2,
    totalPages: 2,
    hasNextPage: true,
  },
}

const mockPage2: MiniArticlesData = {
  items: [
    {
      id: 'art-2',
      slug: 'lujiazui-rent-trends',
      title: '陆家嘴写字楼最新租金趋势',
      category: 'market',
      categoryLabel: '市场洞察',
      publishedAt: '2026-10-26T08:00:00.000Z',
      publishedDateFormatted: '2026-10-26',
      coverImage: null,
      excerpt: '三季度陆家嘴甲级写字楼租金...',
    },
  ],
  pagination: {
    page: 2,
    pageSize: 10,
    totalDocs: 2,
    totalPages: 2,
    hasNextPage: false,
  },
}

type Registration = Record<string, (this: Context, ...args: any[]) => any> & {
  data: Context['data']
}

type Context = {
  data: {
    state: 'loading' | 'ready' | 'error'
    items: MiniArticlesData['items']
    activeCategory: string
    categories: Array<{ label: string; value: string }>
    page: number
    hasNextPage: boolean
    loadMoreState: 'idle' | 'loading' | 'error' | 'end'
  }
  setData(update: Record<string, unknown>): void
  onLoad(): Promise<void>
  onPullDownRefresh(): Promise<void>
  onReachBottom(): Promise<void>
  handleCategoryTap(e: { currentTarget: { dataset: { value: string } } }): Promise<void>
  handleRetry(): Promise<void>
  handleArticleTap(e: { currentTarget: { dataset: { slug: string } } }): void
  requestArticles(page: number, append: boolean): Promise<void>
}

let registration: Registration

function createContext(): Context {
  const data = structuredClone(registration.data) as Context['data']
  const ctx = {
    data,
    setData(update: Record<string, unknown>) {
      Object.assign(data, update)
    },
  } as Context

  for (const [key, value] of Object.entries(registration)) {
    if (key === 'data') continue
    if (typeof value === 'function') {
      (ctx as any)[key] = value.bind(ctx)
    } else {
      (ctx as any)[key] = structuredClone(value)
    }
  }

  return ctx
}

describe('资讯列表页合同与行为测试 (News Page)', () => {
  beforeAll(async () => {
    vi.stubGlobal('wx', {
      stopPullDownRefresh: vi.fn(),
      navigateTo: vi.fn(),
    })
    vi.stubGlobal('Page', (value: Registration) => {
      registration = value
    })
    await import('../miniprogram/pages/news/index.js')
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  beforeEach(() => {
    getArticles.mockReset()
  })

  describe('静态页面合同', () => {
    it('index.json 注册页面配置与基础组件', () => {
      const config = JSON.parse(readPageFile('index.json')) as Record<string, unknown>
      expect(config).toMatchObject({
        navigationBarTitleText: '资讯',
        enablePullDownRefresh: true,
        usingComponents: {
          'sbh-skeleton': '../../components/sbh-skeleton/index',
          'sbh-state': '../../components/sbh-state/index',
        },
      })
    })

    it('index.wxml 包含分类栏、卡片流与状态绑定', () => {
      const template = readPageFile('index.wxml')
      expect(template).toContain('news-category-bar')
      expect(template).toContain('news-category-tab')
      expect(template).toContain('bindtap="handleCategoryTap"')
      expect(template).toContain('news-card')
      expect(template).toContain('bindtap="handleArticleTap"')
      expect(template).toContain('data-slug=')
      expect(template).toContain('sbh-skeleton')
      expect(template).toContain('sbh-state')
    })
  })

  describe('页面交互与分页行为', () => {
    it('onLoad 成功拉取第 1 页并转入 ready 态', async () => {
      getArticles.mockResolvedValueOnce(mockPage1)
      const page = createContext()

      await page.onLoad()

      expect(getArticles).toHaveBeenCalledWith({ page: 1, pageSize: 10, category: '' })
      expect(page.data.state).toBe('ready')
      expect(page.data.items).toHaveLength(1)
      expect(page.data.items[0].slug).toBe('beiwaitan-office-guide')
      expect(page.data.hasNextPage).toBe(true)
    })

    it('切换分类重置页码并过滤拉取', async () => {
      getArticles.mockResolvedValueOnce(mockPage1)
      const page = createContext()
      await page.onLoad()

      getArticles.mockResolvedValueOnce({
        items: [mockPage2.items[0]],
        pagination: { page: 1, pageSize: 10, totalDocs: 1, totalPages: 1, hasNextPage: false },
      })

      await page.handleCategoryTap({ currentTarget: { dataset: { value: 'market' } } })

      expect(page.data.activeCategory).toBe('market')
      expect(page.data.page).toBe(1)
      expect(getArticles).toHaveBeenLastCalledWith({ page: 1, pageSize: 10, category: 'market' })
      expect(page.data.items[0].slug).toBe('lujiazui-rent-trends')
    })

    it('触底事件 onReachBottom 在有下页时追加数据', async () => {
      getArticles.mockResolvedValueOnce(mockPage1)
      const page = createContext()
      await page.onLoad()

      getArticles.mockResolvedValueOnce(mockPage2)
      await page.onReachBottom()

      expect(getArticles).toHaveBeenLastCalledWith({ page: 2, pageSize: 10, category: '' })
      expect(page.data.items).toHaveLength(2)
      expect(page.data.page).toBe(2)
      expect(page.data.hasNextPage).toBe(false)
      expect(page.data.loadMoreState).toBe('end')
    })

    it('下拉刷新 onPullDownRefresh 重拉第 1 页并停止动画', async () => {
      getArticles.mockResolvedValueOnce(mockPage1)
      const page = createContext()
      await page.onLoad()

      getArticles.mockResolvedValueOnce(mockPage1)
      await page.onPullDownRefresh()

      expect(getArticles).toHaveBeenCalledTimes(2)
      expect(wx.stopPullDownRefresh).toHaveBeenCalled()
    })

    it('点击卡片调用 wx.navigateTo 并携带 slug', () => {
      const page = createContext()
      page.handleArticleTap({ currentTarget: { dataset: { slug: 'beiwaitan-office-guide' } } })

      expect(wx.navigateTo).toHaveBeenCalledWith({
        url: '/pages/news-detail/index?slug=beiwaitan-office-guide',
      })
    })

    it('请求失败时转入 error 态', async () => {
      getArticles.mockRejectedValueOnce(new Error('Network error'))
      const page = createContext()

      await page.onLoad()

      expect(page.data.state).toBe('error')
    })

    it('连续切换分类时丢弃晚返回的过期分类请求', async () => {
      let resolveMarket!: (value: MiniArticlesData) => void
      const marketPromise = new Promise<MiniArticlesData>((resolve) => {
        resolveMarket = resolve
      })

      getArticles.mockReturnValueOnce(marketPromise)
      const page = createContext()

      // 先切换到 market（慢请求，尚未返回）
      const pendingMarketTap = page.handleCategoryTap({ currentTarget: { dataset: { value: 'market' } } })

      // 立即再切换到 guide（快请求，先返回）
      getArticles.mockResolvedValueOnce(mockPage1)
      await page.handleCategoryTap({ currentTarget: { dataset: { value: 'guide' } } })

      expect(page.data.activeCategory).toBe('guide')
      expect(page.data.items[0].slug).toBe('beiwaitan-office-guide')

      // 随后慢请求 market 才返回，应被丢弃，不覆盖当前 guide 的列表
      resolveMarket({
        items: [mockPage2.items[0]],
        pagination: { page: 1, pageSize: 10, totalDocs: 1, totalPages: 1, hasNextPage: false },
      })
      await pendingMarketTap

      expect(page.data.activeCategory).toBe('guide')
      expect(page.data.items).toHaveLength(1)
      expect(page.data.items[0].slug).toBe('beiwaitan-office-guide')
    })

    it('分页加载进行中切换分类，旧分类的分页结果不会追加到新分类列表', async () => {
      getArticles.mockResolvedValueOnce(mockPage1)
      const page = createContext()
      await page.onLoad()

      let resolvePage2!: (value: MiniArticlesData) => void
      const page2Promise = new Promise<MiniArticlesData>((resolve) => {
        resolvePage2 = resolve
      })
      getArticles.mockReturnValueOnce(page2Promise)

      // 发起旧分类第 2 页加载（未完成）
      const pendingReachBottom = page.onReachBottom()

      // 此时切换到 market 分类并完成第 1 页加载
      getArticles.mockResolvedValueOnce({
        items: [mockPage2.items[0]],
        pagination: { page: 1, pageSize: 10, totalDocs: 1, totalPages: 1, hasNextPage: false },
      })
      await page.handleCategoryTap({ currentTarget: { dataset: { value: 'market' } } })

      // 旧分类第 2 页晚返回，不应追加或篡改页码
      resolvePage2(mockPage2)
      await pendingReachBottom

      expect(page.data.activeCategory).toBe('market')
      expect(page.data.page).toBe(1)
      expect(page.data.items).toHaveLength(1)
      expect(page.data.items[0].slug).toBe('lujiazui-rent-trends')
    })
  })
})
