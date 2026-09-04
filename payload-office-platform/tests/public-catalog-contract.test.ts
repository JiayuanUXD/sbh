/**
 * F1.5 单测：公开目录契约与稳定排序
 *
 * 设计依据：specs/frontend-mvp/design.md §7.1、§7.4、§15.2
 *           specs/frontend-mvp/tasks.md F1.5
 *
 * 守护不变量：
 *   - URL → ListingSearchInput 解析对每个字段做白名单校验，非法值降级为默认；
 *   - canonical URL 与原 URL 等价（同一组有效参数 round-trip）；
 *   - 价格排序缺少 rentUnit 时降级为 recommended（design.md §7.4 禁跨单位排序）；
 *   - 稳定排序同权重以 listing_id 升序收束，保证跨页稳定；
 *   - 分页切片对 totalDocs 与 totalPages 计算一致；
 *   - 跨 rentUnit 的卡片列表 isSameRentUnit 返回 false。
 *
 * M4.7 未完成，本测试仅覆盖 Facade 接口与排序/分页工具；
 * M4.7 完成后契约不变，仅替换 supply-adapter 内部实现。
 */

import { describe, expect, it } from 'vitest'
import {
  buildCanonicalSearchParams,
  parseListingSearchInput,
} from '@/domain/public-catalog/search-params'
import {
  filterByRentUnit,
  isSameRentUnit,
  paginate,
  stableSortCards,
} from '@/domain/public-catalog/stable-sort'
import {
  mapListingCard,
  type ListingCardViewModel,
} from '@/domain/public-catalog'
import {
  LISTING_DAILY_PER_SQM,
  LISTING_MONTHLY_STANDARD,
  LISTING_SEAT_PER_MONTH,
} from '@/test/frontend/payload-documents'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** 用 updatedAt 作为 lastEffectiveMaintainedAt 过渡 */
function updatedAtOf(card: ListingCardViewModel): number {
  // stableSortCards 不直接读 updatedAt（DTO 不暴露），这里通过原始 fixture 映射。
  // 实际场景由 supply-adapter 在映射时传入回调，测试用固定映射。
  const FIXTURE_BY_ID: Record<number, string> = {
    1001: '2026-07-15T00:00:00.000Z',
    1002: '2026-07-15T00:00:00.000Z',
    1003: '2026-07-10T00:00:00.000Z',
  }
  return Date.parse(FIXTURE_BY_ID[card.id] ?? '')
}

function price(
  amount: number,
  displayUnit: 'rmb-sqm-day' | 'rmb-month' | 'rmb-seat-month',
) {
  const key = displayUnit === 'rmb-sqm-day'
    ? { period: 'day' as const, basis: 'sqm' as const }
    : displayUnit === 'rmb-seat-month'
      ? { period: 'month' as const, basis: 'seat' as const }
      : { period: 'month' as const, basis: 'total' as const }
  const label = displayUnit === 'rmb-sqm-day' ? '元/㎡/天' : displayUnit === 'rmb-seat-month' ? '元/工位/月' : '元/月'
  return { amount, currency: 'CNY' as const, businessType: 'lease' as const, ...key, displayUnit, text: `${amount} ${label}` }
}

function card(id: number, overrides: Partial<ListingCardViewModel> = {}): ListingCardViewModel {
  const base: ListingCardViewModel = {
    citySlug: 'shanghai',
    cityName: '上海市',
    id,
    slug: `listing-${id}`,
    title: `房源 ${id}`,
    price: price(100 * id, 'rmb-month'),
    area: 100,
    floor: null,
    seats: null,
    businessType: 'lease',
    decorationStatus: null,
    listingType: 'traditional-office',
    availableFrom: null,
    isFeatured: false,
    building: null,
    coverImage: null,
    highlights: [],
    stableSortKey: `listing-${id}`,
  }
  return { ...base, ...overrides }
}

// ---------------------------------------------------------------------------
// parseListingSearchInput
// ---------------------------------------------------------------------------

describe('parseListingSearchInput', () => {
  it('解析合法复合参数', () => {
    const sp = new URLSearchParams(
      'district=jingan&district=xuhui&type=serviced-office&priceMin=2000&priceMax=5000&priceUnit=rmb-month&q=江景&sort=price-asc&page=2&availableBefore=2026-08-01&areaMin=50&areaMax=200',
    )
    const input = parseListingSearchInput(sp)
    expect(input.district).toEqual(['jingan', 'xuhui'])
    expect(input.listingType).toEqual(['serviced-office'])
    expect(input.priceMin).toBe(2000)
    expect(input.priceMax).toBe(5000)
    expect(input.priceUnit).toBe('rmb-month')
    expect(input.q).toBe('江景')
    expect(input.sort).toBe('price-asc')
    expect(input.page).toBe(2)
    expect(input.availableBefore).toBe('2026-08-01')
    expect(input.areaMin).toBe(50)
    expect(input.areaMax).toBe(200)
    expect(input.pageSize).toBe(24)
  })

  it('空参数 → 全部字段默认值', () => {
    const input = parseListingSearchInput(new URLSearchParams())
    expect(input.district).toBeUndefined()
    expect(input.listingType).toBeUndefined()
    expect(input.priceMin).toBeUndefined()
    expect(input.sort).toBe('recommended')
    expect(input.page).toBe(1)
    expect(input.pageSize).toBe(24)
  })

  it('非法 listingType 值被丢弃', () => {
    const sp = new URLSearchParams('type=fake-type&type=serviced-office')
    const input = parseListingSearchInput(sp)
    expect(input.listingType).toEqual(['serviced-office'])
  })

  it('非法 rentUnit 值被丢弃', () => {
    const sp = new URLSearchParams('rentUnit=usd-month')
    const input = parseListingSearchInput(sp)
    expect(input.priceUnit).toBeUndefined()
  })

  it('非法 sort 值被丢弃，降级为 recommended', () => {
    const sp = new URLSearchParams('sort=random')
    const input = parseListingSearchInput(sp)
    expect(input.sort).toBe('recommended')
  })

  it('价格排序缺少 rentUnit 时降级为 recommended（禁跨单位排序）', () => {
    const sp = new URLSearchParams('sort=price-asc')
    const input = parseListingSearchInput(sp)
    expect(input.sort).toBe('recommended')
    expect(input.priceUnit).toBeUndefined()
  })

  it('价格排序配合 rentUnit 时保留', () => {
    const sp = new URLSearchParams('sort=price-desc&priceUnit=rmb-sqm-day')
    const input = parseListingSearchInput(sp)
    expect(input.sort).toBe('price-desc')
    expect(input.priceUnit).toBe('rmb-sqm-day')
    expect(input.pricePeriod).toBe('day')
    expect(input.priceBasis).toBe('sqm')
  })

  it('非法日期格式被丢弃', () => {
    const cases = ['2026-13-01', '2026-02-30', 'not-a-date', '2026/08/01', '2026-8-1']
    for (const v of cases) {
      const sp = new URLSearchParams(`availableBefore=${encodeURIComponent(v)}`)
      const input = parseListingSearchInput(sp)
      expect(input.availableBefore, `availableBefore=${v}`).toBeUndefined()
    }
  })

  it('合法日期通过（含闰年 2024-02-29）', () => {
    const sp = new URLSearchParams('availableBefore=2024-02-29')
    const input = parseListingSearchInput(sp)
    expect(input.availableBefore).toBe('2024-02-29')
  })

  it('负数 / 非数字 rentMin 被丢弃', () => {
    const sp = new URLSearchParams('rentMin=-100&priceMax=abc')
    const input = parseListingSearchInput(sp)
    expect(input.priceMin).toBeUndefined()
    expect(input.priceMax).toBeUndefined()
  })

  it('page 越界回退为 1', () => {
    const sp = new URLSearchParams('page=0')
    expect(parseListingSearchInput(sp).page).toBe(1)
    const sp2 = new URLSearchParams('page=-5')
    expect(parseListingSearchInput(sp2).page).toBe(1)
    const sp3 = new URLSearchParams('page=abc')
    expect(parseListingSearchInput(sp3).page).toBe(1)
  })

  it('q 超长被截断', () => {
    const long = 'x'.repeat(200)
    const sp = new URLSearchParams(`q=${long}`)
    const input = parseListingSearchInput(sp)
    expect(input.q?.length).toBe(100)
  })

  it('q 全空白被丢弃', () => {
    const sp = new URLSearchParams('q=%20%20%20')
    const input = parseListingSearchInput(sp)
    expect(input.q).toBeUndefined()
  })

  it('q 含控制字符或孤立代理项时 fail-closed', () => {
    expect(parseListingSearchInput(new URLSearchParams({ q: 'jing\u0000an' })).q).toBeUndefined()
    expect(parseListingSearchInput(new URLSearchParams({ q: '\uD800' })).q).toBeUndefined()
  })

  it('数组字段超长被截断至 20', () => {
    const sp = new URLSearchParams()
    for (let i = 0; i < 30; i++) sp.append('district', `d${i}`)
    const input = parseListingSearchInput(sp)
    expect(input.district?.length).toBe(20)
  })
})

// ---------------------------------------------------------------------------
// buildCanonicalSearchParams round-trip
// ---------------------------------------------------------------------------

describe('buildCanonicalSearchParams', () => {
  it('合法参数 round-trip 等价', () => {
    const original = new URLSearchParams(
      'district=jingan&type=serviced-office&priceMin=2000&priceMax=5000&priceUnit=rmb-month&q=江景&sort=price-asc&page=2',
    )
    const input = parseListingSearchInput(original)
    const canonical = buildCanonicalSearchParams(input)
    const reparsed = parseListingSearchInput(canonical)
    expect(reparsed).toEqual(input)
  })

  it('recommended sort 不出现在 canonical URL（默认值省略）', () => {
    const input = parseListingSearchInput(new URLSearchParams(''))
    const canonical = buildCanonicalSearchParams(input)
    expect(canonical.has('sort')).toBe(false)
    expect(canonical.has('page')).toBe(false)
  })

  it('page=1 省略', () => {
    const input = parseListingSearchInput(new URLSearchParams('page=1'))
    const canonical = buildCanonicalSearchParams(input)
    expect(canonical.has('page')).toBe(false)
  })

  it('非法参数经 round-trip 后被规范化丢弃', () => {
    const dirty = new URLSearchParams('type=fake&sort=random&priceUnit=usd&availableBefore=2026-13-01')
    const input = parseListingSearchInput(dirty)
    const canonical = buildCanonicalSearchParams(input)
    expect(canonical.has('type')).toBe(false)
    expect(canonical.has('sort')).toBe(false)
    expect(canonical.has('rentUnit')).toBe(false)
    expect(canonical.has('availableBefore')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// stableSortCards
// ---------------------------------------------------------------------------

describe('stableSortCards', () => {
  it('recommended: isFeatured 优先，同 isFeatured 按 updatedAt desc，同 updatedAt 按 id asc', () => {
    const cards = [
      card(3, { isFeatured: false }),
      card(2, { isFeatured: false }),
      card(1, { isFeatured: true }),
    ]
    // 给 id=2、id=3 一个更晚的 updatedAt
    const t = {
      1: '2026-07-15T00:00:00.000Z',
      2: '2026-07-20T00:00:00.000Z',
      3: '2026-07-20T00:00:00.000Z',
    }
    const lastEffAt = (c: ListingCardViewModel) => Date.parse(t[c.id as 1 | 2 | 3])
    const sorted = stableSortCards(cards, 'recommended', lastEffAt)
    // featured(id=1) 第一；剩下两个 updatedAt 相同，id 升序 → 2 在前
    expect(sorted.map((c) => c.id)).toEqual([1, 2, 3])
  })

  it('newest: updatedAt desc → id asc', () => {
    const cards = [
      card(3, {}),
      card(2, {}),
      card(1, {}),
    ]
    const t = {
      1: '2026-07-10T00:00:00.000Z',
      2: '2026-07-20T00:00:00.000Z',
      3: '2026-07-20T00:00:00.000Z',
    }
    const lastEffAt = (c: ListingCardViewModel) => Date.parse(t[c.id as 1 | 2 | 3])
    const sorted = stableSortCards(cards, 'newest', lastEffAt)
    // 2 与 3 updatedAt 相同，id 升序：2 → 3 → 1
    expect(sorted.map((c) => c.id)).toEqual([2, 3, 1])
  })

  it('rent-asc: 同单位价格升序 → id asc 收束', () => {
    const cards = [
      card(3, { price: price(300, 'rmb-month') }),
      card(2, { price: price(200, 'rmb-month') }),
      card(1, { price: price(200, 'rmb-month') }),
    ]
    const sorted = stableSortCards(cards, 'price-asc', updatedAtOf)
    // 200 元并列，按 id 升序：1 → 2 → 3
    expect(sorted.map((c) => c.id)).toEqual([1, 2, 3])
  })

  it('rent-desc: 同单位价格降序 → id asc 收束', () => {
    const cards = [
      card(1, { price: price(200, 'rmb-month') }),
      card(2, { price: price(300, 'rmb-month') }),
      card(3, { price: price(300, 'rmb-month') }),
    ]
    const sorted = stableSortCards(cards, 'price-desc', updatedAtOf)
    // 300 元并列，按 id 升序：2 → 3 → 1
    expect(sorted.map((c) => c.id)).toEqual([2, 3, 1])
  })

  it('价格 key 不完整相同时不按金额混排', () => {
    const cards = [
      card(1, {
        businessType: 'lease',
        price: {
          amount: 100,
          currency: 'CNY',
          businessType: 'lease',
          period: 'month',
          basis: 'total',
          displayUnit: 'rmb-month',
          text: '100 元/月',
        },
      }),
      card(2, {
        businessType: 'sale',
        price: {
          amount: 1,
          currency: 'CNY',
          businessType: 'sale',
          period: 'month',
          basis: 'total',
          displayUnit: 'rmb-month',
          text: '1 元/月',
        },
      }),
    ]
    expect(stableSortCards(cards, 'price-asc', updatedAtOf).map((item) => item.id)).toEqual([1, 2])
  })

  it('rent-asc: price=null 卡片始终末尾', () => {
    const cards = [
      card(1, { price: null }),
      card(2, { price: price(200, 'rmb-month') }),
      card(3, { price: null }),
    ]
    const sorted = stableSortCards(cards, 'price-asc', updatedAtOf)
    expect(sorted.map((c) => c.id)).toEqual([2, 1, 3])
  })

  it('不修改输入数组（pure function）', () => {
    const cards = [card(3), card(1), card(2)]
    const original = cards.map((c) => c.id)
    stableSortCards(cards, 'newest', updatedAtOf)
    expect(cards.map((c) => c.id)).toEqual(original)
  })

  it('同权重同 updatedAt 跨多次运行结果稳定', () => {
    const cards = Array.from({ length: 10 }, (_, i) => card(i + 1))
    const lastEffAt = () => Date.parse('2026-07-15T00:00:00.000Z')
    const r1 = stableSortCards(cards, 'newest', lastEffAt).map((c) => c.id)
    const r2 = stableSortCards(cards, 'newest', lastEffAt).map((c) => c.id)
    expect(r1).toEqual(r2)
    // 同权重按 id 升序
    expect(r1).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })
})

// ---------------------------------------------------------------------------
// isSameRentUnit / filterByRentUnit
// ---------------------------------------------------------------------------

describe('isSameRentUnit', () => {
  it('同单位 → true', () => {
    const cards = [
      card(1, { price: price(200, 'rmb-month') }),
      card(2, { price: price(300, 'rmb-month') }),
    ]
    expect(isSameRentUnit(cards)).toBe(true)
  })

  it('混合单位 → false（禁跨单位排序）', () => {
    const cards = [
      card(1, { price: price(200, 'rmb-month') }),
      card(2, { price: price(8.5, 'rmb-sqm-day') }),
    ]
    expect(isSameRentUnit(cards)).toBe(false)
  })

  it('全为 null 价格 → true（视为同组无价格）', () => {
    const cards = [card(1, { price: null }), card(2, { price: null })]
    expect(isSameRentUnit(cards)).toBe(true)
  })

  it('fixture 映射后混合单位 → false', () => {
    const cards = [
      mapListingCard(LISTING_MONTHLY_STANDARD)!,
      mapListingCard(LISTING_DAILY_PER_SQM)!,
      mapListingCard(LISTING_SEAT_PER_MONTH)!,
    ]
    expect(cards.every((c) => c !== null)).toBe(true)
    expect(isSameRentUnit(cards)).toBe(false)
  })
})

describe('filterByRentUnit', () => {
  it('仅保留指定单位卡片', () => {
    const cards = [
      card(1, { price: price(200, 'rmb-month') }),
      card(2, { price: price(8.5, 'rmb-sqm-day') }),
      card(3, { price: price(300, 'rmb-month') }),
    ]
    const filtered = filterByRentUnit(cards, 'rmb-month')
    expect(filtered.map((c) => c.id)).toEqual([1, 3])
  })

  it('无匹配单位 → 空数组', () => {
    const cards = [
      card(1, { price: price(200, 'rmb-month') }),
    ]
    expect(filterByRentUnit(cards, 'rmb-sqm-day')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// paginate
// ---------------------------------------------------------------------------

describe('paginate', () => {
  it('切片当前页', () => {
    const items = Array.from({ length: 50 }, (_, i) => i + 1)
    const r = paginate(items, 2, 24)
    expect(r.docs).toEqual(Array.from({ length: 24 }, (_, i) => 25 + i))
    expect(r.totalDocs).toBe(50)
    expect(r.totalPages).toBe(3)
  })

  it('末页不足 pageSize', () => {
    const items = Array.from({ length: 50 }, (_, i) => i + 1)
    const r = paginate(items, 3, 24)
    expect(r.docs).toEqual([49, 50])
    expect(r.totalPages).toBe(3)
  })

  it('越界页 → 空文档但 totalDocs 正确', () => {
    const items = Array.from({ length: 10 }, (_, i) => i + 1)
    const r = paginate(items, 999, 24)
    expect(r.docs).toEqual([])
    expect(r.totalDocs).toBe(10)
    expect(r.totalPages).toBe(1)
  })

  it('page < 1 自动回退为 1', () => {
    const items = [1, 2, 3]
    const r = paginate(items, 0, 24)
    expect(r.docs).toEqual([1, 2, 3])
  })

  it('空列表 → page 1, totalDocs 0, totalPages 1', () => {
    const r = paginate([], 1, 24)
    expect(r.docs).toEqual([])
    expect(r.totalDocs).toBe(0)
    expect(r.totalPages).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Mapper field whitelist summary（已在 frontend-mappers.test.ts 详细覆盖，这里仅契约断言）
// ---------------------------------------------------------------------------

describe('Public Catalog DTO 字段白名单契约', () => {
  it('ListingCardViewModel 不包含审核/举报/商户/内部电话字段', () => {
    const cardVm = mapListingCard(LISTING_MONTHLY_STANDARD)!
    const keys = Object.keys(cardVm)
    // 守护：禁止出现敏感字段
    const forbidden = [
      'status',
      'reviewStatus',
      'publicationStatus',
      'supplyVisibilityHold',
      'reports',
      'merchantId',
      'merchant',
      'brokerId',
      'broker',
      'internalPhone',
      'deletedAt',
      'createdBy',
      'lastModifiedBy',
    ]
    for (const f of forbidden) {
      expect(keys, `字段 ${f} 不应出现在 DTO`).not.toContain(f)
    }
  })

  it('ListingCardViewModel 公开字段清单', () => {
    const cardVm = mapListingCard(LISTING_MONTHLY_STANDARD)!
    expect(Object.keys(cardVm).sort()).toEqual(
      [
        'id',
        'slug',
        'title',
        'price',
        'area',
        'floor',
        'seats',
        'businessType',
        'citySlug',
        'cityName',
        'decorationStatus',
        'listingType',
        'availableFrom',
        'isFeatured',
        'building',
        'coverImage',
        'highlights',
        'stableSortKey',
      ].sort(),
    )
  })
})
