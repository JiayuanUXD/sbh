import { afterEach, describe, expect, it, vi } from 'vitest'

import type { RequestOptions } from '../miniprogram/services/mini-api-contracts.js'
import {
  createUserAssetsService,
  isFavorite,
  type UserAssets,
  type UserAssetsRequestClient,
} from '../miniprogram/services/user-assets.js'

function emptyAssets(): UserAssets {
  return {
    counts: { favorites: 0, inquiries: 0 },
    favorites: { listings: [], buildings: [] },
    inquiries: [],
  }
}

function listingFavorite(slug = 'jing-an-100') {
  return {
    slug,
    title: '静安中心 100㎡',
    citySlug: 'shanghai',
    cityName: '上海',
    price: null,
    area: 100,
    seats: null,
    listingType: { value: 'traditional-office', label: '传统办公室' },
    availableFrom: null,
    building: null,
    coverImage: null,
    highlights: ['近地铁'],
  }
}

function buildingFavorite(slug = 'jing-an-center') {
  return {
    slug,
    name: '静安中心',
    district: '静安区',
    address: '南京西路 1 号',
    grade: 'grade-a',
    completedYear: 2015,
    totalFloors: 30,
    occupancyRate: null,
    activeListingCount: 3,
    priceRange: null,
    coverImage: null,
    nearestMetro: null,
  }
}

function parseThrough<T>(options: RequestOptions<T>, value: unknown): Promise<T> {
  return Promise.resolve(options.parse(value))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('服务端用户收藏', () => {
  it('session 缺失时不发请求且 fail-closed', async () => {
    let requestCalls = 0
    const request: UserAssetsRequestClient = async <T>(_options: RequestOptions<T>) => {
      requestCalls += 1
      throw new Error('unexpected request')
    }
    const service = createUserAssetsService({
      request,
      ensureAnonymousContext: async () => null,
    })

    await expect(service.loadUserAssets()).rejects.toMatchObject({ code: 'session_invalid' })
    await expect(service.setFavorite({ targetType: 'listing', targetSlug: 'jing-an-100' }, true))
      .rejects.toMatchObject({ code: 'session_invalid' })
    expect(requestCalls).toBe(0)
  })

  it('服务端重载恢复收藏，且不同 service 实例读取同一服务端状态', async () => {
    const serverListings = new Set<string>()
    const requestCalls: Array<Readonly<{
      path: string
      method: string | undefined
      anonymousContextToken: string | undefined
    }>> = []
    const request: UserAssetsRequestClient = async <T>(options: RequestOptions<T>) => {
      requestCalls.push({
        path: options.path,
        method: options.method,
        anonymousContextToken: options.anonymousContextToken,
      })
      if (options.path === '/api/mini/v1/favorites') {
        const data = options.data
        if (typeof data !== 'object' || data === null || !('targetSlug' in data)) {
          throw new Error('invalid test request')
        }
        const slug = data.targetSlug
        if (typeof slug !== 'string') throw new Error('invalid test slug')
        if (options.method === 'PUT') serverListings.add(slug)
        if (options.method === 'DELETE') serverListings.delete(slug)
        return parseThrough(options, {
          favorite: options.method === 'PUT',
          ...(options.method === 'PUT' ? { created: true } : { removed: true }),
          targetType: 'listing',
          targetSlug: slug,
        })
      }
      return parseThrough(options, {
        ...emptyAssets(),
        counts: { favorites: serverListings.size, inquiries: 0 },
        favorites: {
          listings: [...serverListings].map((slug) => listingFavorite(slug)),
          buildings: [],
        },
      })
    }
    const dependencies = {
      request,
      ensureAnonymousContext: async () => 'server-session',
    }
    const first = createUserAssetsService(dependencies)
    const second = createUserAssetsService(dependencies)

    const saved = await first.setFavorite({ targetType: 'listing', targetSlug: 'jing-an-100' }, true)
    expect(isFavorite(saved, { targetType: 'listing', targetSlug: 'jing-an-100' })).toBe(true)

    const restored = await second.loadUserAssets()
    expect(isFavorite(restored, { targetType: 'listing', targetSlug: 'jing-an-100' })).toBe(true)
    expect(requestCalls.every((options) => options.anonymousContextToken === 'server-session')).toBe(true)
  })

  it('写请求网络失败时不产生本地成功，且下一次读取仍以服务端为准', async () => {
    let failWrite = true
    const request: UserAssetsRequestClient = async <T>(options: RequestOptions<T>) => {
      if (options.path === '/api/mini/v1/favorites') {
        if (failWrite) throw new Error('network unavailable')
        return parseThrough(options, {
          favorite: true,
          created: true,
          targetType: 'building',
          targetSlug: 'jing-an-center',
        })
      }
      return parseThrough(options, emptyAssets())
    }
    const service = createUserAssetsService({
      request,
      ensureAnonymousContext: async () => 'server-session',
    })

    await expect(service.setFavorite({ targetType: 'building', targetSlug: 'jing-an-center' }, true))
      .rejects.toThrow('network unavailable')
    failWrite = false
    const reloaded = await service.refreshUserAssets()
    expect(isFavorite(reloaded, { targetType: 'building', targetSlug: 'jing-an-center' })).toBe(false)
  })

  it('写响应成功但写后 GET 未反映目标状态时拒绝成功结果', async () => {
    const request: UserAssetsRequestClient = async <T>(options: RequestOptions<T>) => {
      if (options.path === '/api/mini/v1/favorites') {
        return parseThrough(options, {
          favorite: true,
          created: true,
          targetType: 'listing',
          targetSlug: 'jing-an-100',
        })
      }
      return parseThrough(options, emptyAssets())
    }
    const service = createUserAssetsService({
      request,
      ensureAnonymousContext: async () => 'server-session',
    })

    await expect(service.setFavorite(
      { targetType: 'listing', targetSlug: 'jing-an-100' },
      true,
    )).rejects.toMatchObject({ code: 'favorite_unconfirmed' })
    await expect(service.refreshUserAssets()).resolves.toEqual(emptyAssets())
  })

  it('写响应成功但写后 GET 网络失败时向调用方失败关闭', async () => {
    const request: UserAssetsRequestClient = async <T>(options: RequestOptions<T>) => {
      if (options.path === '/api/mini/v1/favorites') {
        return parseThrough(options, {
          favorite: true,
          created: true,
          targetType: 'listing',
          targetSlug: 'jing-an-100',
        })
      }
      throw new Error('post-write read unavailable')
    }
    const service = createUserAssetsService({
      request,
      ensureAnonymousContext: async () => 'server-session',
    })

    await expect(service.setFavorite(
      { targetType: 'listing', targetSlug: 'jing-an-100' },
      true,
    )).rejects.toThrow('post-write read unavailable')
  })

  it('Storage 旧收藏仅作迁移候选，PUT 与 /me 都确认后才展示', async () => {
    const removeStorageSync = vi.fn()
    const setStorageSync = vi.fn()
    vi.stubGlobal('wx', {
      getStorageSync: vi.fn((key: string) => {
        if (key === 'sbh_fav_listings_v1') {
          return [{ slug: 'jing-an-100', title: '本地旧标题' }]
        }
        if (key === 'sbh_fav_buildings_v1') {
          return [{ slug: 'jing-an-center', name: '本地旧楼盘名' }]
        }
        return undefined
      }),
      setStorageSync,
      removeStorageSync,
    })
    const serverListings = new Set<string>()
    const serverBuildings = new Set<string>()
    const requestCalls: Array<readonly [string, string | undefined]> = []
    const request: UserAssetsRequestClient = async <T>(options: RequestOptions<T>) => {
      requestCalls.push([options.path, options.method])
      if (options.path === '/api/mini/v1/favorites') {
        const data = options.data
        if (typeof data !== 'object' || data === null || !('targetType' in data) || !('targetSlug' in data)) {
          throw new Error('invalid test request')
        }
        const targetType = data.targetType
        const targetSlug = data.targetSlug
        if ((targetType !== 'listing' && targetType !== 'building') || typeof targetSlug !== 'string') {
          throw new Error('invalid test target')
        }
        const targets = targetType === 'listing' ? serverListings : serverBuildings
        targets.add(targetSlug)
        return parseThrough(options, {
          favorite: true,
          created: true,
          targetType,
          targetSlug,
        })
      }
      return parseThrough(options, {
        counts: { favorites: serverListings.size + serverBuildings.size, inquiries: 0 },
        favorites: {
          listings: [...serverListings].map((slug) => listingFavorite(slug)),
          buildings: [...serverBuildings].map((slug) => buildingFavorite(slug)),
        },
        inquiries: [],
      })
    }
    const service = createUserAssetsService({
      request,
      ensureAnonymousContext: async () => 'server-session',
    })

    const assets = await service.loadUserAssets()

    expect(assets.favorites.listings[0]?.title).toBe('静安中心 100㎡')
    expect(assets.favorites.buildings[0]?.name).toBe('静安中心')
    expect(requestCalls).toEqual([
      ['/api/mini/v1/me', 'GET'],
      ['/api/mini/v1/favorites', 'PUT'],
      ['/api/mini/v1/favorites', 'PUT'],
      ['/api/mini/v1/me', 'GET'],
    ])
    expect(removeStorageSync).toHaveBeenCalledWith('sbh_fav_listings_v1')
    expect(removeStorageSync).toHaveBeenCalledWith('sbh_fav_buildings_v1')
    expect(setStorageSync).toHaveBeenCalledWith('sbh_user_assets_migrated_v1', true)
  })

  it('迁移 PUT 未确认时拒绝加载，绝不把本地候选回填为可见收藏', async () => {
    vi.stubGlobal('wx', {
      getStorageSync: vi.fn((key: string) => key === 'sbh_fav_listings_v1'
        ? [{ slug: 'local-only', title: '本地旧收藏' }]
        : undefined),
      setStorageSync: vi.fn(),
      removeStorageSync: vi.fn(),
    })
    const request: UserAssetsRequestClient = async <T>(options: RequestOptions<T>) => {
      if (options.path === '/api/mini/v1/favorites') throw new Error('write unconfirmed')
      return parseThrough(options, emptyAssets())
    }
    const service = createUserAssetsService({
      request,
      ensureAnonymousContext: async () => 'server-session',
    })

    await expect(service.loadUserAssets()).rejects.toThrow('write unconfirmed')
    await expect(service.refreshUserAssets()).resolves.toEqual(emptyAssets())
  })
})
