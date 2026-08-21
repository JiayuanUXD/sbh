import { describe, expect, it } from 'vitest'

import { validateListingRow, LISTING_COLUMNS, type RowContext } from '@/domain/supply-import/listing-row'

const ctx: RowContext = {
  tables: {
    locations: { city: [], district: [], business_area: [], metro_station: [] },
    aliases: { city: new Map(), district: new Map(), business_area: new Map(), metro_station: new Map() },
  },
  buildings: [
    { id: 100, name: '环球金融中心', slug: 'huan-qiu', externalId: 'B-001', cityId: 1 },
    { id: 200, name: '外地大厦', slug: 'wai-di', externalId: 'B-999', cityId: 9 },
  ],
  allowedCityIds: new Set([1]),
}

// listingType / decorationStatus 的值以 Step 1 抄到的真实枚举为准
// （@/domain/review/listing-fields 的 LISTING_TYPE_LABELS / DECORATION_STATUS_LABELS）
const goodRow = {
  房源编号: 'L-001',
  房源标题: '环球金融中心 280㎡ 精装办公室',
  房源类型: '传统办公室',
  楼盘编号或标识: 'B-001',
  面积: '280㎡',
  租金: '4.5元/㎡/天',
  楼层: '12层',
  装修: '精装带家具',
  可租日期: '2026-09-01',
}

describe('validateListingRow', () => {
  it('模板列头固定且以编号打头', () => {
    expect(LISTING_COLUMNS[0]).toBe('房源编号')
    expect(LISTING_COLUMNS).toContain('楼盘编号或标识')
  })

  it('完整正确行通过并产出规范化值', () => {
    const r = validateListingRow(goodRow, 2, ctx)
    expect(r.ok).toBe(true)
    expect(r.ok && r.value).toMatchObject({
      externalId: 'L-001',
      buildingId: 100,
      area: 280,
      rentAmount: 4.5,
      rentUnit: 'rmb-sqm-day',
      floor: 12,
    })
  })

  it('缺编号即错误行——编号是幂等键，不能自动补', () => {
    const r = validateListingRow({ ...goodRow, 房源编号: '  ' }, 2, ctx)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.errors[0]).toMatchObject({
      rowNumber: 2, column: '房源编号', code: 'REQUIRED',
    })
  })

  it('租金缺单位即错误行，不猜默认单位', () => {
    const r = validateListingRow({ ...goodRow, 租金: '4.5' }, 2, ctx)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.errors.some((e) => e.code === 'RENT_UNIT_UNKNOWN')).toBe(true)
  })

  it('楼盘匹配不到即错误行，绝不自动建楼盘', () => {
    const r = validateListingRow({ ...goodRow, 楼盘编号或标识: '不存在大厦' }, 2, ctx)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.errors.some((e) => e.code === 'BUILDING_NOT_FOUND')).toBe(true)
  })

  it('越权城市的楼盘判为错误行，而不是静默跳过', () => {
    const r = validateListingRow({ ...goodRow, 楼盘编号或标识: 'B-999' }, 2, ctx)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.errors[0].code).toBe('CITY_OUT_OF_SCOPE')
  })

  it('allowedCityIds 为 all 时不做城市校验', () => {
    const r = validateListingRow({ ...goodRow, 楼盘编号或标识: 'B-999' }, 2, { ...ctx, allowedCityIds: 'all' })
    expect(r.ok).toBe(true)
  })

  it('一行的多个问题一次全报出来，不是报一个就停', () => {
    const r = validateListingRow({ ...goodRow, 面积: '待定', 租金: '4.5' }, 2, ctx)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.errors.length).toBeGreaterThanOrEqual(2)
  })

  it('房源类型填了不存在的标签即 ENUM_UNKNOWN，message 列出全部合法标签', () => {
    const r = validateListingRow({ ...goodRow, 房源类型: '写字楼' }, 2, ctx)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.errors[0]).toMatchObject({ column: '房源类型', code: 'ENUM_UNKNOWN' })
    const message = r.ok === false ? r.errors[0].message : ''
    expect(message).toContain('传统办公室')
    expect(message).toContain('共享办公')
    expect(message).toContain('整层办公')
    expect(message).toContain('服务式办公室')
  })
})
