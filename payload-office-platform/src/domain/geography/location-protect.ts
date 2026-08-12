/**
 * 地理节点保护 hook（tasks.md M2.1, design.md §3.2）
 *
 * 守护不变量（PRD 03_城市区域）：
 *   1. 固定层级：父级类型必须与自身类型匹配（assertValidHierarchy）
 *   2. 区域代码创建后不可变；类型创建后不可变
 *   3. 移动不可跨城市（新旧父级须归属同一城市）
 *   4. 禁止自引用 / 成环
 *   5. 前台可见（frontendVisible）依赖启用状态：停用节点强制不可见
 *   6. 版本乐观锁:提交版本须与库中一致,写入时自增(VersionConflictError)
 *   7. 坐标范围校验
 *   8. 启停联动（M2.2）：
 *        - 新增下级：直接上级必须启用
 *        - 移动：目标父级必须启用
 *        - 启用节点：所有上级必须启用（站点须线路启用，逐级上溯）
 *
 * 层级/跨城市需解析父级，属副作用，故本文件是 hook（非纯函数）。
 * 纯判断复用 location-hierarchy.ts。
 */

import type { CollectionBeforeChangeHook, PayloadRequest } from 'payload'
import {
  assertValidCoordinates,
  assertValidHierarchy,
  assertValidRegionCode,
  isLocationType,
  type LocationType,
} from '@/domain/geography/location-hierarchy'
import { InvalidOperationError, VersionConflictError } from '@/domain/shared/errors'

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

type LocationNode = {
  id: number | string
  type?: unknown
  parent?: unknown
  status?: unknown
  city?: unknown
}

/** 读取单个节点（类型 / 父级 id / 状态），失败返回 null */
async function loadNode(
  req: PayloadRequest,
  id: number | string,
): Promise<LocationNode | null> {
  try {
    const doc = await req.payload.findByID({
      collection: 'locations',
      id,
      depth: 0,
      req,
    })
    return doc as LocationNode
  } catch {
    return null
  }
}

/**
 * 从某父级起逐级上溯，返回第一个非启用祖先的 id；全部启用返回 null。
 * 用于「启用节点须所有上级启用」校验。防御性最大深度 8。
 */
async function findInactiveAncestor(
  req: PayloadRequest,
  startParentId: number | string,
): Promise<number | string | null> {
  let currentId: number | string | null = startParentId
  for (let depth = 0; depth < 8 && currentId !== null; depth++) {
    const node = await loadNode(req, currentId)
    if (!node) return null
    if (node.status !== undefined && node.status !== 'active') return node.id
    if (node.type === 'city') return null
    currentId = toId(node.parent)
  }
  return null
}

/**
 * 解析某节点归属城市 id（O(1)，依赖反范式 city 字段）：
 *   - city 节点自身即城市
 *   - 其余直接读 city 字段（写侧由 beforeChange 维护，存量由回填迁移补齐）
 * 解析失败返回 null（字段缺失的存量/脏数据，由调用方决定是否放行）。
 */
async function resolveCityId(
  req: PayloadRequest,
  startId: number | string,
): Promise<number | string | null> {
  const node = await loadNode(req, startId)
  if (!node) return null
  if (node.type === 'city') return node.id
  return toId(node.city)
}

export const protectLocation: CollectionBeforeChangeHook = async ({
  data,
  originalDoc,
  operation,
  req,
}) => {
  const nextType = data?.type
  if (!isLocationType(nextType)) {
    throw new InvalidOperationError({
      domain: 'geography',
      code: 'INVALID_LOCATION_TYPE',
      message: `节点类型非法：${String(nextType)}`,
    })
  }
  const childType: LocationType = nextType
  const parentId = toId(data?.parent)
  const hasParent = parentId !== null

  // —— 不可变字段（仅 update）——
  if (operation === 'update' && originalDoc) {
    if (
      typeof originalDoc.immutableCode === 'string' &&
      typeof data?.immutableCode === 'string' &&
      originalDoc.immutableCode !== data.immutableCode
    ) {
      throw new InvalidOperationError({
        domain: 'geography',
        code: 'IMMUTABLE_CODE',
        message: `区域代码创建后不可修改：${originalDoc.immutableCode}`,
      })
    }
    if (originalDoc.type && data?.type && originalDoc.type !== data.type) {
      throw new InvalidOperationError({
        domain: 'geography',
        code: 'IMMUTABLE_TYPE',
        message: `节点类型创建后不可修改：${originalDoc.type} → ${data.type}`,
      })
    }
  }

  // —— 区域代码格式（create 必校；update 因不可变，仅当仍在传值时兜底）——
  if (operation === 'create') {
    assertValidRegionCode(data?.immutableCode)
  }

  // —— 坐标 ——
  assertValidCoordinates(data?.centerLatitude, data?.centerLongitude)

  // —— 固定层级 ——
  let parentType: LocationType | null = null
  let parentStatus: unknown
  if (hasParent) {
    // 禁止自引用
    if (operation === 'update' && originalDoc && String(parentId) === String(originalDoc.id)) {
      throw new InvalidOperationError({
        domain: 'geography',
        code: 'SELF_PARENT',
        message: '节点不能将自身设为上级',
      })
    }
    const parentNode = await loadNode(req, parentId as number | string)
    if (!parentNode) {
      throw new InvalidOperationError({
        domain: 'geography',
        code: 'PARENT_NOT_FOUND',
        message: `上级节点不存在：${String(parentId)}`,
      })
    }
    parentType = isLocationType(parentNode.type) ? parentNode.type : null
    parentStatus = parentNode.status
  }
  assertValidHierarchy({ childType, hasParent, parentType })

  // —— 新增下级：直接上级必须启用（PRD L40）——
  if (operation === 'create' && hasParent && parentStatus !== undefined && parentStatus !== 'active') {
    throw new InvalidOperationError({
      domain: 'geography',
      code: 'PARENT_DISABLED',
      message: '上级节点已停用，请先启用上级再新增下级',
    })
  }

  // —— 移动：目标父级必须启用 + 不可跨城市（update 且 parent 变更时校验）——
  if (operation === 'update' && originalDoc && hasParent) {
    const prevParentId = toId(originalDoc.parent)
    const parentChanged = String(prevParentId ?? '') !== String(parentId ?? '')
    if (parentChanged) {
      // 目标父级停用则禁止移入（PRD L89）
      if (parentStatus !== undefined && parentStatus !== 'active') {
        throw new InvalidOperationError({
          domain: 'geography',
          code: 'TARGET_PARENT_DISABLED',
          message: '目标上级节点已停用，不允许移入',
        })
      }
      if (prevParentId !== null) {
        const [prevCity, nextCity] = await Promise.all([
          resolveCityId(req, prevParentId),
          resolveCityId(req, parentId as number | string),
        ])
        if (prevCity !== null && nextCity !== null && String(prevCity) !== String(nextCity)) {
          throw new InvalidOperationError({
            domain: 'geography',
            code: 'CROSS_CITY_MOVE',
            message: '不允许跨城市移动节点',
            details: { prevCity, nextCity },
          })
        }
      }
    }
  }

  // —— 启用节点：所有上级必须启用（PRD L101，站点须线路启用，逐级上溯）——
  const enabling =
    data?.status === 'active' &&
    (operation === 'create' || (originalDoc && originalDoc.status !== 'active'))
  if (enabling && hasParent) {
    const inactiveAncestor = await findInactiveAncestor(req, parentId as number | string)
    if (inactiveAncestor !== null) {
      throw new InvalidOperationError({
        domain: 'geography',
        code: 'ANCESTOR_DISABLED',
        message: '存在已停用的上级节点，请先启用所有上级',
        details: { inactiveAncestor },
      })
    }
  }

  // —— 前台可见依赖启用：停用节点强制不可见 ——
  const effectiveStatus = data?.status ?? originalDoc?.status ?? 'active'
  if (effectiveStatus !== 'active' && data?.frontendVisible === true) {
    data.frontendVisible = false
  }

  // —— 版本乐观锁 ——
  if (operation === 'create') {
    data.version = 1
  } else if (operation === 'update' && originalDoc) {
    const currentVersion =
      typeof originalDoc.version === 'number' ? originalDoc.version : 1
    const submitted = data?.version
    if (typeof submitted === 'number' && submitted !== currentVersion) {
      throw new VersionConflictError({
        domain: 'geography',
        resource: '区域节点',
        expectedVersion: currentVersion,
        actualVersion: submitted,
      })
    }
    data.version = currentVersion + 1
  }

  // —— 写侧维护所属城市（反范式字段，供 O(1) 城市解析）——
  // 城市节点不自引用，city 留空；其余重解析父级城市并写回。
  if (childType === 'city') {
    data.city = null
  } else {
    const cityId = await resolveCityId(req, parentId as number | string)
    if (cityId === null) {
      throw new InvalidOperationError({
        domain: 'geography',
        code: 'CITY_UNRESOLVED',
        message: '无法解析上级节点的所属城市，禁止落库无归属城市的下级节点',
      })
    }
    data.city = cityId
  }

  return data
}
