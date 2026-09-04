import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  BuildingFilteredResult,
  BuildingSearchInput,
} from '@/domain/public-catalog'
import {
  emptyBuildingSupplySnapshot,
  mapBuildingDetail,
  mapBuildingSummary,
} from '@/domain/public-catalog'
import { BUILDING_JINGAN_CENTER } from '@/test/frontend/payload-documents'

const io = vi.hoisted(() => ({
  resolveCityContext: vi.fn(),
  getCachedMiniBuildings: vi.fn(),
  getCachedMiniBuildingDetail: vi.fn(),
  getSiteConfig: vi.fn(),
}))

vi.mock('@/app/(frontend)/_lib/city-context', () => ({
  resolveCityContext: io.resolveCityContext,
}))

vi.mock('@/lib/mini-program/cached-queries', () => ({
  getCachedMiniBuildings: io.getCachedMiniBuildings,
  getCachedMiniBuildingDetail: io.getCachedMiniBuildingDetail,
}))

vi.mock('@/lib/frontend/site-config', () => ({
  getSiteConfig: io.getSiteConfig,
}))

import {
  getMiniBuildingDetail,
  getMiniBuildings,
} from '@/lib/mini-program/catalog-service'

const AS_OF = '2026-09-04T00:00:00.000Z'

function mappedBuildingSummary() {
  const building = mapBuildingSummary(BUILDING_JINGAN_CENTER)
  if (building === null) throw new Error('公共楼盘摘要 fixture 映射失败')
  return { ...building, listingCount: 3 }
}

function mappedBuildingDetail() {
  const building = mapBuildingDetail({
    ...BUILDING_JINGAN_CENTER,
    completionDate: '2013-01-01T00:00:00.000Z',
    totalFloors: 66,
  }, AS_OF)
  if (building === null) throw new Error('公共楼盘详情 fixture 映射失败')
  return building
}

function resultFixture(): BuildingFilteredResult {
  const building = mappedBuildingSummary()
  return {
    docs: [building],
    groups: { withStock: [building], withoutStock: [] },
    totalDocs: 1,
    withStockTotal: 1,
    withoutStockTotal: 0,
    unfilteredTotalDocs: 1,
    page: 2,
    totalPages: 2,
    facets: { districts: [], grades: [], metros: [] },
    dimensionHits: {
      district: 1,
      grade: 1,
      metro: 1,
      leasableArea: 1,
      completedAfter: 1,
      onlyWithStock: 1,
    },
  }
}

function observedInput(onPageSizeRead: () => void): BuildingSearchInput {
  return {
    sort: 'stock-desc',
    page: 2,
    get pageSize(): 24 {
      onPageSizeRead()
      return 24
    },
  }
}

describe('Mini 楼盘 catalog service 编排', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    io.resolveCityContext.mockResolvedValue({
      slug: 'shanghai',
      serviceStatus: 'live',
    })
    io.getSiteConfig.mockReturnValue({
      siteOrigin: 'https://sbh.example',
      privacyPolicyVersion: 'policy-building-v2',
    })
  })

  it('把 URL 解析结果和缓存快照的权威 pageSize 贯通到真实 Mini mapper', async () => {
    let pageSizeReads = 0
    const snapshotInput = observedInput(() => { pageSizeReads += 1 })
    io.getCachedMiniBuildings.mockResolvedValue({
      asOf: AS_OF,
      data: { result: resultFixture(), input: snapshotInput },
    })

    const snapshot = await getMiniBuildings(new URL(
      'https://example.test/api/mini/v1/buildings?city=shanghai&page=2&pageSize=999',
    ))

    expect(io.getCachedMiniBuildings).toHaveBeenCalledWith(
      'shanghai',
      expect.objectContaining({ page: 2, pageSize: 24 }),
    )
    expect(pageSizeReads).toBe(1)
    expect(snapshot?.data.pagination).toMatchObject({ page: 2, pageSize: 24 })
    expect(snapshot?.data.items[0]).toMatchObject({ grade: 'grade-a', activeListingCount: 3 })
  })

  it('只 mock 查询边界并用真实公共 mapper 输出完成楼盘详情编排', async () => {
    io.getCachedMiniBuildingDetail.mockResolvedValue({
      asOf: AS_OF,
      data: {
        detail: {
          building: mappedBuildingDetail(),
          supply: emptyBuildingSupplySnapshot(AS_OF),
        },
        comparable: [mappedBuildingSummary()],
      },
    })

    const resolution = await getMiniBuildingDetail('shanghai', 'jingan-center')

    expect(io.getCachedMiniBuildingDetail).toHaveBeenCalledWith('shanghai', 'jingan-center')
    expect(resolution).toMatchObject({
      status: 'ok',
      snapshot: {
        data: {
          slug: 'jingan-center',
          grade: 'grade-a',
          completedYear: 2013,
          inquiryPolicy: { version: 'policy-building-v2' },
          comparableBuildings: [{ slug: 'jingan-center', grade: 'grade-a' }],
        },
      },
    })
  })
})
