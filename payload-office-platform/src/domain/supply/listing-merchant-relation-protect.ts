/**
 * 房源-商户有效期关系保护 hook（tasks.md M4.2 / design §3.3 / R2, R4）
 *
 * 守护不变量（读库副作用层，纯判定在 listing-merchant-relation.ts）：
 *   1. listing 必填且存在;由 listing 解析所属 building 与所在城市。
 *   2. 商户解析（快照继承）：create 时若未显式指定商户,则继承所属楼盘
 *      **当前生效**的默认商户关系快照（resolveListingRelationMerchant）;
 *      解析结果一旦写入即为本记录自身快照,后续楼盘默认关系变化不回写。
 *   3. 商户必填且存在。
 *   4. 准入门禁：商户启用 + 资质有效 + 服务城市覆盖房源所在城市。
 *   5. 区间合法：起始必填、止若有必须严格大于起（[start, end) 语义）。
 *   6. 同一房源的有效期不重叠：事务内载入同房源既有关系做等价校验
 *      （PostgreSQL 有 EXCLUDE USING gist 约束兜底；SQLite 只靠本校验）。
 *   7. 版本乐观锁（VersionConflictError）。
 *
 * 更新时重叠检测排除自身（按 originalDoc.id）;更新不再重解析商户快照
 * （商户为创建时冻结的快照值,更新只改有效期等，不回写楼盘默认变化）。
 */

import type { CollectionBeforeChangeHook, PayloadRequest } from 'payload'
import { InvalidOperationError, VersionConflictError } from '@/domain/shared/errors'
import { isWithinValidity, type ValidityPeriod } from '@/domain/shared/validity'
import {
  checkListingMerchantEligibility,
  findListingRelationOverlap,
  isListingRelationPeriodValid,
  resolveListingRelationMerchant,
  toListingRelationPeriod,
} from './listing-merchant-relation'

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

type ListingNode = { id: number | string; building?: unknown }
type BuildingNode = { id: number | string; city?: unknown }
type MerchantNode = {
  id: number | string
  status?: unknown
  qualificationStatus?: unknown
  qualificationExpiresAt?: string | Date | null
  serviceCities?: unknown
}
type RelationNode = {
  id?: number | string
  merchant?: unknown
  effectiveFrom?: unknown
  effectiveTo?: unknown
}

async function loadListing(req: PayloadRequest, id: number | string): Promise<ListingNode | null> {
  try {
    return (await req.payload.findByID({
      collection: 'listings',
      id,
      depth: 0,
      req,
    })) as ListingNode
  } catch {
    return null
  }
}

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

function nodeToPeriod(doc: { effectiveFrom?: unknown; effectiveTo?: unknown }): ValidityPeriod | null {
  const from = doc.effectiveFrom
  if (from === null || from === undefined || from === '') return null
  return toListingRelationPeriod(
    typeof from === 'string' || from instanceof Date ? from : String(from),
    typeof doc.effectiveTo === 'string' || doc.effectiveTo instanceof Date ? doc.effectiveTo : null,
  )
}

/**
 * 解析楼盘“当前生效”的默认商户 id（供 create 快照继承）。
 * 取所属楼盘 building-merchant-relations 中有效期覆盖当前时刻的那一条商户。
 * 无生效关系 → null（房源关系创建需显式给商户,否则抛 MERCHANT_REQUIRED）。
 */
async function resolveBuildingDefaultMerchantId(
  req: PayloadRequest,
  buildingId: number | string,
  now: Date,
): Promise<number | string | null> {
  const result = (await req.payload.find({
    collection: 'building-merchant-relations',
    where: { building: { equals: buildingId } },
    depth: 0,
    limit: 0,
    pagination: false,
    req,
  })) as { docs: RelationNode[] }

  for (const doc of result.docs) {
    const period = nodeToPeriod(doc)
    if (period && isWithinValidity(now, period)) {
      return toId(doc.merchant)
    }
  }
  return null
}

/** 载入同房源既有关系区间（排除指定 id，用于更新时排除自身）。 */
async function loadSiblingPeriods(
  req: PayloadRequest,
  listingId: number | string,
  excludeId: number | string | null,
): Promise<ValidityPeriod[]> {
  const result = (await req.payload.find({
    collection: 'listing-merchant-relations',
    where: { listing: { equals: listingId } },
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
    const period = nodeToPeriod(doc)
    if (period) periods.push(period)
  }
  return periods
}

export const protectListingMerchantRelation: CollectionBeforeChangeHook = async ({
  data,
  originalDoc,
  operation,
  req,
}) => {
  const now = new Date()

  // —— 房源必填且存在,并解析所属楼盘 ——
  const listingId = toId(data?.listing)
  if (listingId === null) {
    throw new InvalidOperationError({
      domain: 'supply',
      code: 'LISTING_REQUIRED',
      message: '必须选择房源',
    })
  }
  const listing = await loadListing(req, listingId)
  if (!listing) {
    throw new InvalidOperationError({
      domain: 'supply',
      code: 'LISTING_NOT_FOUND',
      message: `房源不存在：${String(listingId)}`,
    })
  }
  const buildingId = toId(listing.building)
  if (buildingId === null) {
    throw new InvalidOperationError({
      domain: 'supply',
      code: 'BUILDING_REQUIRED',
      message: '房源未关联楼盘,无法建立供给关系',
    })
  }
  const building = await loadBuilding(req, buildingId)
  if (!building) {
    throw new InvalidOperationError({
      domain: 'supply',
      code: 'BUILDING_NOT_FOUND',
      message: `楼盘不存在：${String(buildingId)}`,
    })
  }

  // —— 商户解析：create 时可继承楼盘当前默认商户快照;update 用既有值 ——
  let merchantId: number | string | null
  if (operation === 'create') {
    const explicitMerchantId = toId(data?.merchant)
    const buildingDefaultMerchantId =
      explicitMerchantId === null
        ? await resolveBuildingDefaultMerchantId(req, buildingId, now)
        : null
    merchantId = resolveListingRelationMerchant({
      explicitMerchantId,
      buildingDefaultMerchantId,
    })
    // 写回快照值:此后本记录商户固定,不随楼盘默认关系变化。
    if (merchantId !== null) {
      data.merchant = merchantId
    }
  } else {
    merchantId = toId(data?.merchant) ?? (originalDoc ? toId(originalDoc.merchant) : null)
  }

  if (merchantId === null) {
    throw new InvalidOperationError({
      domain: 'supply',
      code: 'MERCHANT_REQUIRED',
      message: '必须指定商户,且所属楼盘无当前生效的默认商户可继承',
    })
  }

  // —— 商户存在性 ——
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
    period = toListingRelationPeriod(data?.effectiveFrom, data?.effectiveTo)
  } catch {
    throw new InvalidOperationError({
      domain: 'supply',
      code: 'INVALID_PERIOD',
      message: '有效期起始时刻必填且须为合法时刻',
    })
  }
  if (!isListingRelationPeriodValid(period)) {
    throw new InvalidOperationError({
      domain: 'supply',
      code: 'INVALID_PERIOD',
      message: '有效期结束时刻必须严格晚于起始时刻',
    })
  }

  // —— 准入门禁：启用 + 资质有效 + 服务城市覆盖房源所在城市 ——
  const eligibility = checkListingMerchantEligibility({
    status: merchant.status,
    qualificationStatus: merchant.qualificationStatus,
    qualificationExpiresAt: merchant.qualificationExpiresAt ?? null,
    serviceCityIds: toIds(merchant.serviceCities),
    listingCityId: toId(building.city),
    now,
  })
  if (!eligibility.eligible) {
    throw new InvalidOperationError({
      domain: 'supply',
      code: 'MERCHANT_INELIGIBLE',
      message: '商户不满足与该房源建立有效供给关系的条件',
      details: { reasons: eligibility.reasons },
    })
  }

  // —— 同房源有效期不重叠（SQLite 等价校验；PG 有 EXCLUDE 约束兜底）——
  const excludeId = operation === 'update' && originalDoc ? toId(originalDoc.id) : null
  const siblings = await loadSiblingPeriods(req, listingId, excludeId)
  const overlaps = findListingRelationOverlap(period, siblings)
  if (overlaps.length > 0) {
    throw new InvalidOperationError({
      domain: 'supply',
      code: 'RELATION_OVERLAP',
      message: '该房源在此有效期内已存在其他商户关系，区间不可重叠',
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
        resource: '房源商户关系',
        expectedVersion: currentVersion,
        actualVersion: submitted,
      })
    }
    data.version = currentVersion + 1
  }

  return data
}
