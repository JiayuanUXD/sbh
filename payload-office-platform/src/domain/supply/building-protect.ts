/**
 * 楼盘保护 hook（tasks.md M3.1 / design §3.4 / R3）
 *
 * 守护不变量：
 *   1. 四个固定枚举双保险（operationalStatus / buildingType /
 *      verificationStatus / registrationCapability，select 已约束，这里再兜底）
 *   2. city 若填写必须存在、type=city、启用（禁止关联非城市/停用城市）
 *   3. 图集不超过 BUILDING_GALLERY_MAX（20 张）
 *   4. 版本乐观锁（VersionConflictError）
 *
 * 说明：楼盘停用（operationalStatus=disabled）不在此隐式改写关联房源的
 * 审核/发布状态（R3「停用撤销前台有效性但不隐式改写关联房源状态」）。
 * 前台可见性由统一有效供给谓词在查询层组合，不在保存时联动。
 */

import type { CollectionBeforeChangeHook, PayloadRequest } from 'payload'
import { InvalidOperationError, VersionConflictError } from '@/domain/shared/errors'
import {
  BUILDING_GALLERY_MAX,
  isBuildingOperationalStatus,
  isBuildingType,
  isRegistrationCapability,
  isVerificationStatus,
} from './building'

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

type LocationNode = { id: number | string; type?: unknown; status?: unknown }

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

export const protectBuilding: CollectionBeforeChangeHook = async ({
  data,
  originalDoc,
  operation,
  req,
}) => {
  // —— 四个固定枚举双保险 ——
  if (data?.operationalStatus !== undefined && !isBuildingOperationalStatus(data.operationalStatus)) {
    throw new InvalidOperationError({
      domain: 'supply',
      code: 'INVALID_OPERATIONAL_STATUS',
      message: `非法的楼盘启停状态：${String(data.operationalStatus)}`,
    })
  }
  if (data?.buildingType !== undefined && data.buildingType !== null && !isBuildingType(data.buildingType)) {
    throw new InvalidOperationError({
      domain: 'supply',
      code: 'INVALID_BUILDING_TYPE',
      message: `非法的物业类型：${String(data.buildingType)}`,
    })
  }
  if (
    data?.verificationStatus !== undefined &&
    data.verificationStatus !== null &&
    !isVerificationStatus(data.verificationStatus)
  ) {
    throw new InvalidOperationError({
      domain: 'supply',
      code: 'INVALID_VERIFICATION_STATUS',
      message: `非法的认证状态：${String(data.verificationStatus)}`,
    })
  }
  if (
    data?.registrationCapability !== undefined &&
    data.registrationCapability !== null &&
    !isRegistrationCapability(data.registrationCapability)
  ) {
    throw new InvalidOperationError({
      domain: 'supply',
      code: 'INVALID_REGISTRATION_CAPABILITY',
      message: `非法的注册能力：${String(data.registrationCapability)}`,
    })
  }

  // —— city：存在 + type=city + 启用 ——
  const cityId = toId(data?.city)
  if (cityId !== null) {
    const node = await loadNode(req, cityId)
    if (!node || node.type !== 'city' || (node.status !== undefined && node.status !== 'active')) {
      throw new InvalidOperationError({
        domain: 'supply',
        code: 'INVALID_BUILDING_CITY',
        message: '所选城市不可用（不存在、非城市节点或已停用）',
        details: { city: cityId },
      })
    }
  }

  // —— 图集上限 ——
  if (Array.isArray(data?.gallery) && data.gallery.length > BUILDING_GALLERY_MAX) {
    throw new InvalidOperationError({
      domain: 'supply',
      code: 'GALLERY_LIMIT_EXCEEDED',
      message: `图集最多 ${BUILDING_GALLERY_MAX} 张，当前 ${data.gallery.length} 张`,
      details: { max: BUILDING_GALLERY_MAX, actual: data.gallery.length },
    })
  }

  // —— 版本乐观锁 ——
  if (operation === 'create') {
    data.version = 1
  } else if (operation === 'update' && originalDoc) {
    const currentVersion = typeof originalDoc.version === 'number' ? originalDoc.version : 1
    const submitted = data?.version
    if (typeof submitted === 'number' && submitted !== currentVersion) {
      throw new VersionConflictError({
        domain: 'supply',
        resource: '楼盘',
        expectedVersion: currentVersion,
        actualVersion: submitted,
      })
    }
    data.version = currentVersion + 1
  }

  return data
}
