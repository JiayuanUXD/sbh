/**
 * P1 Task 2：POI 内存缓存
 *
 * 守护不变量：
 *   - cache key: `poi:${buildingId}:${category}:${lat5}:${lng5}`
 *     坐标仅保留小数点后 5 位（约 1.1m 精度），微差合并避免缓存击穿
 *   - 成功 TTL 24 小时；provider 抛错不缓存（失败不延长陈旧窗口）
 *   - building.updated 失效：invalidateBuildingPois(buildingId) 清空该 building
 *     全部类别缓存，不影响其他 building
 *   - 缓存为进程内 Map（单实例）；POI 数据低频变化，24h TTL 足够新鲜
 *     未来如需跨实例一致性，可替换为 Redis tag 失效，接口不变
 */

import type { Coordinates, LocationProvider, NearbyPoi, PoiCategory } from './contracts'

/** 成功缓存 TTL（毫秒） */
const TTL_MS = 24 * 60 * 60 * 1000

/** 小数保留位数 */
const COORD_PRECISION = 5

interface CacheEntry {
  readonly pois: readonly NearbyPoi[]
  readonly expiresAt: number
}

/** 进程内缓存（模块单例） */
const store = new Map<string, CacheEntry>()

export interface GetNearbyPoisInput {
  /** 楼盘 ID（用于 building.updated 失效） */
  buildingId: string
  /** 中心坐标（高德 GCJ-02） */
  center: Coordinates
  /** POI 类别 */
  category: PoiCategory
  /** 底层 provider（高德） */
  provider: LocationProvider
  /** 当前时间戳（毫秒），默认 Date.now()；测试注入以控制 TTL */
  now?: number
}

/**
 * 获取周边 POI：命中缓存直接返回，否则调 provider 并缓存（24h）。
 *
 * 失败（provider 抛错）不写入缓存，调用方下次仍会重试。
 */
export async function getNearbyPois(
  input: GetNearbyPoisInput,
): Promise<readonly NearbyPoi[]> {
  const now = input.now ?? Date.now()
  const key = buildCacheKey(input.buildingId, input.category, input.center)
  const hit = store.get(key)
  if (hit !== undefined && hit.expiresAt > now) {
    return hit.pois
  }
  const pois = await input.provider.nearby({
    center: input.center,
    category: input.category,
    limit: 5,
  })
  // 成功才缓存；失败时 provider 已抛错，不会执行到这里
  store.set(key, { pois, expiresAt: now + TTL_MS })
  return pois
}

/**
 * 失效指定楼盘的全部 POI 缓存（building.updated 事件触发）。
 *
 * 清空所有 `poi:${buildingId}:*` key，跨类别。
 */
export function invalidateBuildingPois(buildingId: string): void {
  const prefix = `poi:${buildingId}:`
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) {
      store.delete(key)
    }
  }
}

/** 清空全部 POI 缓存（仅供测试） */
export function clearPoiCache(): void {
  store.clear()
}

/** 构建缓存 key，坐标四舍五入到小数点后 5 位 */
function buildCacheKey(
  buildingId: string,
  category: PoiCategory,
  center: Coordinates,
): string {
  const lat = roundTo(center.latitude, COORD_PRECISION)
  const lng = roundTo(center.longitude, COORD_PRECISION)
  return `poi:${buildingId}:${category}:${lat}:${lng}`
}

function roundTo(value: number, precision: number): number {
  const factor = 10 ** precision
  return Math.round(value * factor) / factor
}
