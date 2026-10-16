import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ getCachedPublishedArticles: vi.fn() }))

vi.mock('@/lib/frontend/cached-queries', () => ({
  getCachedPublishedArticles: state.getCachedPublishedArticles,
}))
vi.mock('@/components/frontend/ArticleCard', () => ({ default: () => null }))
vi.mock('@/components/frontend/Pagination', () => ({ default: () => null }))

import { generateMetadata } from '@/app/(frontend)/news/page'

describe('/news 空列表', () => {
  beforeEach(() => vi.clearAllMocks())

  it('没有已发布资讯时 noindex（空页是薄内容，不该被收录）', async () => {
    state.getCachedPublishedArticles.mockResolvedValue({ docs: [], totalDocs: 0, page: 1, totalPages: 1 })
    const metadata = await generateMetadata({ searchParams: Promise.resolve({}) })
    expect(metadata.robots).toMatchObject({ index: false })
  })

  it('有已发布资讯时正常收录', async () => {
    state.getCachedPublishedArticles.mockResolvedValue({ docs: [], totalDocs: 3, page: 1, totalPages: 1 })
    const metadata = await generateMetadata({ searchParams: Promise.resolve({}) })
    expect(metadata.robots).toMatchObject({ index: true })
  })
})
