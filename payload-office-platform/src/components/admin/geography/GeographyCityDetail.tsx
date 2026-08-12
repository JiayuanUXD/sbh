import type { AdminViewServerProps, Payload, Where } from 'payload'

import type { Location } from '@/payload-types'
import { GEOGRAPHY_MODULES } from './geography-modules'
import { GeographyForbidden, requireGeographyAccess } from './require-geography-access'
import { countForCities } from '@/domain/geography/location-counts'
import { cityScopeWhere } from '@/domain/geography/location-city'
import type { FlatLocationNode } from '@/domain/geography/location-tree'
import GeographyAdminTemplate from './GeographyAdminTemplate'
import GeographyCityDetailClient from './GeographyCityDetailClient'

/** 从 /admin/geography/cities/:id 解析城市 id（3.86 自定义视图不落 routeParams，自取）。 */
function parseCityId(pathname: string | undefined, searchParams: URLSearchParams): number | null {
  const m = (pathname ?? '').match(/\/geography\/cities\/(\d+)$/)
  const id = m ? m[1] : searchParams.get('id')
  return id && /^\d+$/.test(id) ? Number(id) : null
}

/** 城市详情页只读树的节点视图：城市 + 全部归属节点（含城市自身）。 */
function toFlatLocationNode(d: Location): FlatLocationNode {
  return {
    id: d.id,
    name: d.name,
    type: d.type,
    immutableCode: d.immutableCode,
    // depth:0 时关系字段回退为裸 id（number），depth>0 时为对象；两者都处理。
    parentId: d.parent == null ? null : (typeof d.parent === 'object' ? (d.parent as Location).id : d.parent),
    status: d.status,
    sortOrder: typeof d.sortOrder === 'number' ? d.sortOrder : 0,
    frontendVisible: Boolean(d.frontendVisible),
  }
}

/**
 * 地理·城市详情页（Task 7）—— /admin/geography/cities/:id
 *
 * 服务端：校验登录 → 解析 cityId → 取城市节点 + 完备度计数（Task 5 一次聚合）+
 * `cityScopeWhere(cityId)` 拉全城节点（供只读树），合并后交客户端渲染。
 */
async function renderGeographyCityDetailContent(props: AdminViewServerProps) {
  const { initPageResult } = props
  const req = initPageResult.req
  const payload = req.payload

  // 准入：与城市管理模块同权（未登录跳登录；无 locations 菜单权限 → 403）。
  const allowed = await requireGeographyAccess(
    req,
    GEOGRAPHY_MODULES.city?.menuCodes ?? ['locations'],
  )
  if (!allowed) return <GeographyForbidden />

  const cityId = parseCityId(req.pathname, req.searchParams)
  if (!cityId) {
    return <GeographyCityDetailClient cityId={null} counts={null} nodes={[]} />
  }

  // 用 find（limit 1）而非 findByID：findByID 对不存在的 id 抛 NotFound → 500。
  // 这里一次查询同时过滤「不存在」与「非城市类型」，命中空则走空态。
  const cityMatch = await payload.find({
    collection: 'locations',
    where: {
      id: { equals: cityId },
      type: { equals: 'city' },
    },
    limit: 1,
    depth: 0,
  })
  const city = (cityMatch.docs[0] as Location | undefined) ?? null

  // 非城市或不存在 → 空态
  if (!city) {
    return <GeographyCityDetailClient cityId={null} counts={null} nodes={[]} />
  }

  const counts = (await countForCities(payload, [cityId])).get(cityId) ?? null

  const scope = await payload.find({
    collection: 'locations',
    where: cityScopeWhere(cityId) as Where,
    limit: 0,
    depth: 0,
    sort: 'sortOrder',
  })
  const nodes = (scope.docs as Location[]).map(toFlatLocationNode)

  return <GeographyCityDetailClient cityId={cityId} counts={counts} nodes={nodes} />
}

export default async function GeographyCityDetail(props: AdminViewServerProps) {
  const content = await renderGeographyCityDetailContent(props)

  return <GeographyAdminTemplate {...props}>{content}</GeographyAdminTemplate>
}
