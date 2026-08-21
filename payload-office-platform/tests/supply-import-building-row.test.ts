import { describe, expect, it } from 'vitest'

import { validateBuildingRow, BUILDING_COLUMNS, type RowContext } from '@/domain/supply-import/building-row'
import type { LocationCandidate } from '@/domain/supply-import/resolve-refs'

const cities: LocationCandidate[] = [
  { id: 1, name: '上海', kind: 'city', parentId: null },
  { id: 9, name: '外地', kind: 'city', parentId: null },
]
const districts: LocationCandidate[] = [
  { id: 10, name: '黄浦区', kind: 'district', parentId: 1 },
  { id: 11, name: '徐汇区', kind: 'district', parentId: 9 },
]
const businessAreas: LocationCandidate[] = [
  { id: 100, name: '人民广场', kind: 'business_area', parentId: 10 },
]

const ctx: RowContext = {
  tables: {
    locations: { city: cities, district: districts, business_area: businessAreas, metro_station: [] },
    aliases: { city: new Map(), district: new Map(), business_area: new Map(), metro_station: new Map() },
  },
  buildings: [],
  allowedCityIds: new Set([1]),
}

const goodRow = {
  楼盘编号: 'B-001',
  楼盘名称: '环球金融中心',
  城市: '上海',
  行政区: '黄浦区',
  商圈: '人民广场',
  地址: '世纪大道 100 号',
  总楼层: '35层',
  总建筑面积: '150000㎡',
}

describe('validateBuildingRow', () => {
  it('模板列头固定且以编号打头', () => {
    expect(BUILDING_COLUMNS[0]).toBe('楼盘编号')
    expect(BUILDING_COLUMNS).toEqual([
      '楼盘编号', '楼盘名称', '城市', '行政区', '商圈', '地址', '总楼层', '总建筑面积',
    ])
  })

  it('完整正确行通过并产出规范化值', () => {
    const r = validateBuildingRow(goodRow, 2, ctx)
    expect(r.ok).toBe(true)
    expect(r.ok && r.value).toMatchObject({
      externalId: 'B-001',
      name: '环球金融中心',
      cityId: 1,
      districtId: 10,
      businessAreaId: 100,
      totalFloors: 35,
      grossFloorArea: 150000,
    })
  })

  it('缺编号即错误行', () => {
    const r = validateBuildingRow({ ...goodRow, 楼盘编号: '  ' }, 2, ctx)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.errors[0]).toMatchObject({
      rowNumber: 2, column: '楼盘编号', code: 'REQUIRED',
    })
  })

  it('缺名称即错误行', () => {
    const r = validateBuildingRow({ ...goodRow, 楼盘名称: '' }, 2, ctx)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.errors.some((e) => e.column === '楼盘名称' && e.code === 'REQUIRED')).toBe(true)
  })

  it('城市解析失败即错误行', () => {
    const r = validateBuildingRow({ ...goodRow, 城市: '不存在市' }, 2, ctx)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.errors.some((e) => e.column === '城市' && e.code === 'LOCATION_NOT_FOUND')).toBe(true)
  })

  it('行政区不属于所填城市即错误行', () => {
    // 徐汇区的 parentId 是外地(9)，goodRow 的城市是上海(1)，父子不匹配
    const r = validateBuildingRow({ ...goodRow, 行政区: '徐汇区' }, 2, ctx)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.errors.some((e) => e.column === '行政区' && e.code === 'LOCATION_PARENT_MISMATCH')).toBe(true)
  })

  it('商圈留空合法', () => {
    const r = validateBuildingRow({ ...goodRow, 商圈: '' }, 2, ctx)
    expect(r.ok).toBe(true)
    expect(r.ok && r.value.businessAreaId).toBeNull()
  })

  it('越权城市判为错误行，而不是静默跳过，且是 errors[0]', () => {
    const r = validateBuildingRow(
      { ...goodRow, 城市: '外地', 行政区: '徐汇区', 商圈: '' },
      2,
      ctx,
    )
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.errors[0].code).toBe('CITY_OUT_OF_SCOPE')
  })

  it('allowedCityIds 为 all 时不做城市校验', () => {
    const r = validateBuildingRow(
      { ...goodRow, 城市: '外地', 行政区: '徐汇区', 商圈: '' },
      2,
      { ...ctx, allowedCityIds: 'all' },
    )
    expect(r.ok).toBe(true)
  })

  it('一行的多个问题一次全报出来，不是报一个就停', () => {
    const r = validateBuildingRow({ ...goodRow, 楼盘编号: '', 总楼层: '待定' }, 2, ctx)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.errors.length).toBeGreaterThanOrEqual(2)
  })
})
