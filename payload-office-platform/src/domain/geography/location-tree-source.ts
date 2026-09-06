/**
 * 行政链节点数据源（OPT-074）
 *
 * 只捞 city / district / business_area 三型，一次拉全：
 * 2026-09-06 生产实测行政链 378 节点（7 城 + 77 区 + 294 商圈），约 40KB JSON。
 * 地铁链 1302 节点（66 线 + 1236 站）不走这条路——那个体量得按需分层，
 * 是另一套取数逻辑，不在本工作项内。
 *
 * ## 两个刻意不做的过滤
 *
 * - **不过滤 `status`**：级联组件要把已停用的历史值回显出来并标注「已停用」，
 *   过滤掉的话，一条引用了停用商圈的旧记录打开就是空白，运营会以为数据丢了。
 * - **不过滤 `frontendVisible`**：生产行政区 65/74、商圈 279/294 都是 `false`。
 *   它是前台展示开关，不是后台可用性开关——过滤掉等于把绝大多数商圈藏起来。
 *
 * 「不能选停用节点」这条约束由 location-field-guard 在 beforeChange 兜底，
 * 组件只负责把它们置灰。
 */

import type { Payload, PayloadRequest } from 'payload'

import type { FlatLocationNode } from './location-tree'

/** 行政链三型。地铁链（metro_line / metro_station）不在本数据源范围内 */
export const ADMINISTRATIVE_TYPES = ['city', 'district', 'business_area'] as const

/** relationship 值 → id；depth:0 下通常是裸 id，但 depth 变了也不至于取错 */
function relationId(value: unknown): number | string | null {
  if (typeof value === 'number' || typeof value === 'string') return value
  if (typeof value === 'object' && value !== null && 'id' in value) {
    const id = (value as { id: unknown }).id
    return typeof id === 'number' || typeof id === 'string' ? id : null
  }
  return null
}

export async function loadAdministrativeNodes(
  payload: Payload,
  req?: PayloadRequest,
): Promise<FlatLocationNode[]> {
  const { docs } = await payload.find({
    collection: 'locations' as never,
    where: { type: { in: [...ADMINISTRATIVE_TYPES] } },
    depth: 0,
    limit: 0,
    pagination: false,
    sort: 'sortOrder',
    // 与 location-search 同口径：继承当前用户的数据权限
    overrideAccess: false,
    req,
  })

  return (docs as Array<Record<string, unknown>>).map((d) => ({
    id: d.id as number | string,
    name: typeof d.name === 'string' ? d.name : '',
    type: d.type as FlatLocationNode['type'],
    immutableCode: typeof d.immutableCode === 'string' ? d.immutableCode : '',
    parentId: relationId(d.parent),
    status: d.status === 'disabled' ? 'disabled' : 'active',
    sortOrder: typeof d.sortOrder === 'number' ? d.sortOrder : 0,
    frontendVisible: d.frontendVisible === true,
  }))
}
