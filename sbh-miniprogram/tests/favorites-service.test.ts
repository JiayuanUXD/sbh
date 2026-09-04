import { afterEach, describe, expect, it, vi } from 'vitest'

import type { RequestOptions } from '../miniprogram/services/mini-api-contracts.js'
import { MiniApiError } from '../miniprogram/services/request.js'
import {
  createUserAssetsService,
  isFavorite,
  parseUserAssets,
  type UserAssets,
  type UserAssetsRequestClient,
} from '../miniprogram/services/user-assets.js'

const COMPLETE_PAGE_INFO = {
  favorites: { limit: 200, hasMore: false },
  inquiries: { limit: 100, hasMore: false },
} as const

function emptyAssets(): UserAssets {
  return {
    counts: { favorites: 0, inquiries: 0 },
    pageInfo: COMPLETE_PAGE_INFO,
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
  it('严格接收服务端分类型有界读取的 pageInfo 合同', () => {
    expect(parseUserAssets({
      counts: { favorites: 0, inquiries: 0 },
      pageInfo: {
        favorites: { limit: 200, hasMore: true },
        inquiries: { limit: 100, hasMore: false },
      },
      favorites: { listings: [], buildings: [] },
      inquiries: [],
    })).toMatchObject({
      pageInfo: {
        favorites: { limit: 200, hasMore: true },
        inquiries: { limit: 100, hasMore: false },
      },
    })

    expect(() => parseUserAssets({
      counts: { favorites: 0, inquiries: 0 },
      favorites: { listings: [], buildings: [] },
      inquiries: [],
    })).toThrow('invalid user assets response')
  })

  it('session 缺失时不发请求且 fail-closed', async () => {
    let requestCalls = 0
    const request: UserAssetsRequestClient = async <T>(_options: RequestOptions<T>) => {
      requestCalls += 1
      throw new Error('unexpected request')
    }
    const service = createUserAssetsService({
      request,
      ensureAnonymousContext: async () => null,
      clearAnonymousContext: () => undefined,
    })

    await expect(service.loadUserAssets()).rejects.toMatchObject({ code: 'session_invalid' })
    await expect(service.setFavorite({ targetType: 'listing', targetSlug: 'jing-an-100' }, true))
      .rejects.toMatchObject({ code: 'session_invalid' })
    expect(requestCalls).toBe(0)
  })

  it('/me 返回 session_invalid 时清理会话且本次不重试，用户下次重试才重新登录', async () => {
    let token = 'expired-token'
    let clearCalls = 0
    const requestTokens: string[] = []
    const request: UserAssetsRequestClient = async <T>(options: RequestOptions<T>) => {
      requestTokens.push(options.anonymousContextToken ?? '')
      if (options.anonymousContextToken === 'expired-token') {
        throw new MiniApiError({
          kind: 'business',
          code: 'session_invalid',
          statusCode: 401,
          requestId: 'expired-request',
          retryable: false,
        })
      }
      return parseThrough(options, emptyAssets())
    }
    const service = createUserAssetsService({
      request,
      ensureAnonymousContext: async () => token,
      clearAnonymousContext: () => {
        clearCalls += 1
        token = 'fresh-token'
      },
    })

    await expect(service.loadUserAssets()).rejects.toMatchObject({ code: 'session_invalid' })
    expect(requestTokens).toEqual(['expired-token'])
    expect(clearCalls).toBe(1)

    await expect(service.loadUserAssets()).resolves.toEqual(emptyAssets())
    expect(requestTokens).toEqual(['expired-token', 'fresh-token'])
  })

  it('/favorites 返回 session_invalid 时清理会话且不自动重试写请求', async () => {
    let token = 'expired-token'
    let clearCalls = 0
    const requestTokens: string[] = []
    const serverListings = new Set<string>()
    const request: UserAssetsRequestClient = async <T>(options: RequestOptions<T>) => {
      requestTokens.push(options.anonymousContextToken ?? '')
      if (options.anonymousContextToken === 'expired-token') {
        throw new MiniApiError({
          kind: 'business',
          code: 'session_invalid',
          statusCode: 401,
          requestId: 'expired-write',
          retryable: false,
        })
      }
      if (options.path === '/api/mini/v1/favorites') {
        serverListings.add('jing-an-100')
        return parseThrough(options, {
          favorite: true,
          created: true,
          targetType: 'listing',
          targetSlug: 'jing-an-100',
        })
      }
      return parseThrough(options, {
        counts: { favorites: serverListings.size, inquiries: 0 },
        pageInfo: COMPLETE_PAGE_INFO,
        favorites: {
          listings: [...serverListings].map((slug) => listingFavorite(slug)),
          buildings: [],
        },
        inquiries: [],
      })
    }
    const service = createUserAssetsService({
      request,
      ensureAnonymousContext: async () => token,
      clearAnonymousContext: () => {
        clearCalls += 1
        token = 'fresh-token'
      },
    })
    const target = { targetType: 'listing' as const, targetSlug: 'jing-an-100' }

    await expect(service.setFavorite(target, true)).rejects.toMatchObject({ code: 'session_invalid' })
    expect(requestTokens).toEqual(['expired-token'])
    expect(clearCalls).toBe(1)

    await expect(service.setFavorite(target, true)).resolves.toSatisfy((assets: UserAssets) => (
      isFavorite(assets, target)
    ))
    expect(requestTokens).toEqual(['expired-token', 'fresh-token', 'fresh-token'])
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
      clearAnonymousContext: () => undefined,
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
      clearAnonymousContext: () => undefined,
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
      clearAnonymousContext: () => undefined,
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
      clearAnonymousContext: () => undefined,
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
        pageInfo: COMPLETE_PAGE_INFO,
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
      clearAnonymousContext: () => undefined,
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

  it('Storage 已迁移状态不再读取或改写旧 key', async () => {
    const getStorageSync = vi.fn((key: string) => (
      key === 'sbh_user_assets_migrated_v1' ? true : undefined
    ))
    const removeStorageSync = vi.fn()
    const setStorageSync = vi.fn()
    vi.stubGlobal('wx', { getStorageSync, removeStorageSync, setStorageSync })
    const request: UserAssetsRequestClient = async <T>(options: RequestOptions<T>) => (
      parseThrough(options, emptyAssets())
    )
    const service = createUserAssetsService({
      request,
      ensureAnonymousContext: async () => 'server-session',
      clearAnonymousContext: () => undefined,
    })

    await expect(service.loadUserAssets()).resolves.toEqual(emptyAssets())
    expect(getStorageSync).toHaveBeenCalledTimes(1)
    expect(removeStorageSync).not.toHaveBeenCalled()
    expect(setStorageSync).not.toHaveBeenCalled()
  })

  it('Storage 读取失败时仍返回服务端确认资产，但保留旧 key 且不标记迁移', async () => {
    const removeStorageSync = vi.fn()
    const setStorageSync = vi.fn()
    vi.stubGlobal('wx', {
      getStorageSync: vi.fn((key: string) => {
        if (key === 'sbh_user_assets_migrated_v1') return false
        throw new Error('storage read unavailable')
      }),
      removeStorageSync,
      setStorageSync,
    })
    const serverAssets: UserAssets = {
      counts: { favorites: 1, inquiries: 0 },
      pageInfo: COMPLETE_PAGE_INFO,
      favorites: {
        listings: [{ slug: 'jing-an-100', title: '静安中心 100㎡', coverImage: null }],
        buildings: [],
      },
      inquiries: [],
    }
    const request: UserAssetsRequestClient = async <T>(options: RequestOptions<T>) => (
      parseThrough(options, {
        ...serverAssets,
        favorites: { listings: [listingFavorite()], buildings: [] },
      })
    )
    const service = createUserAssetsService({
      request,
      ensureAnonymousContext: async () => 'server-session',
      clearAnonymousContext: () => undefined,
    })

    await expect(service.loadUserAssets()).resolves.toEqual(serverAssets)
    expect(removeStorageSync).not.toHaveBeenCalled()
    expect(setStorageSync).not.toHaveBeenCalled()
  })

  it.each([
    { targetType: 'listing' as const, targetSlug: 'removed-listing', code: 'listing_not_found' },
    { targetType: 'building' as const, targetSlug: 'removed-building', code: 'building_not_found' },
  ])('确定性失效候选 $code 不阻塞 profile，并在服务端确认后完成迁移', async (candidate) => {
    const removeStorageSync = vi.fn()
    const setStorageSync = vi.fn()
    vi.stubGlobal('wx', {
      getStorageSync: vi.fn((key: string) => {
        if (key === 'sbh_user_assets_migrated_v1') return false
        if (key === 'sbh_fav_listings_v1' && candidate.targetType === 'listing') {
          return [{ slug: candidate.targetSlug }]
        }
        if (key === 'sbh_fav_buildings_v1' && candidate.targetType === 'building') {
          return [{ slug: candidate.targetSlug }]
        }
        return undefined
      }),
      removeStorageSync,
      setStorageSync,
    })
    const request: UserAssetsRequestClient = async <T>(options: RequestOptions<T>) => {
      if (options.path === '/api/mini/v1/favorites') {
        throw new MiniApiError({
          kind: 'business',
          code: candidate.code,
          statusCode: 404,
          requestId: 'removed-target',
          retryable: false,
        })
      }
      return parseThrough(options, emptyAssets())
    }
    const service = createUserAssetsService({
      request,
      ensureAnonymousContext: async () => 'server-session',
      clearAnonymousContext: () => undefined,
    })

    await expect(service.loadUserAssets()).resolves.toEqual(emptyAssets())
    expect(removeStorageSync).toHaveBeenCalledWith('sbh_fav_listings_v1')
    expect(removeStorageSync).toHaveBeenCalledWith('sbh_fav_buildings_v1')
    expect(setStorageSync).toHaveBeenCalledWith('sbh_user_assets_migrated_v1', true)
  })

  it('迁移遇到 503 时失败关闭并保留候选供后续重试', async () => {
    const removeStorageSync = vi.fn()
    const setStorageSync = vi.fn()
    vi.stubGlobal('wx', {
      getStorageSync: vi.fn((key: string) => (
        key === 'sbh_fav_listings_v1' ? [{ slug: 'jing-an-100' }] : undefined
      )),
      removeStorageSync,
      setStorageSync,
    })
    const request: UserAssetsRequestClient = async <T>(options: RequestOptions<T>) => {
      if (options.path === '/api/mini/v1/favorites') {
        throw new MiniApiError({
          kind: 'http',
          code: 'service_unavailable',
          statusCode: 503,
          requestId: 'migration-unavailable',
          retryable: false,
        })
      }
      return parseThrough(options, emptyAssets())
    }
    const service = createUserAssetsService({
      request,
      ensureAnonymousContext: async () => 'server-session',
      clearAnonymousContext: () => undefined,
    })

    await expect(service.loadUserAssets()).rejects.toMatchObject({ code: 'service_unavailable' })
    expect(removeStorageSync).not.toHaveBeenCalled()
    expect(setStorageSync).not.toHaveBeenCalled()
  })

  it('迁移 PUT 未确认时拒绝加载，绝不把本地候选回填为可见收藏', async () => {
    const removeStorageSync = vi.fn()
    const setStorageSync = vi.fn()
    vi.stubGlobal('wx', {
      getStorageSync: vi.fn((key: string) => key === 'sbh_fav_listings_v1'
        ? [{ slug: 'local-only', title: '本地旧收藏' }]
        : undefined),
      setStorageSync,
      removeStorageSync,
    })
    const request: UserAssetsRequestClient = async <T>(options: RequestOptions<T>) => {
      if (options.path === '/api/mini/v1/favorites') throw new Error('write unconfirmed')
      return parseThrough(options, emptyAssets())
    }
    const service = createUserAssetsService({
      request,
      ensureAnonymousContext: async () => 'server-session',
      clearAnonymousContext: () => undefined,
    })

    await expect(service.loadUserAssets()).rejects.toThrow('write unconfirmed')
    await expect(service.refreshUserAssets()).resolves.toEqual(emptyAssets())
    expect(removeStorageSync).not.toHaveBeenCalled()
    expect(setStorageSync).not.toHaveBeenCalled()
  })
})
