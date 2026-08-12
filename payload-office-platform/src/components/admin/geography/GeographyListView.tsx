import type { AdminViewServerProps, Payload, Where } from 'payload'

import type { Location } from '@/payload-types'
import { getGeographyModuleByPath } from './geography-modules'
import { GeographyForbidden, requireGeographyAccess } from './require-geography-access'
import {
  fetchBusinessAreaBoundaryStatus,
  fetchBusinessAreaMissingBoundaryIds,
} from '@/domain/geography/location-counts'
import GeographyListViewClient, { type GeographyRow } from './GeographyListViewClient'

const PAGE_SIZE = 20

/** relationship 值可能是 id 或已 populate 的对象；只取对象里的 name。 */
function popName(value: unknown): string | null {
  if (value && typeof value === 'object' && 'name' in value) {
    const n = (value as { name?: unknown }).name
    return typeof n === 'string' ? n : null
  }
  return null
}

/** 拉取某类型 option（供城市 / 行政区筛选下拉），可选按城市收窄。 */
async function fetchLocationOptions(
  payload: Payload,
  type: Location['type'],
  city: string | null,
): Promise<{ id: number; name: string }[]> {
  const where: Where = { type: { equals: type } }
  if (city) where.city = { equals: city }
  const res = await payload.find({
    collection: 'locations',
    where,
    limit: 200,
    depth: 0,
    sort: 'sortOrder',
  })
  return (res.docs as Location[]).map((d) => ({ id: d.id, name: d.name }))
}

/**
 * 地理四模块共享列表 - 服务端入口（计划 Task 6）
 *
 * 按 `initPageResult.req.pathname` 解析当前模块（cities / districts / business-areas
 * / metro-lines），从 URL search params 读筛选（city / parent / status / q / page），
 * 一次 `payload.find` 取本页，再调 Task 5 聚合计数服务（本页 ids 一次聚合）合并进行。
 */
export default async function GeographyListView(props: AdminViewServerProps) {
  const { initPageResult } = props
  const req = initPageResult.req
  const payload = req.payload

  const geoModule = getGeographyModuleByPath(req.pathname ?? '')

  // 准入：Payload 3.86 自定义视图既不做登录重定向、也不经导航的 menuCode 过滤，
  // 必须在此显式判定（未登录→跳登录；已登录但无该模块菜单权限→403）。
  const allowed = await requireGeographyAccess(req, geoModule?.menuCodes ?? ['locations'])
  if (!allowed) return <GeographyForbidden />

  if (!geoModule) {
    return <div>未知的地理模块</div>
  }

  const sp = req.searchParams
  const rawPage = sp.get('page')
  const page = rawPage && /^\d+$/.test(rawPage) ? Math.max(1, parseInt(rawPage, 10)) : 1
  const city = sp.get('city') ?? undefined
  const parent = sp.get('parent') ?? undefined
  const status = sp.get('status') ?? undefined
  const q = sp.get('q')?.trim() || undefined

  // 快捷 chip：只接受模块配置里声明过的 key，多选以逗号分隔（chip=a,b）。
  // 非法 / 未声明 key 一律丢弃，避免把结果滤成空。
  const validChips = geoModule.chips ?? []
  const chipSet = new Set(
    (sp.get('chip')?.split(',').map((s) => s.trim()).filter(Boolean) ?? []).filter((k) =>
      validChips.some((c) => c.key === k),
    ),
  )

  // 只应用该模块支持的筛选，避免非法参数把结果滤成空
  const and: Where[] = [{ type: { equals: geoModule.type } }]
  if (geoModule.filters.includes('city') && city) and.push({ city: { equals: city } })
  if (geoModule.filters.includes('district') && parent) and.push({ parent: { equals: parent } })
  if (geoModule.filters.includes('status') && status)
    and.push({ status: { equals: status } })
  if (geoModule.filters.includes('keyword') && q) {
    and.push({ or: [{ name: { contains: q } }, { immutableCode: { contains: q } }] })
  }
  // 快捷 chip：缺封面是 coverImage 字段直接判空；缺边界是「无扩展或 boundary 空」，
  // 用 SQL 预取缺边界商圈 id 集合再并入 where（分页前过滤，口径与 Task 5 一致）。
  if (chipSet.has('missingCover')) and.push({ coverImage: { exists: false } })
  if (chipSet.has('missingBoundary')) {
    const missingIds = await fetchBusinessAreaMissingBoundaryIds(payload)
    and.push({ id: { in: missingIds } })
  }

  const result = await payload.find({
    collection: 'locations',
    where: { and },
    limit: PAGE_SIZE,
    page,
    sort: 'sortOrder',
    depth: 1,
  })

  const docs = result.docs as Array<
    Location & { parent?: Location | number | null; city?: Location | number | null }
  >
  const ids = docs.map((d) => d.id)
  const counts = ids.length > 0 ? await geoModule.counter(payload, ids) : new Map()
  // 仅商圈模块有边界列（flag source=hasBoundary）时才查扩展表；其余模块直接空 Map 全 false
  const needsBoundary = geoModule.columns.some((c) => c.kind === 'flag' && c.source === 'hasBoundary')
  const boundaryStatus =
    needsBoundary && ids.length > 0 ? await fetchBusinessAreaBoundaryStatus(payload, ids) : new Map<number, boolean>()

  const rows: GeographyRow[] = docs.map((d) => ({
    id: d.id,
    name: d.name,
    immutableCode: d.immutableCode,
    status: d.status,
    frontendVisible: Boolean(d.frontendVisible),
    sortOrder: typeof d.sortOrder === 'number' ? d.sortOrder : 0,
    centerLatitude: d.centerLatitude ?? null,
    centerLongitude: d.centerLongitude ?? null,
    version: typeof d.version === 'number' ? d.version : 1,
    parentName: popName(d.parent),
    cityName: popName(d.city),
    hasBoundary: boundaryStatus.get(d.id) ?? false,
    hasCover: d.coverImage != null,
    counts: counts.get(d.id) ?? {},
  }))

  // 城市筛选下拉：全部城市；行政区级联下拉（仅商圈模块且选了城市时）
  const cityOptions = geoModule.filters.includes('city')
    ? await fetchLocationOptions(payload, 'city', null)
    : []
  const districtOptions =
    geoModule.filters.includes('district') && city
      ? await fetchLocationOptions(payload, 'district', city)
      : []

  return (
    <GeographyListViewClient
      module={{
        type: geoModule.type,
        route: geoModule.route,
        title: geoModule.title,
        columns: geoModule.columns,
        filters: geoModule.filters,
        chips: geoModule.chips ?? [],
        emptyHint: geoModule.emptyHint,
        create: geoModule.create ? { parentFilter: geoModule.create.parentFilter } : undefined,
      }}
      rows={rows}
      total={result.totalDocs}
      page={page}
      totalPages={result.totalPages}
      city={city}
      parent={parent}
      status={status}
      q={q}
      chips={[...chipSet]}
      cityOptions={cityOptions}
      districtOptions={districtOptions}
    />
  )
}