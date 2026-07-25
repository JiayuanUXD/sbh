/**
 * 楼盘-商户有效期关系保护 hook（tasks.md M3.3 / design §3.3 / R2, R3）
 *
 * 守护不变量（读库副作用层，纯判定在 building-merchant-relation.ts）：
 *   1. building / merchant 必填且存在
 *   2. 准入门禁：商户启用 + 资质有效 + 服务城市覆盖楼盘城市
 *      （checkMerchantEligibility，供给谓词 §9/§10 的关系建立门禁）
 *   3. 区间合法：起始必填、止若有必须严格大于起（[start, end) 语义）
 *   4. 同一楼盘的有效期不重叠：事务内载入同楼盘既有关系做等价校验
 *      （PostgreSQL 有 EXCLUDE USING gist 约束兜底；SQLite 只靠本校验）
 *   5. 版本乐观锁（VersionConflictError）
 *
 * 更新时重叠检测排除自身（按 originalDoc.id）。
 */

import type { CollectionBeforeChangeHook, PayloadRequest } from 'payload'
import { InvalidOperationError, VersionConflictError } from '@/domain/shared/errors'
import type { ValidityPeriod } from '@/domain/shared/validity'
import {
  checkMerchantEligibility,
  findRelationOverlap,
  isRelationPeriodValid,
  toRelationPeriod,
} from './building-merchant-relation'

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

type BuildingNode = { id: number | string; city?: unknown }
type MerchantNode = {
  id: number | string
  status?: unknown
  qualificationStatus?: unknown
  qualificationExpiresAt?: string | Date | null
  serviceCities?: unknown
}
type RelationNode = { id?: number | string; effectiveFrom?: unknown; effectiveTo?: unknown }

async function loadBuilding(req: PayloadRequest, id: number | string): Promise<BuildingNode | null> {
  try {
    return (await req.payload.findByID({
      collection: 'buildings',
      id,
      depth: 0,
      req,
    })) as BuildingNode
  } catch {
    return null
  }
}

async function loadMerchant(req: PayloadRequest, id: number | string): Promise<MerchantNode | null> {
  try {
    return (await req.payload.findByID({
      collection: 'merchants',
      id,
      depth: 0,
      req,
    })) as MerchantNode
  } catch {
    return null
  }
}

/** 载入同楼盘既有关系区间（排除指定 id，用于更新时排除自身）。 */
async function loadSiblingPeriods(
  req: PayloadRequest,
  buildingId: number | string,
  excludeId: number | string | null,
): Promise<ValidityPeriod[]> {
  const result = (await req.payload.find({
    collection: 'building-merchant-relations',
    where: { building: { equals: buildingId } },
    depth: 0,
    limit: 0,
    pagination: false,
    req,
  })) as { docs: RelationNode[] }

  const periods: ValidityPeriod[] = []
  for (const doc of result.docs) {
    if (excludeId !== null && doc.id !== undefined && String(doc.id) === String(excludeId)) {
      continue
    }
    const from = doc.effectiveFrom
    if (from === null || from === undefined || from === '') continue
    periods.push(
      toRelationPeriod(
        typeof from === 'string' || from instanceof Date ? from : String(from),
        typeof doc.effectiveTo === 'string' || doc.effectiveTo instanceof Date
          ? doc.effectiveTo
          : null,
      ),
    )
  }
  return periods
}

export const protectBuildingMerchantRelation: CollectionBeforeChangeHook = async ({
  data,
  originalDoc,
  operation,
  req,
}) => {
  // —— 楼盘 / 商户必填 ——
  const buildingId = toId(data?.building)
  if (buildingId === null) {
    throw new InvalidOperationError({
      domain: 'supply',
      code: 'BUILDING_REQUIRED',
      message: '必须选择楼盘',
    })
  }
  const merchantId = toId(data?.merchant)
  if (merchantId === null) {
    throw new InvalidOperationError({
      domain: 'supply',
      code: 'MERCHANT_REQUIRED',
      message: '必须选择商户',
    })
  }

  // —— 存在性 ——
  const building = await loadBuilding(req, buildingId)
  if (!building) {
    throw new InvalidOperationError({
      domain: 'supply',
      code: 'BUILDING_NOT_FOUND',
      message: `楼盘不存在：${String(buildingId)}`,
    })
  }
  const merchant = await loadMerchant(req, merchantId)
  if (!merchant) {
    throw new InvalidOperationError({
      domain: 'supply',
      code: 'MERCHANT_NOT_FOUND',
      message: `商户不存在：${String(merchantId)}`,
    })
  }

  // —— 区间合法性（起始必填、止严格大于起）——
  let period: ValidityPeriod
  try {
    period = toRelationPeriod(data?.effectiveFrom, data?.effectiveTo)
  } catch {
    throw new InvalidOperationError({
      domain: 'supply',
      code: 'INVALID_PERIOD',
      message: '有效期起始时刻必填且须为合法时刻',
    })
  }
  if (!isRelationPeriodValid(period)) {
    throw new InvalidOperationError({
      domain: 'supply',
      code: 'INVALID_PERIOD',
      message: '有效期结束时刻必须严格晚于起始时刻',
    })
  }

  // —— 准入门禁：启用 + 资质有效 + 服务城市覆盖楼盘城市 ——
  const eligibility = checkMerchantEligibility({
    status: merchant.status,
    qualificationStatus: merchant.qualificationStatus,
    qualificationExpiresAt: merchant.qualificationExpiresAt ?? null,
    serviceCityIds: toIds(merchant.serviceCities),
    buildingCityId: toId(building.city),
    now: new Date(),
  })
  if (!eligibility.eligible) {
    throw new InvalidOperationError({
      domain: 'supply',
      code: 'MERCHANT_INELIGIBLE',
      message: '商户不满足与该楼盘建立有效供给关系的条件',
      details: { reasons: eligibility.reasons },
    })
  }

  // —— 同楼盘有效期不重叠（SQLite 等价校验；PG 有 EXCLUDE 约束兜底）——
  const excludeId = operation === 'update' && originalDoc ? toId(originalDoc.id) : null
  const siblings = await loadSiblingPeriods(req, buildingId, excludeId)
  const overlaps = findRelationOverlap(period, siblings)
  if (overlaps.length > 0) {
    throw new InvalidOperationError({
      domain: 'supply',
      code: 'RELATION_OVERLAP',
      message: '该楼盘在此有效期内已存在其他商户关系，区间不可重叠',
      details: { overlapCount: overlaps.length },
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
        resource: '楼盘商户关系',
        expectedVersion: currentVersion,
        actualVersion: submitted,
      })
    }
    data.version = currentVersion + 1
  }

  return data
}
