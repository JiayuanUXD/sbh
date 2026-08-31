/**
 * 商户保护 hook（tasks.md M2.4 / design §3.3 / R2）
 *
 * 守护不变量：
 *   1. type 必须是固定枚举（select 已约束，双保险）
 *   2. contact_phone 若填写必须是合法中国大陆手机号（规范化后存储）
 *   3. service_cities 每一项必须存在、type=city、启用（禁止关联非城市/停用城市）
 *   4. 资质一致性：状态 valid 时到期日必填；到期日若填写必须是合法时刻
 *   5. 版本乐观锁（VersionConflictError）
 *
 * 「资质过期/服务城市不匹配 → 不能建立新供给关系」的门禁在 M3.3
 * 建立 building/listing-merchant 关系时用 isQualificationEffective / coversCity
 * 判定，不在商户保存时拦截（商户可以先录入待审核资质）。
 */

import type { CollectionBeforeChangeHook, PayloadRequest } from 'payload'
import { isValidCnMobile, normalizePhone } from '@/domain/shared/phone'
import { InvalidOperationError, VersionConflictError } from '@/domain/shared/errors'
import { findByIdSafe } from '@/domain/shared/transaction-safety'
import { isMerchantType } from './merchant'

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

/** relationship hasMany 值 → id 数组 */
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
    operation: 'merchant-protect:location',
  })
}

export const protectMerchant: CollectionBeforeChangeHook = async ({
  data,
  originalDoc,
  operation,
  req,
}) => {
  // —— 类型枚举双保险 ——
  if (data?.type !== undefined && !isMerchantType(data.type)) {
    throw new InvalidOperationError({
      domain: 'supply',
      code: 'INVALID_MERCHANT_TYPE',
      message: `非法的商户类型：${String(data.type)}`,
    })
  }

  // —— 联系电话规范化 + 校验 ——
  if (typeof data?.contactPhone === 'string' && data.contactPhone.trim() !== '') {
    const normalized = normalizePhone(data.contactPhone)
    if (!isValidCnMobile(normalized)) {
      throw new InvalidOperationError({
        domain: 'supply',
        code: 'INVALID_CONTACT_PHONE',
        message: '联系电话不是合法的中国大陆手机号',
      })
    }
    data.contactPhone = normalized
  }

  // —— 服务城市：存在 + type=city + 启用 ——
  const cityIds = toIds(data?.serviceCities)
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
        domain: 'supply',
        code: 'INVALID_SERVICE_CITY',
        message: '存在不可作为服务城市的节点（不存在、非城市或已停用）',
        details: { invalidCities },
      })
    }
  }

  // —— 资质一致性 ——
  const expiresRaw = data?.qualificationExpiresAt
  if (expiresRaw !== null && expiresRaw !== undefined && expiresRaw !== '') {
    const t = expiresRaw instanceof Date ? expiresRaw.getTime() : new Date(String(expiresRaw)).getTime()
    if (Number.isNaN(t)) {
      throw new InvalidOperationError({
        domain: 'supply',
        code: 'INVALID_QUALIFICATION_EXPIRY',
        message: '资质到期时间不是合法时刻',
      })
    }
  }
  if (data?.qualificationStatus === 'valid' && (expiresRaw === null || expiresRaw === undefined || expiresRaw === '')) {
    throw new InvalidOperationError({
      domain: 'supply',
      code: 'QUALIFICATION_EXPIRY_REQUIRED',
      message: '资质状态为「已通过」时必须填写到期时间',
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
        resource: '商户',
        expectedVersion: currentVersion,
        actualVersion: submitted,
      })
    }
    data.version = currentVersion + 1
  }

  return data
}
