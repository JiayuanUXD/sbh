import { redirect } from 'next/navigation'

import type { AdminViewServerProps, Payload, Where } from 'payload'

import type { Location } from '@/payload-types'
import { getGeographyModuleByPath } from './geography-modules'
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

  // Payload 3.86 不自动给自定义 admin 视图加认证门槛（isCustomAdminView 把
  // 所有自定义视图当作公共路由，绕过 /admin 的登录重定向）。手动补上：未登录
  // 直接跳登录页，杜绝匿名访问管理数据。计划验收「未登录跳登录」。
  if (!req.user) {
    const adminRoute = payload.config.routes.admin
    const loginRoute = payload.config.admin.routes.login
    const current = req.pathname ?? ''
    const qs = req.searchParams.toString()
    const target = `${adminRoute}${loginRoute}?redirect=${encodeURIComponent(qs ? `${current}?${qs}` : current)}`
    redirect(target)
  }

  const module = getGeographyModuleByPath(req.pathname ?? '')
  if (!module) {
    return <div>未知的地理模块</div>
  }

  const sp = req.searchParams
  const rawPage = sp.get('page')
  const page = rawPage && /^\d+$/.test(rawPage) ? Math.max(1, parseInt(rawPage, 10)) : 1
  const city = sp.get('city') ?? undefined
  const parent = sp.get('parent') ?? undefined
  const status = sp.get('status') ?? undefined
  const q = sp.get('q')?.trim() || undefined

  // 只应用该模块支持的筛选，避免非法参数把结果滤成空
  const and: Where[] = [{ type: { equals: module.type } }]
  if (module.filters.includes('city') && city) and.push({ city: { equals: city } })
  if (module.filters.includes('district') && parent) and.push({ parent: { equals: parent } })
  if (module.filters.includes('status') && status)
    and.push({ status: { equals: status } })
  if (module.filters.includes('keyword') && q) {
    and.push({ or: [{ name: { contains: q } }, { immutableCode: { contains: q } }] })
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
  const counts = ids.length > 0 ? await module.counter(payload, ids) : new Map()

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
    counts: counts.get(d.id) ?? {},
  }))

  // 城市筛选下拉：全部城市；行政区级联下拉（仅商圈模块且选了城市时）
  const cityOptions = module.filters.includes('city')
    ? await fetchLocationOptions(payload, 'city', null)
    : []
  const districtOptions =
    module.filters.includes('district') && city
      ? await fetchLocationOptions(payload, 'district', city)
      : []

  return (
    <GeographyListViewClient
      module={{
        type: module.type,
        title: module.title,
        columns: module.columns,
        filters: module.filters,
        emptyHint: module.emptyHint,
      }}
      rows={rows}
      total={result.totalDocs}
      page={page}
      totalPages={result.totalPages}
      city={city}
      parent={parent}
      status={status}
      q={q}
      cityOptions={cityOptions}
      districtOptions={districtOptions}
    />
  )
}