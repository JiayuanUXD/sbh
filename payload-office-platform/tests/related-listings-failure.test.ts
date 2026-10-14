import { afterEach, describe, expect, it, vi } from 'vitest'
import RelatedListings from '@/components/frontend/detail/RelatedListings'

// 2026-10-14 生产：推荐查询被 30s 语句超时掐断后，Promise reject 冒泡到页面级错误边界，
// 整个详情页被换成「This page couldn't load」。推荐是非关键区块，失败只隐去本段。
describe('详情页相关推荐区失败降级', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('推荐加载失败时整段不渲染并记录错误，不向页面抛出', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failure = new Error('canceling statement due to statement timeout')

    await expect(RelatedListings({ recommendations: Promise.reject(failure), listingId: 1 })).resolves.toBeNull()
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('[detail-recommendations]'), failure)
  })

  it('零条推荐仍返回 null 且不记错误', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(RelatedListings({ recommendations: Promise.resolve([]), listingId: 1 })).resolves.toBeNull()
    expect(logged).not.toHaveBeenCalled()
  })
})
