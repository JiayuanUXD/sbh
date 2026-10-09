import { describe, expect, it } from 'vitest'

import { presentListingCard } from '../miniprogram/domain/listing-presentation.js'
import type { MiniListingCard, MiniPrice } from '../miniprogram/services/catalog-contracts.js'

const priceWithMonthlyEstimate: MiniPrice = {
  amount: 4.5,
  currency: 'CNY',
  businessType: 'lease',
  period: 'day',
  basis: 'sqm',
  displayUnit: 'rmb-sqm-day',
  text: '4.5 元/㎡/天',
  monthlyEstimate: 36_500,
}

const cardWithMonthlyEstimate: MiniListingCard = {
  id: 'listing-101',
  slug: 'jing-an-center-101',
  title: '静安中心 101 室',
  citySlug: 'shanghai',
  cityName: '上海',
  price: priceWithMonthlyEstimate,
  area: 1_860,
  seats: 120,
  listingType: { value: 'traditional-office', label: '传统办公' },
  availableFrom: '2026-09-01',
  building: {
    slug: 'jing-an-center',
    name: '静安中心',
    address: '静安区南京西路 1 号',
    district: '静安区',
  },
  coverImage: {
    src: 'https://cdn.example/jing-an-center.jpg',
    alt: '静安中心外观',
  },
  highlights: ['近地铁', '精装修', '可注册', '高区景观'],
}

describe('房源卡展示模型', () => {
  it('优先显示月租估算并把原始报价降为次信息', () => {
    expect(presentListingCard(cardWithMonthlyEstimate)).toMatchObject({
      primaryPrice: '约 ¥36,500/月',
      secondaryPrice: '4.5 元/㎡/天',
      facts: '1,860 ㎡ · 120 席 · 传统办公',
      location: '静安区 · 静安中心',
      tags: ['近地铁', '精装修', '可注册'],
    })
  })

  it('缺少估算时不伪造月租，回退原始报价或价格面议', () => {
    expect(presentListingCard({
      ...cardWithMonthlyEstimate,
      price: { ...priceWithMonthlyEstimate, monthlyEstimate: null },
    })).toMatchObject({
      primaryPrice: '4.5 元/㎡/天',
      secondaryPrice: '',
    })

    expect(presentListingCard({
      ...cardWithMonthlyEstimate,
      price: null,
      coverImage: null,
    })).toMatchObject({
      primaryPrice: '价格面议',
      secondaryPrice: '',
      imageUrl: '',
      imageAlt: '静安中心 101 室',
    })
  })
})
