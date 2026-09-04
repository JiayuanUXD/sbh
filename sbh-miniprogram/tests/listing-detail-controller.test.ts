import { describe, expect, it, vi } from 'vitest'

import {
  createListingDetailController,
  type ListingDetailSnapshot,
} from '../miniprogram/pages/listing-detail/controller.js'
import type {
  MiniListingCard,
  MiniListingDetailData,
} from '../miniprogram/services/catalog-contracts.js'
import { MiniApiError } from '../miniprogram/services/mini-api-error.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function listingDetail(slug: string, monthlyEstimate = 25_500): MiniListingDetailData {
  return {
    listing: {
      id: `id-${slug}`,
      slug,
      title: `${slug} 房源`,
      citySlug: 'shanghai',
      cityName: '上海',
      price: {
        amount: 8.5,
        currency: 'CNY',
        businessType: 'lease',
        period: 'day',
        basis: 'sqm',
        displayUnit: 'rmb-sqm-day',
        text: '8.5 元/㎡/天',
        monthlyEstimate,
      },
      area: 100,
      seats: 12,
      listingType: { value: 'traditional-office', label: '传统办公' },
      availableFrom: '2026-09-01',
      building: {
        slug: 'jing-an-tower',
        name: '静安中心',
        address: '静安区南京西路 1 号',
        district: '静安区',
      },
      coverImage: null,
      highlights: ['近地铁'],
      gallery: [{ src: `https://cdn.example/${slug}.jpg`, alt: `${slug} 图片` }],
      factGroups: [{
        id: 'terms',
        title: '租赁条件',
        facts: [{ label: '交付标准', value: '精装修', estimated: false }],
      }],
      verification: {
        verifiedAt: '2026-08-20T00:00:00.000Z',
        priceVerifiedAt: '2026-08-21T00:00:00.000Z',
      },
    },
    monthlyCost: {
      currency: 'CNY',
      period: 'month',
      propertyFeeInclusion: 'excluded',
      rent: monthlyEstimate,
      propertyFee: 2_800,
      total: monthlyEstimate + 2_800,
      assumptions: ['物业费另计'],
    },
    relatedListings: [],
    buildingInfo: null,
    inquiryPolicy: { version: '2026-08-27' },
  }
}

function notFoundError(): MiniApiError {
  return new MiniApiError({
    kind: 'business',
    code: 'listing_not_found',
    statusCode: 404,
    requestId: 'request-not-found',
    retryable: false,
  })
}

function setup(
  getListingDetail: (slug: string) => Promise<MiniListingDetailData>,
  getFallbackListings: () => Promise<readonly MiniListingCard[]> = async () => [],
) {
  const snapshots: ListingDetailSnapshot[] = []
  const stopPullDownRefresh = vi.fn()
  const controller = createListingDetailController({
    getListingDetail,
    getFallbackListings,
    onChange: (snapshot) => snapshots.push(snapshot),
    stopPullDownRefresh,
  })
  return { controller, snapshots, stopPullDownRefresh }
}

describe('房源详情控制器', () => {
  it('初次加载先清空价格进入 loading，成功后进入 ready', async () => {
    const request = deferred<MiniListingDetailData>()
    const { controller, snapshots } = setup(() => request.promise)

    const loading = controller.load('jing-an-tower-101')
    expect(controller.snapshot()).toMatchObject({
      state: 'loading',
      slug: 'jing-an-tower-101',
      content: null,
    })

    request.resolve(listingDetail('jing-an-tower-101'))
    await loading

    expect(controller.snapshot()).toMatchObject({
      state: 'ready',
      slug: 'jing-an-tower-101',
      content: {
        primaryPrice: '约 ¥25,500/月',
        secondaryPrice: '8.5 元/㎡/天',
        inquiryPolicyVersion: '2026-08-27',
      },
    })
    expect(snapshots.map((snapshot) => snapshot.state)).toEqual(['loading', 'ready'])
  })

  it('同 slug 刷新保留详情进入 refreshing，失败后保留旧价进入 stale', async () => {
    const refresh = deferred<MiniListingDetailData>()
    let call = 0
    const { controller, stopPullDownRefresh } = setup(async (slug) => {
      call += 1
      return call === 1 ? listingDetail(slug) : refresh.promise
    })

    await controller.load('jing-an-tower-101')
    const previousContent = controller.snapshot().content
    const refreshing = controller.refresh()

    expect(controller.snapshot()).toEqual({
      state: 'refreshing',
      slug: 'jing-an-tower-101',
      content: previousContent,
      fallbackListings: [],
      loadingFallback: false,
    })

    refresh.reject(new Error('network secret'))
    await refreshing

    expect(controller.snapshot()).toEqual({
      state: 'stale',
      slug: 'jing-an-tower-101',
      content: previousContent,
      fallbackListings: [],
      loadingFallback: false,
    })
    expect(stopPullDownRefresh).toHaveBeenCalledOnce()
  })

  it('stale 重试成功后以新 API 值回到 ready', async () => {
    let call = 0
    const { controller } = setup(async (slug) => {
      call += 1
      if (call === 1) return listingDetail(slug, 25_500)
      if (call === 2) throw new Error('refresh failed')
      return listingDetail(slug, 30_000)
    })

    await controller.load('jing-an-tower-101')
    await controller.refresh()
    expect(controller.snapshot().state).toBe('stale')

    await controller.refresh()
    expect(controller.snapshot()).toMatchObject({
      state: 'ready',
      content: { primaryPrice: '约 ¥30,000/月' },
    })
  })

  it('初载普通失败进入 error，listing_not_found 进入 not-found，均不保留内容', async () => {
    const ordinary = setup(async () => { throw new Error('failed') }).controller
    await ordinary.load('jing-an-tower-101')
    expect(ordinary.snapshot()).toEqual({
      state: 'error',
      slug: 'jing-an-tower-101',
      content: null,
      fallbackListings: [],
      loadingFallback: false,
    })

    const missing = setup(async () => { throw notFoundError() }).controller
    await missing.load('jing-an-tower-404')
    expect(missing.snapshot()).toEqual({
      state: 'not-found',
      slug: 'jing-an-tower-404',
      content: null,
      fallbackListings: [],
      loadingFallback: false,
    })
  })

  it('换 slug 立即清空旧价格，新请求失败后也不恢复旧内容', async () => {
    const { controller } = setup(async (slug) => {
      if (slug === 'jing-an-tower-101') return listingDetail(slug)
      throw new Error('new listing failed')
    })

    await controller.load('jing-an-tower-101')
    expect(controller.snapshot().content).not.toBeNull()

    const replacement = controller.load('jing-an-tower-102')
    expect(controller.snapshot()).toEqual({
      state: 'loading',
      slug: 'jing-an-tower-102',
      content: null,
      fallbackListings: [],
      loadingFallback: false,
    })
    await replacement

    expect(controller.snapshot()).toEqual({
      state: 'error',
      slug: 'jing-an-tower-102',
      content: null,
      fallbackListings: [],
      loadingFallback: false,
    })
  })

  it('旧 slug 的迟到响应不能覆盖新 slug', async () => {
    const older = deferred<MiniListingDetailData>()
    const newer = deferred<MiniListingDetailData>()
    const { controller } = setup((slug) => (
      slug === 'jing-an-tower-101' ? older.promise : newer.promise
    ))

    const olderLoad = controller.load('jing-an-tower-101')
    const newerLoad = controller.load('jing-an-tower-102')
    older.resolve(listingDetail('jing-an-tower-101', 99_999))
    await olderLoad

    expect(controller.snapshot()).toEqual({
      state: 'loading',
      slug: 'jing-an-tower-102',
      content: null,
      fallbackListings: [],
      loadingFallback: false,
    })

    newer.resolve(listingDetail('jing-an-tower-102', 30_000))
    await newerLoad
    expect(controller.snapshot()).toMatchObject({
      state: 'ready',
      slug: 'jing-an-tower-102',
      content: { title: 'jing-an-tower-102 房源', primaryPrice: '约 ¥30,000/月' },
    })
  })

  it('刷新遇到 listing_not_found 会清空旧价并进入 not-found', async () => {
    let call = 0
    const { controller } = setup(async (slug) => {
      call += 1
      if (call === 1) return listingDetail(slug)
      throw notFoundError()
    })

    await controller.load('jing-an-tower-101')
    await controller.refresh()

    expect(controller.snapshot()).toEqual({
      state: 'not-found',
      slug: 'jing-an-tower-101',
      content: null,
      fallbackListings: [],
      loadingFallback: false,
    })
  })

  it('not-found 加载普通推荐，过滤失效 slug、按 slug 去重并限量三条', async () => {
    const fallback = deferred<readonly MiniListingCard[]>()
    const { controller } = setup(
      async () => { throw notFoundError() },
      () => fallback.promise,
    )
    const loading = controller.load('jing-an-tower-404')
    await Promise.resolve()

    expect(controller.snapshot()).toEqual({
      state: 'not-found',
      slug: 'jing-an-tower-404',
      content: null,
      fallbackListings: [],
      loadingFallback: true,
    })

    fallback.resolve([
      listingDetail('jing-an-tower-404').listing,
      listingDetail('jing-an-tower-101').listing,
      { ...listingDetail('jing-an-tower-101').listing, id: 'duplicate-id' },
      listingDetail('jing-an-tower-102').listing,
      listingDetail('jing-an-tower-103').listing,
      listingDetail('jing-an-tower-104').listing,
    ])
    await loading

    expect(controller.snapshot()).toEqual({
      state: 'not-found',
      slug: 'jing-an-tower-404',
      content: null,
      fallbackListings: [
        listingDetail('jing-an-tower-101').listing,
        listingDetail('jing-an-tower-102').listing,
        listingDetail('jing-an-tower-103').listing,
      ],
      loadingFallback: false,
    })
  })

  it('普通推荐失败仍保持 not-found 与空推荐，不转成 error', async () => {
    const { controller } = setup(
      async () => { throw notFoundError() },
      async () => { throw new Error('fallback failed secret') },
    )

    await controller.load('jing-an-tower-404')

    expect(controller.snapshot()).toEqual({
      state: 'not-found',
      slug: 'jing-an-tower-404',
      content: null,
      fallbackListings: [],
      loadingFallback: false,
    })
  })

  it('旧 slug 的迟到普通推荐不能覆盖新 slug 的详情', async () => {
    const fallback = deferred<readonly MiniListingCard[]>()
    const { controller } = setup(
      async (slug) => {
        if (slug === 'jing-an-tower-404') throw notFoundError()
        return listingDetail(slug, 30_000)
      },
      () => fallback.promise,
    )

    const missing = controller.load('jing-an-tower-404')
    await Promise.resolve()
    expect(controller.snapshot().loadingFallback).toBe(true)

    await controller.load('jing-an-tower-102')
    fallback.resolve([listingDetail('jing-an-tower-101').listing])
    await missing

    expect(controller.snapshot()).toMatchObject({
      state: 'ready',
      slug: 'jing-an-tower-102',
      content: { primaryPrice: '约 ¥30,000/月' },
      fallbackListings: [],
      loadingFallback: false,
    })
  })

  it('dispose 后在途响应不能再发布', async () => {
    const request = deferred<MiniListingDetailData>()
    const { controller, snapshots } = setup(() => request.promise)
    const loading = controller.load('jing-an-tower-101')
    controller.dispose()
    request.resolve(listingDetail('jing-an-tower-101'))
    await loading

    expect(snapshots.map((snapshot) => snapshot.state)).toEqual(['loading'])
  })
})
