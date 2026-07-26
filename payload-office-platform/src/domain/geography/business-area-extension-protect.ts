/**
 * 商圈扩展保护 hook（tasks.md M2.3 / PRD 02-02 §8-§11）
 *
 * 守护不变量：
 *   1. business_area 必须存在、type=business_area、自身及全部祖先启用（PRD §10）
 *   2. business_area 创建后不可改（一个扩展绑定一个商圈；unique 由字段保证）
 *   3. metro_stations 关联仅限：存在、type=metro_station、启用、且与商圈同城（PRD §8/§11）
 *   4. 扩展中心点坐标范围（复用 assertValidCoordinates）
 *   5. 边界多边形闭合/合法/不自交 + 别名规范化（纯函数层）
 *   6. 版本乐观锁（VersionConflictError）
 *
 * 基础字段（名称/代码/状态/排序/可见性）不在本 collection 存储，
 * 故「禁止在扩展页修改基础字段」由数据模型结构天然保证，无需额外校验。
 */

import type { CollectionBeforeChangeHook, PayloadRequest } from 'payload'
import { assertValidCoordinates } from '@/domain/geography/location-hierarchy'
import { InvalidOperationError, VersionConflictError } from '@/domain/shared/errors'
import { assertValidBoundary, normalizeAliases } from './business-area-extension'

/** relationship 值可能是 id 或已 populate 的对象；统一取出 id */
function toId(value: unknown): number | string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number' || typeof value === 'string') return value
  if (typeof value === 'object' && 'id' in value) {
    const id = (value as { id: unknown }).id
    return typeof id === 'number' || typeof id === 'string' ? id : null
  }
  return null
}

/** relationship hasMany 值：id 数组或 populate 对象数组 → id 数组 */
function toIds(value: unknown): Array<number | string> {
  if (!Array.isArray(value)) return []
  const out: Array<number | string> = []
  for (const v of value) {
    const id = toId(v)
    if (id !== null) out.push(id)
  }
  return out
}

type LocationNode = {
  id: number | string
  type?: unknown
  parent?: unknown
  status?: unknown
}

async function loadNode(req: PayloadRequest, id: number | string): Promise<LocationNode | null> {
  try {
    return (await req.payload.findByID({
      collection: 'locations',
      id,
      depth: 0,
      req,
    })) as LocationNode
  } catch {
    return null
  }
}

/** 向上解析归属城市 id（自身或沿 parent 上溯遇 city）；防御性最大深度 8 */
async function resolveCityId(
  req: PayloadRequest,
  startId: number | string,
): Promise<number | string | null> {
  let currentId: number | string | null = startId
  for (let depth = 0; depth < 8 && currentId !== null; depth++) {
    const node = await loadNode(req, currentId)
    if (!node) return null
    if (node.type === 'city') return node.id
    currentId = toId(node.parent)
  }
  return null
}

/** 从节点起逐级上溯，返回首个非启用祖先 id（含自身）；全部启用返回 null。最大深度 8 */
async function findInactiveInChain(
  req: PayloadRequest,
  startId: number | string,
): Promise<number | string | null> {
  let currentId: number | string | null = startId
  for (let depth = 0; depth < 8 && currentId !== null; depth++) {
    const node = await loadNode(req, currentId)
    if (!node) return null
    if (node.status !== undefined && node.status !== 'active') return node.id
    if (node.type === 'city') return null
    currentId = toId(node.parent)
  }
  return null
}

export const protectBusinessAreaExtension: CollectionBeforeChangeHook = async ({
  data,
  originalDoc,
  operation,
  req,
}) => {
  const businessAreaId = toId(data?.businessArea)

  // —— businessArea 必填且创建后不可改 ——
  if (businessAreaId === null) {
    throw new InvalidOperationError({
      domain: 'geography',
      code: 'BUSINESS_AREA_REQUIRED',
      message: '必须选择所属商圈',
    })
  }
  if (operation === 'update' && originalDoc) {
    const prevId = toId(originalDoc.businessArea)
    if (prevId !== null && String(prevId) !== String(businessAreaId)) {
      throw new InvalidOperationError({
        domain: 'geography',
        code: 'BUSINESS_AREA_IMMUTABLE',
        message: '扩展所属商圈创建后不可更改',
      })
    }
  }

  // —— businessArea 类型 + 自身及祖先启用 ——
  const areaNode = await loadNode(req, businessAreaId)
  if (!areaNode) {
    throw new InvalidOperationError({
      domain: 'geography',
      code: 'BUSINESS_AREA_NOT_FOUND',
      message: `商圈节点不存在：${String(businessAreaId)}`,
    })
  }
  if (areaNode.type !== 'business_area') {
    throw new InvalidOperationError({
      domain: 'geography',
      code: 'NOT_BUSINESS_AREA',
      message: `所选节点不是商圈：${String(areaNode.type)}`,
    })
  }
  const inactive = await findInactiveInChain(req, businessAreaId)
  if (inactive !== null) {
    throw new InvalidOperationError({
      domain: 'geography',
      code: 'BUSINESS_AREA_INACTIVE',
      message: '商圈自身或其上级已停用，扩展转为只读，不能编辑',
      details: { inactiveNode: inactive },
    })
  }

  // —— 边界 + 别名 + 扩展中心点 ——
  assertValidBoundary(data?.boundary)
  assertValidCoordinates(data?.extendedCenterLatitude, data?.extendedCenterLongitude)
  data.aliases = normalizeAliases(data?.aliases)

  // —— 站点关联：存在 + type=metro_station + 启用 + 同城 ——
  const stationIds = toIds(data?.metroStations)
  if (stationIds.length > 0) {
    const areaCity = await resolveCityId(req, businessAreaId)
    const invalidStations: Array<number | string> = []
    for (const sid of stationIds) {
      const station = await loadNode(req, sid)
      if (
        !station ||
        station.type !== 'metro_station' ||
        (station.status !== undefined && station.status !== 'active')
      ) {
        invalidStations.push(sid)
        continue
      }
      const stationCity = await resolveCityId(req, sid)
      if (areaCity !== null && stationCity !== null && String(areaCity) !== String(stationCity)) {
        invalidStations.push(sid)
      }
    }
    if (invalidStations.length > 0) {
      throw new InvalidOperationError({
        domain: 'geography',
        code: 'INVALID_STATION_RELATION',
        message: '存在不可关联的站点（不存在、非站点、已停用或跨城市）',
        details: { invalidStations },
      })
    }
  }

  // —— 版本乐观锁 ——
  if (operation === 'create') {
    data.version = 1
  } else if (operation === 'update' && originalDoc) {
    const currentVersion = typeof originalDoc.version === 'number' ? originalDoc.version : 1
    const submitted = data?.version
    if (typeof submitted === 'number' && submitted !== currentVersion) {
      throw new VersionConflictError({
        domain: 'geography',
        resource: '商圈扩展',
        expectedVersion: currentVersion,
        actualVersion: submitted,
      })
    }
    data.version = currentVersion + 1
  }

  return data
}
