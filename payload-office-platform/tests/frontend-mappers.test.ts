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
  it.each([
    ['day', 'sqm', 'sqm', 'rmb-sqm-day', '12 元/㎡/天'],
    ['day', 'suite', 'total', 'rmb-total', '12 元/天'],
    ['day', 'seat', 'seat', 'rmb-total', '12 元/工位/天'],
    ['month', 'sqm', 'sqm', 'rmb-total', '12 元/㎡/月'],
    ['month', 'suite', 'total', 'rmb-month', '12 元/月'],
    ['month', 'seat', 'seat', 'rmb-seat-month', '12 元/工位/月'],
    ['year', 'sqm', 'sqm', 'rmb-total', '12 元/㎡/年'],
    ['year', 'suite', 'total', 'rmb-total', '12 元/年'],
    ['year', 'seat', 'seat', 'rmb-total', '12 元/工位/年'],
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
