import { describe, expect, it } from 'vitest'

import {
  parseMiniArticleDetailData,
  parseMiniArticlesData,
  type MiniArticlesQuery,
} from '../miniprogram/services/catalog-contracts.js'
import { createCatalogService, type MiniRequestClient } from '../miniprogram/services/catalog.js'
import type { RequestOptions } from '../miniprogram/services/request.js'

function createRecordingRequestClient() {
  const calls: Array<Readonly<{ path: string; parse: unknown }>> = []
  const request: MiniRequestClient = <T>(options: RequestOptions<T>): Promise<T> => {
    calls.push({ path: options.path, parse: options.parse })
    return new Promise<T>(() => {})
  }
  return { calls, request }
}

const mockArticleItem = {
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
}

const mockArticlesData = {
  items: [mockArticleItem],
  pagination: {
    page: 1,
    pageSize: 10,
    totalDocs: 1,
    totalPages: 1,
    hasNextPage: false,
  },
}

const mockArticleDetailData = {
  ...mockArticleItem,
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

describe('资讯服务层 (News Service)', () => {
  describe('catalog.getArticles', () => {
    it('不传参时请求默认路径 /api/mini/v1/articles', async () => {
      const { calls, request } = createRecordingRequestClient()
      const catalog = createCatalogService(request)

      void catalog.getArticles()

      expect(calls).toEqual([
        {
          path: '/api/mini/v1/articles',
          parse: parseMiniArticlesData,
        },
      ])
    })

    it('传入 query 参数时正确拼接 page, pageSize 与 category', async () => {
      const { calls, request } = createRecordingRequestClient()
      const catalog = createCatalogService(request)

      const query: MiniArticlesQuery = {
        page: 2,
        pageSize: 10,
        category: 'guide',
      }
      void catalog.getArticles(query)

      expect(calls[0].path).toBe('/api/mini/v1/articles?page=2&pageSize=10&category=guide')
      expect(calls[0].parse).toBe(parseMiniArticlesData)
    })

    it('parseMiniArticlesData 解析合法数据并 fail-closed 拦截非法结构', () => {
      const parsed = parseMiniArticlesData(mockArticlesData)
      expect(parsed.items).toHaveLength(1)
      expect(parsed.items[0].slug).toBe('beiwaitan-office-guide')
      expect(parsed.pagination.totalDocs).toBe(1)

      // 非法数据应抛出异常（fail-closed）
      expect(() => parseMiniArticlesData(null)).toThrow()
      expect(() => parseMiniArticlesData({})).toThrow()
      expect(() => parseMiniArticlesData({ items: 'not-array', pagination: {} })).toThrow()
    })
  })

  describe('catalog.getArticleDetail', () => {
    it('拒绝非法 slug 并抛出 TypeError', async () => {
      const { request } = createRecordingRequestClient()
      const catalog = createCatalogService(request)

      expect(() => catalog.getArticleDetail('INVALID_SLUG!!')).toThrow(TypeError)
      expect(() => catalog.getArticleDetail('-invalid')).toThrow(TypeError)
      expect(() => catalog.getArticleDetail('invalid-')).toThrow(TypeError)
    })

    it('合法 slug 构造正确请求路径', async () => {
      const { calls, request } = createRecordingRequestClient()
      const catalog = createCatalogService(request)

      void catalog.getArticleDetail('beiwaitan-office-guide')

      expect(calls).toHaveLength(1)
      expect(calls[0].path).toBe('/api/mini/v1/articles/beiwaitan-office-guide')
    })

    it('parseMiniArticleDetailData 解析详情且在 slug 不一致时抛错', () => {
      const parsed = parseMiniArticleDetailData(mockArticleDetailData, 'beiwaitan-office-guide')
      expect(parsed.title).toBe('北外滩写字楼选址指南')
      expect(parsed.contentHtml).toBe('<p class="mini-rich-p">正文内容</p>')
      expect(parsed.relatedBuildings).toHaveLength(1)
      expect(parsed.relatedBuildings[0].slug).toBe('baiyulan-guangchang')

      // slug 不一致应抛错
      expect(() => parseMiniArticleDetailData(mockArticleDetailData, 'different-slug')).toThrow()
    })
  })
})
