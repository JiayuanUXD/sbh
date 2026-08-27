import { afterEach, describe, expect, it, vi } from 'vitest'

import { parseListingQuery } from '../miniprogram/domain/listing-query.js'
import {
  createListingsController,
  type ListingsController,
  type ListingsSnapshot,
} from '../miniprogram/pages/listings/controller.js'
import type {
  MiniListingCard,
  MiniListingsData,
  MiniQuickFilter,
} from '../miniprogram/services/catalog-contracts.js'

function deferred<T>() {
  let resolvePromise: (value: T) => void = () => undefined
  let rejectPromise: (reason?: unknown) => void = () => undefined
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return { promise, resolve: resolvePromise, reject: rejectPromise }
}

function listing(id: string): MiniListingCard {
  return {
    id,
    slug: id,
    title: id,
    citySlug: 'shanghai',
    cityName: '上海',
    price: null,
    area: null,
    seats: null,
    listingType: { value: 'traditional-office', label: '传统办公' },
    availableFrom: null,
    building: null,
    coverImage: null,
    highlights: [],
  }
}

const filters: readonly MiniQuickFilter[] = [
  {
    id: 'district',
    label: '区域',
    options: [{ value: 'jingan', label: '静安区', count: 12 }],
  },
]

function listingsResult(
  ids: readonly string[],
  options: Readonly<{
    canonicalQuery?: string
    page?: number
    totalDocs?: number
    totalPages?: number
    hasNextPage?: boolean
  }> = {},
): MiniListingsData {
  const page = options.page ?? 1
  const totalDocs = options.totalDocs ?? ids.length
  const totalPages = options.totalPages ?? (totalDocs === 0 ? 0 : 1)
  return {
    items: ids.map(listing),
    pagination: {
      page,
      pageSize: 24,
      totalDocs,
      totalPages,
      hasNextPage: options.hasNextPage ?? page < totalPages,
      hasPrevPage: page > 1,
    },
    canonicalQuery: options.canonicalQuery ?? (page > 1 ? `page=${page}` : ''),
    currentPriceUnit: null,
    filters,
  }
}

function createSubject(
  getListings: (query: string) => Promise<MiniListingsData>,
  stopPullDownRefresh = vi.fn(),
) {
  const snapshots: ListingsSnapshot[] = []
  const controller = createListingsController({
    getListings,
    onChange(snapshot) {
      snapshots.push(snapshot)
    },
    stopPullDownRefresh,
  })
  return { controller, snapshots, stopPullDownRefresh }
}

async function loadInitial(
  controller: ListingsController,
  result = listingsResult(['initial']),
): Promise<void> {
  await controller.load(parseListingQuery(result.canonicalQuery))
}

afterEach(() => {
  vi.useRealTimers()
})

describe('房源列表控制器', () => {
  it('首载立即进入骨架态，成功后采用 API canonicalQuery 且安全忽略 city', async () => {
    const request = deferred<MiniListingsData>()
    const { controller } = createSubject(() => request.promise)

    const loading = controller.load(parseListingQuery('district=jingan'))

    expect(controller.snapshot()).toMatchObject({
      state: 'loading',
      items: [],
      refreshing: false,
      loadingMore: false,
    })

    request.resolve(listingsResult(['xuhui-1'], {
      canonicalQuery: 'city=beijing&district=xuhui',
      totalDocs: 1,
    }))
    await loading

    expect(controller.snapshot()).toMatchObject({
      state: 'ready',
      items: [expect.objectContaining({ id: 'xuhui-1' })],
      query: expect.objectContaining({ district: ['xuhui'], page: 1 }),
      totalDocs: 1,
      estimatedCount: 1,
    })
    expect(controller.snapshot().query).not.toHaveProperty('city')
  })

  it('首载错误进入可重试错误态，随后 load 可恢复', async () => {
    const getListings = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(listingsResult(['recovered']))
    const { controller } = createSubject(getListings)

    await controller.load(parseListingQuery('district=jingan'))
    expect(controller.snapshot()).toMatchObject({ state: 'error', items: [] })

    await controller.load(controller.snapshot().query)
    expect(controller.snapshot()).toMatchObject({
      state: 'ready',
      items: [expect.objectContaining({ id: 'recovered' })],
    })
  })

  it('首载 replace pending 时 refresh 不抢 owner，并立即停止下拉动画', async () => {
    const request = deferred<MiniListingsData>()
    const getListings = vi.fn(() => request.promise)
    const { controller, stopPullDownRefresh } = createSubject(getListings)

    const loading = controller.load(parseListingQuery('district=jingan'))
    const refreshing = controller.refresh()

    expect(getListings).toHaveBeenCalledTimes(1)
    expect(stopPullDownRefresh).toHaveBeenCalledTimes(1)
    expect(controller.snapshot()).toMatchObject({
      state: 'loading',
      refreshing: false,
      refreshError: false,
    })

    request.resolve(listingsResult(['initial'], { canonicalQuery: 'district=jingan' }))
    await Promise.all([loading, refreshing])
    expect(controller.snapshot()).toMatchObject({
      state: 'ready',
      refreshing: false,
      refreshError: false,
      items: [expect.objectContaining({ id: 'initial' })],
    })
  })

  it('idle 时 refresh 不发请求并立即停止下拉动画', async () => {
    const getListings = vi.fn()
    const { controller, stopPullDownRefresh } = createSubject(getListings)

    await controller.refresh()

    expect(getListings).not.toHaveBeenCalled()
    expect(stopPullDownRefresh).toHaveBeenCalledTimes(1)
    expect(controller.snapshot()).toMatchObject({ state: 'idle', refreshError: false })
  })

  it('loading guard 接管旧 refresh 动画后，最终 replace 不重复 stop', async () => {
    const staleRefresh = deferred<MiniListingsData>()
    const replacement = deferred<MiniListingsData>()
    const getListings = vi.fn()
      .mockResolvedValueOnce(listingsResult(['old']))
      .mockReturnValueOnce(staleRefresh.promise)
      .mockReturnValueOnce(replacement.promise)
    const { controller, stopPullDownRefresh } = createSubject(getListings)
    await loadInitial(controller)

    const refreshing = controller.refresh()
    const replacing = controller.applyFilters(parseListingQuery('district=xuhui'))
    await controller.refresh()
    expect(stopPullDownRefresh).toHaveBeenCalledTimes(1)
    expect(getListings).toHaveBeenCalledTimes(3)

    staleRefresh.resolve(listingsResult(['stale']))
    await refreshing
    replacement.resolve(listingsResult(['new'], { canonicalQuery: 'district=xuhui' }))
    await replacing

    expect(stopPullDownRefresh).toHaveBeenCalledTimes(1)
    expect(controller.snapshot().items.map((item) => item.id)).toEqual(['new'])
  })

  it('较旧请求后返回时不能覆盖较新的筛选结果', async () => {
    const first = deferred<MiniListingsData>()
    const second = deferred<MiniListingsData>()
    const getListings = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const { controller } = createSubject(getListings)

    const older = controller.load(parseListingQuery('district=jingan'))
    const newer = controller.load(parseListingQuery('district=xuhui'))
    second.resolve(listingsResult(['xuhui-result'], { canonicalQuery: 'district=xuhui' }))
    await newer
    first.resolve(listingsResult(['jingan-result'], { canonicalQuery: 'district=jingan' }))
    await older

    expect(controller.snapshot().items.map((item) => item.id)).toEqual(['xuhui-result'])
    expect(controller.snapshot().query.district).toEqual(['xuhui'])
  })

  it('下拉刷新失败保留旧卡并由最终有效 owner 收尾', async () => {
    const refresh = deferred<MiniListingsData>()
    const replacement = deferred<MiniListingsData>()
    const getListings = vi.fn()
      .mockResolvedValueOnce(listingsResult(['old']))
      .mockReturnValueOnce(refresh.promise)
      .mockReturnValueOnce(replacement.promise)
    const { controller, stopPullDownRefresh } = createSubject(getListings)
    await loadInitial(controller)

    const refreshing = controller.refresh()
    expect(controller.snapshot()).toMatchObject({
      state: 'ready',
      refreshing: true,
      items: [expect.objectContaining({ id: 'old' })],
    })
    const replacing = controller.applyFilters(parseListingQuery('district=xuhui'))
    refresh.reject(new Error('stale refresh failed'))
    await refreshing
    expect(stopPullDownRefresh).not.toHaveBeenCalled()

    replacement.resolve(listingsResult(['new'], { canonicalQuery: 'district=xuhui' }))
    await replacing
    expect(stopPullDownRefresh).toHaveBeenCalledTimes(1)
    expect(controller.snapshot()).toMatchObject({
      state: 'ready',
      refreshError: false,
      items: [expect.objectContaining({ id: 'new' })],
    })
  })

  it('当前刷新失败时保留旧卡并展示独立刷新错误', async () => {
    const getListings = vi.fn()
      .mockResolvedValueOnce(listingsResult(['old']))
      .mockRejectedValueOnce(new Error('refresh failed'))
    const { controller, stopPullDownRefresh } = createSubject(getListings)
    await loadInitial(controller)

    await controller.refresh()

    expect(controller.snapshot()).toMatchObject({
      state: 'ready',
      refreshing: false,
      refreshError: true,
      items: [expect.objectContaining({ id: 'old' })],
    })
    expect(stopPullDownRefresh).toHaveBeenCalledTimes(1)
  })

  it('空态刷新失败时保留旧的真实放宽建议', async () => {
    const getListings = vi.fn()
      .mockResolvedValueOnce(listingsResult([], {
        canonicalQuery: 'q=%E6%B1%9F%E6%99%AF',
        totalDocs: 0,
        totalPages: 0,
      }))
      .mockResolvedValueOnce(listingsResult(['without-keyword'], { totalDocs: 6 }))
      .mockRejectedValueOnce(new Error('refresh failed'))
    const { controller } = createSubject(getListings)
    await controller.load(parseListingQuery('q=%E6%B1%9F%E6%99%AF'))
    expect(controller.snapshot().relaxations).toEqual([
      expect.objectContaining({ dimension: 'q', count: 6 }),
    ])

    await controller.refresh()

    expect(controller.snapshot()).toMatchObject({
      state: 'empty',
      refreshError: true,
      relaxations: [expect.objectContaining({ dimension: 'q', count: 6 })],
    })
  })

  it('hasNextPage=false 或正在加载更多时不重复请求下一页', async () => {
    const nextPage = deferred<MiniListingsData>()
    const getListings = vi.fn()
      .mockResolvedValueOnce(listingsResult(['first'], {
        canonicalQuery: 'district=jingan',
        totalDocs: 25,
        totalPages: 2,
        hasNextPage: true,
      }))
      .mockReturnValueOnce(nextPage.promise)
    const { controller } = createSubject(getListings)
    await controller.load(parseListingQuery('district=jingan'))

    const firstAppend = controller.loadNextPage()
    const duplicateAppend = controller.loadNextPage()
    expect(getListings).toHaveBeenCalledTimes(2)
    await duplicateAppend

    nextPage.resolve(listingsResult(['second'], {
      canonicalQuery: 'district=jingan&page=2',
      page: 2,
      totalDocs: 25,
      totalPages: 2,
      hasNextPage: false,
    }))
    await firstAppend
    await controller.loadNextPage()
    expect(getListings).toHaveBeenCalledTimes(2)
  })

  it('刷新取代 append 时立即清除 loadingMore，旧分页响应不得覆盖刷新', async () => {
    const append = deferred<MiniListingsData>()
    const refresh = deferred<MiniListingsData>()
    const getListings = vi.fn()
      .mockResolvedValueOnce(listingsResult(['old'], {
        totalDocs: 25,
        totalPages: 2,
        hasNextPage: true,
      }))
      .mockReturnValueOnce(append.promise)
      .mockReturnValueOnce(refresh.promise)
    const { controller, stopPullDownRefresh } = createSubject(getListings)
    await loadInitial(controller)

    const appending = controller.loadNextPage()
    expect(controller.snapshot().loadingMore).toBe(true)
    const refreshing = controller.refresh()
    expect(controller.snapshot()).toMatchObject({ refreshing: true, loadingMore: false })

    refresh.resolve(listingsResult(['fresh']))
    await refreshing
    append.resolve(listingsResult(['stale-page'], { page: 2 }))
    await appending

    expect(controller.snapshot().items.map((item) => item.id)).toEqual(['fresh'])
    expect(stopPullDownRefresh).toHaveBeenCalledTimes(1)
  })

  it('下一页按不可变 id 去重，append 失败时保留旧卡并给独立错误', async () => {
    const getListings = vi.fn()
      .mockResolvedValueOnce(listingsResult(['a', 'b'], {
        canonicalQuery: 'district=jingan',
        totalDocs: 4,
        totalPages: 3,
        hasNextPage: true,
      }))
      .mockResolvedValueOnce(listingsResult(['b', 'c'], {
        canonicalQuery: 'district=jingan&page=2',
        page: 2,
        totalDocs: 4,
        totalPages: 3,
        hasNextPage: true,
      }))
      .mockRejectedValueOnce(new Error('append failed'))
    const { controller } = createSubject(getListings)
    await controller.load(parseListingQuery('district=jingan'))

    await controller.loadNextPage()
    expect(controller.snapshot().items.map((item) => item.id)).toEqual(['a', 'b', 'c'])

    await controller.loadNextPage()
    expect(controller.snapshot()).toMatchObject({
      state: 'ready',
      loadingMore: false,
      loadMoreError: true,
    })
    expect(controller.snapshot().items.map((item) => item.id)).toEqual(['a', 'b', 'c'])
  })

  it('应用筛选和放宽建议都替换旧列表', async () => {
    const getListings = vi.fn()
      .mockResolvedValueOnce(listingsResult(['old']))
      .mockResolvedValueOnce(listingsResult(['filtered'], { canonicalQuery: 'district=xuhui' }))
      .mockResolvedValueOnce(listingsResult(['relaxed'], { canonicalQuery: '' }))
    const { controller } = createSubject(getListings)
    await loadInitial(controller)

    await controller.applyFilters(parseListingQuery('district=xuhui'))
    expect(controller.snapshot().items.map((item) => item.id)).toEqual(['filtered'])

    await controller.applyRelaxation('')
    expect(controller.snapshot().items.map((item) => item.id)).toEqual(['relaxed'])
  })

  it('API canonical 已在第二页时，应用相同筛选仍强制请求并替换第一页', async () => {
    const getListings = vi.fn()
      .mockResolvedValueOnce(listingsResult(['page-2'], {
        canonicalQuery: 'district=jingan&page=2',
        page: 2,
        totalDocs: 30,
        totalPages: 2,
      }))
      .mockResolvedValueOnce(listingsResult(['page-1'], {
        canonicalQuery: 'district=jingan',
        page: 1,
        totalDocs: 30,
        totalPages: 2,
        hasNextPage: true,
      }))
    const { controller } = createSubject(getListings)
    await controller.load(parseListingQuery('district=jingan&page=2'))

    await controller.applyFilters(controller.snapshot().query)

    expect(getListings).toHaveBeenNthCalledWith(2, 'district=jingan')
    expect(controller.snapshot()).toMatchObject({
      query: expect.objectContaining({ district: ['jingan'], page: 1 }),
      items: [expect.objectContaining({ id: 'page-1' })],
    })
  })

  it('放宽建议即使携带旧 page 也强制应用第一页', async () => {
    const getListings = vi.fn()
      .mockResolvedValueOnce(listingsResult(['old']))
      .mockResolvedValueOnce(listingsResult(['relaxed'], { canonicalQuery: 'district=jingan' }))
    const { controller } = createSubject(getListings)
    await loadInitial(controller)

    await controller.applyRelaxation('district=jingan&page=2')

    expect(getListings).toHaveBeenNthCalledWith(2, 'district=jingan')
  })

  it('零结果只请求最多三条真实放宽计数，单条失败隔离', async () => {
    let requestCount = 0
    const getListings = vi.fn(async (query: string) => {
      requestCount += 1
      if (requestCount === 1) {
        return listingsResult([], {
          canonicalQuery: 'q=%E6%B1%9F%E6%99%AF&district=jingan&areaMin=500&priceUnit=rmb-sqm-day',
          totalDocs: 0,
          totalPages: 0,
        })
      }
      if (!query.includes('q=')) return listingsResult(['without-keyword'], { totalDocs: 8 })
      if (!query.includes('district=')) throw new Error('one relaxation failed')
      if (!query.includes('areaMin=')) return listingsResult(['without-area'], { totalDocs: 5 })
      throw new Error('unexpected relaxation query')
    })
    const { controller } = createSubject(getListings)

    await controller.load(parseListingQuery(
      'q=%E6%B1%9F%E6%99%AF&district=jingan&areaMin=500&priceMin=3&priceUnit=rmb-sqm-day',
    ))

    expect(getListings).toHaveBeenCalledTimes(4)
    expect(controller.snapshot()).toMatchObject({
      state: 'empty',
      loadingRelaxations: false,
      relaxations: [
        expect.objectContaining({ dimension: 'q', count: 8 }),
        expect.objectContaining({ dimension: 'area', count: 5 }),
      ],
    })
  })

  it('草稿估算防抖 250ms，新估算使旧响应失效且只读取 totalDocs', async () => {
    vi.useFakeTimers()
    const older = deferred<MiniListingsData>()
    const newer = deferred<MiniListingsData>()
    const getListings = vi.fn()
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise)
    const { controller } = createSubject(getListings)

    controller.estimateDraft(parseListingQuery('district=jingan'))
    await vi.advanceTimersByTimeAsync(249)
    expect(getListings).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(getListings).toHaveBeenCalledTimes(1)

    controller.estimateDraft(parseListingQuery('district=xuhui'))
    await vi.advanceTimersByTimeAsync(250)
    older.resolve(listingsResult(['ignored'], { totalDocs: 99 }))
    await Promise.resolve()
    expect(controller.snapshot().estimatedCount).toBe(0)
    expect(controller.snapshot().estimating).toBe(true)

    newer.resolve(listingsResult([], { totalDocs: 7, totalPages: 1 }))
    await Promise.resolve()
    expect(controller.snapshot()).toMatchObject({ estimating: false, estimatedCount: 7 })
  })

  it('任意 replace load 都使在途草稿估算失效', async () => {
    vi.useFakeTimers()
    const estimate = deferred<MiniListingsData>()
    const getListings = vi.fn()
      .mockReturnValueOnce(estimate.promise)
      .mockResolvedValueOnce(listingsResult(['replacement'], {
        canonicalQuery: 'district=xuhui',
        totalDocs: 2,
      }))
    const { controller } = createSubject(getListings)

    controller.estimateDraft(parseListingQuery('district=jingan'))
    await vi.advanceTimersByTimeAsync(250)
    await controller.load(parseListingQuery('district=xuhui'))
    estimate.resolve(listingsResult([], { totalDocs: 99 }))
    await Promise.resolve()

    expect(controller.snapshot()).toMatchObject({
      query: expect.objectContaining({ district: ['xuhui'] }),
      estimating: false,
      estimatedCount: 2,
    })
  })

  it('append 先发、草稿估算后成功时，迟到 append 不覆盖估算 session', async () => {
    vi.useFakeTimers()
    const append = deferred<MiniListingsData>()
    const estimate = deferred<MiniListingsData>()
    const getListings = vi.fn()
      .mockResolvedValueOnce(listingsResult(['first'], {
        totalDocs: 25,
        totalPages: 2,
        hasNextPage: true,
      }))
      .mockReturnValueOnce(append.promise)
      .mockReturnValueOnce(estimate.promise)
    const { controller } = createSubject(getListings)
    await loadInitial(controller)

    const appending = controller.loadNextPage()
    controller.estimateDraft(parseListingQuery('district=xuhui'))
    await vi.advanceTimersByTimeAsync(250)
    estimate.resolve(listingsResult([], { totalDocs: 7 }))
    await Promise.resolve()
    expect(controller.snapshot()).toMatchObject({
      estimating: false,
      estimateUnavailable: false,
      estimatedCount: 7,
    })

    append.resolve(listingsResult(['second'], {
      page: 2,
      totalDocs: 25,
      totalPages: 2,
      hasNextPage: false,
    }))
    await appending
    expect(controller.snapshot()).toMatchObject({
      estimating: false,
      estimateUnavailable: false,
      estimatedCount: 7,
    })
  })

  it('refresh 先返回且草稿估算仍 pending 时保留估算 session', async () => {
    vi.useFakeTimers()
    const estimate = deferred<MiniListingsData>()
    const refresh = deferred<MiniListingsData>()
    const getListings = vi.fn()
      .mockResolvedValueOnce(listingsResult(['old'], { totalDocs: 25 }))
      .mockReturnValueOnce(estimate.promise)
      .mockReturnValueOnce(refresh.promise)
    const { controller } = createSubject(getListings)
    await loadInitial(controller)

    controller.estimateDraft(parseListingQuery('district=xuhui'))
    await vi.advanceTimersByTimeAsync(250)
    const refreshing = controller.refresh()
    refresh.resolve(listingsResult(['fresh'], { totalDocs: 30 }))
    await refreshing

    expect(controller.snapshot()).toMatchObject({
      estimating: true,
      estimateUnavailable: false,
      estimatedCount: 0,
    })

    estimate.resolve(listingsResult([], { totalDocs: 7 }))
    await Promise.resolve()
    expect(controller.snapshot()).toMatchObject({
      estimating: false,
      estimateUnavailable: false,
      estimatedCount: 7,
    })
  })

  it('估算失败封闭旧数量，新草稿开始后可恢复成功', async () => {
    vi.useFakeTimers()
    const getListings = vi.fn()
      .mockResolvedValueOnce(listingsResult(['old'], { totalDocs: 25 }))
      .mockRejectedValueOnce(new Error('estimate unavailable'))
      .mockResolvedValueOnce(listingsResult([], { totalDocs: 8 }))
    const { controller } = createSubject(getListings)
    await loadInitial(controller)

    controller.estimateDraft(parseListingQuery('district=jingan'))
    await vi.advanceTimersByTimeAsync(250)
    expect(controller.snapshot()).toMatchObject({
      estimating: false,
      estimateUnavailable: true,
      estimatedCount: 0,
    })

    controller.estimateDraft(parseListingQuery('district=xuhui'))
    expect(controller.snapshot()).toMatchObject({
      estimating: true,
      estimateUnavailable: false,
      estimatedCount: 0,
    })
    await vi.advanceTimersByTimeAsync(250)
    expect(controller.snapshot()).toMatchObject({
      estimating: false,
      estimateUnavailable: false,
      estimatedCount: 8,
    })
  })

  it('估算 unavailable session 不被后续 refresh 的主结果改写', async () => {
    vi.useFakeTimers()
    const getListings = vi.fn()
      .mockResolvedValueOnce(listingsResult(['old'], { totalDocs: 25 }))
      .mockRejectedValueOnce(new Error('estimate unavailable'))
      .mockResolvedValueOnce(listingsResult(['fresh'], { totalDocs: 30 }))
    const { controller } = createSubject(getListings)
    await loadInitial(controller)

    controller.estimateDraft(parseListingQuery('district=xuhui'))
    await vi.advanceTimersByTimeAsync(250)
    await controller.refresh()

    expect(controller.snapshot()).toMatchObject({
      estimating: false,
      estimateUnavailable: true,
      estimatedCount: 0,
    })
  })

  it('关闭筛选面板取消待执行 timer，并使在途估算响应失效', async () => {
    vi.useFakeTimers()
    const inflight = deferred<MiniListingsData>()
    const getListings = vi.fn(() => inflight.promise)
    const { controller } = createSubject(getListings)

    controller.estimateDraft(parseListingQuery('district=jingan'))
    controller.cancelEstimate()
    await vi.advanceTimersByTimeAsync(250)
    expect(getListings).not.toHaveBeenCalled()
    expect(controller.snapshot().estimating).toBe(false)

    controller.estimateDraft(parseListingQuery('district=xuhui'))
    await vi.advanceTimersByTimeAsync(250)
    expect(getListings).toHaveBeenCalledTimes(1)
    controller.cancelEstimate()
    inflight.resolve(listingsResult([], { totalDocs: 12 }))
    await Promise.resolve()
    expect(controller.snapshot()).toMatchObject({ estimating: false, estimatedCount: 0 })
  })
})
