import type { ListViewServerPropsOnly } from 'payload'

import type { Location } from '@/payload-types'
import LocationTreeViewClient, { type TreeNode } from './LocationTreeViewClient'

/**
 * 城市区域树形管理视图 - 服务端入口（tasks.md M2.2 / PRD 03_城市区域）
 *
 * 整页替换 locations 默认列表视图：
 *   - 服务端一次性取全量地理节点（locations.read 为公开读，overrideAccess 取全集）
 *   - 摊平为可序列化节点数组传给 client；client 按固定层级组装树
 *   - 引用数量按节点点击时懒加载调 GET /api/locations/:id/references，避免整页 N×6 次 count
 *
 * 注册：Locations.admin.components.views.list.Component
 *
 * 说明：
 *   - 写侧四类保护（上级停用/跨城市移动/代码重复/被引用节点）由 protectLocation hook 保证，
 *     此视图仅负责浏览与跳转，新增/编辑仍走 Payload 标准编辑页（校验一致）。
 */
export default async function LocationTreeView({ payload }: ListViewServerPropsOnly) {
  const result = await payload.find({
    collection: 'locations',
    depth: 0,
    limit: 2000,
    sort: 'sortOrder',
    overrideAccess: true,
  })

  const nodes: TreeNode[] = (result.docs as Location[]).map((doc) => ({
    id: doc.id,
    name: doc.name ?? '',
    type: doc.type,
    immutableCode: doc.immutableCode ?? '',
    parentId:
      doc.parent == null
        ? null
        : typeof doc.parent === 'object'
          ? doc.parent.id
          : doc.parent,
    status: (doc.status as 'active' | 'disabled') ?? 'active',
    sortOrder: typeof doc.sortOrder === 'number' ? doc.sortOrder : 0,
    frontendVisible: Boolean(doc.frontendVisible),
  }))

  return <LocationTreeViewClient nodes={nodes} />
}
