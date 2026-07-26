/**
 * 楼盘查重 / 合并服务（tasks.md M3.2 / design §3.4 / R3, R8）
 *
 * 依赖 payload 读写（副作用），故为函数而非纯函数；纯判定在 building-dedup.ts。
 *
 * 职责：
 *   1. findBuildingDuplicates：同城候选载入 + 纯函数查重 + 候选详情快照（供 UI 差异说明）
 *   2. mergeBuildings：保留目标不可变 ID，把源的 building-merchant-relations / listings
 *      外键迁移到目标，再软删除源（deletedAt，非物理删除，R8）
 *
 * 合并的原子性：调用方（endpoint）在同一请求事务内传入 req，任一步失败整体回滚。
 * 迁移前先做「目标既有关系 vs 源关系」区间重叠预检：命中即中止且不发生任何写入，
 * 与 PostgreSQL EXCLUDE 约束语义一致（同一楼盘有效期不可重叠）。
 */

import type { BasePayload, PayloadRequest, Where } from 'payload'
import { detectDuplicates, type DuplicateReason } from './building-dedup'
import {
  findRelationOverlap,
  toRelationPeriod,
} from './building-merchant-relation'
import type { ValidityPeriod } from '@/domain/shared/validity'
import type { Building, BuildingMerchantRelation, Listing } from '@/payload-types'

/** relationship 值 → id（复用 protect hook 的口径）。 */
function toId(value: unknown): number | string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number' || typeof value === 'string') return value
  if (typeof value === 'object' && 'id' in value) {
    const id = (value as { id: unknown }).id
    return typeof id === 'number' || typeof id === 'string' ? id : null
  }
  return null
}

/**
 * relationship 外键写回需要数值 id（生成类型里 building/relation id 均为 number）。
 * 数字字符串归一化为 number；已是 number 原样返回。
 */
function toNumericId(value: number | string): number {
  if (typeof value === 'number') return value
  const n = Number(value)
  if (!Number.isFinite(n)) {
    throw new Error(`无法将 id 归一化为数值：${value}`)
  }
  return n
}

// ────────────────────────────────────────────────────────────
// 查重
// ────────────────────────────────────────────────────────────

export interface FindDuplicatesInput {
  name: unknown
  /** 楼盘所在城市 id；为空则不查重（城市是同城前提） */
  cityId: number | string | null | undefined
  latitude: unknown
  longitude: unknown
  /** 编辑既有楼盘时排除自身 */
  excludeId?: number | string
}

/** 候选详情：命中原因 + 关键字段快照，供前端展示差异说明。 */
export interface DuplicateCandidateDetail {
  id: number | string
  name: string
  slug: string | null
  district: number | string | null
  address: string | null
  operationalStatus: string | null
  latitude: number | null
  longitude: number | null
  reasons: DuplicateReason[]
  /** 与待保存楼盘的距离（米）；无坐标为 null */
  distanceMeters: number | null
}

export interface FindDuplicatesReport {
  hasDuplicate: boolean
  total: number
  candidates: DuplicateCandidateDetail[]
}

/** 同城候选查询上限：兜底避免超大城市全表扫描；MVP 足够。 */
const CANDIDATE_QUERY_LIMIT = 200

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}
function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * 在同城、未逻辑删除、排除自身的楼盘中筛出高相似候选。
 * 城市为空直接返回空报告（同城是查重前提，不跨城比对）。
 */
export async function findBuildingDuplicates(
  payload: BasePayload,
  input: FindDuplicatesInput,
  req?: PayloadRequest,
): Promise<FindDuplicatesReport> {
  const cityId = toId(input.cityId)
  if (cityId === null) {
    return { hasDuplicate: false, total: 0, candidates: [] }
  }

  const where: Where = { city: { equals: cityId } }
  if (input.excludeId !== undefined) {
    where.id = { not_equals: input.excludeId }
  }

  const result = await payload.find({
    collection: 'buildings',
    where,
    depth: 0,
    limit: CANDIDATE_QUERY_LIMIT,
    pagination: false,
    overrideAccess: true,
    req,
  })

  const matches = detectDuplicates(
    { name: input.name, latitude: input.latitude, longitude: input.longitude },
    result.docs.map((d) => ({
      id: d.id,
      name: d.name,
      latitude: d.latitude,
      longitude: d.longitude,
    })),
  )

  const byId = new Map<string, Building>(result.docs.map((d) => [String(d.id), d]))
  const candidates: DuplicateCandidateDetail[] = []
  for (const m of matches) {
    const doc = byId.get(String(m.id))
    if (!doc) continue
    candidates.push({
      id: m.id,
      name: str(doc.name) ?? '',
      slug: str(doc.slug),
      district: toId(doc.district),
      address: str(doc.address),
      operationalStatus: str(doc.operationalStatus),
      latitude: num(doc.latitude),
      longitude: num(doc.longitude),
      reasons: m.reasons,
      distanceMeters: m.distanceMeters,
    })
  }

  return { hasDuplicate: candidates.length > 0, total: candidates.length, candidates }
}

// ────────────────────────────────────────────────────────────
// 合并
// ────────────────────────────────────────────────────────────

export interface MergeBuildingsInput {
  /** 被合并（迁出关联后软删除）的源楼盘 */
  sourceId: number | string
  /** 保留不可变 ID、接收全部关联的目标楼盘 */
  targetId: number | string
}

export interface MergeBuildingsReport {
  sourceId: number | string
  targetId: number | string
  migratedRelations: number
  migratedListings: number
}

export type MergeBuildingsResult =
  | { ok: true; report: MergeBuildingsReport }
  | { ok: false; code: MergeErrorCode; error: string }

export type MergeErrorCode = 'INVALID_MERGE' | 'NOT_FOUND' | 'RELATION_OVERLAP'

/** 关系文档 → 有效期区间（起始缺失视为无效，跳过）。 */
function relationPeriod(doc: BuildingMerchantRelation): ValidityPeriod | null {
  const from = doc.effectiveFrom
  if (from === null || from === undefined || from === '') return null
  return toRelationPeriod(from, doc.effectiveTo ?? null)
}

async function loadBuilding(
  payload: BasePayload,
  id: number | string,
  req?: PayloadRequest,
): Promise<Building | null> {
  try {
    return await payload.findByID({
      collection: 'buildings',
      id,
      depth: 0,
      overrideAccess: true,
      req,
    })
  } catch {
    return null
  }
}

async function findRelationsByBuilding(
  payload: BasePayload,
  buildingId: number | string,
  req?: PayloadRequest,
): Promise<BuildingMerchantRelation[]> {
  const res = await payload.find({
    collection: 'building-merchant-relations',
    where: { building: { equals: buildingId } },
    depth: 0,
    limit: 0,
    pagination: false,
    overrideAccess: true,
    req,
  })
  return res.docs
}

async function findListingsByBuilding(
  payload: BasePayload,
  buildingId: number | string,
  req?: PayloadRequest,
): Promise<Listing[]> {
  const res = await payload.find({
    collection: 'listings',
    where: { building: { equals: buildingId } },
    depth: 0,
    limit: 0,
    pagination: false,
    overrideAccess: true,
    req,
  })
  return res.docs
}

/**
 * 合并两个楼盘：迁移源的关联到目标，软删除源。保留目标不可变 ID（R8）。
 *
 * 步骤：
 *   1. 校验 source ≠ target，且两者都存在
 *   2. 载入源的供给关系 / 房源
 *   3. 预检：源关系区间迁到目标后不得与目标既有关系重叠（否则整体中止，零写入）
 *   4. 迁移供给关系（携带完整字段满足 protect hook 的 eligibility/overlap/version 校验）
 *   5. 迁移房源 building 外键
 *   6. 软删除源楼盘（deletedAt，非物理删除）
 *
 * 原子性由调用方在同一请求事务内传入 req 保证。
 */
export async function mergeBuildings(
  payload: BasePayload,
  input: MergeBuildingsInput,
  req?: PayloadRequest,
): Promise<MergeBuildingsResult> {
  const { sourceId, targetId } = input

  if (String(sourceId) === String(targetId)) {
    return { ok: false, code: 'INVALID_MERGE', error: '源楼盘与目标楼盘不能相同' }
  }

  const source = await loadBuilding(payload, sourceId, req)
  if (!source) {
    return { ok: false, code: 'NOT_FOUND', error: `源楼盘不存在：${String(sourceId)}` }
  }
  const target = await loadBuilding(payload, targetId, req)
  if (!target) {
    return { ok: false, code: 'NOT_FOUND', error: `目标楼盘不存在：${String(targetId)}` }
  }

  const sourceRelations = await findRelationsByBuilding(payload, sourceId, req)
  const targetRelations = await findRelationsByBuilding(payload, targetId, req)
  const sourceListings = await findListingsByBuilding(payload, sourceId, req)

  // —— 预检：迁移后同一楼盘（目标）有效期不可重叠 ——
  const targetPeriods: ValidityPeriod[] = []
  for (const doc of targetRelations) {
    const p = relationPeriod(doc)
    if (p) targetPeriods.push(p)
  }
  for (const doc of sourceRelations) {
    const p = relationPeriod(doc)
    if (p && findRelationOverlap(p, targetPeriods).length > 0) {
      return {
        ok: false,
        code: 'RELATION_OVERLAP',
        error: '合并会导致目标楼盘出现有效期重叠的供给关系，请先调整关系有效期',
      }
    }
    if (p) targetPeriods.push(p)
  }

  // —— 迁移供给关系（完整字段，触发 protect hook 二次校验 target 准入/重叠）——
  const targetBuildingId = toNumericId(targetId)
  for (const doc of sourceRelations) {
    await payload.update({
      collection: 'building-merchant-relations',
      id: doc.id,
      data: {
        building: targetBuildingId,
        merchant: doc.merchant,
        effectiveFrom: doc.effectiveFrom,
        effectiveTo: doc.effectiveTo ?? null,
        version: typeof doc.version === 'number' ? doc.version : 1,
        createdReason: doc.createdReason,
      },
      overrideAccess: true,
      req,
    })
  }

  // —— 迁移房源 building 外键（Listings 无 beforeChange，局部更新安全）——
  for (const doc of sourceListings) {
    await payload.update({
      collection: 'listings',
      id: doc.id,
      data: { building: targetBuildingId },
      overrideAccess: true,
      req,
    })
  }

  // —— 软删除源楼盘（deletedAt 非空，保留记录与审计链，R8）——
  await payload.update({
    collection: 'buildings',
    id: sourceId,
    data: { deletedAt: new Date().toISOString() },
    overrideAccess: true,
    req,
  })

  return {
    ok: true,
    report: {
      sourceId,
      targetId,
      migratedRelations: sourceRelations.length,
      migratedListings: sourceListings.length,
    },
  }
}
