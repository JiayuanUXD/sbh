/**
 * OPT-068 生产供给适配器：轻量扫描与按 id 回捞。
 *
 * 锁定三件事：
 *   1. 扫描查询只取行模型需要的字段（select）、只展开判定需要的关联字段（populate），
 *      depth 2、按 id 稳定排序、每页 1000——线上实测 depth 2 全字段每 200 条 1.5 秒，
 *      同样的查询收窄字段后 0.27 秒，这是整个 OPT-068 的收益来源，不能被谁顺手改回去。
 *   2. 扫描仍过完整有效供给谓词：粗筛 where + 举报暂停排除 + 精筛，商户不合格的行不出现。
 *   3. 回捞按 id in 查询、同样过精筛；空 id 列表不打库。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const payloadState = vi.hoisted(() => ({
  find: vi.fn<(params: Record<string, unknown>) => Promise<Record<string, unknown>>>(),
}))

vi.mock('payload', () => ({
  getPayload: async () => ({ find: payloadState.find }),
}))

vi.mock('@/payload.config', () => ({ default: {} }))

import {
  createPayloadSupplyAdapter,
  createSearchContext,
  parseListingSearchInput,
} from '@/domain/public-catalog'

function listing(id: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    slug: `listing-${id}`,
    title: `房源 ${id}`,
    listingType: 'traditional-office',
    businessType: 'lease',
    area: 100 + id,
    isFeatured: id === 1,
    updatedAt: `2026-08-0${(id % 9) + 1}T00:00:00.000Z`,
    price: { amount: 5, currency: 'CNY', period: 'day', unit: 'sqm' },
    publicationStatus: 'published',
    reviewStatus: 'approved',
    supplyVisibilityHold: 'normal',
    merchant: {
      id: 50,
      status: 'active',
      qualificationStatus: 'valid',
      qualificationExpiresAt: '2027-01-01T00:00:00.000Z',
      serviceCities: [{ id: 100 }],
    },
    building: {
      id: 10,
      slug: 'building-10',
      name: 'Building 10',
      city: { id: 100, slug: 'shanghai', name: '上海市', type: 'city', status: 'active' },
      district: { id: 101, slug: 'jing-an', name: '静安区', type: 'district', status: 'active' },
      businessDistrict: { id: 201, slug: 'nanjing-xi-lu', name: '南京西路', type: 'business_area', status: 'active' },
      latitude: 31.2304,
      longitude: 121.4737,
    },
    ...over,
  }
}

const EXPECTED_SELECT = {
  slug: true,
  title: true,
  listingType: true,
  businessType: true,
  area: true,
  price: true,
  rent: true,
  rentUnit: true,
  isFeatured: true,
  updatedAt: true,
  building: true,
  merchant: true,
}

const EXPECTED_POPULATE = {
  buildings: { slug: true, name: true, city: true, district: true, businessDistrict: true, latitude: true, longitude: true },
  locations: { name: true, slug: true, type: true, status: true },
  merchants: { status: true, qualificationStatus: true, qualificationExpiresAt: true, serviceCities: true },
}

const ctx = createSearchContext('shanghai')
const parse = (q: string) => parseListingSearchInput(new URLSearchParams(q))

function listingCalls() {
  return payloadState.find.mock.calls
    .map(([params]) => params)
    .filter((params) => params.collection === 'listings')
}

describe('OPT-068 supply adapter：scanEffectiveListings', () => {
  beforeEach(() => {
    payloadState.find.mockReset()
  })

  it('只取行模型字段、只展开判定字段，depth 2 / limit 1000 / sort id，并保留粗筛 where', async () => {
    payloadState.find.mockImplementation(async (params) => {
      if (params.collection === 'listing-reports') return { docs: [], hasNextPage: false }
      if (params.collection === 'listings') {
        return { docs: [listing(1), listing(2, { merchant: { ...(listing(2).merchant as object), status: 'disabled' } })], hasNextPage: false }
      }
      throw new Error(`unexpected collection ${String(params.collection)}`)
    })

    const adapter = createPayloadSupplyAdapter()
    const rows = await adapter.scanEffectiveListings!(parse('areaMin=100'), ctx)

    const [call] = listingCalls()
    expect(call.depth).toBe(2)
    expect(call.limit).toBe(1000)
    expect(call.sort).toBe('id')
    expect(call.select).toEqual(EXPECTED_SELECT)
    expect(call.populate).toEqual(EXPECTED_POPULATE)
    expect(call.where).toMatchObject({
      publicationStatus: { equals: 'published' },
      reviewStatus: { equals: 'approved' },
      'building.city.slug': { equals: 'shanghai' },
      area: { greater_than_equal: 100 },
    })

    // 商户停用的第 2 条被精筛掉；第 1 条投影成行
    expect(rows.map((r) => r.id)).toEqual([1])
    expect(rows[0]).toMatchObject({
      slug: 'listing-1',
      listingType: 'traditional-office',
      buildingId: 10,
      district: { id: 101, slug: 'jing-an', name: '静安区' },
      businessDistrictId: 201,
      isFeatured: true,
      coordinates: { latitude: 31.2304, longitude: 121.4737 },
    })
    expect(rows[0].price?.displayUnit).toBe('rmb-sqm-day')
  })

  it('翻页直到没有下一页，并在 5000 条封顶', async () => {
    const pageOf = (page: number) =>
      Array.from({ length: 1000 }, (_, i) => listing((page - 1) * 1000 + i + 1))
    payloadState.find.mockImplementation(async (params) => {
      if (params.collection === 'listing-reports') return { docs: [], hasNextPage: false }
      if (params.collection === 'listings') {
        const page = Number(params.page ?? 1)
        return { docs: pageOf(page), hasNextPage: true, nextPage: page + 1 }
      }
      throw new Error(`unexpected collection ${String(params.collection)}`)
    })

    const adapter = createPayloadSupplyAdapter()
    const rows = await adapter.scanEffectiveListings!(parse(''), ctx)

    expect(rows).toHaveLength(5000)
    expect(listingCalls().map((c) => c.page)).toEqual([1, 2, 3, 4, 5])
  })

  it('区域筛选仍走楼盘 id 下推（与 findEffectiveListings 同一 where 构造）', async () => {
    payloadState.find.mockImplementation(async (params) => {
      if (params.collection === 'listing-reports') return { docs: [], hasNextPage: false }
      if (params.collection === 'buildings') return { docs: [{ id: 10 }, { id: 11 }], hasNextPage: false }
      if (params.collection === 'listings') return { docs: [listing(1)], hasNextPage: false }
      throw new Error(`unexpected collection ${String(params.collection)}`)
    })

    const adapter = createPayloadSupplyAdapter()
    await adapter.scanEffectiveListings!(parse('district=jing-an'), ctx)
    expect(listingCalls()[0].where).toMatchObject({ building: { in: [10, 11] } })
  })
})

describe('OPT-068 supply adapter：findEffectiveListingsByIds', () => {
  beforeEach(() => {
    payloadState.find.mockReset()
  })

  it('按 id in 回捞 depth 2，并过精筛', async () => {
    payloadState.find.mockImplementation(async (params) => {
      if (params.collection === 'listing-reports') return { docs: [], hasNextPage: false }
      if (params.collection === 'listings') {
        return {
          docs: [listing(1), listing(3, { merchant: { ...(listing(3).merchant as object), status: 'disabled' } })],
          hasNextPage: false,
        }
      }
      throw new Error(`unexpected collection ${String(params.collection)}`)
    })

    const adapter = createPayloadSupplyAdapter()
    const docs = await adapter.findEffectiveListingsByIds!([3, 1], ctx)

    const [call] = listingCalls()
    expect(call.depth).toBe(2)
    expect(call.limit).toBe(2)
    // 粗筛 where 可能已含 `id.not_in`（举报暂停），所以 id in 必须用 and 合并而不是覆盖
    expect(call.where).toEqual({
      and: [
        expect.objectContaining({
          publicationStatus: { equals: 'published' },
          'building.city.slug': { equals: 'shanghai' },
        }),
        { id: { in: [3, 1] } },
      ],
    })
    expect(docs.map((d) => d.id)).toEqual([1])
  })

  it('空 id 列表不打库', async () => {
    const adapter = createPayloadSupplyAdapter()
    expect(await adapter.findEffectiveListingsByIds!([], ctx)).toEqual([])
    expect(payloadState.find).not.toHaveBeenCalled()
  })
})
