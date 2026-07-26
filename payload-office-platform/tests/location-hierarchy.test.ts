import { describe, it, expect } from 'vitest'
import {
  assertValidCoordinates,
  assertValidHierarchy,
  assertValidRegionCode,
  getRequiredParentType,
  isLocationType,
  isValidLatitude,
  isValidLongitude,
  isValidParentType,
  isValidRegionCode,
  requiresParent,
} from '@/domain/geography/location-hierarchy'
import { InvalidOperationError } from '@/domain/shared/errors'

describe('location-hierarchy/类型与父级规则', () => {
  it('isLocationType 只认五类', () => {
    expect(isLocationType('city')).toBe(true)
    expect(isLocationType('metro_station')).toBe(true)
    expect(isLocationType('metro')).toBe(false)
    expect(isLocationType('business-district')).toBe(false)
    expect(isLocationType(123)).toBe(false)
  })

  it('固定层级父级类型映射', () => {
    expect(getRequiredParentType('city')).toBeNull()
    expect(getRequiredParentType('district')).toBe('city')
    expect(getRequiredParentType('business_area')).toBe('district')
    expect(getRequiredParentType('metro_line')).toBe('city')
    expect(getRequiredParentType('metro_station')).toBe('metro_line')
  })

  it('requiresParent 城市不需要,其余需要', () => {
    expect(requiresParent('city')).toBe(false)
    expect(requiresParent('district')).toBe(true)
    expect(requiresParent('metro_station')).toBe(true)
  })

  it('isValidParentType 仅唯一合法父级通过', () => {
    expect(isValidParentType('business_area', 'district')).toBe(true)
    expect(isValidParentType('business_area', 'city')).toBe(false)
    // 商圈 与 地铁站 不能互为父级
    expect(isValidParentType('business_area', 'metro_station')).toBe(false)
    expect(isValidParentType('metro_station', 'business_area')).toBe(false)
    expect(isValidParentType('metro_station', 'metro_line')).toBe(true)
  })
})

describe('location-hierarchy/assertValidHierarchy', () => {
  it('城市有上级 → 抛 ROOT_HAS_PARENT', () => {
    expect(() =>
      assertValidHierarchy({ childType: 'city', hasParent: true, parentType: 'city' }),
    ).toThrowError(InvalidOperationError)
  })

  it('城市无上级 → 通过', () => {
    expect(() =>
      assertValidHierarchy({ childType: 'city', hasParent: false }),
    ).not.toThrow()
  })

  it('行政区缺上级 → 抛 PARENT_REQUIRED', () => {
    try {
      assertValidHierarchy({ childType: 'district', hasParent: false })
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidOperationError)
      expect((e as InvalidOperationError).code).toBe('PARENT_REQUIRED')
    }
  })

  it('商圈挂在城市下（应挂行政区）→ 抛 INVALID_PARENT_TYPE', () => {
    try {
      assertValidHierarchy({
        childType: 'business_area',
        hasParent: true,
        parentType: 'city',
      })
      expect.unreachable()
    } catch (e) {
      expect((e as InvalidOperationError).code).toBe('INVALID_PARENT_TYPE')
    }
  })

  it('地铁站挂线路下 → 通过', () => {
    expect(() =>
      assertValidHierarchy({
        childType: 'metro_station',
        hasParent: true,
        parentType: 'metro_line',
      }),
    ).not.toThrow()
  })
})

describe('location-hierarchy/坐标', () => {
  it('纬度经度范围', () => {
    expect(isValidLatitude(90)).toBe(true)
    expect(isValidLatitude(-90)).toBe(true)
    expect(isValidLatitude(90.0001)).toBe(false)
    expect(isValidLongitude(180)).toBe(true)
    expect(isValidLongitude(-180.5)).toBe(false)
    expect(isValidLatitude(NaN)).toBe(false)
  })

  it('两者皆空 → 合法', () => {
    expect(() => assertValidCoordinates(null, undefined)).not.toThrow()
  })

  it('只填一个 → 抛 COORDINATE_INCOMPLETE', () => {
    try {
      assertValidCoordinates(31.2, null)
      expect.unreachable()
    } catch (e) {
      expect((e as InvalidOperationError).code).toBe('COORDINATE_INCOMPLETE')
    }
  })

  it('超范围 → 抛对应错误码', () => {
    try {
      assertValidCoordinates(200, 121)
      expect.unreachable()
    } catch (e) {
      expect((e as InvalidOperationError).code).toBe('INVALID_LATITUDE')
    }
    try {
      assertValidCoordinates(31, 999)
      expect.unreachable()
    } catch (e) {
      expect((e as InvalidOperationError).code).toBe('INVALID_LONGITUDE')
    }
  })
})

describe('location-hierarchy/区域代码', () => {
  it('格式校验', () => {
    expect(isValidRegionCode('SH')).toBe(true)
    expect(isValidRegionCode('SH-PUDONG_01')).toBe(true)
    expect(isValidRegionCode('sh')).toBe(false) // 小写
    expect(isValidRegionCode('-SH')).toBe(false) // 连字符开头
    expect(isValidRegionCode('S')).toBe(false) // 过短
  })

  it('assertValidRegionCode 非法抛 INVALID_REGION_CODE', () => {
    try {
      assertValidRegionCode('bad code')
      expect.unreachable()
    } catch (e) {
      expect((e as InvalidOperationError).code).toBe('INVALID_REGION_CODE')
    }
  })
})
