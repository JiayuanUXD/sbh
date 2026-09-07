import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import type { MiniBuildingsData } from '../miniprogram/services/catalog-contracts.js'

const getBuildings = vi.hoisted(() => vi.fn<(query?: string) => Promise<MiniBuildingsData>>())

vi.mock('../miniprogram/services/catalog.js', () => ({ getBuildings }))

type Deferred<T> = Readonly<{ promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void }>

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail })
  return { promise, resolve, reject }
}

function response(
  page: number,
  slugs: readonly string[],
  hasNextPage: boolean,
  inactiveSlugs: readonly string[] = [],
): MiniBuildingsData {
  const card = (slug: string) => ({
    id: slug,
    slug,
    name: slug,
    district: '静安区',
    address: '测试路 1 号',
    grade: 'grade-a' as const,
    completedYear: 2020,
    totalFloors: null,
    occupancyRate: null,
    activeListingCount: 1,
    priceRange: null,
    coverImage: null,
    nearestMetro: null,
  })
  return {
    items: slugs.map(card),
    inactiveItems: inactiveSlugs.map((slug) => ({ ...card(slug), activeListingCount: 0 })),
    pagination: {
      page,
      pageSize: 24,
      totalDocs: 3,
      totalPages: hasNextPage ? page + 1 : page,
      hasNextPage,
      hasPrevPage: page > 1,
    },
    totalActiveCount: 2,
    totalInactiveCount: 1,
    districtOptions: [],
    inquiryPolicy: { version: 'policy-v3' },
  }
}

type Registration = Record<string, (this: Context, ...args: any[]) => any> & {
  data: Context['data']
}

type Context = {
  data: {
    state: 'loading' | 'ready' | 'error'
    items: MiniBuildingsData['items']
    inactiveItems: MiniBuildingsData['inactiveItems']
    totalDocs: number
    totalActiveCount: number
    totalInactiveCount: number
    districtFilter: string
    districtFilterLabel: string
    districtOptions: MiniBuildingsData['districtOptions']
    gradeFilter: string
    sortFilter: string
    page: number
    hasNextPage: boolean
    loadMoreState: 'idle' | 'loading' | 'error'
    inquiryPolicyVersion: string | null
  }
  pageActive: boolean
  buildingRequestGeneration: number
  buildingRequestPending: boolean
  buildingReloadRequired: boolean
  setData(update: Record<string, unknown>): void
  closeInquiryForLifecycle(): void
  restoreModalTabBarBoundary(): Promise<boolean>
  requestBuildings(page: number, append: boolean): Promise<void>
  loadBuildings(): Promise<void>
}

let registration: Registration

function createContext(): Context {
  const data = structuredClone(registration.data) as Context['data']
  return {
    data,
    pageActive: true,
    buildingRequestGeneration: 0,
    buildingRequestPending: false,
    buildingReloadRequired: false,
    setData(update) { Object.assign(data, update) },
    closeInquiryForLifecycle: vi.fn(),
    restoreModalTabBarBoundary: vi.fn(async () => true),
    requestBuildings: registration.requestBuildings,
    loadBuildings: registration.loadBuildings,
  }
}

beforeAll(async () => {
  vi.stubGlobal('wx', {
    login: vi.fn(),
    stopPullDownRefresh: vi.fn(),
    showActionSheet: vi.fn(),
  })
  vi.stubGlobal('Page', (value: Registration) => { registration = value })
  await import('../miniprogram/pages/buildings/index.js')
})

afterAll(() => vi.unstubAllGlobals())

beforeEach(() => getBuildings.mockReset())

describe('楼盘列表请求世代与分页', () => {
  it('页面只在 hasNextPage=false 显示全部终态，并提供追加失败重试', () => {
    const markup = readFileSync(resolve(import.meta.dirname, '../miniprogram/pages/buildings/index.wxml'), 'utf8')
    expect(markup).toMatch(/wx:if="\{\{!hasNextPage\}\}"[^>]*class="buildings-end"/)
    expect(markup).toContain('loadMoreState === \'loading\'')
    expect(markup).toContain('loadMoreState === \'error\'')
    expect(markup).toContain('bindtap="handleRetryLoadMore"')
  })

  it('首屏发 page=1，触底后 page+1 合并去重，仅服务端确认时进入终态', async () => {
    getBuildings
      .mockResolvedValueOnce(response(1, ['building-a'], true))
      .mockResolvedValueOnce(response(2, ['building-a', 'building-b'], false, ['building-c']))
    const context = createContext()

    await registration.loadBuildings.call(context)
    expect(getBuildings).toHaveBeenNthCalledWith(1, 'page=1')
    expect(context.data.hasNextPage).toBe(true)

    await registration.onReachBottom.call(context)
    expect(getBuildings).toHaveBeenNthCalledWith(2, 'page=2')
    expect(context.data.items.map((item) => item.slug)).toEqual(['building-a', 'building-b'])
    expect(context.data.inactiveItems.map((item) => item.slug)).toEqual(['building-c'])
    expect(context.data.page).toBe(2)
    expect(context.data.hasNextPage).toBe(false)
    expect(context.data.loadMoreState).toBe('idle')
  })

  it('新筛选的快响应不会被旧首屏慢响应覆盖', async () => {
    const oldRequest = deferred<MiniBuildingsData>()
    const currentRequest = deferred<MiniBuildingsData>()
    getBuildings.mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(currentRequest.promise)
    const context = createContext()

    const oldLoad = registration.loadBuildings.call(context)
    context.data.districtFilter = '静安区'
    const currentLoad = registration.loadBuildings.call(context)
    currentRequest.resolve(response(1, ['current-building'], false))
    await currentLoad
    oldRequest.resolve(response(1, ['stale-building'], false))
    await oldLoad

    expect(getBuildings).toHaveBeenNthCalledWith(2, 'district=%E9%9D%99%E5%AE%89%E5%8C%BA&page=1')
    expect(context.data.items.map((item) => item.slug)).toEqual(['current-building'])
    expect(context.data.state).toBe('ready')
  })

  it('区域筛选显示权威 label，请求只传对应 slug', async () => {
    getBuildings
      .mockResolvedValueOnce({
        ...response(1, ['building-a'], false),
        districtOptions: [{ value: 'jing-an', label: '静安区', count: 12 }],
      })
      .mockResolvedValueOnce(response(1, ['building-a'], false))
    const context = createContext()
    await registration.loadBuildings.call(context)
    vi.mocked(wx.showActionSheet).mockImplementationOnce(({ success }) => {
      success?.({ tapIndex: 1 } as WechatMiniprogram.ShowActionSheetSuccessCallbackResult)
    })

    registration.handleDistrictFilter.call(context)
    await Promise.resolve()
    await Promise.resolve()

    expect(context.data.districtFilterLabel).toBe('静安区')
    expect(getBuildings).toHaveBeenLastCalledWith('district=jing-an&page=1')
  })

  it('旧分页请求不追加到新筛选，分页失败可原页重试', async () => {
    getBuildings.mockResolvedValueOnce(response(1, ['old-page-1'], true))
    const stalePageTwo = deferred<MiniBuildingsData>()
    const currentPageOne = deferred<MiniBuildingsData>()
    getBuildings.mockReturnValueOnce(stalePageTwo.promise).mockReturnValueOnce(currentPageOne.promise)
    const context = createContext()
    await registration.loadBuildings.call(context)

    const append = registration.onReachBottom.call(context)
    context.data.gradeFilter = 'grade-a'
    const reset = registration.loadBuildings.call(context)
    currentPageOne.resolve(response(1, ['filtered-building'], true))
    await reset
    stalePageTwo.resolve(response(2, ['stale-page-2'], false))
    await append
    expect(context.data.items.map((item) => item.slug)).toEqual(['filtered-building'])

    getBuildings.mockRejectedValueOnce(new Error('network'))
    await registration.onReachBottom.call(context)
    expect(context.data.state).toBe('ready')
    expect(context.data.loadMoreState).toBe('error')

    getBuildings.mockResolvedValueOnce(response(2, ['filtered-building', 'retried'], false))
    await registration.handleRetryLoadMore.call(context)
    expect(context.data.items.map((item) => item.slug)).toEqual(['filtered-building', 'retried'])
  })

  it.each(['onHide', 'onUnload'] as const)('%s 使迟到响应失效', async (lifecycle) => {
    const pending = deferred<MiniBuildingsData>()
    getBuildings.mockReturnValueOnce(pending.promise)
    const context = createContext()

    const load = registration.loadBuildings.call(context)
    registration[lifecycle].call(context)
    pending.resolve(response(1, ['late-building'], false))
    await load

    expect(context.data.items).toEqual([])
    expect(context.data.state).toBe('loading')
  })

  it('离场中断加载后返回页面会启动新世代请求，不永久停在 loading', async () => {
    const stale = deferred<MiniBuildingsData>()
    const current = deferred<MiniBuildingsData>()
    getBuildings.mockReturnValueOnce(stale.promise).mockReturnValueOnce(current.promise)
    const context = createContext()

    const staleLoad = registration.loadBuildings.call(context)
    registration.onHide.call(context)
    registration.onShow.call(context)
    expect(getBuildings).toHaveBeenCalledTimes(2)
    current.resolve(response(1, ['current-after-return'], false))
    await vi.waitFor(() => expect(context.data.state).toBe('ready'))
    stale.resolve(response(1, ['stale-before-hide'], false))
    await staleLoad

    expect(context.data.items.map((item) => item.slug)).toEqual(['current-after-return'])
    expect(context.data.state).toBe('ready')
  })
})
