import { describe, expect, it } from 'vitest'

import { createHomeLoadController } from '../miniprogram/pages/home/controller.js'
import { presentHome, type HomePageSnapshot } from '../miniprogram/pages/home/model.js'
import type { MiniHomeData, MiniListingCard } from '../miniprogram/services/catalog-contracts.js'

function deferred<T>() {
  let resolvePromise: (value: T) => void = () => undefined
  let rejectPromise: (reason?: unknown) => void = () => undefined
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return { promise, resolve: resolvePromise, reject: rejectPromise }
}

function homeWithSlug(slug: string): MiniHomeData {
  const listing: MiniListingCard = {
    id: slug,
    slug,
    title: slug,
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
  return {
    featuredListings: [listing],
    featuredBuildings: [],
    quickFilters: [],
    stats: { listings: 1, buildings: 1, businessAreas: 1 },
  }
}

describe('首页请求 owner 控制器', () => {
  it('旧刷新 A 完成时不覆盖新刷新 B，也不提前停止 B 的刷新动画', async () => {
    const requestA = deferred<MiniHomeData>()
    const requestB = deferred<MiniHomeData>()
    const requests = [requestA.promise, requestB.promise]
    let requestIndex = 0
    let stopCount = 0
    let snapshot: HomePageSnapshot = {
      state: 'ready',
      content: presentHome(homeWithSlug('initial')),
      refreshError: false,
    }
    const controller = createHomeLoadController({
      getHome: () => requests[requestIndex++] ?? Promise.reject(new Error('unexpected request')),
      getSnapshot: () => snapshot,
      setSnapshot: (next) => {
        snapshot = next
      },
      stopPullDownRefresh: () => {
        stopCount += 1
      },
    })

    const loadingA = controller.load(true)
    const loadingB = controller.load(true)

    requestA.resolve(homeWithSlug('stale-a'))
    await loadingA
    expect(snapshot.content?.featuredListings[0]?.slug).toBe('initial')
    expect(stopCount).toBe(0)

    requestB.resolve(homeWithSlug('latest-b'))
    await loadingB
    expect(snapshot.content?.featuredListings[0]?.slug).toBe('latest-b')
    expect(stopCount).toBe(1)
  })

  it('刷新 A 后启动普通加载 B，只有 B 完成时停止一次既有刷新动画', async () => {
    const requestA = deferred<MiniHomeData>()
    const requestB = deferred<MiniHomeData>()
    const requests = [requestA.promise, requestB.promise]
    let requestIndex = 0
    let stopCount = 0
    let snapshot: HomePageSnapshot = {
      state: 'ready',
      content: presentHome(homeWithSlug('initial')),
      refreshError: false,
    }
    const controller = createHomeLoadController({
      getHome: () => requests[requestIndex++] ?? Promise.reject(new Error('unexpected request')),
      getSnapshot: () => snapshot,
      setSnapshot: (next) => {
        snapshot = next
      },
      stopPullDownRefresh: () => {
        stopCount += 1
      },
    })

    const loadingA = controller.load(true)
    const loadingB = controller.load(false)

    requestA.resolve(homeWithSlug('stale-a'))
    await loadingA
    expect(snapshot.content?.featuredListings[0]?.slug).toBe('initial')
    expect(stopCount).toBe(0)

    requestB.resolve(homeWithSlug('latest-b'))
    await loadingB
    expect(snapshot.content?.featuredListings[0]?.slug).toBe('latest-b')
    expect(stopCount).toBe(1)
  })
})
