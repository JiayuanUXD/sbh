import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MiniArticleDetailData } from '../miniprogram/services/catalog-contracts.js'

const projectRoot = resolve(import.meta.dirname, '..')
const pageRoot = resolve(projectRoot, 'miniprogram/pages/news-detail')

function readPageFile(filename: string): string {
  return readFileSync(resolve(pageRoot, filename), 'utf8')
}

const getArticleDetail = vi.hoisted(() => vi.fn<(slug: string) => Promise<MiniArticleDetailData>>())

vi.mock('../miniprogram/services/catalog.js', () => ({
  getArticleDetail,
}))

const mockDetail: MiniArticleDetailData = {
  id: 'art-1',
  slug: 'beiwaitan-office-guide',
  title: '北外滩写字楼选址指南',
  category: 'guide',
  categoryLabel: '选址指南',
  publishedAt: '2026-10-25T08:00:00.000Z',
  publishedDateFormatted: '2026-10-25',
  coverImage: {
    src: 'https://example.com/cover.jpg',
    alt: '北外滩封面',
  },
  excerpt: '北外滩作为上海新一代商务核心区...',
  contentHtml: '<p class="mini-rich-p">北外滩核心商务区分析...</p>',
  relatedBuildings: [
    {
      id: 'b-1',
      name: '白玉兰广场',
      slug: 'baiyulan-guangchang',
      district: '虹口区',
      priceText: '7.5-11.0 元/㎡/天',
      coverImage: {
        src: 'https://example.com/b1.jpg',
        alt: '白玉兰广场',
      },
    },
  ],
}

type Registration = Record<string, (this: Context, ...args: any[]) => any> & {
  data: Context['data']
}

type Context = {
  data: {
    state: 'loading' | 'ready' | 'error'
    slug: string
    article: MiniArticleDetailData | null
  }
  setData(update: Record<string, unknown>): void
  onLoad(options?: { slug?: string }): Promise<void>
  loadDetail(slug: string): Promise<void>
  handleRetry(): Promise<void>
  handleBuildingTap(e: { currentTarget: { dataset: { slug?: string } } }): void
  onShareAppMessage(): { title: string; path: string; imageUrl?: string }
  onShareTimeline(): { title: string; query?: string; imageUrl?: string }
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
    if (typeof value === 'function') {
      (ctx as any)[key] = value.bind(ctx)
    }
  }

  return ctx
}

describe('资讯详情页合同与行为测试 (News Detail Page)', () => {
  beforeAll(async () => {
    vi.stubGlobal('wx', {
      navigateTo: vi.fn(),
      showToast: vi.fn(),
    })
    vi.stubGlobal('Page', (value: Registration) => {
      registration = value
    })
    await import('../miniprogram/pages/news-detail/index.js')
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  beforeEach(() => {
    getArticleDetail.mockReset()
  })

  describe('静态页面合同', () => {
    it('index.json 注册页面导航标题与基础组件', () => {
      const config = JSON.parse(readPageFile('index.json')) as Record<string, unknown>
      expect(config).toMatchObject({
        navigationBarTitleText: '资讯详情',
        usingComponents: {
          'sbh-skeleton': '../../components/sbh-skeleton/index',
          'sbh-state': '../../components/sbh-state/index',
        },
      })
    })

    it('index.wxml 包含富文本、关联楼盘、封面图及状态组件', () => {
      const template = readPageFile('index.wxml')
      expect(template).toContain('news-detail__content')
      expect(template).toContain('rich-text')
      expect(template).toContain('news-detail__related')
      expect(template).toContain('bindtap="handleBuildingTap"')
      expect(template).toContain('news-detail__title')
      expect(template).toContain('news-detail__badge')
      expect(template).toContain('news-detail__date')
      expect(template).toContain('sbh-skeleton')
      expect(template).toContain('sbh-state')
    })
  })

  describe('页面交互与加载行为', () => {
    it('缺少 slug 或非法 slug 直接进入 error 态', async () => {
      const page = createContext()
      await page.onLoad({})
      expect(page.data.state).toBe('error')

      const page2 = createContext()
      await page2.onLoad({ slug: 'INVALID_SLUG!!' })
      expect(page2.data.state).toBe('error')
    })

    it('合法 slug 成功加载并渲染详情与关联楼盘', async () => {
      getArticleDetail.mockResolvedValueOnce(mockDetail)
      const page = createContext()

      await page.onLoad({ slug: 'beiwaitan-office-guide' })

      expect(getArticleDetail).toHaveBeenCalledWith('beiwaitan-office-guide')
      expect(page.data.state).toBe('ready')
      expect(page.data.article).toEqual(mockDetail)
    })

    it('加载失败时进入 error 态并支持重试', async () => {
      getArticleDetail.mockRejectedValueOnce(new Error('404 Not Found'))
      const page = createContext()
      await page.onLoad({ slug: 'beiwaitan-office-guide' })
      expect(page.data.state).toBe('error')

      getArticleDetail.mockResolvedValueOnce(mockDetail)
      await page.handleRetry()
      expect(page.data.state).toBe('ready')
      expect(page.data.article?.title).toBe('北外滩写字楼选址指南')
    })

    it('点击关联楼盘跳转楼盘详情页', () => {
      const page = createContext()
      page.handleBuildingTap({ currentTarget: { dataset: { slug: 'baiyulan-guangchang' } } })

      expect(wx.navigateTo).toHaveBeenCalledWith({
        url: '/pages/building-detail/index?slug=baiyulan-guangchang',
      })
    })

    it('分享钩子 onShareAppMessage 与 onShareTimeline 组装正确参数', () => {
      const page = createContext()
      page.data.article = mockDetail

      const shareApp = page.onShareAppMessage()
      expect(shareApp.title).toBe('北外滩写字楼选址指南')
      expect(shareApp.path).toBe('/pages/news-detail/index?slug=beiwaitan-office-guide')
      expect(shareApp.imageUrl).toBe('https://example.com/cover.jpg')

      const shareTimeline = page.onShareTimeline()
      expect(shareTimeline.title).toBe('北外滩写字楼选址指南')
      expect(shareTimeline.query).toBe('slug=beiwaitan-office-guide')
      expect(shareTimeline.imageUrl).toBe('https://example.com/cover.jpg')
    })
  })
})
