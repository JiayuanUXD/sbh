import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { UserAssets } from '../miniprogram/services/user-assets.js'

const loadUserAssets = vi.hoisted(() => vi.fn<() => Promise<UserAssets>>())
const refreshUserAssets = vi.hoisted(() => vi.fn<() => Promise<UserAssets>>())

vi.mock('../miniprogram/services/user-assets.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../miniprogram/services/user-assets.js')>()
  return { ...actual, loadUserAssets, refreshUserAssets }
})

type ProfilePageInfo = Readonly<{ limit: number; hasMore: boolean }>

type ProfilePageData = {
  assetsState: 'loading' | 'ready' | 'error'
  favoriteListings: readonly unknown[]
  favoriteBuildings: readonly unknown[]
  inquiries: readonly unknown[]
  favoriteCollection: 'none' | 'listing' | 'building'
  favoritesPageInfo: ProfilePageInfo
  inquiriesPageInfo: ProfilePageInfo
}

type ProfileContext = {
  data: ProfilePageData
  assetsRequestVersion: number
  setData(update: Partial<ProfilePageData>): void
}

type ProfileRegistration = {
  data: ProfilePageData
  loadAssets(this: ProfileContext, force?: boolean, pullDown?: boolean): Promise<void>
  handleViewFavorites(
    this: ProfileContext,
    event: Readonly<{ currentTarget: Readonly<{ dataset: Readonly<{ type?: string }> }> }>,
  ): void
}

let registration: ProfileRegistration
const showToast = vi.fn()

function assetsWithTruncation(): UserAssets {
  return {
    counts: { favorites: 2, inquiries: 1 },
    pageInfo: {
      favorites: { limit: 200, hasMore: true },
      inquiries: { limit: 100, hasMore: true },
    },
    favorites: {
      listings: [{ slug: 'listing-a', title: '房源 A', coverImage: null }],
      buildings: [{ slug: 'building-a', name: '楼盘 A', coverImage: null }],
    },
    inquiries: [{
      targetType: 'general',
      targetSlug: null,
      targetTitle: '通用找房需求',
      submittedAt: '2026-09-04T08:00:00.000Z',
      status: { value: 'new', label: '新建' },
    }],
  }
}

function context(): ProfileContext {
  const data = structuredClone(registration.data)
  return {
    data,
    assetsRequestVersion: 0,
    setData(update) {
      Object.assign(data, update)
    },
  }
}

beforeAll(async () => {
  vi.stubGlobal('Page', (value: ProfileRegistration) => { registration = value })
  vi.stubGlobal('wx', {
    stopPullDownRefresh: vi.fn(),
    showToast,
    navigateTo: vi.fn(),
  })
  await import('../miniprogram/pages/profile/index.js')
})

afterAll(() => vi.unstubAllGlobals())

beforeEach(() => {
  loadUserAssets.mockReset()
  refreshUserAssets.mockReset()
  showToast.mockReset()
})

describe('我的页面资产截断状态', () => {
  it('服务端 hasMore 与 limit 进入页面状态，刷新后不会丢失', async () => {
    loadUserAssets.mockResolvedValueOnce(assetsWithTruncation())
    const page = context()

    await registration.loadAssets.call(page)

    expect(page.data.assetsState).toBe('ready')
    expect(page.data.favoritesPageInfo).toEqual({ limit: 200, hasMore: true })
    expect(page.data.inquiriesPageInfo).toEqual({ limit: 100, hasMore: true })
    expect(page.data.favoriteListings).toHaveLength(1)
    expect(page.data.favoriteBuildings).toHaveLength(1)
    expect(page.data.inquiries).toHaveLength(1)
  })

  it('加载失败时清空截断状态，不沿用上一轮“另有更多”', async () => {
    loadUserAssets.mockRejectedValueOnce(new Error('network unavailable'))
    const page = context()
    page.data.favoritesPageInfo = { limit: 200, hasMore: true }
    page.data.inquiriesPageInfo = { limit: 100, hasMore: true }

    await registration.loadAssets.call(page)

    expect(page.data.assetsState).toBe('error')
    expect(page.data.favoritesPageInfo).toEqual({ limit: 0, hasMore: false })
    expect(page.data.inquiriesPageInfo).toEqual({ limit: 0, hasMore: false })
  })

  it('收藏已截断且当前类别为空时不误报“暂未收藏”', () => {
    const page = context()
    page.data.favoritesPageInfo = { limit: 200, hasMore: true }

    registration.handleViewFavorites.call(page, {
      currentTarget: { dataset: { type: 'listing' } },
    })

    expect(showToast).toHaveBeenCalledWith({ title: '收藏另有更多', icon: 'none' })
  })
})
