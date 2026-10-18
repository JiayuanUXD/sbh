import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  parseMiniBuildingCard,
  parseMiniBuildingDetailData,
  type MiniBuildingCard,
} from '../miniprogram/services/catalog-contracts.js'

const getBuildingDetail = vi.hoisted(() => vi.fn())
vi.mock('../miniprogram/services/catalog.js', () => ({ getBuildingDetail }))

type CardContext = { setData(update: Record<string, unknown>): void }
type DetailContext = CardContext & {
  data: { slug: string }
  loadFavoriteState(slug: string): void
}
let card: { methods: { computeFields(this: CardContext, building: MiniBuildingCard): void } }
let detail: { loadBuildingDetail(this: DetailContext, slug: string): Promise<void> }

const building = {
  id: 'building-1', slug: 'test-building', name: '测试楼宇', address: '测试路 1 号',
  district: null, completedYear: null, totalFloors: null, occupancyRate: null,
  activeListingCount: 0, priceRange: null, coverImage: null, nearestMetro: null,
}

beforeAll(async () => {
  vi.stubGlobal('wx', { login: vi.fn(), setNavigationBarTitle: vi.fn() })
  vi.stubGlobal('Component', (value: typeof card) => { card = value })
  vi.stubGlobal('Page', (value: typeof detail) => { detail = value })
  // 组件由小程序 tsconfig 独立检查，测试侧只捕获运行时注册结果。
  const cardModule = '../miniprogram/components/building-card/index.js'
  await import(cardModule)
  await import('../miniprogram/pages/building-detail/index.js')
})

afterAll(() => vi.unstubAllGlobals())

describe('楼盘等级真实消费面', () => {
  it.each([
    ['super-grade-a', '超甲级'],
    ['grade-a', '甲级'],
    ['grade-b', '乙级'],
    ['ungraded', '未评级'],
    ['creative-park', '未评级'],
    ['serviced-office', '未评级'],
    [null, '未评级'],
  ])('卡片与详情将服务响应 %s 展示为 %s', async (grade, label) => {
    const cardData: Record<string, unknown> = {}
    card.methods.computeFields.call(
      { setData: (update) => Object.assign(cardData, update) },
      parseMiniBuildingCard({ ...building, grade }),
    )
    expect(cardData.factsText).toBe(label)

    getBuildingDetail.mockResolvedValueOnce(parseMiniBuildingDetailData({
      ...building, grade, standardFloorArea: null, elevators: null, parkingSpaces: null,
      propertyManagementCompany: null, propertyFee: null, gallery: [], groupedListings: [],
      comparableBuildings: [], inquiryPolicy: { version: 'test-v1' },
    }))
    const detailData: Record<string, unknown> = {}
    await detail.loadBuildingDetail.call({
      data: { slug: building.slug },
      setData: (update) => Object.assign(detailData, update),
      loadFavoriteState: vi.fn(),
    }, building.slug)
    expect(detailData.state).toBe('ready')
    expect(detailData.gradeLabel).toBe(label)
  })
})
