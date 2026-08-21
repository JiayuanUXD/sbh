/**
 * P1 Task 3：服务端 POI 获取辅助
 *
 * 守护不变量：
 *   - POI 查询在服务端用 AMAP_WEB_SERVICE_KEY（不暴露到浏览器）
 *   - 缺坐标/缺 Key/provider 失效/超时 -> 返回空数组，位置面板降级为静态地址
 *   - 失败不阻断页面渲染（Promise.all + 逐类别 catch）
 */

import {
  createAmapLocationProvider,
  getNearbyPois,
} from '@/domain/location-services'
import type { NearbyPoi, PoiCategory } from '@/domain/location-services'
import type { CoordinatesViewModel } from '@/domain/public-catalog'

/** 按类别分组的 POI（传给 LocationPanel） */
export type PoiByCategory = Readonly<Record<PoiCategory, readonly NearbyPoi[]>>

/**
 * 周边点位清单左侧字母锚点（最多 5 项，对应 A-E）。
 *
 * LocationPanel 的清单面板与 AmapMapCanvas 的地图图钉共用同一套字母——
 * 两者呈现的是同一份「当前激活类别/子分类下的 POI 列表」，字母必须一一对应
 * （清单第 N 项 = 地图上标着同一字母的图钉），不允许两处各自维护一份
 * `['A','B','C','D','E']` 后走样成两套编号。
 */
export const POI_LETTERS = ['A', 'B', 'C', 'D', 'E'] as const

const POI_CATEGORIES: readonly PoiCategory[] = [
  'transport',
  'restaurant',
  'bank',
  'hotel',
]

function emptyPoiByCategory(): PoiByCategory {
  return { transport: [], restaurant: [], bank: [], hotel: [] }
}

/**
 * 获取楼盘周边四类 POI（各最多 5 条，由 provider + 缓存控制）。
 *
 * 任何失败（无坐标/无 Key/网络/超时/业务错误）都降级为空数组，
 * 不抛错；调用方直接传给 LocationPanel，静态区始终可见。
 */
export async function fetchNearbyPois(
  buildingId: number,
  coordinates: CoordinatesViewModel | undefined,
): Promise<PoiByCategory> {
  if (!coordinates) return emptyPoiByCategory()
  const key = process.env.AMAP_WEB_SERVICE_KEY ?? ''
  const provider = createAmapLocationProvider({ key, fetchImpl: fetch })
  const center = { latitude: coordinates.latitude, longitude: coordinates.longitude }
  const entries = await Promise.all(
    POI_CATEGORIES.map(async (category) => {
      try {
        const pois = await getNearbyPois({
          buildingId: String(buildingId),
          center,
          category,
          provider,
        })
        return [category, pois] as const
      } catch {
        return [category, [] as readonly NearbyPoi[]] as const
      }
    }),
  )
  return Object.fromEntries(entries) as PoiByCategory
}
