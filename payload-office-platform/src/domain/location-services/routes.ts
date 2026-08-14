/**
 * P2 Task 1：隐私安全的路线摘要契约与高德路线 provider
 *
 * 守护不变量：
 *   - RouteSummary 为响应白名单：只含 mode/时长/距离/换乘/来源，绝不回传原始起点
 *   - 请求高德 direction WebService；请求只在当前交互内存在，不缓存起点
 *   - 2500ms 超时映射 provider_timeout；非 2xx / status≠1 / 非法 JSON 各映射稳定错误码
 *   - 错误信息不含请求 URL（含 Key）与坐标
 *   - transfers 仅 transit 有意义；driving/walking 恒 null
 *   - 外部响应按 unknown 解析后收窄；纯函数可独立单测（注入 fetchImpl）
 */

import {
  LocationServiceError,
  parseCoordinates,
  type Coordinates,
} from './contracts'

export const ROUTE_MODES = ['transit', 'driving', 'walking'] as const
export type RouteMode = (typeof ROUTE_MODES)[number]

export type RouteSummary = Readonly<{
  mode: RouteMode
  durationMinutes: number
  distanceMeters: number
  transfers: number | null
  source: 'amap-location-service'
}>

export interface RouteProvider {
  route(input: Readonly<{
    origin: Coordinates
    destination: Coordinates
    mode: RouteMode
  }>): Promise<RouteSummary>
}

/** 解析路线模式，非白名单返回 null */
export function parseRouteMode(value: unknown): RouteMode | null {
  if (typeof value !== 'string') return null
  return (ROUTE_MODES as readonly string[]).includes(value)
    ? (value as RouteMode)
    : null
}

/** 路线请求（API 入参白名单） */
export type RouteRequest = Readonly<{
  origin: Coordinates
  destination: Coordinates
  mode: RouteMode
  requestId: string
}>

export type ValidateRouteResult =
  | { ok: true; data: RouteRequest }
  | { ok: false; errors: string[] }

/**
 * 校验路线请求体（视为 unknown）。仅接受白名单字段并收窄类型；
 * 起点/终点必须为合法坐标，mode 白名单，requestId 非空字符串（≤128）。
 */
export function validateRouteRequest(body: unknown): ValidateRouteResult {
  const errors: string[] = []
  if (typeof body !== 'object' || body === null) {
    return { ok: false, errors: ['invalid_body'] }
  }
  const record = body as Record<string, unknown>

  const origin = isRecord(record.origin)
    ? parseCoordinates(record.origin as { latitude: unknown; longitude: unknown })
    : null
  if (origin === null) errors.push('invalid_origin')

  const destination = isRecord(record.destination)
    ? parseCoordinates(record.destination as { latitude: unknown; longitude: unknown })
    : null
  if (destination === null) errors.push('invalid_destination')

  const mode = parseRouteMode(record.mode)
  if (mode === null) errors.push('invalid_mode')

  const requestId = record.requestId
  if (typeof requestId !== 'string' || requestId.length === 0 || requestId.length > 128) {
    errors.push('invalid_request_id')
  }

  if (errors.length > 0 || origin === null || destination === null || mode === null) {
    return { ok: false, errors }
  }
  return {
    ok: true,
    data: { origin, destination, mode, requestId: requestId as string },
  }
}

const DEFAULT_TIMEOUT_MS = 2500

type AmapResponse = { ok: boolean; status: number; json: () => Promise<unknown> }

export type AmapRouteFetch = (
  url: string,
  init: { signal: AbortSignal; method: string },
) => Promise<AmapResponse>

export interface CreateAmapRouteProviderOptions {
  key: string
  fetchImpl: AmapRouteFetch
  timeoutMs?: number
}

/** 高德 direction 接口路径（按模式） */
const ENDPOINT_BY_MODE: Readonly<Record<RouteMode, string>> = {
  transit: 'https://restapi.amap.com/v3/direction/transit/integrated',
  driving: 'https://restapi.amap.com/v3/direction/driving',
  walking: 'https://restapi.amap.com/v3/direction/walking',
}

/**
 * 创建高德路线 provider。
 *
 * 生产用法：
 * ```ts
 * createAmapRouteProvider({ key: process.env.AMAP_WEB_SERVICE_KEY, fetchImpl: fetch })
 * ```
 */
export function createAmapRouteProvider(
  options: CreateAmapRouteProviderOptions,
): RouteProvider {
  const { key, fetchImpl, timeoutMs = DEFAULT_TIMEOUT_MS } = options
  return {
    async route({ origin, destination, mode }) {
      if (!key) {
        throw new LocationServiceError('provider_missing_key', '高德 WebService Key 未配置')
      }
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      const url = buildRouteUrl(key, origin, destination, mode)
      let response: AmapResponse
      try {
        response = await fetchImpl(url.toString(), { signal: controller.signal, method: 'GET' })
      } catch (e) {
        if (controller.signal.aborted) {
          throw new LocationServiceError('provider_timeout', '高德路线请求超时')
        }
        // 错误信息不含 url（含 Key）与坐标
        throw new LocationServiceError(
          'provider_http_error',
          `高德路线网络错误: ${describeError(e)}`,
        )
      } finally {
        clearTimeout(timer)
      }
      if (!response.ok) {
        throw new LocationServiceError('provider_http_error', `高德路线 HTTP ${response.status}`)
      }
      let body: unknown
      try {
        body = await response.json()
      } catch (e) {
        throw new LocationServiceError(
          'provider_invalid_response',
          `高德路线响应非合法 JSON: ${describeError(e)}`,
        )
      }
      return parseRouteBody(body, mode)
    },
  }
}

/**
 * transit 模式默认城市（上海 adcode 前缀）。
 *
 * 高德 direction/transit/integrated 要求 city（起点城市）。当前平台仅在上海市上线，
 * 故用上海区号 021 作为默认值。多城市上线时，应从 destination 所在 building.city
 * 推导真实 adcode 并通过 RouteProvider.route 的 input 传入，替换此默认。
 * TODO(P2-followup): 多城市支持 - 把 city 提为 route input 的可选参数。
 */
const TRANSIT_DEFAULT_CITY = '021'

/** 构建高德 direction 请求 URL（不对外暴露，避免 Key 泄露） */
function buildRouteUrl(
  key: string,
  origin: Coordinates,
  destination: Coordinates,
  mode: RouteMode,
): URL {
  const url = new URL(ENDPOINT_BY_MODE[mode])
  url.searchParams.set('origin', `${origin.longitude},${origin.latitude}`)
  url.searchParams.set('destination', `${destination.longitude},${destination.latitude}`)
  if (mode === 'transit') {
    url.searchParams.set('city', TRANSIT_DEFAULT_CITY)
  }
  url.searchParams.set('key', key)
  return url
}

/** 解析高德 direction 响应，映射为白名单 RouteSummary */
function parseRouteBody(body: unknown, mode: RouteMode): RouteSummary {
  if (!isRecord(body)) {
    throw new LocationServiceError('provider_invalid_response', '高德路线响应非对象')
  }
  if (body.status !== '1') {
    throw new LocationServiceError(
      'provider_business_error',
      `高德路线业务错误 status=${String(body.status)}`,
    )
  }
  const route = body.route
  if (!isRecord(route)) {
    throw new LocationServiceError('provider_invalid_response', '高德路线响应缺 route')
  }
  if (mode === 'transit') {
    return parseTransit(route)
  }
  return parsePath(route, mode)
}

/** transit：取 transits[0]，segments 中 bus 段数 -1 为换乘次数 */
function parseTransit(route: Record<string, unknown>): RouteSummary {
  const transits = route.transits
  if (!Array.isArray(transits) || transits.length === 0 || !isRecord(transits[0])) {
    throw new LocationServiceError('provider_invalid_response', '高德路线响应缺 transits')
  }
  const first = transits[0]
  const durationMinutes = secondsToMinutes(first.duration)
  const distanceMeters = toFiniteNumber(first.distance)
  const segments = first.segments
  const busCount = Array.isArray(segments)
    ? segments.filter((s) => isRecord(s) && isRecord(s.bus)).length
    : 0
  const transfers = busCount > 0 ? busCount - 1 : 0
  return Object.freeze({
    mode: 'transit',
    durationMinutes,
    distanceMeters,
    transfers,
    source: 'amap-location-service',
  })
}

/** driving/walking：取 paths[0] */
function parsePath(route: Record<string, unknown>, mode: 'driving' | 'walking'): RouteSummary {
  const paths = route.paths
  if (!Array.isArray(paths) || paths.length === 0 || !isRecord(paths[0])) {
    throw new LocationServiceError('provider_invalid_response', '高德路线响应缺 paths')
  }
  const first = paths[0]
  return Object.freeze({
    mode,
    durationMinutes: secondsToMinutes(first.duration),
    distanceMeters: toFiniteNumber(first.distance),
    transfers: null,
    source: 'amap-location-service',
  })
}

function secondsToMinutes(value: unknown): number {
  return Math.round(toFiniteNumber(value) / 60)
}

function toFiniteNumber(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) {
    throw new LocationServiceError('provider_invalid_response', '高德路线数值字段非法')
  }
  return n
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function describeError(e: unknown): string {
  if (e instanceof Error) return e.name
  return typeof e === 'string' ? e : 'unknown'
}
