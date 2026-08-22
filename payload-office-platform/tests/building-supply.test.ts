import { describe, expect, it } from 'vitest'
import { buildBuildingSupplySnapshot } from '@/domain/public-catalog/building-supply'
import { getBuildingDetail, getRelatedBuildings, type ListingCardViewModel } from '@/domain/public-catalog'
import { createSearchContext } from '@/domain/public-catalog'
import { rankRelatedBuildingsByProximity } from '@/domain/public-catalog/supply-adapter'
import { shanghaiDate } from '@/domain/shared/time'
import type { Building } from '@/payload-types'
import { BUILDING_JINGAN_CENTER, LISTING_MONTHLY_STANDARD } from '@/test/frontend/payload-documents'

const AS_OF = '2026-07-30T10:00:00.000Z'

function makeCard(overrides: Partial<ListingCardViewModel> = {}): ListingCardViewModel {
  return {
    id: 1,
    slug: 'listing-1',
    title: '测试房源',
    price: {
      amount: 8.5,
      businessType: 'lease',
      currency: 'CNY',
      period: 'day',
      basis: 'sqm',
      displayUnit: 'rmb-sqm-day',
      text: '8.5 元/㎡/天',
    },
    area: 100,
    floor: null,
    seats: null,
    businessType: 'lease',
    decorationStatus: 'fully_fitted',
    listingType: 'traditional-office',
    availableFrom: '2026-08-01',
    isFeatured: false,
    building: null,
    coverImage: null,
    highlights: [],
    stableSortKey: 'listing-1',
    ...overrides,
    citySlug: overrides.citySlug ?? 'shanghai',
    cityName: overrides.cityName ?? '上海市',
  }
}

describe('buildBuildingSupplySnapshot', () => {
  it('出租、出售和联合办公独立分组', () => {
    const snapshot = buildBuildingSupplySnapshot(
      [
        makeCard(),
        makeCard({
          id: 2,
          slug: 'sale',
          businessType: 'sale',
          price: {
            amount: 50000,
            businessType: 'sale',
            currency: 'CNY',
            period: 'one-time',
            basis: 'total',
            displayUnit: 'rmb-total',
            text: '50000 元',
          },
        }),
        makeCard({
          id: 3,
          slug: 'coworking',
          listingType: 'coworking',
          price: {
            amount: 2000,
            businessType: 'lease',
            currency: 'CNY',
            period: 'month',
            basis: 'seat',
            displayUnit: 'rmb-seat-month',
            text: '2000 元/工位/月',
          },
        }),
      ],
      { sort: 'recommended' },
      AS_OF,
    )

    expect(snapshot.groups.map((group) => group.key)).toEqual(['lease', 'sale', 'coworking'])
  })

  it('分组筛选只收窄结果行，保留全部非空业务组及统一公开聚合', () => {
    const cards = [
      makeCard({ id: 1, slug: 'lease', area: 100, availableFrom: null }),
      makeCard({
        id: 2,
        slug: 'sale',
        area: 240,
        businessType: 'sale',
        availableFrom: '2026-08-01',
        price: {
          amount: 50000,
          businessType: 'sale',
          currency: 'CNY',
          period: 'one-time',
          basis: 'total',
          displayUnit: 'rmb-total',
          text: '50000 元',
        },
      }),
      makeCard({
        id: 3,
        slug: 'coworking',
        area: 60,
        listingType: 'coworking',
        availableFrom: '2026-07-01',
        price: {
          amount: 2000,
          businessType: 'lease',
          currency: 'CNY',
          period: 'month',
          basis: 'seat',
          displayUnit: 'rmb-seat-month',
          text: '2000 元/工位/月',
        },
      }),
    ]

    const snapshot = buildBuildingSupplySnapshot(cards, { group: 'lease' }, AS_OF)

    expect(snapshot.groups.map((group) => group.key)).toEqual(['lease'])
    expect(snapshot.availableGroups.map((group) => group.key)).toEqual(['lease', 'sale', 'coworking'])
    expect(snapshot.totalEffectiveListings).toBe(3)
    expect(snapshot.resultCount).toBe(1)
    expect(snapshot.availableGroups).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'sale',
        areaRange: { min: 240, max: 240 },
        immediateAvailabilityCount: 0,
      }),
      expect.objectContaining({
        key: 'coworking',
        areaRange: { min: 60, max: 60 },
        immediateAvailabilityCount: 1,
      }),
    ]))
  })

  it('不同价格单位不合并且不共同排序', () => {
    const snapshot = buildBuildingSupplySnapshot(
      [
        makeCard({ id: 1, slug: 'monthly', price: {
          amount: 5000,
          businessType: 'lease',
          currency: 'CNY',
          period: 'month',
          basis: 'total',
          displayUnit: 'rmb-month',
          text: '5000 元/月',
        } }),
        makeCard({ id: 2, slug: 'sqm-day' }),
      ],
      { sort: 'price-asc' },
      AS_OF,
    )

    expect(snapshot.validationErrors).toContain('price_unit_required')
    expect(snapshot.groups[0]?.priceSortDegraded).toBe(true)
    expect(snapshot.groups[0]?.priceRanges).toHaveLength(2)
  })

  /**
   * 终审 C2：「能不能按单价排序」必须**按组**算，不能拿跨组的结果集算。
   *
   * 页面把默认组的 href 写成不带 `group` 参数（canonical 惯例），于是默认组下
   * `input.group === undefined`、`filtered` 是跨全部业务组的卡片；而 `priceKeyOf`
   * 含 `businessType`，「这栋楼同时有租赁与出售」这一个事实就让跨组的
   * `hasMixedPriceKeys` 恒真 → 每个组的价格排序统统退化成 id 序。视图层却按当前组
   * 算「单位是否唯一」，照常渲染排序选项并高亮 `aria-current`，下面还补一句「该组内
   * 房源计价单位不唯一」——该组内是唯一的，不唯一的是那个没按组过滤的全集。
   * 用户按这句话做的任何补救都基于错误诊断。
   */
  it('组内单位唯一时按单价排序真的生效，不因为楼盘另有一个出售组而退化', () => {
    const cheapLease = makeCard({
      id: 3, slug: 'lease-cheap',
      price: { amount: 6.5, businessType: 'lease', currency: 'CNY', period: 'day', basis: 'sqm',
        displayUnit: 'rmb-sqm-day', text: '6.5 元/㎡/天' },
    })
    const pricyLease = makeCard({
      id: 1, slug: 'lease-pricy',
      price: { amount: 9.5, businessType: 'lease', currency: 'CNY', period: 'day', basis: 'sqm',
        displayUnit: 'rmb-sqm-day', text: '9.5 元/㎡/天' },
    })
    // 出售组：单位（rmb-total）与租赁组不可通约。它的存在不该影响租赁组的排序。
    const sale = makeCard({
      id: 2, slug: 'sale', businessType: 'sale',
      price: { amount: 38_000_000, businessType: 'sale', currency: 'CNY', period: 'one-time',
        basis: 'total', displayUnit: 'rmb-total', text: '38000000 元' },
    })

    // 默认组不写 group 参数——这正是触发旧 bug 的那种输入
    const snapshot = buildBuildingSupplySnapshot([pricyLease, sale, cheapLease], { sort: 'price-asc' }, AS_OF)

    const lease = snapshot.groups.find((group) => group.key === 'lease')
    expect(lease?.priceSortDegraded).toBe(false)
    // 真的按价格升序，而不是退化成 id 序（id 序会是 1, 3）
    expect(lease?.listings.map((listing) => listing.id)).toEqual([3, 1])
    // 出售组只有一条，同样不算「单位不唯一」
    expect(snapshot.groups.find((group) => group.key === 'sale')?.priceSortDegraded).toBe(false)
    // 没有任何一组降级 → 快照级汇总信号也不置位
    expect(snapshot.validationErrors).toEqual([])
  })

  it('只有真正单位不唯一的那一组被标记降级，同快照的其它组不受牵连', () => {
    // 租赁组内两种不可通约单位 → 该组降级；联合办公组只有一种单位 → 不降级
    const leaseSqmDay = makeCard({ id: 1, slug: 'lease-sqm-day' })
    const leaseMonthly = makeCard({
      id: 2, slug: 'lease-monthly',
      price: { amount: 5000, businessType: 'lease', currency: 'CNY', period: 'month', basis: 'total',
        displayUnit: 'rmb-month', text: '5000 元/月' },
    })
    const coworking = makeCard({
      id: 3, slug: 'coworking', listingType: 'coworking', seats: 12,
      price: { amount: 2880, businessType: 'lease', currency: 'CNY', period: 'month', basis: 'seat',
        displayUnit: 'rmb-seat-month', text: '2880 元/工位/月' },
    })

    const snapshot = buildBuildingSupplySnapshot(
      [leaseSqmDay, leaseMonthly, coworking],
      { sort: 'price-asc' },
      AS_OF,
    )

    expect(snapshot.groups.find((group) => group.key === 'lease')?.priceSortDegraded).toBe(true)
    expect(snapshot.groups.find((group) => group.key === 'coworking')?.priceSortDegraded).toBe(false)
    // 快照级信号是「任一组降级」的汇总，不是组级判据
    expect(snapshot.validationErrors).toContain('price_unit_required')
  })

  it('非价格排序时任何组都不标记降级（降级只描述价格排序没生效这件事）', () => {
    const snapshot = buildBuildingSupplySnapshot(
      [
        makeCard({ id: 1, slug: 'a' }),
        makeCard({ id: 2, slug: 'b', price: {
          amount: 5000, businessType: 'lease', currency: 'CNY', period: 'month', basis: 'total',
          displayUnit: 'rmb-month', text: '5000 元/月' } }),
      ],
      { sort: 'area-asc' },
      AS_OF,
    )
    expect(snapshot.groups.every((group) => group.priceSortDegraded === false)).toBe(true)
    expect(snapshot.validationErrors).toEqual([])
  })

  /**
   * 价格区间的**单位闸门**：元/月、元/㎡/天、元/工位/月 不可通约，跨单位比 amount
   * 是本项目的硬禁区。守卫落在 `matchesInput` 真正做数值比较的那一行——所以这里
   * 直接调 `buildBuildingSupplySnapshot`（域层入口），而不是断言某个 prop 被传进
   * 了组件：后者只能证明接线，证明不了不变量。
   */
  it('价格区间只作用于 priceUnit 指定的单位，其余单位不参与比价', () => {
    const sqmDay = makeCard({ id: 1, slug: 'sqm-day', price: {
      amount: 8.5, businessType: 'lease', currency: 'CNY', period: 'day', basis: 'sqm',
      displayUnit: 'rmb-sqm-day', text: '8.5 元/㎡/天',
    } })
    // 5000 元/月：数值上远大于 10，但和「10 元以上」这个桶毫无可比性。
    const monthly = makeCard({ id: 2, slug: 'monthly', price: {
      amount: 5000, businessType: 'lease', currency: 'CNY', period: 'month', basis: 'total',
      displayUnit: 'rmb-month', text: '5000 元/月',
    } })
    // 2880 元/工位/月：同上，另一种不可通约单位。
    const perSeat = makeCard({ id: 3, slug: 'per-seat', price: {
      amount: 2880, businessType: 'lease', currency: 'CNY', period: 'month', basis: 'seat',
      displayUnit: 'rmb-seat-month', text: '2880 元/工位/月',
    } })

    const cards = [sqmDay, monthly, perSeat]

    // 「10 元以上」桶（元/㎡/天）：8.5 不在区间内，另外两条根本不参与比较
    const above10 = buildBuildingSupplySnapshot(
      cards, { priceMin: 10, priceUnit: 'rmb-sqm-day' }, AS_OF,
    )
    expect(above10.resultCount).toBe(0)

    // 「8–9 元」桶：只有 元/㎡/天 的那条命中
    const between = buildBuildingSupplySnapshot(
      cards, { priceMin: 8, priceMax: 9, priceUnit: 'rmb-sqm-day' }, AS_OF,
    )
    expect(between.groups[0]?.listings.map((l) => l.id)).toEqual([1])
  })

  it('价格区间缺 priceUnit 时整段不生效，而不是退化成跨单位比价', () => {
    const cards = [
      makeCard({ id: 1, slug: 'sqm-day' }),
      makeCard({ id: 2, slug: 'monthly', price: {
        amount: 5000, businessType: 'lease', currency: 'CNY', period: 'month', basis: 'total',
        displayUnit: 'rmb-month', text: '5000 元/月',
      } }),
    ]
    const snapshot = buildBuildingSupplySnapshot(cards, { priceMin: 10 }, AS_OF)
    expect(snapshot.resultCount).toBe(2)
  })

  it('价格面议（price 为空）落不进任何价格区间', () => {
    const cards = [
      makeCard({ id: 1, slug: 'sqm-day' }),
      makeCard({ id: 2, slug: 'on-request', price: null }),
    ]
    const snapshot = buildBuildingSupplySnapshot(
      cards, { priceMin: 0, priceUnit: 'rmb-sqm-day' }, AS_OF,
    )
    expect(snapshot.groups[0]?.listings.map((l) => l.id)).toEqual([1])
  })

  /**
   * 「可即刻入驻 N」的计数与「可即刻入驻」pill 的过滤必须是同一个判据。
   * 曾经不是：计数走 `Date.parse`、过滤走字符串比较，于是
   * `'2026-07-30T00:00:00.000Z' > '2026-07-30'` 为真——**恰好当天**可入驻的房源
   * 被计入 N 却被 pill 过滤掉。这条钉住的就是那个边界。
   */
  it('恰好当天可入驻的房源同时计入「可即刻」计数与 availableBefore 过滤', () => {
    const asOfDay = shanghaiDate(new Date(AS_OF))
    // 生产库里的 availableFrom 是带时刻的完整 ISO，不是裸日期——这正是分叉点。
    const sameDay = makeCard({ id: 1, slug: 'same-day', availableFrom: `${asOfDay}T00:00:00.000Z` })
    const later = makeCard({ id: 2, slug: 'later', availableFrom: '2099-01-01T00:00:00.000Z' })

    const unfiltered = buildBuildingSupplySnapshot([sameDay, later], {}, AS_OF)
    expect(unfiltered.availableGroups[0]?.immediateAvailabilityCount).toBe(1)

    const filtered = buildBuildingSupplySnapshot([sameDay, later], { availableBefore: asOfDay }, AS_OF)
    expect(filtered.groups[0]?.listings.map((l) => l.id)).toEqual([1])
    // 两个口径必须给出同一个数
    expect(filtered.resultCount).toBe(unfiltered.availableGroups[0]?.immediateAvailabilityCount)
  })

  it('未填可入驻日期视为随时可入驻，既计入计数也不被 availableBefore 过滤掉', () => {
    const card = makeCard({ id: 1, slug: 'no-date', availableFrom: null })
    const snapshot = buildBuildingSupplySnapshot([card], { availableBefore: '2020-01-01' }, AS_OF)
    expect(snapshot.resultCount).toBe(1)
  })

  it('组聚合按未过滤口径给出工位区间，与面积区间并列', () => {
    const cards = [
      makeCard({ id: 1, slug: 'co-1', listingType: 'coworking', seats: 12 }),
      makeCard({ id: 2, slug: 'co-2', listingType: 'coworking', seats: 48 }),
    ]
    const snapshot = buildBuildingSupplySnapshot(cards, { areaMin: 999_999 }, AS_OF)
    // 结果集被面积筛空，但 availableGroups（画像口径）仍给出完整工位区间
    expect(snapshot.resultCount).toBe(0)
    expect(snapshot.availableGroups[0]?.seatRange).toEqual({ min: 12, max: 48 })
  })
})

describe('getRelatedBuildings', () => {
  it('周边楼盘只来自当前有效楼盘且排除自身', async () => {
    const current = {
      id: 1,
      slug: 'bund-soho',
      name: '外滩 SOHO',
      address: '中山东二路',
      operationalStatus: 'active',
      city: {
        id: 100,
        name: '上海市',
        slug: 'shanghai',
        type: 'city',
        status: 'active',
      },
    } as Building
    const nearby = {
      ...current,
      id: 2,
      slug: 'nearby-active-building',
      name: '周边有效楼盘',
    } as Building
    const adapter = {
      async findEffectiveBuildingBySlug() { return current },
      async findEffectiveBuildingsNear() { return [current, nearby] },
    }

    const result = await getRelatedBuildings(
      'bund-soho',
      createSearchContext('shanghai', new Date(AS_OF)),
      { limit: 6 },
      adapter as never,
    )

    expect(result.map((item) => item.slug)).not.toContain('bund-soho')
    expect(result.map((item) => item.slug)).toEqual(['nearby-active-building'])
  })

  it('零、负数或 NaN 限制在进入适配器前返回空数组', async () => {
    let calls = 0
    const adapter = {
      async findEffectiveBuildingBySlug() {
        calls += 1
        return null
      },
      async findEffectiveBuildingsNear() {
        calls += 1
        return []
      },
    }
    const ctx = createSearchContext('shanghai', new Date(AS_OF))

    await expect(getRelatedBuildings('bund-soho', ctx, { limit: 0 }, adapter as never)).resolves.toEqual([])
    await expect(getRelatedBuildings('bund-soho', ctx, { limit: -1 }, adapter as never)).resolves.toEqual([])
    await expect(getRelatedBuildings('bund-soho', ctx, { limit: Number.NaN }, adapter as never)).resolves.toEqual([])
    expect(calls).toBe(0)
  })

  it('按距离排序完整候选集，最接近的楼盘可位于旧 ID 前缀之外', () => {
    const current = { id: 1, latitude: 31, longitude: 121 } as Building
    const idSortedPrefix = Array.from({ length: 30 }, (_, index) => ({
      id: index + 2,
      latitude: 35,
      longitude: 125,
    } as Building))
    const closestOutsideFormerPrefix = {
      id: 99,
      latitude: 31.0001,
      longitude: 121.0001,
    } as Building

    const result = rankRelatedBuildingsByProximity(
      current,
      [...idSortedPrefix, closestOutsideFormerPrefix],
      1,
    )

    expect(result.map((building) => building.id)).toEqual([99])
  })
})

describe('getBuildingDetail', () => {
  it('同一 asOf 下只读取一次楼内有效房源并复用其结果生成供给快照', async () => {
    let effectiveListingsByBuildingCalls = 0
    const seenAsOf: string[] = []
    const adapter = {
      async findEffectiveBuildingBySlug(_slug: string, ctx: { asOf: string }) {
        seenAsOf.push(ctx.asOf)
        return BUILDING_JINGAN_CENTER
      },
      async findEffectiveListingsByBuilding(_id: number, ctx: { asOf: string }) {
        effectiveListingsByBuildingCalls += 1
        seenAsOf.push(ctx.asOf)
        return [LISTING_MONTHLY_STANDARD]
      },
    }

    const result = await getBuildingDetail(
      'jingan-center',
      createSearchContext('shanghai', new Date(AS_OF)),
      adapter as never,
    )

    expect(effectiveListingsByBuildingCalls).toBe(1)
    expect(seenAsOf).toEqual([AS_OF, AS_OF])
    expect(result.supply.totalEffectiveListings).toBe(1)
  })
})
