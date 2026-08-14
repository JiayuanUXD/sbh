/**
 * P1 位置服务契约
 *
 * 守护不变量：
 *   - POI 类别固定四类（transport/restaurant/bank/hotel），不可扩展
 *   - 交通子分类固定两类（subway/bus），仅 transport 类别有效
 *   - 坐标范围为有效经纬度（纬度 [-90,90]、经度 [-180,180]），超界/非数字拒绝
 *   - Coordinates / NearbyPoi 为只读；外部响应始终按 unknown 解析后收窄
 *   - LocationServiceError 携带稳定错误码，不泄露上游原始响应
 *   - 不依赖 payload / React，纯函数可独立单测
 */

export const POI_CATEGORIES = ['transport', 'restaurant', 'bank', 'hotel'] as const
export type PoiCategory = (typeof POI_CATEGORIES)[number]

/**
 * 交通 POI 子分类（仅 transport 类别有效）。
 * - subway：地铁站（高德 typecode 1505xx）
 * - bus：公交站（高德 typecode 1507xx）
 */
export const TRANSPORT_SUBCATEGORIES = ['subway', 'bus'] as const
export type TransportSubCategory = (typeof TRANSPORT_SUBCATEGORIES)[number]

export type Coordinates = Readonly<{ latitude: number; longitude: number }>

export type NearbyPoi = Readonly<{
  id: string
  category: PoiCategory
  name: string
  coordinates: Coordinates
  distanceMeters: number
  direction: string | null
  source: 'amap-location-service'
  fetchedAt: string
  /**
   * 交通子分类（仅 category === 'transport' 时有意义）。
   * 其他类别恒为 null；transport 缺 typecode 时也为 null（UI 降级为无子 Tab）。
   */
  subCategory: TransportSubCategory | null
  /**
   * 地铁线路名（仅 subCategory === 'subway' 时可能有值）。
   * 从高德 POI tag 字段提取，如 ["2号线", "12号线"]；无线路信息为空数组。
   */
  metroLines: readonly string[]
}>

export interface LocationProvider {
  nearby(input: Readonly<{
    center: Coordinates
    category: PoiCategory
    limit: 5
  }>): Promise<readonly NearbyPoi[]>
}

/** 位置服务稳定错误码（与 provider 实现对齐） */
export type LocationServiceErrorCode =
  | 'provider_timeout'
  | 'provider_http_error'
  | 'provider_business_error'
  | 'provider_invalid_response'
  | 'provider_missing_key'

export class LocationServiceError extends Error {
  readonly code: LocationServiceErrorCode
  constructor(code: LocationServiceErrorCode, message: string) {
    super(message)
    this.name = 'LocationServiceError'
    this.code = code
  }
}

/** 解析 POI 类别，非白名单或非字符串返回 null */
export function parsePoiCategory(value: unknown): PoiCategory | null {
  if (typeof value !== 'string') return null
  return (POI_CATEGORIES as readonly string[]).includes(value)
    ? (value as PoiCategory)
    : null
}

/** 解析交通子分类，非白名单或非字符串返回 null */
export function parseTransportSubCategory(value: unknown): TransportSubCategory | null {
  if (typeof value !== 'string') return null
  return (TRANSPORT_SUBCATEGORIES as readonly string[]).includes(value)
    ? (value as TransportSubCategory)
    : null
}

/** 解析坐标，超界或非有限数字返回 null；合法坐标冻结为只读 */
export function parseCoordinates(input: Readonly<{
  latitude: unknown
  longitude: unknown
}>): Coordinates | null {
  const { latitude, longitude } = input
  if (
    typeof latitude !== 'number' ||
    typeof longitude !== 'number' ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {
    return null
  }
  if (latitude < -90 || latitude > 90) return null
  if (longitude < -180 || longitude > 180) return null
  return Object.freeze({ latitude, longitude })
}
