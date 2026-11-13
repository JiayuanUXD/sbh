import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getMiniArticlesMock, getMiniArticleDetailMock } = vi.hoisted(() => ({
  getMiniArticlesMock: vi.fn(),
  getMiniArticleDetailMock: vi.fn(),
}))

vi.mock('@/lib/mini-program/catalog-service', () => ({
  getMiniArticles: getMiniArticlesMock,
  getMiniArticleDetail: getMiniArticleDetailMock,
}))

import { GET as getArticlesRoute } from '../src/app/api/mini/v1/articles/route'
import { GET as getArticleDetailRoute } from '../src/app/api/mini/v1/articles/[slug]/route'

const MOCK_ARTICLE_LIST = {
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
        src: 'https://example.com/cover.jpg',
        alt: '北外滩封面',
      },
      excerpt: '北外滩作为上海新一代商务核心区...',
    },
  ],
  pagination: {
    page: 1,
    pageSize: 5,
    totalDocs: 1,
    totalPages: 1,
    hasNextPage: false,
  },
}

const MOCK_ARTICLE_DETAIL = {
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
  contentHtml: '<p class="mini-rich-p">正文内容</p>',
  relatedBuildings: [
    {
      id: 'b-1',
      name: '白玉兰广场',
      slug: 'baiyulan-guangchang',
      district: '虹口区',
      priceText: '7.5-11.0 元/㎡/天',
      coverImage: {
        src: 'https://example.com/building.jpg',
        alt: '白玉兰广场',
      },
    },
  ],
}

describe('Mini API 资讯端点测试', () => {
  beforeEach(() => {
    getMiniArticlesMock.mockReset()
    getMiniArticleDetailMock.mockReset()
  })

  it('GET /api/mini/v1/articles 返回标准结构与分页', async () => {
    getMiniArticlesMock.mockImplementation(async (url: URL) => {
      const page = parseInt(url.searchParams.get('page') || '1', 10)
      const pageSize = parseInt(url.searchParams.get('pageSize') || '10', 10)
      return {
        asOf: '2026-11-06T00:00:00.000Z',
        data: {
          items: MOCK_ARTICLE_LIST.items,
          pagination: {
            page,
            pageSize,
            totalDocs: 1,
            totalPages: 1,
            hasNextPage: false,
          },
        },
      }
    })

    const request = new Request('http://localhost:3717/api/mini/v1/articles?page=1&pageSize=5')
    const response = await getArticlesRoute(request)

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/)

    const json = await response.json()
    expect(json.ok).toBe(true)
    expect(json.data).toBeDefined()
    expect(Array.isArray(json.data.items)).toBe(true)
    expect(json.data.pagination).toMatchObject({
      page: 1,
      pageSize: 5,
    })
    expect(typeof json.data.pagination.totalDocs).toBe('number')
    expect(typeof json.data.pagination.totalPages).toBe('number')
    expect(typeof json.data.pagination.hasNextPage).toBe('boolean')

    if (json.data.items.length > 0) {
      const first = json.data.items[0]
      expect(first).toHaveProperty('id')
      expect(first).toHaveProperty('slug')
      expect(first).toHaveProperty('title')
      expect(first).toHaveProperty('category')
      expect(first).toHaveProperty('categoryLabel')
      expect(first).toHaveProperty('publishedAt')
      expect(first).toHaveProperty('publishedDateFormatted')
      expect(first).toHaveProperty('coverImage')
      expect(first).toHaveProperty('excerpt')
    }
  })

  it('GET /api/mini/v1/articles 支持分类过滤', async () => {
    getMiniArticlesMock.mockImplementation(async (url: URL) => {
      const category = url.searchParams.get('category')
      const items = MOCK_ARTICLE_LIST.items.filter((item) => item.category === category)
      return {
        asOf: '2026-11-06T00:00:00.000Z',
        data: {
          items,
          pagination: {
            page: 1,
            pageSize: 10,
            totalDocs: items.length,
            totalPages: 1,
            hasNextPage: false,
          },
        },
      }
    })

    const request = new Request('http://localhost:3717/api/mini/v1/articles?category=guide')
    const response = await getArticlesRoute(request)

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.ok).toBe(true)
    for (const item of json.data.items) {
      expect(item.category).toBe('guide')
      expect(item.categoryLabel).toBe('选址指南')
    }
  })

  it('GET /api/mini/v1/articles/[slug] 针对非法或不存在的 slug 返回 404', async () => {
    getMiniArticleDetailMock.mockImplementation(async (slug: string) => {
      if (slug === 'INVALID_SLUG!!' || slug === 'non-existent-article-slug') {
        return { status: 'article_not_found' }
      }
      return {
        status: 'ok',
        snapshot: {
          asOf: '2026-11-06T00:00:00.000Z',
          data: MOCK_ARTICLE_DETAIL,
        },
      }
    })

    // 非法 slug（含大写或非法符号）
    const badRequest = new Request('http://localhost:3717/api/mini/v1/articles/INVALID_SLUG!!')
    const badResponse = await getArticleDetailRoute(badRequest, {
      params: Promise.resolve({ slug: 'INVALID_SLUG!!' }),
    })
    expect(badResponse.status).toBe(404)
    expect(badResponse.headers.get('cache-control')).toBe('private, no-store')
    expect(badResponse.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/)
    const badJson = await badResponse.json()
    expect(badJson.ok).toBe(false)
    expect(badJson.error.code).toBe('article_not_found')

    // 不存在的 slug
    const notFoundRequest = new Request('http://localhost:3717/api/mini/v1/articles/non-existent-article-slug')
    const notFoundResponse = await getArticleDetailRoute(notFoundRequest, {
      params: Promise.resolve({ slug: 'non-existent-article-slug' }),
    })
    expect(notFoundResponse.status).toBe(404)
    const notFoundJson = await notFoundResponse.json()
    expect(notFoundJson.ok).toBe(false)
    expect(notFoundJson.error.code).toBe('article_not_found')
  })

  it('GET /api/mini/v1/articles/[slug] 针对合法文章返回 200 与正文和关联楼盘', async () => {
    getMiniArticleDetailMock.mockImplementation(async (slug: string) => {
      if (slug === 'beiwaitan-office-guide') {
        return {
          status: 'ok',
          snapshot: {
            asOf: '2026-11-06T00:00:00.000Z',
            data: MOCK_ARTICLE_DETAIL,
          },
        }
      }
      return { status: 'article_not_found' }
    })

    const request = new Request('http://localhost:3717/api/mini/v1/articles/beiwaitan-office-guide')
    const response = await getArticleDetailRoute(request, {
      params: Promise.resolve({ slug: 'beiwaitan-office-guide' }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    const json = await response.json()
    expect(json.ok).toBe(true)
    expect(json.data.slug).toBe('beiwaitan-office-guide')
    expect(json.data.contentHtml).toBe('<p class="mini-rich-p">正文内容</p>')
    expect(json.data.relatedBuildings).toHaveLength(1)
    expect(json.data.relatedBuildings[0]).toMatchObject({
      id: 'b-1',
      name: '白玉兰广场',
      slug: 'baiyulan-guangchang',
      district: '虹口区',
    })
  })
})
