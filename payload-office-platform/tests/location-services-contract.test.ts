/**
 * P1 位置服务契约测试
 *
 * 守护不变量：
 *   - POI 类别固定四类（transport/restaurant/bank/hotel），非白名单拒绝
 *   - 坐标范围为有效经纬度（纬度 [-90,90]、经度 [-180,180]），超界/非数字拒绝
 *   - LocationServiceError 携带稳定错误码且为 Error 子类
 */
import { describe, it, expect } from 'vitest'

import {
  POI_CATEGORIES,
  TRANSPORT_SUBCATEGORIES,
  parsePoiCategory,
  parseTransportSubCategory,
  parseCoordinates,
  LocationServiceError,
} from '@/domain/location-services/contracts'

describe('location-services 契约', () => {
  it('POI 类别只允许四类', () => {
    for (const c of POI_CATEGORIES) {
      expect(parsePoiCategory(c)).toBe(c)
    }
    expect(parsePoiCategory('hospital')).toBeNull()
    expect(parsePoiCategory('')).toBeNull()
  })

  it('交通子分类只允许 subway/bus', () => {
    for (const c of TRANSPORT_SUBCATEGORIES) {
      expect(parseTransportSubCategory(c)).toBe(c)
    }
    expect(parseTransportSubCategory('taxi')).toBeNull()
    expect(parseTransportSubCategory('')).toBeNull()
    expect(parseTransportSubCategory(123)).toBeNull()
  })

  it('坐标超界被拒绝', () => {
    expect(parseCoordinates({ latitude: 91, longitude: 121 })).toBeNull()
    expect(parseCoordinates({ latitude: -91, longitude: 0 })).toBeNull()
    expect(parseCoordinates({ latitude: 0, longitude: 181 })).toBeNull()
    expect(parseCoordinates({ latitude: 0, longitude: -181 })).toBeNull()
  })

  it('合法坐标被接受', () => {
    expect(parseCoordinates({ latitude: 31.23, longitude: 121.48 })).toEqual({
      latitude: 31.23,
      longitude: 121.48,
    })
  })

  it('非数字坐标被拒绝', () => {
    expect(parseCoordinates({ latitude: NaN, longitude: 121 })).toBeNull()
    expect(
      parseCoordinates({ latitude: '31', longitude: 121 } as unknown as {
        latitude: number
        longitude: number
      }),
    ).toBeNull()
  })

  it('LocationServiceError 携带稳定错误码且为 Error 子类', () => {
    const err = new LocationServiceError('provider_timeout', '上游超时')
    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe('provider_timeout')
    expect(err.message).toBe('上游超时')
  })
})
