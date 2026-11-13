import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  payloadFind: vi.fn(),
  getSiteConfig: vi.fn(),
}))

vi.mock('payload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('payload')>()
  return {
    ...actual,
    getPayload: vi.fn(async () => ({
      find: io.payloadFind,
    })),
  }
})

vi.mock('@/lib/frontend/site-config', () => ({
  getSiteConfig: io.getSiteConfig,
}))

import {
  formatDateFormatted,
  getMiniArticleDetail,
  getMiniArticles,
  SAFE_SLUG_PATTERN,
  toMiniImage,
} from '@/lib/mini-program/article-service'

describe('article-service 测试', () => {
  beforeEach(() => {
    io.payloadFind.mockReset()
    io.getSiteConfig.mockReturnValue({
      siteOrigin: 'https://example.com',
    })
  })

  describe('基础工具函数', () => {
    it('SAFE_SLUG_PATTERN 正确校验 slug', () => {
      expect(SAFE_SLUG_PATTERN.test('hello-world-123')).toBe(true)
      expect(SAFE_SLUG_PATTERN.test('beijing-cbd')).toBe(true)
      expect(SAFE_SLUG_PATTERN.test('invalid_slug')).toBe(false)
      expect(SAFE_SLUG_PATTERN.test('UPPERCASE')).toBe(false)
      expect(SAFE_SLUG_PATTERN.test('-leading-dash')).toBe(false)
      expect(SAFE_SLUG_PATTERN.test('trailing-dash-')).toBe(false)
    })

    it('formatDateFormatted 格式化 ISO 日期', () => {
      expect(formatDateFormatted('2026-10-25T08:00:00.000Z')).toBe('2026-10-25')
      expect(formatDateFormatted(null)).toBe('')
      expect(formatDateFormatted('invalid-date')).toBe('')
    })

    it('toMiniImage 正确将媒体对象转换为 MiniImage', () => {
      expect(toMiniImage(null, 'https://example.com', '默认')).toBeNull()
      expect(
        toMiniImage(
          { url: '/media/test.jpg', alt: '测试图', width: 800, height: 600 },
          'https://example.com',
          '默认',
        ),
      ).toEqual({
        src: 'https://example.com/media/test.jpg',
        alt: '测试图',
        width: 800,
        height: 600,
      })
      // 绝对 URL 保持不变
      expect(
        toMiniImage(
          { url: 'https://cdn.example.com/test.jpg', alt: '' },
          'https://example.com',
          '回退标题',
        ),
      ).toEqual({
        src: 'https://cdn.example.com/test.jpg',
        alt: '回退标题',
        width: undefined,
        height: undefined,
      })
    })
  })

  describe('getMiniArticles', () => {
    it('正确解析分页与参数并映射返回', async () => {
      io.payloadFind.mockResolvedValueOnce({
        docs: [
          {
            id: 'doc-1',
            slug: 'test-article',
            title: '测试资讯',
            category: 'market',
            publishedAt: '2026-11-01T10:00:00.000Z',
            coverImage: { url: '/media/c.jpg' },
            excerpt: '摘要内容',
          },
        ],
        page: 1,
        limit: 10,
        totalDocs: 1,
        totalPages: 1,
        hasNextPage: false,
      })

      const url = new URL('https://example.com/api/mini/v1/articles?page=1&pageSize=10&category=market')
      const snapshot = await getMiniArticles(url)

      expect(io.payloadFind).toHaveBeenCalledWith(
        expect.objectContaining({
          collection: 'articles',
          page: 1,
          limit: 10,
          where: expect.objectContaining({
            status: { equals: 'published' },
            category: { equals: 'market' },
          }),
        }),
      )

      expect(snapshot.data.items).toHaveLength(1)
      expect(snapshot.data.items[0]).toEqual({
        id: 'doc-1',
        slug: 'test-article',
        title: '测试资讯',
        category: 'market',
        categoryLabel: '市场洞察',
        publishedAt: '2026-11-01T10:00:00.000Z',
        publishedDateFormatted: '2026-11-01',
        coverImage: {
          src: 'https://example.com/media/c.jpg',
          alt: '测试资讯',
          width: undefined,
          height: undefined,
        },
        excerpt: '摘要内容',
      })
      expect(snapshot.data.pagination).toEqual({
        page: 1,
        pageSize: 10,
        totalDocs: 1,
        totalPages: 1,
        hasNextPage: false,
      })
    })
  })

  describe('getMiniArticleDetail', () => {
    it('非法 slug 直接返回 article_not_found，不访问数据库', async () => {
      const res = await getMiniArticleDetail('ILLEGAL_SLUG')
      expect(res.status).toBe('article_not_found')
      expect(io.payloadFind).not.toHaveBeenCalled()
    })

    it('文章不存在时返回 article_not_found', async () => {
      io.payloadFind.mockResolvedValueOnce({ docs: [] })
      const res = await getMiniArticleDetail('non-existent-article')
      expect(res.status).toBe('article_not_found')
    })

    it('合法文章返回详情、序列化富文本与关联楼盘', async () => {
      io.payloadFind.mockResolvedValueOnce({
        docs: [
          {
            id: 'doc-100',
            slug: 'shanghai-tower-guide',
            title: '上海中心大厦入驻指南',
            category: 'guide',
            publishedAt: '2026-10-30T12:00:00.000Z',
            coverImage: { url: '/media/tower.jpg' },
            excerpt: '上海第一高楼...',
            content: {
              root: {
                children: [
                  {
                    type: 'paragraph',
                    children: [{ type: 'text', text: '正文第一段' }],
                  },
                ],
              },
            },
            relatedBuildings: [
              {
                id: 501,
                name: '上海中心大厦',
                slug: 'shanghai-tower',
                district: { name: '浦东新区' },
                priceRange: { text: '12-18 元/㎡·天' },
                coverImage: { url: '/media/b501.jpg' },
              },
            ],
          },
        ],
      })

      const res = await getMiniArticleDetail('shanghai-tower-guide')
      expect(res.status).toBe('ok')
      if (res.status === 'ok') {
        expect(res.snapshot.data.title).toBe('上海中心大厦入驻指南')
        expect(res.snapshot.data.categoryLabel).toBe('选址指南')
        expect(res.snapshot.data.contentHtml).toContain('<p class="mini-rich-p">正文第一段</p>')
        expect(res.snapshot.data.relatedBuildings).toEqual([
          {
            id: '501',
            name: '上海中心大厦',
            slug: 'shanghai-tower',
            district: '浦东新区',
            priceText: '12-18 元/㎡·天',
            coverImage: {
              src: 'https://example.com/media/b501.jpg',
              alt: '上海中心大厦',
              width: undefined,
              height: undefined,
            },
          },
        ])
      }
    })
  })
})
