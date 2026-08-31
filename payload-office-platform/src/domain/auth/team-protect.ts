/**
 * 团队保护 hook（tasks.md M2.5 / design §3.3 / R1,R2）
 *
 * 守护不变量：
 *   1. city_scope 每一项必须存在、type=city、启用（禁止关联非城市/停用城市）
 *   2. 版本乐观锁（VersionConflictError）
 *
 * 主管（manager）合法性由 users 关系约束；这里不校验主管角色，
 * 「主管必须具备 MGR 角色」属 M5 分配/团队管理时的业务门禁，不在主数据保存时强制。
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
    operation: 'team-protect:location',
  })
}

export const protectTeam: CollectionBeforeChangeHook = async ({
  data,
  originalDoc,
  operation,
  req,
}) => {
  // —— 服务城市范围：存在 + type=city + 启用 ——
  const cityIds = toIds(data?.cityScope)
  if (cityIds.length > 0) {
    const invalidCities: Array<number | string> = []
    for (const cid of cityIds) {
      const node = await loadNode(req, cid)
      if (!node || node.type !== 'city' || (node.status !== undefined && node.status !== 'active')) {
        invalidCities.push(cid)
      }
    }
    if (invalidCities.length > 0) {
      throw new InvalidOperationError({
        domain: 'auth',
        code: 'INVALID_TEAM_CITY',
        message: '团队城市范围含不可用节点（不存在、非城市或已停用）',
        details: { invalidCities },
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
        resource: '团队',
        expectedVersion: currentVersion,
        actualVersion: submitted,
      })
    }
    data.version = currentVersion + 1
  }

  return data
}
