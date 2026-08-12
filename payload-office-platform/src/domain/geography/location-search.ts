import type { Payload } from 'payload'

/**
 * 地理节点全局搜索（Task 13）
 *
 * 纯查询纯函数：按 name / immutableCode 模糊匹配，返回后台搜索面板所需的最小字段。
 * 依赖反范式 city 字段（Task 1）与 parent 关系（depth:1 populate）解析城市与上级名称。
 */

export type LocationSearchResult = {
  id: number
  name: string
  immutableCode: string
  type: string
  cityId: number | null
  cityName: string
  parentName: string
}

type RawLocation = {
  id?: unknown
  name?: unknown
  immutableCode?: unknown
  type?: unknown
  city?: unknown
  parent?: unknown
}

/** 取数字 id：number/string/对象 id 均可，取不到返回 null */
function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  if (typeof value === 'object' && 'id' in value) return toNumber((value as { id: unknown }).id)
  return null
}

function nameOf(value: unknown): string {
  if (value && typeof value === 'object' && 'name' in value) {
    return String((value as { name: unknown }).name ?? '')
  }
  return ''
}

/** 把一条 location 文档整形为搜索结果；城市节点 cityId/cityName 取自身（不自引用） */
function shapeResult(doc: RawLocation): LocationSearchResult {
  const isCity = doc.type === 'city'
  const id = toNumber(doc.id)
  const city = isCity ? doc : doc.city
  return {
    id: id ?? 0,
    name: String(doc.name ?? ''),
    immutableCode: String(doc.immutableCode ?? ''),
    type: String(doc.type ?? ''),
    cityId: isCity ? id : toNumber(doc.city),
    cityName: isCity ? String(doc.name ?? '') : nameOf(doc.city),
    parentName: nameOf(doc.parent),
  }
}

/**
 * 按 name / immutableCode 模糊匹配（contains，大小写不敏感）。
 * q 去空格后长度 < 2 直接返回空数组，不打库。
 * overrideAccess:false，随当前用户数据权限（后台维护能力）。
 */
export async function searchLocations(
  payload: Payload,
  q: string,
  limit: number,
  req?: Parameters<Payload['find']>[0]['req'],
): Promise<LocationSearchResult[]> {
  const keyword = (q ?? '').trim()
  if (keyword.length < 2) return []

  const { docs } = await payload.find({
    collection: 'locations' as never,
    where: {
      or: [
        { name: { contains: keyword } },
        { immutableCode: { contains: keyword } },
      ],
    },
    limit,
    depth: 1,
    overrideAccess: false,
    req,
  })

  return (docs ?? []).map((doc) => shapeResult(doc as unknown as RawLocation))
}

/**
 * 搜索结果 → 后台编辑入口（纯函数，供前端组件回避业务跳转逻辑）。
 *   - city：城市详情页（Task 7 只读详情）
 *   - district / business_area / metro_line：对应模块列表，用区域代码 `?q=` 定位（列表按 name/code 过滤）
 *   - metro_station：无独立模块，跳 Payload 原生编辑页 /admin/collections/locations/:id
 */
export function locationSearchTarget(result: Pick<LocationSearchResult, 'id' | 'type' | 'immutableCode'>): string {
  const moduleRoute: Partial<Record<string, string>> = {
    district: '/admin/geography/districts',
    business_area: '/admin/geography/business-areas',
    metro_line: '/admin/geography/metro-lines',
  }
  const route = moduleRoute[result.type]
  if (route) {
    return `${route}?q=${encodeURIComponent(result.immutableCode)}`
  }
  if (result.type === 'city') {
    return `/admin/geography/cities/${result.id}`
  }
  // city 之外的兜底（metro_station 等）：Payload 原生编辑页
  return `/admin/collections/locations/${result.id}`
}