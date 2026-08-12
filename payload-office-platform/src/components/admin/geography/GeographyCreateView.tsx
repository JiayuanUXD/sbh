import type { AdminViewServerProps, Payload, Where } from 'payload'

import type { Location } from '@/payload-types'
import { getGeographyModuleByCreatePath } from './geography-modules'
import { GeographyForbidden, requireGeographyAccess } from './require-geography-access'
import GeographyCreateViewClient from './GeographyCreateViewClient'

/** 拉取 parent 候选（新建时父级下拉），可选按城市收窄（行政区级联）。 */
async function fetchParentOptions(
  payload: Payload,
  type: Location['type'],
  city: string | null,
): Promise<{ id: number; name: string }[]> {
  const where: Where = { type: { equals: type }, status: { equals: 'active' } }
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
 * 地理模块「新建」视图 - 服务端入口（计划 Task 8）
 *
 * 路由 /admin/geography/<route>/new（如 /geography/districts/new）。Payload 3.86 原生
 * 创建页不从 query params 预填，故用轻量自定义视图：按模块 create 配置预填 type 与父级
 * （parentFilter 决定用哪个筛选参数：city→城市筛选，district→行政区筛选），提交走
 * REST /api/locations 过 protectLocation hook（city 由 hook 自动填对）。
 */
export default async function GeographyCreateView(props: AdminViewServerProps) {
  const { initPageResult } = props
  const req = initPageResult.req
  const payload = req.payload

  const geoModule = getGeographyModuleByCreatePath(req.pathname ?? '')

  // 准入：本视图能创建 location（写侧），只判登录不够——必须校验模块菜单权限，
  // 否则任意登录账号敲 URL 即可新建行政区。
  const allowed = await requireGeographyAccess(req, geoModule?.menuCodes ?? ['locations'])
  if (!allowed) return <GeographyForbidden />

  if (!geoModule?.create) {
    return <div>未知的地理模块</div>
  }
  const create = geoModule.create

  const sp = req.searchParams
  // 预填源：parentFilter=city 用城市筛选值，=district 用行政区筛选值；无则留空由用户选。
  const city = sp.get('city') ?? null
  const parent = sp.get('parent') ?? sp.get('city') ?? null
  const prefilledParentId = geoModule.create.parentFilter === 'city' ? city : parent

  const parentOptions = await fetchParentOptions(
    payload,
    geoModule.create.parentTargetType,
    geoModule.create.parentTargetType === 'district' ? city : null,
  )

  return (
    <GeographyCreateViewClient
      moduleType={geoModule.type}
      title={geoModule.title}
      createLabel={geoModule.create.label}
      fixedType={create.type}
      parentFilter={create.parentFilter}
      parentOptions={parentOptions}
      prefilledParentId={prefilledParentId}
      cityId={city}
    />
  )
}