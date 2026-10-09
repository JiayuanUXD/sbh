import { describe, expect, it } from 'vitest'

import { presentListingDetail } from '../miniprogram/domain/listing-detail-presentation.js'
import type { MiniListingDetailData } from '../miniprogram/services/catalog-contracts.js'

const assumptions = [
  '日租按 30 天折算月租',
  '物业费已包含在租金中，不重复加总',
] as const

const validDetail: MiniListingDetailData = {
  listing: {
    id: 'listing-1',
    slug: 'jing-an-tower-101',
    title: '静安中心 101',
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
      monthlyEstimate: 25_500,
    },
    area: 100,
    seats: null,
    listingType: { value: 'traditional-office', label: '传统办公' },
    availableFrom: '2026-09-01',
    building: {
      slug: 'jing-an-tower',
      name: '静安中心',
      address: '静安区南京西路 1 号',
      district: '静安区',
    },
    coverImage: {
      src: 'https://cdn.example/listing-1.jpg',
      width: 1600,
      height: 1200,
      alt: '静安中心外观',
    },
    highlights: ['近地铁', '精装修'],
    gallery: [
      {
        src: 'https://cdn.example/listing-1.jpg',
        width: 1600,
        height: 1200,
        alt: '静安中心外观',
      },
    ],
    factGroups: [{
      id: 'terms',
      title: '租赁条件与非常长的中文事实分组标题',
      facts: [
        {
          label: '交付标准',
          value: '精装修并配备可容纳跨部门协作与访客接待的完整办公家具',
          estimated: false,
        },
        { label: '免租期', value: null, estimated: true },
      ],
    }],
    verification: {
      verifiedAt: '2026-08-20T00:00:00.000Z',
      priceVerifiedAt: '2026-08-21T00:00:00.000Z',
    },
  },
  monthlyCost: {
    currency: 'CNY',
    period: 'month',
    propertyFeeInclusion: 'included',
    rent: 25_500,
    propertyFee: 2_800,
    total: 25_500,
    assumptions,
  },
  relatedListings: [],
  buildingInfo: {
    id: 'building-1',
    slug: 'jing-an-tower',
    name: '静安中心完整楼盘卡',
    district: '静安区',
    address: '静安区南京西路 1 号',
    grade: 'super-grade-a',
    completedYear: 2013,
    totalFloors: 66,
    occupancyRate: null,
    activeListingCount: 3,
    priceRange: null,
    coverImage: null,
    nearestMetro: null,
  },
  inquiryPolicy: { version: '2026-08-27' },
}

function withMonthlyCost(
  monthlyCost: Partial<MiniListingDetailData['monthlyCost']>,
): MiniListingDetailData {
  return {
    ...validDetail,
    monthlyCost: { ...validDetail.monthlyCost, ...monthlyCost },
  }
}

describe('房源详情展示模型', () => {
  it('只格式化 API 主月租与单位报价，并逐项显示 API 月度成本', () => {
    const presented = presentListingDetail(validDetail)

    expect(presented.primaryPrice).toBe('约 ¥25,500/月')
    expect(presented.secondaryPrice).toBe('8.5 元/㎡/天')
    expect(presented.monthlyCost).toMatchObject({
      rent: '¥25,500',
      propertyFee: '¥2,800',
      total: '¥25,500',
      inclusionLabel: '物业费已包含',
    })
    expect(presented.monthlyCost.assumptions).toBe(assumptions)
  })

  it('所在楼盘消费详情 DTO 的完整楼盘卡', () => {
    expect(presentListingDetail(validDetail).building).toBe(validDetail.buildingInfo)
  })

  it('租金、物业费和合计分别缺失时都显示破折号', () => {
    const presented = presentListingDetail(withMonthlyCost({
      rent: null,
      propertyFee: null,
      total: null,
    }))

    expect(presented.monthlyCost).toMatchObject({
      rent: '—',
      propertyFee: '—',
      total: '—',
    })
  })

  it('included 不重复加总，且不修正 API 提供的合计', () => {
    const presented = presentListingDetail(withMonthlyCost({
      propertyFeeInclusion: 'included',
      rent: 100,
      propertyFee: 20,
      total: 100,
    }))

    expect(presented.monthlyCost).toMatchObject({
      rent: '¥100',
      propertyFee: '¥20',
      total: '¥100',
    })
  })

  it('excluded 信息不全时不伪造合计，已有 total 也只按原值展示', () => {
    expect(presentListingDetail(withMonthlyCost({
      propertyFeeInclusion: 'excluded',
      rent: 100,
      propertyFee: null,
      total: null,
    })).monthlyCost.total).toBe('—')

    expect(presentListingDetail(withMonthlyCost({
      propertyFeeInclusion: 'excluded',
      rent: 100,
      propertyFee: 20,
      total: 999,
    })).monthlyCost.total).toBe('¥999')
  })

  it.each([
    ['included', '物业费已包含'],
    ['excluded', '物业费另计'],
    ['confirm', '物业费待确认'],
    [null, '物业费包含情况待确认'],
  ] as const)('格式化物业费状态 %s', (state, label) => {
    expect(presentListingDetail(withMonthlyCost({
      propertyFeeInclusion: state,
    })).monthlyCost.inclusionLabel).toBe(label)
  })

  it('核心规格固定四列，缺值不删除格子，日期按中文日历格式展示', () => {
    const presented = presentListingDetail(validDetail)

    expect(presented.specifications).toEqual([
      { id: 'area', label: '面积', value: '100 ㎡', estimated: false },
      { id: 'seats', label: '工位', value: '—', estimated: false },
      { id: 'listing-type', label: '类型', value: '传统办公', estimated: false },
      { id: 'available-from', label: '最早入驻', value: '2026年9月1日', estimated: false },
    ])
  })

  it('事实长中文原样保留、空事实降级，并格式化两项核验日期', () => {
    const presented = presentListingDetail(validDetail)

    expect(presented.factGroups).toEqual([{
      id: 'terms',
      title: '租赁条件与非常长的中文事实分组标题',
      facts: [
        {
          label: '交付标准',
          value: '精装修并配备可容纳跨部门协作与访客接待的完整办公家具',
          estimated: false,
        },
        { label: '免租期', value: '—', estimated: true },
      ],
    }])
    expect(presented.verification).toEqual({
      verifiedAt: '2026年8月20日',
      priceVerifiedAt: '2026年8月21日',
    })
  })

  it('缺少主月租、单位报价与核验日期时不编造文案', () => {
    const presented = presentListingDetail({
      ...validDetail,
      listing: {
        ...validDetail.listing,
        price: null,
        verification: { verifiedAt: null, priceVerifiedAt: null },
      },
    })

    expect(presented.primaryPrice).toBe('—')
    expect(presented.secondaryPrice).toBe('')
    expect(presented.verification).toEqual({ verifiedAt: '—', priceVerifiedAt: '—' })
  })
})
