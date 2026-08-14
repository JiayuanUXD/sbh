/**
 * P1 Task 2：高德 WebService POI provider
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
  type TransportSubCategory,
} from './contracts'

/** 高德 place/around 按类别映射的关键词（keywords 参数）。
 * transport 走子分类双请求（见 TRANSPORT_SUB_QUERIES），此处值不使用。 */
const KEYWORD_BY_CATEGORY: Readonly<Record<PoiCategory, string>> = {
  transport: '',
  restaurant: '餐厅',
  bank: '银行',
  hotel: '酒店',
}

/**
 * 交通子分类查询配置。
 * 高德 type 参数单独不生效，需 keywords+type 组合才能精确返回地铁站/公交站。
 * - subway：keywords=地铁站 + type=150500
 * - bus：keywords=公交站 + type=150700
 */
const TRANSPORT_SUB_QUERIES: ReadonlyArray<{
  subCategory: TransportSubCategory
  keywords: string
  type: string
}> = [
  { subCategory: 'subway', keywords: '地铁站', type: '150500' },
  { subCategory: 'bus', keywords: '公交站', type: '150700' },
]

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

  /** 单次高德 place/around 请求（非 transport 类别）。 */
  async function fetchOnce(
    center: Coordinates,
    category: PoiCategory,
    limit: number,
  ): Promise<readonly NearbyPoi[]> {
    const url = buildAmapUrl(key, center, category)
    const body = await doFetch(url)
    return parseAmapBody(body, category, null, limit)
  }

  /** 交通子请求（keywords+type 组合精确筛选地铁站/公交站）。 */
  async function fetchTransportSub(
    center: Coordinates,
    sub: (typeof TRANSPORT_SUB_QUERIES)[number],
    limit: number,
  ): Promise<readonly NearbyPoi[]> {
    const url = buildAmapTransportUrl(key, center, sub.keywords, sub.type)
    const body = await doFetch(url)
    return parseAmapBody(body, 'transport', sub.subCategory, limit)
  }

  /** fetch + 超时 + 错误映射，返回解析后的 JSON body。 */
  async function doFetch(url: URL): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let response: AmapResponse
    try {
      response = await fetchImpl(url.toString(), {
        signal: controller.signal,
        method: 'GET',
      })
    } catch (e) {
      if (controller.signal.aborted) {
        throw new LocationServiceError('provider_timeout', '高德 WebService 请求超时')
      }
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
    try {
      return await response.json()
    } catch (e) {
      throw new LocationServiceError(
        'provider_invalid_response',
        `高德 WebService 响应非合法 JSON: ${describeError(e)}`,
      )
    }
  }

  return {
    async nearby({ center, category, limit }) {
      if (!key) {
        throw new LocationServiceError(
          'provider_missing_key',
          '高德 WebService Key 未配置',
        )
      }
      // transport 拆地铁/公交两次子请求，各取 limit 条，合并返回
      if (category === 'transport') {
        const [subways, buses] = await Promise.all(
          TRANSPORT_SUB_QUERIES.map((sub) =>
            fetchTransportSub(center, sub, limit).catch(() => [] as NearbyPoi[]),
          ),
        )
        return [...subways, ...buses]
      }
      return fetchOnce(center, category, limit)
    },
  }
}

/** 构建高德 place/around 请求 URL（非 transport 类别，不对外暴露避免 Key 泄露） */
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

/** 构建交通子分类请求 URL（keywords+type 组合精确筛选地铁站/公交站） */
function buildAmapTransportUrl(
  key: string,
  center: Coordinates,
  keywords: string,
  type: string,
): URL {
  const location = `${center.longitude},${center.latitude}`
  const url = new URL('https://restapi.amap.com/v3/place/around')
  url.searchParams.set('location', location)
  url.searchParams.set('keywords', keywords)
  url.searchParams.set('type', type)
  url.searchParams.set('radius', '1000')
  url.searchParams.set('offset', '5')
  url.searchParams.set('sortrule', 'distance')
  url.searchParams.set('key', key)
  return url
}

/** 解析高德响应体，过滤非法 POI 并截断到 limit。
 * subCategory 由调用方传入（transport 子请求决定），非 transport 传 null。 */
function parseAmapBody(
  body: unknown,
  category: PoiCategory,
  subCategory: TransportSubCategory | null,
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
    const mapped = mapPoi(poi, category, subCategory, fetchedAt)
    if (mapped !== null) result.push(mapped)
  }
  return result
}

/** 映射单条高德 POI 为 NearbyPoi；非法数据返回 null 静默过滤。
 * subCategory 由调用方传入（transport 子请求决定），非 transport 传 null。 */
function mapPoi(
  poi: unknown,
  category: PoiCategory,
  subCategory: TransportSubCategory | null,
  fetchedAt: string,
): NearbyPoi | null {
  if (!isRecord(poi)) return null
  const { id, name, location, distance, direction, address } = poi
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
  // 地铁线路名：仅地铁站从 address 字段提取（高德地铁站 address 格式 "2号线;12号线;13号线"）
  const metroLines = subCategory === 'subway' ? extractMetroLines(address) : []
  return {
    id,
    category,
    name,
    coordinates,
    distanceMeters,
    direction: directionValue,
    source: 'amap-location-service',
    fetchedAt,
    subCategory,
    metroLines,
  }
}

/**
 * 从高德地铁站 POI 的 address 字段提取地铁线路名。
 * address 格式为分号分隔的线路名列表，如 "12号线;13号线;2号线"。
 * 仅保留匹配 "X号线" 模式的项，去重。非字符串/无匹配 → 空数组。
 */
function extractMetroLines(address: unknown): readonly string[] {
  if (typeof address !== 'string' || address.length === 0) return []
  const segments = address.split(/[;；]/)
  const lines: string[] = []
  for (const raw of segments) {
    const segment = raw.trim()
    if (segment && /^\d+号线$/.test(segment) && !lines.includes(segment)) {
      lines.push(segment)
    }
  }
  return lines
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function describeError(e: unknown): string {
  if (e instanceof Error) return e.name
  return typeof e === 'string' ? e : 'unknown'
}
