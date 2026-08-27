/**
 * F0.4 单测：Public Catalog Mapper
 *
 * 设计依据：FRONTEND_AGENT.md §6.2、§13；specs/frontend-mvp/design.md §7
 *
 * 守护不变量：
 *   - 字段白名单：mapper 不向浏览器暴露审核、举报、商户资质、内部电话、
 *     权限、审计、精确内部坐标或工作版本
 *   - 价格始终保留数值、币种、单位和可读文本
 *   - 媒体、价格、面积、时间和 SEO 使用统一值对象
 *   - 关系字段在 depth ≥ 1 时为对象，depth = 0 时为 id；mapper 类型守卫收窄
 */

import { describe, expect, it } from 'vitest'
import {
  mapBuildingCity,
  mapBuildingDetail,
  mapBuildingSummary,
  mapDistrict,
  mapListingCard,
  mapListingDetail,
  mapMedia,
  mapPrice,
  pickVariantSrc,
  setBusinessTypeWarnHandler,
} from '@/domain/public-catalog'
import {
  BUILDING_DISABLED,
  BUILDING_JINGAN_CENTER,
  BUILDING_PUDONG_FLAT,
  CITY_HANGZHOU,
  INVALID_INPUTS,
  LISTING_DAILY_PER_SQM,
  LISTING_DELETED,
  LISTING_DRAFT,
  LISTING_FULL_FLOOR_LARGE,
  LISTING_LEASED,
  LISTING_LONG_TITLE,
  LISTING_MISSING_UNIT,
  LISTING_MONTHLY_STANDARD,
  LISTING_NEGATIVE_PRICE,
  LISTING_SEAT_PER_MONTH,
  MEDIA_BROKEN,
  MEDIA_COVER_A,
  MEDIA_GALLERY_1,
} from '@/test/frontend/payload-documents'

const BUILDING_HANGZHOU = {
  ...BUILDING_JINGAN_CENTER,
  id: 210,
  slug: 'hangzhou-center',
  name: '杭州中心',
  city: CITY_HANGZHOU,
}

// ---------------------------------------------------------------------------
// mapPrice
// ---------------------------------------------------------------------------

describe('mapPrice', () => {
  // period × basis 全组合（4 × 3 = 12）。每个组合必须有唯一的 displayUnit：
  // 楼盘详情页按 displayUnit 分组筛选，任何两个语义不同的组合共用一个 displayUnit
  // 都会让「筛某个单位」同时命中不可比的价格（如月单价与一次性总价并列）。
  it.each([
    ['day', 'sqm', 'sqm', 'rmb-sqm-day', '12 元/㎡/天'],
    ['day', 'suite', 'total', 'rmb-day', '12 元/天'],
    ['day', 'seat', 'seat', 'rmb-seat-day', '12 元/工位/天'],
    ['month', 'sqm', 'sqm', 'rmb-sqm-month', '12 元/㎡/月'],
    ['month', 'suite', 'total', 'rmb-month', '12 元/月'],
    ['month', 'seat', 'seat', 'rmb-seat-month', '12 元/工位/月'],
    ['year', 'sqm', 'sqm', 'rmb-sqm-year', '12 元/㎡/年'],
    ['year', 'suite', 'total', 'rmb-year', '12 元/年'],
    ['year', 'seat', 'seat', 'rmb-seat-year', '12 元/工位/年'],
    ['one-time', 'sqm', 'sqm', 'rmb-sqm-total', '12 元/㎡'],
    ['one-time', 'suite', 'total', 'rmb-total', '12 元'],
    ['one-time', 'seat', 'seat', 'rmb-seat-total', '12 元/工位'],
  ] as const)('结构化价格 %s/%s 不被丢弃且保留语义', (period, unit, basis, displayUnit, text) => {
    const card = mapListingCard({
      ...LISTING_MONTHLY_STANDARD,
      rent: undefined,
      rentUnit: null,
      price: { amount: 12, currency: 'CNY', period, unit },
    })
    expect(card?.price).toMatchObject({
      amount: 12,
      currency: 'CNY',
      businessType: 'lease',
      period,
      basis,
      displayUnit,
      text,
    })
  })

  it('displayUnit 在 12 个组合上两两互异（防兜底桶回归）', () => {
    const periods = ['day', 'month', 'year', 'one-time'] as const
    const units = ['sqm', 'suite', 'seat'] as const
    const seen = new Map<string, string>()
    for (const period of periods) {
      for (const unit of units) {
        const card = mapListingCard({
          ...LISTING_MONTHLY_STANDARD,
          rent: undefined,
          rentUnit: null,
          price: { amount: 12, currency: 'CNY', period, unit },
        })
        const displayUnit = card?.price?.displayUnit
        expect(displayUnit, `${period}/${unit} 应产出价格`).toBeTruthy()
        const combo = `${period}/${unit}`
        const clash = seen.get(displayUnit as string)
        expect(
          clash,
          `${combo} 与 ${clash} 共用 displayUnit=${displayUnit}，会让楼盘页筛选混合不可比的价格`,
        ).toBeUndefined()
        seen.set(displayUnit as string, combo)
      }
    }
    expect(seen.size).toBe(12)
  })

  it('出售总价：one-time + suite → rmb-total，文本不带周期后缀', () => {
    const card = mapListingCard({
      ...LISTING_MONTHLY_STANDARD,
      rent: undefined,
      rentUnit: null,
      businessType: 'sale',
      price: { amount: 38000000, currency: 'CNY', period: 'one-time', unit: 'suite' },
    })
    expect(card?.price).toMatchObject({
      amount: 38000000,
      businessType: 'sale',
      period: 'one-time',
      basis: 'total',
      displayUnit: 'rmb-total',
      text: '38000000 元',
    })
  })

  it('出售单价：one-time + sqm → rmb-sqm-total，不落回 rmb-total', () => {
    const card = mapListingCard({
      ...LISTING_MONTHLY_STANDARD,
      rent: undefined,
      rentUnit: null,
      businessType: 'sale',
      price: { amount: 52000, currency: 'CNY', period: 'one-time', unit: 'sqm' },
    })
    expect(card?.price?.displayUnit).toBe('rmb-sqm-total')
    expect(card?.price?.text).toBe('52000 元/㎡')
  })

  it('未知 businessType 记告警后降级 lease（未来的交易类型不能被静默吞掉）', () => {
    const warned: string[] = []
    const restore = setBusinessTypeWarnHandler((message) => warned.push(message))
    try {
      const card = mapListingCard({
        ...LISTING_MONTHLY_STANDARD,
        businessType: 'transfer' as never,
      })
      expect(card?.businessType).toBe('lease')
      expect(warned).toHaveLength(1)
      expect(warned[0]).toContain('transfer')
    } finally {
      restore()
    }
  })

  it('同一未知取值只告警一次（一个列表页会调用两次/张，不能刷屏）', () => {
    const warned: string[] = []
    const restore = setBusinessTypeWarnHandler((message) => warned.push(message))
    try {
      for (let i = 0; i < 5; i++) {
        mapListingCard({ ...LISTING_MONTHLY_STANDARD, businessType: 'transfer' as never })
      }
      expect(warned).toHaveLength(1)
    } finally {
      restore()
    }
  })

  it('不同未知取值各告警一次（去重不能吞掉新出现的类型）', () => {
    const warned: string[] = []
    const restore = setBusinessTypeWarnHandler((message) => warned.push(message))
    try {
      mapListingCard({ ...LISTING_MONTHLY_STANDARD, businessType: 'transfer' as never })
      mapListingCard({ ...LISTING_MONTHLY_STANDARD, businessType: 'custody' as never })
      expect(warned).toHaveLength(2)
      expect(warned.join('|')).toContain('transfer')
      expect(warned.join('|')).toContain('custody')
    } finally {
      restore()
    }
  })

  it('已知 businessType 不触发告警', () => {
    const warned: string[] = []
    const restore = setBusinessTypeWarnHandler((message) => warned.push(message))
    try {
      mapListingCard({ ...LISTING_MONTHLY_STANDARD, businessType: 'sale' })
      mapListingCard({ ...LISTING_MONTHLY_STANDARD, businessType: 'lease' })
      expect(warned).toHaveLength(0)
    } finally {
      restore()
    }
  })

  it('businessType 缺失按 lease 处理且不告警（历史数据兼容）', () => {
    const warned: string[] = []
    const restore = setBusinessTypeWarnHandler((message) => warned.push(message))
    try {
      const card = mapListingCard({ ...LISTING_MONTHLY_STANDARD, businessType: null })
      expect(card?.businessType).toBe('lease')
      expect(warned).toHaveLength(0)
    } finally {
      restore()
    }
  })

  it('rmb-month: 保留数值、币种、单位并产出可读文本', () => {
    const p = mapPrice(25000, 'rmb-month')
    expect(p).not.toBeNull()
    expect(p?.amount).toBe(25000)
    expect(p?.currency).toBe('CNY')
    expect(p?.displayUnit).toBe('rmb-month')
    expect(p?.period).toBe('month')
    expect(p?.basis).toBe('total')
    expect(p?.businessType).toBe('lease')
    expect(p?.text).toBe('25000 元/月')
  })

  it('rmb-sqm-day: 支持小数单价', () => {
    const p = mapPrice(8.5, 'rmb-sqm-day')
    expect(p?.text).toBe('8.5 元/㎡/天')
    expect(p?.amount).toBe(8.5)
  })

  it('rmb-seat-month: 工位月租', () => {
    const p = mapPrice(2800, 'rmb-seat-month')
    expect(p?.text).toBe('2800 元/工位/月')
  })

  it('rent=null → 返回 null', () => {
    expect(mapPrice(null, 'rmb-month')).toBeNull()
  })

  it('rent=undefined → 返回 null', () => {
    expect(mapPrice(undefined, 'rmb-month')).toBeNull()
  })

  it('rent=负数 → 返回 null（防非法数据）', () => {
    expect(mapPrice(-100, 'rmb-month')).toBeNull()
  })

  it('rent=NaN → 返回 null', () => {
    expect(mapPrice(Number.NaN, 'rmb-month')).toBeNull()
  })

  it('rent=Infinity → 返回 null', () => {
    expect(mapPrice(Number.POSITIVE_INFINITY, 'rmb-month')).toBeNull()
  })

  it('unit 缺失 → 返回 null', () => {
    expect(mapPrice(12000, null)).toBeNull()
    expect(mapPrice(12000, undefined)).toBeNull()
  })

  it('极值价格：45 万元/月 正常映射', () => {
    const p = mapPrice(450000, 'rmb-month')
    expect(p?.amount).toBe(450000)
    expect(p?.text).toBe('450000 元/月')
  })
})

// ---------------------------------------------------------------------------
// mapMedia
// ---------------------------------------------------------------------------

describe('mapMedia', () => {
  it('完整媒体 → 投影 src/width/height/alt', () => {
    const m = mapMedia(MEDIA_COVER_A, 'fallback')
    expect(m?.src).toBe('/media/cover-jingan-center.jpg')
    expect(m?.alt).toBe('静安中心封面图')
    expect(m?.width).toBe(1280)
    expect(m?.height).toBe(960)
  })

  it('alt 为空时回退到 fallbackAlt', () => {
    const m = mapMedia(
      { ...MEDIA_COVER_A, alt: '' },
      '静安中心',
    )
    expect(m?.alt).toBe('静安中心')
  })

  it('alt=null → 类型守卫拒绝，返回 null（Media.alt 在 schema 中是必填字符串）', () => {
    const broken = { ...MEDIA_COVER_A, alt: null as unknown as string }
    expect(mapMedia(broken, '回退标题')).toBeNull()
  })

  it('url 缺失 → 返回 null', () => {
    expect(mapMedia(MEDIA_BROKEN, 'fallback')).toBeNull()
  })

  it('url 为空字符串 → 返回 null', () => {
    const m = mapMedia({ ...MEDIA_COVER_A, url: '' }, 'fallback')
    expect(m).toBeNull()
  })

  it.each([
    '//cdn.example.com/office.jpg',
    'javascript:alert(1)',
    'data:image/png;base64,xxx',
    'https://user:pass@cdn.example.com/office.jpg',
  ])('不安全媒体 URL 不进入公开 DTO：%s', (url) => {
    expect(mapMedia({ ...MEDIA_COVER_A, url }, 'fallback')).toBeNull()
  })

  it('非对象输入 → 返回 null', () => {
    expect(mapMedia(null, 'fallback')).toBeNull()
    expect(mapMedia(undefined, 'fallback')).toBeNull()
    expect(mapMedia('string', 'fallback')).toBeNull()
    expect(mapMedia(42, 'fallback')).toBeNull()
  })

  it('blurDataURL 透传', () => {
    const m = mapMedia(
      { ...MEDIA_COVER_A, blurDataUrl: 'data:image/jpeg;base64,xxx' },
      'fallback',
    )
    expect(m?.blurDataURL).toBe('data:image/jpeg;base64,xxx')
  })

  // --- OPT-059：派生尺寸与焦点 ---------------------------------------------

  const WITH_SIZES = {
    ...MEDIA_COVER_A,
    sizes: {
      thumb: { url: '/media/cover-320.webp', width: 320 },
      card: { url: '/media/cover-768.webp', width: 768 },
      hero: { url: '/media/cover-1600.webp', width: 1600 },
    },
  }

  it('派生尺寸按宽度升序投影为 variants', () => {
    const m = mapMedia(WITH_SIZES, 'fallback')
    expect(m?.variants).toEqual([
      { src: '/media/cover-320.webp', width: 320 },
      { src: '/media/cover-768.webp', width: 768 },
      { src: '/media/cover-1600.webp', width: 1600 },
    ])
  })

  it('存量图无派生 → variants 缺省，src 仍是原图（回落契约）', () => {
    const m = mapMedia(MEDIA_COVER_A, 'fallback')
    expect(m?.variants).toBeUndefined()
    expect(m?.src).toBe('/media/cover-jingan-center.jpg')
  })

  it('withoutEnlargement 导致宽度小于标称值时按实际宽度投影', () => {
    const m = mapMedia(
      { ...MEDIA_COVER_A, sizes: { card: { url: '/media/small.webp', width: 500 } } },
      'fallback',
    )
    expect(m?.variants).toEqual([{ src: '/media/small.webp', width: 500 }])
  })

  it.each([
    '//cdn.example.com/office.jpg',
    'javascript:alert(1)',
    'https://user:pass@cdn.example.com/office.jpg',
  ])('不安全的派生图 URL 被单独剔除，不污染 variants：%s', (url) => {
    const m = mapMedia(
      { ...MEDIA_COVER_A, sizes: { card: { url, width: 768 }, hero: { url: '/media/ok.webp', width: 1600 } } },
      'fallback',
    )
    expect(m?.variants).toEqual([{ src: '/media/ok.webp', width: 1600 }])
  })

  it('派生图缺 width 或 width 非正 → 该档丢弃（srcset 里没有宽度就没有意义）', () => {
    const m = mapMedia(
      { ...MEDIA_COVER_A, sizes: { card: { url: '/media/a.webp' }, hero: { url: '/media/b.webp', width: 0 } } },
      'fallback',
    )
    expect(m?.variants).toBeUndefined()
  })

  it('焦点投影为 0-100 百分比', () => {
    const m = mapMedia({ ...MEDIA_COVER_A, focalX: 30, focalY: 70 }, 'fallback')
    expect(m?.focal).toEqual({ x: 30, y: 70 })
  })

  it('焦点为 null → 整个 focal 字段缺省（object-position: null% 会让声明整条失效）', () => {
    const m = mapMedia({ ...MEDIA_COVER_A, focalX: null, focalY: null }, 'fallback')
    expect(m?.focal).toBeUndefined()
  })

  it('焦点只有一个轴 → 视为无效，整个 focal 缺省', () => {
    const m = mapMedia({ ...MEDIA_COVER_A, focalX: 30, focalY: null }, 'fallback')
    expect(m?.focal).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// pickVariantSrc
// ---------------------------------------------------------------------------

describe('pickVariantSrc', () => {
  const media = {
    src: '/media/original.jpg',
    alt: 'x',
    variants: [
      { src: '/media/320.webp', width: 320 },
      { src: '/media/768.webp', width: 768 },
      { src: '/media/1600.webp', width: 1600 },
    ],
  } as const

  it('取宽度 ≥ target 的最小档', () => {
    expect(pickVariantSrc(media, 768)).toBe('/media/768.webp')
    expect(pickVariantSrc(media, 400)).toBe('/media/768.webp')
  })

  it('target 超过所有档位 → 取最大档', () => {
    expect(pickVariantSrc(media, 4000)).toBe('/media/1600.webp')
  })

  it('无派生 → 回落原图 src', () => {
    expect(pickVariantSrc({ src: '/media/original.jpg', alt: 'x' }, 768)).toBe('/media/original.jpg')
  })
})

// ---------------------------------------------------------------------------
// mapDistrict
// ---------------------------------------------------------------------------

describe('mapDistrict', () => {
  it('完整 Location → 投影 id/slug/name', () => {
    const d = mapDistrict({
      id: 1,
      name: '静安',
      slug: 'jingan',
      type: 'district',
      parent: 100,
      immutableCode: 'JA',
      status: 'active',
      updatedAt: '2026-07-01T00:00:00.000Z',
      createdAt: '2026-07-01T00:00:00.000Z',
    })
    expect(d).toEqual({ id: 1, slug: 'jingan', name: '静安' })
  })

  it('id 为字符串 → 视为非 Location 返回 undefined', () => {
    expect(mapDistrict({ id: 'a', slug: 's', name: 'n' })).toBeUndefined()
  })

  it('slug 缺失 → 返回 undefined', () => {
    expect(mapDistrict({ id: 1, name: 'n' })).toBeUndefined()
  })

  it('非对象输入 → 返回 undefined', () => {
    expect(mapDistrict(null)).toBeUndefined()
    expect(mapDistrict(undefined)).toBeUndefined()
    expect(mapDistrict('string')).toBeUndefined()
  })

  it('number 输入（depth=0 形式）→ 返回 undefined', () => {
    expect(mapDistrict(1)).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// mapBuildingSummary
// ---------------------------------------------------------------------------

describe('mapBuildingSummary', () => {
  it('exposes the populated canonical city identity', () => {
    expect(mapBuildingSummary(BUILDING_JINGAN_CENTER)).toMatchObject({
      citySlug: 'shanghai',
      cityName: '上海市',
    })
  })

  it('fails closed when the city relationship is not populated', () => {
    expect(mapBuildingSummary(BUILDING_PUDONG_FLAT)).toBeNull()
  })

  it('完整 Building → 投影公开字段', () => {
    const b = mapBuildingSummary(BUILDING_JINGAN_CENTER)
    expect(b?.id).toBe(200)
    expect(b?.slug).toBe('jingan-center')
    expect(b?.name).toBe('静安中心')
    expect(b?.address).toBe('上海市静安区南京西路 1788 号')
    expect(b?.grade).toBe('grade-a')
    expect(b?.district?.slug).toBe('jingan')
    expect(b?.coverImage?.src).toBe('/media/cover-jingan-center.jpg')
    expect(b?.summary).toBe('南京西路核心地段甲级写字楼')
  })

  it('不暴露 verificationStatus（内部审核字段）', () => {
    const b = mapBuildingSummary(BUILDING_JINGAN_CENTER)
    expect(JSON.stringify(b)).not.toContain('verificationStatus')
    expect(JSON.stringify(b)).not.toContain('verified')
  })

  it('仅暴露公开近似坐标，不暴露高精度内部坐标（PRD 04 §358）', () => {
    const b = mapBuildingSummary({
      ...BUILDING_JINGAN_CENTER,
      latitude: 31.223647,
      longitude: 121.455412,
    })
    expect(b?.coordinates).toEqual({ latitude: 31.2236, longitude: 121.4554 })
    expect(JSON.stringify(b)).not.toContain('31.223647')
    expect(JSON.stringify(b)).not.toContain('121.455412')
  })

  it('不暴露 createdBy/lastModifiedBy（审计字段）', () => {
    const b = mapBuildingSummary(BUILDING_JINGAN_CENTER)
    expect(JSON.stringify(b)).not.toContain('createdBy')
    expect(JSON.stringify(b)).not.toContain('lastModifiedBy')
  })

  it('不暴露 version（乐观锁版本）', () => {
    const b = mapBuildingSummary({ ...BUILDING_JINGAN_CENTER, version: 99 })
    expect(JSON.stringify(b)).not.toContain('version')
    expect(JSON.stringify(b)).not.toContain('"version":')
  })

  it('非 Building 输入 → 返回 null', () => {
    expect(mapBuildingSummary(null)).toBeNull()
    expect(mapBuildingSummary({})).toBeNull()
    expect(mapBuildingSummary('string')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// mapListingCard
// ---------------------------------------------------------------------------

describe('mapListingCard', () => {
  it('copies canonical city identity to listing card and detail DTOs', () => {
    expect(mapListingCard(LISTING_MONTHLY_STANDARD)).toMatchObject({
      citySlug: 'shanghai',
      cityName: '上海市',
    })
    expect(mapListingDetail(LISTING_MONTHLY_STANDARD)).toMatchObject({
      citySlug: 'shanghai',
      cityName: '上海市',
    })
  })

  it('fails closed when a listing building does not expose a canonical city', () => {
    const listing = { ...LISTING_DAILY_PER_SQM, building: BUILDING_PUDONG_FLAT }
    expect(mapListingCard(listing)).toBeNull()
    expect(mapListingDetail(listing)).toBeNull()
  })

  it('无旧 rent 的结构化价格房源仍映射为公开卡片和详情', () => {
    const listing = {
      ...LISTING_MONTHLY_STANDARD,
      rent: undefined,
      rentUnit: null,
      price: { amount: 8, currency: 'CNY', period: 'day', unit: 'sqm' },
    }
    expect(mapListingCard(listing)?.price?.text).toBe('8 元/㎡/天')
    expect(mapListingDetail(listing)?.id).toBe(LISTING_MONTHLY_STANDARD.id)
  })

  it('价格待面议的房源不因缺少 rent 被拒绝', () => {
    const listing = { ...LISTING_MONTHLY_STANDARD, rent: undefined, rentUnit: null, price: undefined }
    expect(mapListingCard(listing)).toMatchObject({ id: LISTING_MONTHLY_STANDARD.id, price: null })
    expect(mapListingDetail(listing)?.price).toBeNull()
  })

  it('月租房源：完整字段投影', () => {
    const card = mapListingCard(LISTING_MONTHLY_STANDARD)
    expect(card?.id).toBe(1001)
    expect(card?.slug).toBe('jingan-center-100-monthly')
    expect(card?.title).toBe('静安中心 100㎡ 精装办公室')
    expect(card?.price?.text).toBe('25000 元/月')
    expect(card?.area).toBe(100)
    expect(card?.listingType).toBe('traditional-office')
    expect(card?.availableFrom).toBe('2026-08-01')
    expect(card?.isFeatured).toBe(true)
    expect(card?.building?.name).toBe('静安中心')
    expect(card?.coverImage?.src).toBe('/media/cover-jingan-center.jpg')
    expect(card?.stableSortKey).toBe('listing-1001')
  })

  it('亮点最多 3 条：第 4 条被截断', () => {
    const card = mapListingCard(LISTING_MONTHLY_STANDARD)
    expect(card?.highlights).toHaveLength(3)
    expect(card?.highlights).toEqual(['落地窗江景', '精装修交付', '24h 空调'])
  })

  it('日租房源：rmb-sqm-day 价格正确', () => {
    const card = mapListingCard(LISTING_DAILY_PER_SQM)
    expect(card?.price?.text).toBe('8.5 元/㎡/天')
    expect(card?.price?.displayUnit).toBe('rmb-sqm-day')
    expect(card?.price?.amount).toBe(8.5)
  })

  it('工位月租房源：area=null 时正常处理', () => {
    const card = mapListingCard(LISTING_SEAT_PER_MONTH)
    expect(card?.area).toBeNull()
    expect(card?.price?.text).toBe('2800 元/工位/月')
  })

  it('整层大数值价格：45 万/月 正常映射', () => {
    const card = mapListingCard(LISTING_FULL_FLOOR_LARGE)
    expect(card?.price?.amount).toBe(450000)
    expect(card?.price?.text).toBe('450000 元/月')
  })

  it('coverImage 缺失时回退到楼盘 coverImage（要求 building.coverImage 已填充为 Media 对象）', () => {
    // LISTING_DAILY_PER_SQM 的 coverImage=null，building=BUILDING_PUDONG_FLAT
    // BUILDING_PUDONG_FLAT.coverImage=1002（id 形式，未填充）→ 回退失败，coverImage=null
    const cardFlat = mapListingCard(LISTING_DAILY_PER_SQM)
    expect(cardFlat?.coverImage).toBeNull()

    // 构造一个 coverImage=null 但 building.coverImage 已填充的场景
    const listingWithPopulatedBuildingCover: typeof LISTING_MONTHLY_STANDARD = {
      ...LISTING_DAILY_PER_SQM,
      building: BUILDING_JINGAN_CENTER, // 该楼盘 coverImage=MEDIA_COVER_A（已填充）
    }
    const card = mapListingCard(listingWithPopulatedBuildingCover)
    expect(card?.coverImage?.src).toBe('/media/cover-jingan-center.jpg')
  })

  it('isFeatured=false 时正常映射', () => {
    const card = mapListingCard(LISTING_DAILY_PER_SQM)
    expect(card?.isFeatured).toBe(false)
  })

  it('isFeatured=undefined 时映射为 false', () => {
    const listingWithoutFlag = { ...LISTING_MONTHLY_STANDARD, isFeatured: undefined }
    const card = mapListingCard(listingWithoutFlag)
    expect(card?.isFeatured).toBe(false)
  })

  it('稳定排序键使用不可变 listing id', () => {
    const card = mapListingCard(LISTING_MONTHLY_STANDARD)
    expect(card?.stableSortKey).toBe('listing-1001')
  })

  it('空亮点数组 → 返回空数组', () => {
    const card = mapListingCard(LISTING_DAILY_PER_SQM)
    expect(card?.highlights).toEqual([])
  })

  it('过滤亮点中 text 为空或非字符串的项', () => {
    const listingWithBadHighlights = {
      ...LISTING_MONTHLY_STANDARD,
      highlights: [
        { text: '有效亮点', id: 'h1' },
        { text: '', id: 'h2' },
        { text: null, id: 'h3' },
        { text: 123, id: 'h4' },
        { text: '第二个有效亮点', id: 'h5' },
      ],
    }
    const card = mapListingCard(listingWithBadHighlights)
    expect(card?.highlights).toEqual(['有效亮点', '第二个有效亮点'])
  })

  it('不暴露审核/举报/商户资质等内部字段', () => {
    const card = mapListingCard(LISTING_MONTHLY_STANDARD)
    const json = JSON.stringify(card)
    expect(json).not.toContain('verificationStatus')
    expect(json).not.toContain('createdBy')
    expect(json).not.toContain('lastModifiedBy')
    expect(json).not.toContain('deletedAt')
    expect(json).not.toContain('internalPhone')
    expect(json).not.toContain('merchantQualification')
  })

  it('不暴露 createdBy 关系', () => {
    const card = mapListingCard(LISTING_MONTHLY_STANDARD)
    expect(JSON.stringify(card)).not.toContain('createdBy')
    expect(JSON.stringify(card)).not.toContain('lastModifiedBy')
  })

  it('不暴露 status 字段（公开 DTO 由有效供给谓词保证可见性）', () => {
    const card = mapListingCard(LISTING_MONTHLY_STANDARD)
    expect(JSON.stringify(card)).not.toMatch(/"status":/)
  })

  it('草稿房源也能被 mapper 处理（公开与否由查询门面决定，mapper 不二次过滤）', () => {
    const card = mapListingCard(LISTING_DRAFT)
    expect(card?.id).toBe(2001)
  })

  it('已出租房源能被 mapper 处理', () => {
    const card = mapListingCard(LISTING_LEASED)
    expect(card?.id).toBe(2002)
  })

  it('逻辑删除房源能被 mapper 处理（mapper 不检查 deletedAt）', () => {
    const card = mapListingCard(LISTING_DELETED)
    expect(card?.id).toBe(2005)
  })

  it('负数价格 → price=null（防非法数据）', () => {
    const card = mapListingCard(LISTING_NEGATIVE_PRICE)
    expect(card?.price).toBeNull()
  })

  it('价格单位缺失 → price=null', () => {
    const card = mapListingCard(LISTING_MISSING_UNIT)
    expect(card?.price).toBeNull()
  })

  it('极长标题正常映射', () => {
    const card = mapListingCard(LISTING_LONG_TITLE)
    expect(card?.title.length).toBeGreaterThan(50)
  })

  it('未知输入 → 返回 null（不抛错）', () => {
    for (const input of INVALID_INPUTS) {
      expect(mapListingCard(input)).toBeNull()
    }
  })
})

// ---------------------------------------------------------------------------
// mapListingDetail
// ---------------------------------------------------------------------------

describe('mapListingDetail', () => {
  it('mapper 不公开 contactBroker 和审核字段', () => {
    const detail = mapListingDetail({
      ...LISTING_MONTHLY_STANDARD,
      contactBroker: { id: 1, phone: '13800001111' },
      reviewStatus: 'approved',
      spaceDetails: { efficiencyRate: 70, seatMin: 8, seatMax: 16 },
      costTerms: { depositMonths: 3 },
      registrationStatus: 'available',
      mediaItems: [{
        resource: MEDIA_COVER_A,
        kind: 'image',
        category: 'workspace',
        alt: '  公开工位图  ',
        capturedAt: '2026-07-01T00:00:00.000Z',
        isSchematic: false,
      }],
      verificationInfo: {
        verifiedAt: '2026-07-01T00:00:00.000Z',
        priceVerifiedAt: '2026-07-02T00:00:00.000Z',
      },
    })
    expect(detail).not.toHaveProperty('contactBroker')
    expect(detail).not.toHaveProperty('reviewStatus')
    expect(JSON.stringify(detail)).not.toContain('13800001111')
    expect(detail?.mediaItems).toHaveLength(1)
    expect(detail?.mediaItems[0]).toMatchObject({
      id: '/media/cover-jingan-center.jpg:0',
      category: 'workspace',
      capturedAt: '2026-07-01T00:00:00.000Z',
    })
    expect(detail?.verification).toEqual({
      verifiedAt: '2026-07-01T00:00:00.000Z',
      priceVerifiedAt: '2026-07-02T00:00:00.000Z',
    })
  })

  it('仅公开房源媒体的闭合分类', () => {
    const detail = mapListingDetail({
      ...LISTING_MONTHLY_STANDARD,
      mediaItems: [
        { resource: MEDIA_COVER_A, kind: 'image', category: 'workspace', alt: '办公区' },
        { resource: MEDIA_COVER_A, kind: 'image', category: '13800001111', alt: '电话' },
      ],
    })
    expect(detail?.mediaItems.map((item) => item.category)).toEqual(['workspace'])
  })

  it('详情显式保留卡片的业务类型和装修状态', () => {
    const detail = mapListingDetail({
      ...LISTING_MONTHLY_STANDARD,
      businessType: 'sale',
      decorationStatus: 'fully_fitted',
    })
    expect(detail).toMatchObject({ businessType: 'sale', decorationStatus: 'fully_fitted' })
  })

  it('公开事实覆盖 P0 房源楼层、装修、入驻、租期、付款和核验更新时间', () => {
    const detail = mapListingDetail({
      ...LISTING_MONTHLY_STANDARD,
      floor: '18F',
      decorationStatus: 'fully_fitted',
      availableFrom: '2026-08-01T00:00:00.000Z',
      minimumLeaseMonths: 24,
      paymentTerms: '押三付一',
      registrationStatus: 'conditional',
      verificationInfo: {
        verifiedAt: '2026-07-20T00:00:00.000Z',
        priceVerifiedAt: '2026-07-21T00:00:00.000Z',
      },
    })
    const facts = detail?.factGroups.flatMap((group) => group.facts) ?? []
    expect(facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '房源楼层', value: '18F' }),
      expect.objectContaining({ label: '装修', value: '拎包入住' }),
      expect.objectContaining({ label: '可入驻日期', value: '2026-08-01T00:00:00.000Z' }),
      expect.objectContaining({ label: '最短租期', value: '24 个月' }),
      expect.objectContaining({ label: '付款方式', value: '押三付一' }),
      expect.objectContaining({ label: '注册', value: '有条件注册' }),
      expect.objectContaining({ label: '信息核验时间', value: '2026-07-20T00:00:00.000Z' }),
      expect.objectContaining({ label: '价格核验时间', value: '2026-07-21T00:00:00.000Z' }),
    ]))
  })

  it('在卡片字段上增加画廊、楼盘摘要和富文本说明', () => {
    const detail = mapListingDetail(LISTING_MONTHLY_STANDARD)
    expect(detail).not.toBeNull()
    expect(detail?.seats).toBe(12)
    expect(detail?.description).toBeNull()
    expect(detail?.gallery.length).toBeGreaterThan(0)
    // 画廊首图应来自房源 coverImage
    expect(detail?.gallery[0].src).toBe('/media/cover-jingan-center.jpg')
  })

  it('legacy 画廊只合并房源 coverImage 与房源 gallery（去重）', () => {
    const detail = mapListingDetail({
      ...LISTING_MONTHLY_STANDARD,
      gallery: [
        { image: MEDIA_COVER_A, id: 'listing-duplicate-cover' },
        { image: MEDIA_GALLERY_1, id: 'listing-gallery-1' },
      ],
    })
    expect(detail?.gallery.length).toBe(2)
    const srcs = detail?.gallery.map((g) => g.src)
    expect(srcs).toContain('/media/cover-jingan-center.jpg')
    expect(srcs).toContain('/media/lobby.jpg')
    expect(srcs).not.toContain('/media/meeting-room.jpg')
    // 不应重复
    expect(new Set(srcs).size).toBe(srcs?.length)
  })

  it('房源没有自有媒体时不得以楼盘 gallery 冒充房源媒体', () => {
    const detail = mapListingDetail({
      ...LISTING_MONTHLY_STANDARD,
      coverImage: null,
      gallery: null,
    })
    expect(detail?.gallery).toEqual([])
  })

  it('重复 src 被去重', () => {
    // 构造一个 coverImage 与房源 gallery 首图相同的场景
    const listingWithDupCover: typeof LISTING_MONTHLY_STANDARD = {
      ...LISTING_MONTHLY_STANDARD,
      coverImage: MEDIA_COVER_A,
      gallery: [{ image: MEDIA_COVER_A, id: 'same-as-cover' }],
    }
    const detail = mapListingDetail(listingWithDupCover)
    const srcs = detail?.gallery.map((g) => g.src)
    const coverCount = srcs?.filter((s) => s === '/media/cover-jingan-center.jpg').length
    expect(coverCount).toBe(1)
  })

  it('未知输入 → 返回 null', () => {
    expect(mapListingDetail(null)).toBeNull()
    expect(mapListingDetail({})).toBeNull()
    expect(mapListingDetail('string')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// mapBuildingDetail
// ---------------------------------------------------------------------------

describe('mapBuildingDetail', () => {
  it('exposes the persisted Hangzhou city identity', () => {
    expect(mapBuildingDetail(BUILDING_HANGZHOU)).toMatchObject({
      citySlug: 'hangzhou',
      cityName: '杭州市',
    })
  })

  it('rejects raw, missing, disabled, malformed, and noncanonical city relationships', () => {
    const invalidCities: unknown[] = [
      100,
      undefined,
      { ...CITY_HANGZHOU, status: 'disabled' },
      { ...CITY_HANGZHOU, type: 'district' },
      { ...CITY_HANGZHOU, slug: ' Hangzhou ' },
      { ...CITY_HANGZHOU, name: '   ' },
    ]

    for (const city of invalidCities) {
      expect(mapBuildingCity({ ...BUILDING_HANGZHOU, city })).toBeNull()
      expect(mapBuildingDetail({ ...BUILDING_HANGZHOU, city })).toBeNull()
    }
  })

  it('认证按同一 asOf 过滤公开状态和有效期', () => {
    const b = mapBuildingDetail({
      ...BUILDING_JINGAN_CENTER,
      certifications: [
        { name: '未来认证', publicVisible: true, validFrom: '2026-08-01T00:00:00.000Z' },
        { name: '当前认证', publicVisible: true, validFrom: '2026-01-01T00:00:00.000Z', validTo: '2026-08-01T00:00:00.000Z' },
        { name: '已过期认证', publicVisible: true, validTo: '2026-07-01T00:00:00.000Z' },
        { name: '内部认证', publicVisible: false },
      ],
    }, '2026-07-30T00:00:00.000Z')
    expect(b?.amenityGroups.find((group) => group.id === 'certifications')?.items)
      .toEqual(['当前认证'])
  })

  it('公开事实覆盖 P0 楼盘身份、建筑、物业、停车和注册能力且不混入房源事实', () => {
    const b = mapBuildingDetail({
      ...BUILDING_JINGAN_CENTER,
      buildingType: 'office_building',
      grade: 'grade-a',
      registrationCapability: 'supported',
      completionDate: '2020-01-01T00:00:00.000Z',
      totalFloors: 32,
      propertyCompany: '测试物业',
      propertyFee: 28,
      parkingSpaces: 300,
      floor: '18F',
      decorationStatus: 'fully_fitted',
      minimumLeaseMonths: 24,
    })
    expect(b).toMatchObject({ buildingType: 'office_building', grade: 'grade-a' })
    const facts = b?.factGroups.flatMap((group) => group.facts) ?? []
    expect(facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '物业类型', value: '写字楼' }),
      expect.objectContaining({ label: '楼宇等级', value: '甲级' }),
      expect.objectContaining({ label: '注册能力', value: '支持注册' }),
      expect.objectContaining({ label: '竣工时间', value: '2020-01-01T00:00:00.000Z' }),
      expect.objectContaining({ label: '总楼层', value: '32 层' }),
      expect.objectContaining({ label: '物业公司', value: '测试物业' }),
      expect.objectContaining({ label: '物业费', value: '28 元/㎡/月' }),
      expect.objectContaining({ label: '停车位', value: '300 个' }),
    ]))
    expect(facts.map((item) => item.label)).not.toEqual(expect.arrayContaining([
      '房源楼层',
      '装修',
      '最短租期',
    ]))
  })

  /**
   * `FactValue.magnitude`/`unit`（OPT-037 Task 10b）——无图替代构图要把数值排
   * 32px、单位排 14px，只能由 mapper 在**唯一知道后缀是什么的地方**把两半一起
   * 产出。这条用例锁住的不是"新字段存在"，而是**它与 `value` 永不分叉**：
   * `value === magnitude + unit`。分叉的后果是宫格显示的数字与规格表不一致，
   * 而两边都不会报错。
   */
  it('数值事实同时给出 magnitude/unit，且与 value 恒一致', () => {
    const b = mapBuildingDetail({
      ...BUILDING_JINGAN_CENTER,
      totalFloors: 32,
      parkingSpaces: 300,
      developerAndScale: { typicalFloorArea: 1500, efficiencyRate: 70 },
      verticalTransport: { passengerElevators: 6, freightElevators: 1 },
    })
    const facts = b?.factGroups.flatMap((group) => group.facts) ?? []
    const byLabel = (label: string) => facts.find((item) => item.label === label)

    expect(byLabel('总楼层')).toMatchObject({ value: '32 层', magnitude: '32', unit: '层' })
    expect(byLabel('标准层面积')).toMatchObject({ value: '1500 ㎡', magnitude: '1500', unit: '㎡' })
    expect(byLabel('得房率')).toMatchObject({ value: '70%', magnitude: '70', unit: '%' })
    expect(byLabel('客梯')).toMatchObject({ value: '6 部', magnitude: '6', unit: '部' })
    expect(byLabel('停车位')).toMatchObject({ value: '300 个', magnitude: '300', unit: '个' })

    // 文本事实没有单位：unit 必须是 null，magnitude 与 value 相同——否则宫格会
    // 把值的尾字当成单位排成小字。
    expect(byLabel('物业类型')).toMatchObject({ value: '写字楼', magnitude: '写字楼', unit: null })
    expect(byLabel('注册能力')?.unit).toBeNull()

    // 恒等式对**每一条**事实成立，不只上面点名的那几条。
    // 唯一允许的差异是数值与单位之间那个分隔空格：展示串里它是字面量
    // （"32 层"），拆分形态里由 `.dt-keyspecs__value-row` 的 gap 承担，所以
    // `unit` 是 trim 过的。除此之外两种形态必须一字不差。
    for (const item of facts) {
      if (item.value == null) {
        expect(item.magnitude).toBeNull()
        continue
      }
      const rejoined = `${item.magnitude ?? ''}${item.unit ?? ''}`
      expect(rejoined.replace(/\s+/g, '')).toBe(item.value.replace(/\s+/g, ''))
    }
  })

  it('仅公开楼盘媒体的闭合分类', () => {
    const detail = mapBuildingDetail({
      ...BUILDING_JINGAN_CENTER,
      mediaItems: [
        { resource: MEDIA_COVER_A, kind: 'image', category: 'exterior', alt: '外立面' },
        { resource: MEDIA_COVER_A, kind: 'image', category: 'workspace', alt: '不适用分类' },
      ],
    })
    expect(detail?.mediaItems.map((item) => item.category)).toEqual(['exterior'])
  })

  it('完整 Building → 投影公开字段', () => {
    const b = mapBuildingDetail(BUILDING_JINGAN_CENTER)
    expect(b?.id).toBe(200)
    expect(b?.name).toBe('静安中心')
    expect(b?.address).toBe('上海市静安区南京西路 1788 号')
    expect(b?.grade).toBe('grade-a')
    expect(b?.district?.name).toBe('静安')
    expect(b?.businessDistrict?.name).toBe('南京西路商圈')
    expect(b?.nearestMetro?.name).toBe('静安寺站')
    expect(b?.summary).toBe('南京西路核心地段甲级写字楼')
  })

  it('gallery 合并 coverImage 与楼盘 gallery（去重）', () => {
    const b = mapBuildingDetail(BUILDING_JINGAN_CENTER)
    expect(b?.gallery.length).toBe(3) // 1 张 cover + 2 张 gallery
    const srcs = b?.gallery.map((g) => g.src)
    expect(srcs).toContain('/media/cover-jingan-center.jpg')
    expect(srcs).toContain('/media/lobby.jpg')
    expect(srcs).toContain('/media/meeting-room.jpg')
    expect(new Set(srcs).size).toBe(srcs?.length)
  })

  it('配套项名称被收集到 amenities 数组', () => {
    const b = mapBuildingDetail(BUILDING_JINGAN_CENTER)
    expect(b?.amenities).toEqual(['停车场', '咖啡厅'])
  })

  it('rejects a depth=0 building whose city is only an id', () => {
    expect(mapBuildingDetail(BUILDING_PUDONG_FLAT)).toBeNull()
  })

  it('不暴露 verificationStatus（内部审核字段）', () => {
    const b = mapBuildingDetail(BUILDING_JINGAN_CENTER)
    expect(JSON.stringify(b)).not.toContain('verificationStatus')
  })

  it('仅暴露公开近似坐标，不暴露高精度内部坐标（PRD 04 §358 / P1 Task 3）', () => {
    const b = mapBuildingDetail({
      ...BUILDING_JINGAN_CENTER,
      latitude: 31.223647,
      longitude: 121.455412,
    })
    expect(b?.coordinates).toEqual({ latitude: 31.2236, longitude: 121.4554 })
    const json = JSON.stringify(b)
    expect(json).not.toContain('31.223647')
    expect(json).not.toContain('121.455412')
  })

  it('不暴露 createdBy/lastModifiedBy/version', () => {
    const b = mapBuildingDetail(BUILDING_JINGAN_CENTER)
    const json = JSON.stringify(b)
    expect(json).not.toContain('createdBy')
    expect(json).not.toContain('lastModifiedBy')
    expect(json).not.toMatch(/"version":/)
  })

  it('不暴露 operationalStatus（内部运营状态）', () => {
    const b = mapBuildingDetail(BUILDING_JINGAN_CENTER)
    expect(JSON.stringify(b)).not.toContain('operationalStatus')
  })

  it('不暴露 status（公开可见性由查询门面决定）', () => {
    const b = mapBuildingDetail(BUILDING_JINGAN_CENTER)
    expect(JSON.stringify(b)).not.toMatch(/"status":/)
  })

  it('已停用楼盘仍映射公开近似坐标（可见性由查询门面决定，非 mapper 职责）', () => {
    const b = mapBuildingDetail({
      ...BUILDING_DISABLED,
      latitude: 31.000047,
      longitude: 121.000012,
    })
    expect(b?.coordinates).toEqual({ latitude: 31, longitude: 121 })
    const json = JSON.stringify(b)
    expect(json).not.toContain('31.000047')
    expect(json).not.toContain('121.000012')
  })

  it('非 Building 输入 → 返回 null', () => {
    expect(mapBuildingDetail(null)).toBeNull()
    expect(mapBuildingDetail({})).toBeNull()
    expect(mapBuildingDetail('string')).toBeNull()
  })
})
