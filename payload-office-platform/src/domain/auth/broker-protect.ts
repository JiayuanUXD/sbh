/**
 * 经纪人保护 hook（tasks.md M2.5 / design §3.3 / R1,R2）
 *
 * 守护不变量：
 *   1. 一名 user 至多绑定一个经纪人档案（user 唯一）
 *   2. service_cities 每一项必须存在、type=city、启用
 *   3. service_business_areas 每一项必须存在、type=business_area、启用
 *   4. team 若填写必须存在且启用
 *   5. 版本乐观锁（VersionConflictError）
 *
 * employment_status 停用守卫由独立的 protectBrokerStop 负责，本 hook 不涉及。
 */

import type { CollectionBeforeChangeHook, PayloadRequest } from 'payload'
import { InvalidOperationError, VersionConflictError } from '@/domain/shared/errors'
import { findByIdSafe } from '@/domain/shared/transaction-safety'

function toId(value: unknown): number | string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number' || typeof value === 'string') return value
  if (typeof value === 'object' && 'id' in value) {
    const id = (value as { id: unknown }).id
    return typeof id === 'number' || typeof id === 'string' ? id : null
  }
  return null
}

function toIds(value: unknown): Array<number | string> {
  if (!Array.isArray(value)) return []
  const out: Array<number | string> = []
  for (const v of value) {
    const id = toId(v)
    if (id !== null) out.push(id)
  }
  return out
}

type LocationNode = { id: number | string; type?: unknown; status?: unknown }

async function loadNode(req: PayloadRequest, id: number | string): Promise<LocationNode | null> {
  // findByIdSafe 而不是 try/catch 吞 NotFound：后者会连带回滚调用方的写入事务
  // （原因与实测见 domain/shared/transaction-safety.ts）
  return findByIdSafe<LocationNode>({
    req,
    collection: 'locations',
    id,
    depth: 0,
    operation: 'broker-protect:location',
  })
}

/** 校验一批 location 节点：存在 + type 命中 + 启用；返回不合法的 id 列表 */
async function findInvalidNodes(
  req: PayloadRequest,
  ids: Array<number | string>,
  expectedType: string,
): Promise<Array<number | string>> {
  const invalid: Array<number | string> = []
  for (const id of ids) {
    const node = await loadNode(req, id)
    if (!node || node.type !== expectedType || (node.status !== undefined && node.status !== 'active')) {
      invalid.push(id)
    }
  }
  return invalid
}

export const protectBroker: CollectionBeforeChangeHook = async ({
  data,
  originalDoc,
  operation,
  req,
}) => {
  // —— user 唯一：一名用户至多一个经纪人档案 ——
  const userId = toId(data?.user)
  if (userId !== null) {
    const dup = await req.payload.count({
      collection: 'brokers',
      where: {
        and: [
          { user: { equals: userId } },
          ...(originalDoc?.id !== undefined ? [{ id: { not_equals: originalDoc.id } }] : []),
        ],
      },
      overrideAccess: true,
      req,
    })
    if (dup.totalDocs > 0) {
      throw new InvalidOperationError({
        domain: 'auth',
        code: 'BROKER_USER_TAKEN',
        message: '该用户已绑定其它经纪人档案',
        details: { userId },
      })
    }
  }

  // —— 服务城市：存在 + type=city + 启用 ——
  const invalidCities = await findInvalidNodes(req, toIds(data?.serviceCities), 'city')
  if (invalidCities.length > 0) {
    throw new InvalidOperationError({
      domain: 'auth',
      code: 'INVALID_BROKER_CITY',
      message: '服务城市含不可用节点（不存在、非城市或已停用）',
      details: { invalidCities },
    })
  }

  // —— 服务商圈：存在 + type=business_area + 启用 ——
  const invalidAreas = await findInvalidNodes(req, toIds(data?.serviceBusinessAreas), 'business_area')
  if (invalidAreas.length > 0) {
    throw new InvalidOperationError({
      domain: 'auth',
      code: 'INVALID_BROKER_BUSINESS_AREA',
      message: '服务商圈含不可用节点（不存在、非商圈或已停用）',
      details: { invalidAreas },
    })
  }

  // —— team 若填写必须存在且启用 ——
  const teamId = toId(data?.team)
  if (teamId !== null) {
    const team = await findByIdSafe<{ id: number | string; status?: unknown }>({
      req,
      collection: 'teams',
      id: teamId,
      depth: 0,
      operation: 'broker-protect:team',
    })
    if (!team || (team.status !== undefined && team.status !== 'active')) {
      throw new InvalidOperationError({
        domain: 'auth',
        code: 'INVALID_BROKER_TEAM',
        message: '所属团队不存在或已停用',
        details: { teamId },
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
        domain: 'auth',
        resource: '经纪人',
        expectedVersion: currentVersion,
        actualVersion: submitted,
      })
    }
    data.version = currentVersion + 1
  }

  return data
}
