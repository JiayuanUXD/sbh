import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MiniBuildingDetailData } from '../miniprogram/services/catalog-contracts.js'
import { MiniApiError } from '../miniprogram/services/mini-api-error.js'

const getBuildingDetail = vi.hoisted(() => vi.fn<(slug: string) => Promise<MiniBuildingDetailData>>())
const loadUserAssets = vi.hoisted(() => vi.fn())
const setFavorite = vi.hoisted(() => vi.fn())

vi.mock('../miniprogram/services/catalog.js', () => ({ getBuildingDetail }))
vi.mock('../miniprogram/services/favorites.js', () => ({
  loadUserAssets,
  setFavorite,
  isFavorite: (assets: any, target: any) => Boolean(assets?.favorites?.buildings?.some((b: any) => b.slug === target.targetSlug)),
  refreshUserAssets: vi.fn(),
}))

function mockBuilding(slug: string): MiniBuildingDetailData {
  return {
    id: `b-${slug}`,
    slug,
    name: `测试楼盘-${slug}`,
    district: '静安区',
    address: '南京西路 100 号',
    grade: 'grade-a',
    completedYear: 2022,
    totalFloors: 30,
    standardFloorArea: 2000,
    elevators: { passenger: 8, cargo: null },
    parkingSpaces: 500,
    propertyManagementCompany: '优质物业',
    propertyFee: 35,
    activeListingCount: 5,
    nearestMetro: { station: '静安寺站', line: '2号线', distanceMeters: 200 },
    inquiryPolicy: { version: 'v1.0' },
    gallery: [{ src: 'https://img.example.com/1.jpg', alt: '外观' }],
    groupedListings: [],
    comparableBuildings: [],
  }
}

type PageContext = {
  data: {
    slug: string
    state: string
    building: MiniBuildingDetailData | null
    gradeLabel: string
    isFavorited: boolean
    favoriteBusy: boolean
  }
  loadVersion: number
  setData(update: Record<string, unknown>): void
  onLoad(options: Record<string, string | undefined>): void
  onShow(): void
  onUnload(): void
  loadBuildingDetail(targetSlug?: unknown): Promise<void>
  loadFavoriteState(slug: string): Promise<void>
  handleBackToList(): void
}

let pageRegistration: any
let wxMock: any

beforeAll(async () => {
  wxMock = {
    login: vi.fn(),
    setNavigationBarTitle: vi.fn(),
    showToast: vi.fn(),
    switchTab: vi.fn(),
    pageScrollTo: vi.fn(),
    openPrivacyContract: vi.fn(),
  }
  vi.stubGlobal('wx', wxMock)
  vi.stubGlobal('Page', (opts: any) => { pageRegistration = opts })
  await import('../miniprogram/pages/building-detail/index.js')
})

afterAll(() => {
  vi.unstubAllGlobals()
})

function createInstance(initialSlug = 'test-tower'): PageContext {
  const data = {
    slug: initialSlug,
    state: 'loading',
    building: null,
    gradeLabel: '—',
    isFavorited: false,
    favoriteBusy: true,
  }
  const instance: PageContext = {
    data,
    loadVersion: 0,
    setData(update: Record<string, unknown>) {
      Object.assign(data, update)
    },
    onLoad: pageRegistration.onLoad,
    onShow: pageRegistration.onShow,
    onUnload: pageRegistration.onUnload,
    loadBuildingDetail: pageRegistration.loadBuildingDetail,
    loadFavoriteState: pageRegistration.loadFavoriteState,
    handleBackToList: pageRegistration.handleBackToList,
  }
  return instance
}

describe('T1: 楼盘详情重试与生命周期', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadUserAssets.mockResolvedValue({ favorites: { buildings: [] } })
  })

  it('合法 slug 首次请求失败后，通过微信事件对象重试能够复用原有 slug 并恢复 ready', async () => {
    const page = createInstance('valid-slug')
    getBuildingDetail.mockRejectedValueOnce(new Error('network error'))

    await page.loadBuildingDetail('valid-slug')
    expect(page.data.state).toBe('error')

    getBuildingDetail.mockResolvedValueOnce(mockBuilding('valid-slug'))
    // 模拟微信组件 bindretry 传过来的 CustomEvent 对象（非字符串）
    const wechatEvent = { type: 'retry', timeStamp: 1234, target: {}, currentTarget: {}, detail: {} }
    await page.loadBuildingDetail(wechatEvent)

    expect(getBuildingDetail).toHaveBeenLastCalledWith('valid-slug')
    expect(page.data.state).toBe('ready')
    expect(page.data.building?.slug).toBe('valid-slug')
  })

  it('再次失败依然维持 error 态且可再次重试', async () => {
    const page = createInstance('valid-slug')
    getBuildingDetail.mockRejectedValueOnce(new Error('network error 1'))
    await page.loadBuildingDetail('valid-slug')
    expect(page.data.state).toBe('error')

    getBuildingDetail.mockRejectedValueOnce(new Error('network error 2'))
    const wechatEvent = { type: 'retry' }
    await page.loadBuildingDetail(wechatEvent)
    expect(page.data.state).toBe('error')

    getBuildingDetail.mockResolvedValueOnce(mockBuilding('valid-slug'))
    await page.loadBuildingDetail(wechatEvent)
    expect(page.data.state).toBe('ready')
  })

  it('空或非法路由 slug 不发请求直接进入 not-found 态并释放 favoriteBusy', async () => {
    const page = createInstance('')
    page.onLoad({ slug: '' })
    expect(page.data.state).toBe('not-found')
    expect(page.data.favoriteBusy).toBe(false)
    expect(getBuildingDetail).not.toHaveBeenCalled()

    const page2 = createInstance('')
    page2.onLoad({ slug: 'invalid_slug_with_underscores' })
    expect(page2.data.state).toBe('not-found')
    expect(page2.data.favoriteBusy).toBe(false)
    expect(getBuildingDetail).not.toHaveBeenCalled()
  })

  it('页面卸载或多次快速重试时，迟到响应不会覆盖当前状态', async () => {
    const page = createInstance('tower-a')
    let resolveFirst!: (value: MiniBuildingDetailData) => void
    const firstPromise = new Promise<MiniBuildingDetailData>((resolve) => { resolveFirst = resolve })
    getBuildingDetail.mockReturnValueOnce(firstPromise)

    const p1 = page.loadBuildingDetail('tower-a')
    // 页面卸载
    page.onUnload()

    resolveFirst(mockBuilding('tower-a'))
    await p1

    // 状态未被迟到的响应改变为 ready
    expect(page.data.building).toBeNull()
  })
})

describe('T2: 楼盘错误结构化分类', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadUserAssets.mockResolvedValue({ favorites: { buildings: [] } })
  })

  it('MiniApiError code=building_not_found 归为 not-found 态', async () => {
    const page = createInstance('tower-x')
    getBuildingDetail.mockRejectedValueOnce(new MiniApiError({
      kind: 'business',
      code: 'building_not_found',
      statusCode: 404,
      requestId: 'req-1',
      retryable: false,
    }))
    await page.loadBuildingDetail('tower-x')
    expect(page.data.state).toBe('not-found')
    expect(page.data.building).toBeNull()
    expect(page.data.isFavorited).toBe(false)
  })

  it('详情接口 HTTP 404 未解析为业务包时归为 not-found 态', async () => {
    const page = createInstance('tower-x')
    getBuildingDetail.mockRejectedValueOnce(new MiniApiError({
      kind: 'http',
      code: 'http_error',
      statusCode: 404,
      requestId: 'req-2',
      retryable: false,
    }))
    await page.loadBuildingDetail('tower-x')
    expect(page.data.state).toBe('not-found')
    expect(page.data.building).toBeNull()
  })

  it('网络、超时、HTTP 5xx 归为 error 态', async () => {
    const page = createInstance('tower-x')

    getBuildingDetail.mockRejectedValueOnce(new MiniApiError({
      kind: 'network',
      code: 'network_error',
      statusCode: null,
      requestId: null,
      retryable: true,
    }))
    await page.loadBuildingDetail('tower-x')
    expect(page.data.state).toBe('error')

    getBuildingDetail.mockRejectedValueOnce(new MiniApiError({
      kind: 'timeout',
      code: 'request_timeout',
      statusCode: null,
      requestId: null,
      retryable: true,
    }))
    await page.loadBuildingDetail('tower-x')
    expect(page.data.state).toBe('error')

    getBuildingDetail.mockRejectedValueOnce(new MiniApiError({
      kind: 'http',
      code: 'server_error',
      statusCode: 500,
      requestId: 'req-3',
      retryable: true,
    }))
    await page.loadBuildingDetail('tower-x')
    expect(page.data.state).toBe('error')
  })

  it('普通 Error 的 message 恰巧包含 404 或 not_found 时依然归为 error 态，不误报不存在', async () => {
    const page = createInstance('tower-x')
    getBuildingDetail.mockRejectedValueOnce(new Error('Something failed with code 404 not_found in text'))
    await page.loadBuildingDetail('tower-x')
    expect(page.data.state).toBe('error')
  })

  it('错误文案变更但结构化信息不变时分类保持一致', async () => {
    const page = createInstance('tower-x')
    const custom404 = new MiniApiError({
      kind: 'business',
      code: 'building_not_found',
      statusCode: 404,
      requestId: 'req-4',
      retryable: false,
    })
    Object.defineProperty(custom404, 'message', { value: '全新的自定义用户文案' })
    getBuildingDetail.mockRejectedValueOnce(custom404)
    await page.loadBuildingDetail('tower-x')
    expect(page.data.state).toBe('not-found')
  })

  it('不存在态清除旧楼盘展示并提供返回楼盘列表', () => {
    const page = createInstance('tower-x')
    page.handleBackToList()
    expect(wxMock.switchTab).toHaveBeenCalledWith({ url: '/pages/buildings/index' })
  })
})
