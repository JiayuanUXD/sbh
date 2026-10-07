import { describe, expect, it } from 'vitest'

import {
  buildingCreateData,
  buildingFillPatch,
  lexicalHasText,
  listingCreateData,
  listingUpdatePatch,
  retireDecision,
  textToLexical,
  unflattenSnapshot,
} from '@/domain/supply-sync/huizuxuanzhi-apply'
import type { HuizuBuildingRow, HuizuListingRow } from '@/domain/supply-sync/huizuxuanzhi-row'

const SYNCED = '2026-10-06T00:00:00.000Z'
const REFS = { cityId: 1, districtId: 10, businessDistrictId: 100 }

const building: HuizuBuildingRow = {
  kind: 'building',
  externalId: '5086',
  sourceUrl: 'https://www.huizuxuanzhi.com/loupan/l5086',
  slug: 'bin-gang-shang-ye-zhong-xin-5086',
  attachToBuildingId: null,
  name: '滨港商业中心',
  districtName: '虹口区',
  businessAreaName: '四川北路',
  address: '四川北路989弄',
  latitude: 31.249796,
  longitude: 121.484124,
  completionYear: 2024,
  totalFloors: 36,
  grossFloorArea: 300000,
  standardFloorHeight: 4.5,
  netCeilingHeight: 3.2,
  passengerElevators: 19,
  elevatorNote: '客梯19部',
  airConditioning: 'VAV中央空调系统',
  network: '电信',
  propertyFee: 39,
  parkingSpaces: 1100,
  parkingFee: '1000元/月',
  developer: null,
  propertyCompany: 'CBRE',
  description: '第一段\n第二段',
  images: [],
}

const listing: HuizuListingRow = {
  kind: 'listing',
  externalId: '63445',
  buildingExternalId: '5086',
  sourceUrl: 'https://www.huizuxuanzhi.com/loupan/l5086-x63445.html',
  slug: 'bin-gang-400-jing-zhuang-xiu-huizu-63445',
  title: '滨港商业中心 400㎡ 精装修',
  area: 400,
  dailyRent: 5,
  decorationStatus: 'furnished',
  decorationRaw: '精装修',
  registrable: true,
  floor: '中层',
  orientation: '朝东南',
  efficiencyRate: 70,
  seatMin: 40,
  seatMax: 80,
  isDivisible: false,
  paymentTerms: '押3付1',
  depositMonths: 3,
  minimumLeaseMonths: 24,
  propertyFee: null,
  description: '套话',
}

describe('富文本', () => {
  it('按行切段落；空文本为 null', () => {
    const doc = textToLexical('第一段\n\n 第二段 ')
    expect(doc?.root.children.map((p) => p.children[0].text)).toEqual(['第一段', '第二段'])
    expect(textToLexical('  \n ')).toBeNull()
    expect(textToLexical(null)).toBeNull()
  })

  it('空段落的编辑器算「空」', () => {
    expect(lexicalHasText(textToLexical('有字'))).toBe(true)
    expect(
      lexicalHasText({
        root: { children: [{ type: 'paragraph', children: [] }] },
      }),
    ).toBe(false)
    expect(lexicalHasText(null)).toBe(false)
  })
})

describe('楼盘', () => {
  it('新建一律草稿，带 dataSource 与 slug', () => {
    const data = buildingCreateData(building, REFS, SYNCED)
    expect(data).toMatchObject({
      name: '滨港商业中心',
      slug: 'bin-gang-shang-ye-zhong-xin-5086',
      status: 'draft',
      operationalStatus: 'active',
      city: 1,
      district: 10,
      businessDistrict: 100,
      completionDate: '2024-01-01T00:00:00.000Z',
      developerAndScale: {
        grossFloorArea: 300000,
        standardFloorHeight: 4.5,
        netCeilingHeight: 3.2,
      },
      verticalTransport: { passengerElevators: 19 },
      dataSource: {
        source: 'huizuxuanzhi',
        externalId: '5086',
        sourceUrl: building.sourceUrl,
        syncedAt: SYNCED,
      },
    })
  })

  it('只填空：非空字段不覆盖，组内只补空的子字段，名称与区永不改', () => {
    const existing = {
      name: '滨港商业中心（运营改过的名字）',
      district: 99,
      address: '运营精修过的地址',
      latitude: null,
      totalFloors: 0,
      developerAndScale: {
        developer: '运营填的开发商',
        grossFloorArea: null,
        standardFloorHeight: 4.2,
      },
      description: {
        root: { children: [{ type: 'paragraph', children: [] }] },
      },
    }
    const { patch, filled } = buildingFillPatch(existing, building, REFS)
    expect(patch).not.toHaveProperty('name')
    expect(patch).not.toHaveProperty('district')
    expect(patch).not.toHaveProperty('address')
    expect(patch.latitude).toBe(31.249796)
    // 0 是有效值，不算空
    expect(patch).not.toHaveProperty('totalFloors')
    expect(patch.developerAndScale).toEqual({
      developer: '运营填的开发商',
      grossFloorArea: 300000,
      standardFloorHeight: 4.2,
      netCeilingHeight: 3.2,
    })
    expect(filled).toContain('description')
    expect(filled).toContain('developerAndScale.grossFloorArea')
    expect(filled).not.toContain('developerAndScale.standardFloorHeight')
  })

  it('什么都不缺时补丁为空', () => {
    const full = buildingCreateData(building, REFS, SYNCED)
    expect(buildingFillPatch(full, building, REFS)).toEqual({
      patch: {},
      filled: [],
    })
  })
})

describe('房源', () => {
  it('新建一律草稿 / 未提交 / 正常，价格四件套与旧两列同时写', () => {
    const data = listingCreateData(listing, 22, 1, SYNCED)
    expect(data).toMatchObject({
      title: '滨港商业中心 400㎡ 精装修',
      slug: listing.slug,
      building: 22,
      merchant: 1,
      publicationStatus: 'draft',
      reviewStatus: 'not_submitted',
      supplyVisibilityHold: 'normal',
      rent: 5,
      rentUnit: 'rmb-sqm-day',
      price: { amount: 5, currency: 'CNY', period: 'day', unit: 'sqm' },
      registrationStatus: 'available',
      seats: 80,
      spaceDetails: {
        seatMin: 40,
        seatMax: 80,
        efficiencyRate: 70,
        isDivisible: false,
      },
      costTerms: { depositMonths: 3, propertyFeeAmount: null },
    })
  })

  it('没有日租金时旧两列一起置空', () => {
    const data = listingCreateData({ ...listing, dailyRent: null }, 22, 1, SYNCED)
    expect(data.rent).toBeNull()
    expect(data.rentUnit).toBeNull()
  })

  it('覆盖补丁：不碰状态 / 商户 / slug，记录被改叶子的原值', () => {
    const existing = {
      ...listingCreateData(listing, 22, 1, SYNCED),
      publicationStatus: 'published',
      reviewStatus: 'approved',
      // 2026-08 那轮误把「精装修」以外的也映射成 furnished；这里模拟价格与装修都变了
      rent: '4.5',
      price: { amount: 4.5, currency: 'CNY', period: 'day', unit: 'sqm' },
      decorationStatus: 'simple',
      building: { id: 22, name: '滨港商业中心' },
    }
    const { patch, before, changed } = listingUpdatePatch(existing, listing, 22, '2026-10-07T00:00:00.000Z')
    expect(patch).not.toHaveProperty('slug')
    expect(patch).not.toHaveProperty('merchant')
    expect(patch).not.toHaveProperty('publicationStatus')
    expect(patch).not.toHaveProperty('reviewStatus')
    expect(changed.sort()).toEqual(['decorationStatus', 'price.amount', 'rent'])
    expect(before).toEqual({
      rent: '4.5',
      'price.amount': 4.5,
      decorationStatus: 'simple',
    })
    expect(patch.dataSource).toMatchObject({
      source: 'huizuxuanzhi',
      externalId: '63445',
      syncedAt: '2026-10-07T00:00:00.000Z',
    })
  })

  it('采集值与库里一致时 changed 为空（numeric 列读回字符串、关系读回对象都不算变化）', () => {
    const existing = {
      ...listingCreateData(listing, 22, 1, SYNCED),
      area: '400',
      building: { id: 22 },
    }
    expect(listingUpdatePatch(existing, listing, 22, SYNCED).changed).toEqual([])
  })

  it('快照能还原成嵌套补丁', () => {
    expect(
      unflattenSnapshot({
        rent: 4.5,
        'price.amount': 4.5,
        'spaceDetails.seatMax': 60,
      }),
    ).toEqual({
      rent: 4.5,
      price: { amount: 4.5 },
      spaceDetails: { seatMax: 60 },
    })
  })
})

describe('retireDecision', () => {
  it('只下架已上架的；成交终态与软删不动', () => {
    expect(retireDecision({ publicationStatus: 'published' })).toBe('retire')
    expect(retireDecision({ publicationStatus: 'leased' })).toBe('skip-not-published')
    expect(retireDecision({ publicationStatus: 'draft' })).toBe('skip-not-published')
    expect(
      retireDecision({
        publicationStatus: 'published',
        deletedAt: '2026-09-01',
      }),
    ).toBe('skip-deleted')
  })
})

describe('富文本比对', () => {
  it('读回后键序不同、多了属性，只要文字一样就不算变化（2026-10-06 真库实测的误判）', () => {
    const reordered = {
      root: {
        children: [
          {
            children: [{ version: 1, format: 0, detail: 0, style: '', type: 'text', text: '套话', mode: 'normal' }],
            direction: 'ltr',
            type: 'paragraph',
            textFormat: 0,
            textStyle: '',
          },
        ],
        direction: 'ltr',
        type: 'root',
      },
    }
    const existing = { ...listingCreateData(listing, 22, 1, SYNCED), description: reordered }
    expect(listingUpdatePatch(existing, listing, 22, SYNCED).changed).toEqual([])
    const edited = { ...existing, description: textToLexical('运营改过的描述') }
    expect(listingUpdatePatch(edited, listing, 22, SYNCED).changed).toEqual(['description'])
  })
})

describe('竣工日期', () => {
  it('1901 年以前不写进日期字段（上海时区的地方平时偏移会让 Payload 读回时崩溃）', () => {
    expect(buildingCreateData({ ...building, completionYear: 1898 }, REFS, SYNCED).completionDate).toBeNull()
    expect(buildingCreateData({ ...building, completionYear: 1901 }, REFS, SYNCED).completionDate).toBe(
      '1901-01-01T00:00:00.000Z',
    )
  })
})
