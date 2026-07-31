/**
 * P1 Task 2：高德 WebService POI provider
 *
 * 设计依据：docs/superpowers/plans/2026-07-30-detail-pages-p1-enhancements.md Task 2
 *
 * 守护不变量：
 *   - 请求高德 place/around 接口，location=经度,纬度（高德规范：经度在前）
 *   - 2500ms AbortController 超时，映射为 provider_timeout
 *   - 非 2xx / 业务 status 非 1 / 非法 JSON 分别映射稳定错误码
 *   - 不记录完整请求 URL（含 Key）到错误信息或日志
 *   - 外部响应始终按 unknown 解析后收窄；非法 POI（缺字段/坐标超界）静默过滤
 *   - 返回条数受 limit 截断（高德 offset 参数同步限制上游返回量）
 */

import {
  LocationServiceError,
  parseCoordinates,
  type Coordinates,
  type LocationProvider,
  type NearbyPoi,
  type PoiCategory,
} from './contracts'

/** 高德 place/around 按类别映射的关键词（keywords 参数） */
const KEYWORD_BY_CATEGORY: Readonly<Record<PoiCategory, string>> = {
  transport: '地铁站;公交站',
  restaurant: '餐厅',
  bank: '银行',
  hotel: '酒店',
}

/** 超时阈值（毫秒） */
const DEFAULT_TIMEOUT_MS = 2500

/** 高德 place/around 响应的最小结构（仅取需要字段，其余忽略） */
type AmapResponse = {
  ok: boolean
  status: number
  json: () => Promise<unknown>
}

/** fetch 实现签名（生产用全局 fetch，测试注入 mock） */
export type AmapFetch = (
  url: string,
  init: { signal: AbortSignal; method: string },
) => Promise<AmapResponse>

export interface CreateAmapLocationProviderOptions {
  /** 高德 WebService Key（服务端） */
  key: string
  /** fetch 实现（生产用全局 fetch，测试注入） */
  fetchImpl: AmapFetch
  /** 超时毫秒，默认 2500（仅供测试覆盖） */
  timeoutMs?: number
}

/**
 * 创建高德 POI provider。
 *
 * 生产用法：
 * ```ts
 * createAmapLocationProvider({ key: process.env.AMAP_WEB_SERVICE_KEY, fetchImpl: fetch })
 * ```
 */
export function createAmapLocationProvider(
  options: CreateAmapLocationProviderOptions,
): LocationProvider {
  const { key, fetchImpl, timeoutMs = DEFAULT_TIMEOUT_MS } = options
  return {
    async nearby({ center, category, limit }) {
      if (!key) {
        throw new LocationServiceError(
          'provider_missing_key',
          '高德 WebService Key 未配置',
        )
      }
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      const url = buildAmapUrl(key, center, category)
      let response: AmapResponse
      try {
        response = await fetchImpl(url.toString(), {
          signal: controller.signal,
          method: 'GET',
        })
      } catch (e) {
        if (controller.signal.aborted) {
          throw new LocationServiceError(
            'provider_timeout',
            '高德 WebService 请求超时',
          )
        }
        // 错误信息不包含 url（含 Key）
        throw new LocationServiceError(
          'provider_http_error',
          `高德 WebService 网络错误: ${describeError(e)}`,
        )
      } finally {
        clearTimeout(timer)
      }
      if (!response.ok) {
        throw new LocationServiceError(
          'provider_http_error',
          `高德 WebService HTTP ${response.status}`,
        )
      }
      let body: unknown
      try {
        body = await response.json()
      } catch (e) {
        throw new LocationServiceError(
          'provider_invalid_response',
          `高德 WebService 响应非合法 JSON: ${describeError(e)}`,
        )
      }
      return parseAmapBody(body, category, limit)
    },
  }
}

/** 构建高德 place/around 请求 URL（不对外暴露，避免 Key 泄露） */
function buildAmapUrl(
  key: string,
  center: Coordinates,
  category: PoiCategory,
): URL {
  const location = `${center.longitude},${center.latitude}`
  const url = new URL('https://restapi.amap.com/v3/place/around')
  url.searchParams.set('location', location)
  url.searchParams.set('keywords', KEYWORD_BY_CATEGORY[category])
  url.searchParams.set('radius', '1000')
  url.searchParams.set('offset', '5')
  url.searchParams.set('sortrule', 'distance')
  url.searchParams.set('key', key)
  return url
}

/** 解析高德响应体，过滤非法 POI 并截断到 limit */
function parseAmapBody(
  body: unknown,
  category: PoiCategory,
  limit: number,
): NearbyPoi[] {
  if (!isRecord(body)) {
    throw new LocationServiceError(
      'provider_invalid_response',
      '高德 WebService 响应非对象',
    )
  }
  if (body.status !== '1') {
    throw new LocationServiceError(
      'provider_business_error',
      `高德 WebService 业务错误 status=${String(body.status)}`,
    )
  }
  const pois = body.pois
  if (!Array.isArray(pois)) {
    throw new LocationServiceError(
      'provider_invalid_response',
      '高德 WebService 响应 pois 非数组',
    )
  }
  const fetchedAt = new Date().toISOString()
  const result: NearbyPoi[] = []
  for (const poi of pois) {
    if (result.length >= limit) break
    const mapped = mapPoi(poi, category, fetchedAt)
    if (mapped !== null) result.push(mapped)
  }
  return result
}

/** 映射单条高德 POI 为 NearbyPoi；非法数据返回 null 静默过滤 */
function mapPoi(
  poi: unknown,
  category: PoiCategory,
  fetchedAt: string,
): NearbyPoi | null {
  if (!isRecord(poi)) return null
  const { id, name, location, distance, direction } = poi
  if (typeof id !== 'string' || typeof name !== 'string') return null
  if (typeof location !== 'string') return null
  // 高德 location 格式 "经度,纬度"
  const parts = location.split(',')
  if (parts.length !== 2) return null
  const longitude = Number(parts[0])
  const latitude = Number(parts[1])
  const coordinates = parseCoordinates({ latitude, longitude })
  if (coordinates === null) return null
  const distanceMeters = Number(distance)
  if (!Number.isFinite(distanceMeters)) return null
  const directionValue =
    typeof direction === 'string' && direction.length > 0 ? direction : null
  return {
    id,
    category,
    name,
    coordinates,
    distanceMeters,
    direction: directionValue,
    source: 'amap-location-service',
    fetchedAt,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function describeError(e: unknown): string {
  if (e instanceof Error) return e.name
  return typeof e === 'string' ? e : 'unknown'
}
