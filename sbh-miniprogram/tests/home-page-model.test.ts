import { describe, expect, it } from 'vitest'

import {
  beginHomeLoad,
  buildQuickFilterNavigation,
  buildSearchNavigation,
  failHomeLoad,
  presentHome,
  succeedHomeLoad,
  type HomePageSnapshot,
} from '../miniprogram/pages/home/model.js'
import type {
  MiniBuildingCard,
  MiniHomeData,
  MiniListingCard,
} from '../miniprogram/services/catalog-contracts.js'

const featuredListing: MiniListingCard = {
  id: 'listing-101',
  slug: 'jing-an-center-101',
  title: '静安中心 101 室',
  citySlug: 'shanghai',
  cityName: '上海',
  price: {
    amount: 4.5,
    currency: 'CNY',
    businessType: 'lease',
    period: 'day',
    basis: 'sqm',
    displayUnit: 'rmb-sqm-day',
    text: '4.5 元/㎡/天',
    monthlyEstimate: 36_500,
  },
  area: 1860,
  seats: 120,
  listingType: { value: 'traditional-office', label: '传统办公' },
  availableFrom: '2026-09-01',
  building: {
    slug: 'jing-an-center',
    name: '静安中心',
    address: '静安区南京西路 1 号',
    district: '静安区',
  },
  coverImage: null,
  highlights: ['近地铁'],
}

const featuredBuilding: MiniBuildingCard = {
  id: 'building-1',
  slug: 'jing-an-center',
  name: '静安中心',
  district: '静安区',
  address: '静安区南京西路 1 号',
  grade: 'super-grade-a',
  completedYear: 2013,
  totalFloors: 66,
  occupancyRate: null,
  activeListingCount: 3,
  priceRange: null,
  coverImage: null,
  nearestMetro: {
    station: '南京西路站',
    line: null,
    distanceMeters: null,
  },
}

const validHome: MiniHomeData = {
  featuredListings: [featuredListing],
  featuredBuildings: [featuredBuilding],
  quickFilters: [
    {
      id: 'district',
      label: '热门区域',
      options: [
        { value: 'empty', label: '零房源', count: 0 },
        { value: 'jingan', label: '静安', count: 12 },
        { value: 'pudong', label: '浦东', count: 10 },
        { value: 'huangpu', label: '黄浦', count: 8 },
        { value: 'xuhui', label: '徐汇', count: 6 },
        { value: 'changning', label: '长宁', count: 4 },
      ],
    },
    {
      id: 'listingType',
      label: '办公类型',
      options: [
        { value: 'coworking', label: '联合办公', count: 5 },
      ],
    },
    {
      id: 'priceUnit',
      label: '计价方式',
      options: [
        { value: 'rmb-month', label: '按月', count: 3 },
      ],
    },
  ],
  stats: { listings: 31, buildings: 9, businessAreas: 6 },
}

describe('首页展示模型', () => {
  it('把真实计数投影为快捷筛选并展示首组真实房源', () => {
    const model = presentHome(validHome)

    expect(model.quickFilters[0]?.options[0]).toMatchObject({
      label: '静安',
      count: 12,
      query: 'district=jingan',
    })
    expect(model.quickFilters[0]?.options).toHaveLength(4)
    expect(model.quickFilters[0]?.options.some((option) => option.count === 0)).toBe(false)
    expect(model.featuredListings[0]).toMatchObject({
      slug: 'jing-an-center-101',
      primaryPrice: '约 ¥36,500/月',
    })
    expect(model.featuredBuildings).toEqual([featuredBuilding])
    expect(model.stats).toEqual({ listings: 31, buildings: 9, businessAreas: 6 })
  })

  it('每组都只保留 API 返回的正计数前四项，并移除空组', () => {
    const model = presentHome({
      ...validHome,
      quickFilters: [
        ...validHome.quickFilters,
        {
          id: 'district',
          label: '无可用区域',
          options: [{ value: 'empty', label: '零房源', count: 0 }],
        },
      ],
    })

    expect(model.quickFilters).toHaveLength(3)
    expect(model.quickFilters.every((group) => group.options.length > 0)).toBe(true)
  })

  it('先过滤不可执行项再取前四，且不让无效高计数项挤掉有效项', () => {
    const model = presentHome({
      ...validHome,
      quickFilters: [
        {
          id: 'district',
          label: '热门区域',
          options: [
            { value: '', label: '空值', count: 99 },
            { value: 'fake', label: '   ', count: 98 },
            { value: 'jingan', label: ' 静安 ', count: 12 },
            { value: 'pudong', label: '浦东', count: 10 },
            { value: 'huangpu', label: '黄浦', count: 8 },
            { value: 'xuhui', label: '徐汇', count: 6 },
            { value: 'changning', label: '长宁', count: 4 },
          ],
        },
        {
          id: 'listingType',
          label: '办公类型',
          options: [
            { value: 'unknown', label: '未知类型', count: 99 },
            { value: 'coworking', label: '联合办公', count: 5 },
          ],
        },
        {
          id: 'priceUnit',
          label: '计价方式',
          options: [
            { value: 'unknown', label: '未知单位', count: 99 },
            { value: 'rmb-month', label: '按月', count: 3 },
          ],
        },
      ],
    })

    expect(model.quickFilters[0]?.options.map((option) => option.label)).toEqual([
      '静安',
      '浦东',
      '黄浦',
      '徐汇',
    ])
    expect(model.quickFilters[1]?.options.map((option) => option.value)).toEqual(['coworking'])
    expect(model.quickFilters[2]?.options.map((option) => option.value)).toEqual(['rmb-month'])
  })

  it('畸形 district 不展示，零计数与空标签在构建 query 前跳过', () => {
    let zeroCountValueReads = 0
    let emptyLabelValueReads = 0
    const home: MiniHomeData = {
      ...validHome,
      quickFilters: [{
        id: 'district',
        label: '热门区域',
        options: [
          {
            get value() {
              zeroCountValueReads += 1
              return '\uD800'
            },
            label: '零计数',
            count: 0,
          },
          {
            get value() {
              emptyLabelValueReads += 1
              return '\uD800'
            },
            label: '   ',
            count: 99,
          },
          { value: '\uD800', label: '畸形区域', count: 98 },
          { value: 'jingan', label: '静安', count: 12 },
        ],
      }],
    }

    expect(() => presentHome(home)).not.toThrow()
    const model = presentHome(home)
    expect(zeroCountValueReads).toBe(0)
    expect(emptyLabelValueReads).toBe(0)
    expect(model.quickFilters[0]?.options.map((option) => option.label)).toEqual(['静安'])
  })
})

describe('首页列表导航', () => {
  it('搜索提交生成 canonical q 查询，空白输入进入无筛选列表', () => {
    expect(buildSearchNavigation(' 南京西路 ')).toBe(
      'q=%E5%8D%97%E4%BA%AC%E8%A5%BF%E8%B7%AF',
    )
    expect(buildSearchNavigation('   ')).toBe('')
    expect(buildSearchNavigation('\uD800')).toBe('')
  })

  it('快捷筛选只设置当前维度并生成 canonical query', () => {
    expect(buildQuickFilterNavigation('district', 'jingan')).toBe('district=jingan')
    expect(buildQuickFilterNavigation('listingType', 'coworking')).toBe('type=coworking')
    expect(buildQuickFilterNavigation('priceUnit', 'rmb-month')).toBe('priceUnit=rmb-month')
  })

  it('非法快捷值不会生成带无效条件的列表地址', () => {
    expect(buildQuickFilterNavigation('district', '   ')).toBeNull()
    expect(buildQuickFilterNavigation('listingType', 'unknown')).toBeNull()
    expect(buildQuickFilterNavigation('priceUnit', 'unknown')).toBeNull()
  })
})

describe('首页加载状态', () => {
  const emptySnapshot: HomePageSnapshot = {
    state: 'idle',
    content: null,
    refreshError: false,
  }

  it('无既有内容首载进入 loading，失败进入无内容 error', () => {
    expect(beginHomeLoad(emptySnapshot, false)).toMatchObject({ state: 'loading' })
    expect(failHomeLoad(emptySnapshot)).toEqual({
      state: 'error',
      content: null,
      refreshError: false,
    })
  })

  it('已有内容刷新失败保留内容并只标记 refreshError', () => {
    const content = presentHome(validHome)
    const ready: HomePageSnapshot = { state: 'ready', content, refreshError: false }

    expect(beginHomeLoad(ready, true)).toEqual(ready)
    expect(failHomeLoad(ready)).toEqual({
      state: 'ready',
      content,
      refreshError: true,
    })
  })

  it('成功加载进入 ready 并清除旧刷新错误', () => {
    const content = presentHome(validHome)

    expect(succeedHomeLoad({ ...emptySnapshot, refreshError: true }, content)).toEqual({
      state: 'ready',
      content,
      refreshError: false,
    })
  })
})
