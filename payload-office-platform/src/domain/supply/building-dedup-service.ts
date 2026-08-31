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
 * 合并的原子性：`mergeBuildings` 自己开事务（调用方已开则不抢），任一步失败整体回滚。
 *   详见该函数的注释——原来把这件事甩给 endpoint，而 endpoint 从来没做。
 * 迁移前先做「目标既有关系 vs 源关系」区间重叠预检：命中即中止且不发生任何写入，
 * 与 PostgreSQL EXCLUDE 约束语义一致（同一楼盘有效期不可重叠）。
 */

import type { BasePayload, PayloadRequest, Where } from 'payload'
import { commitTransaction, initTransaction, killTransaction } from 'payload'
import { detectDuplicates, type DuplicateReason } from './building-dedup'
import {
  findRelationOverlap,
  toRelationPeriod,
} from './building-merchant-relation'
import type { ValidityPeriod } from '@/domain/shared/validity'
import { assertTransactionIntact } from '@/domain/shared/transaction-safety'
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
  const captured = req?.transactionID
  try {
    return (
      (await payload.findByID({
        collection: 'buildings',
        id,
        depth: 0,
        overrideAccess: true,
        // disableErrors：查不到时 Payload 早于 catch 就 return null，不会
        // killTransaction 把调用方那笔写入一起回滚（见 shared/transaction-safety.ts）
        disableErrors: true,
        req,
      })) ?? null
    )
  } catch {
    // 真出别的异常时 Payload 已经回滚了 req 上的事务，必须抛出去，
    // 否则合并会「返回成功但没落库」。
    assertTransactionIntact(req, captured, 'building-dedup:building')
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
 * ## 原子性由这里负责，不能甩给调用方
 *
 * 这段注释原来写的是「原子性由调用方在同一请求事务内传入 req 保证」，
 * 而**没有任何调用方这么做**：`building-merge-endpoint` 只是把 req 透传下来，
 * 但 Payload 的自定义 endpoint 不开事务（只有 collection operation 会）。
 * 于是 4~6 里的每一次 `payload.update` 都在 `initTransaction` 里发现
 * `req.transactionID` 是空的，各自开一笔、各自提交。第 6 步失败就留下
 * 「关系和房源都搬到目标了、源楼盘还活着」的半合并状态，而 endpoint 返回 5xx——
 * 运营看到「合并失败」，数据却已经动了一半，且没有反向操作能还原。
 *
 * 所以事务在这里开：`initTransaction` 只在 req 上还没有事务时才开一笔并接管提交权
 * （调用方已经开了就返回 false，我们不抢），任一步抛错整笔 `killTransaction`。
 *
 * 提交前必须 `assertTransactionIntact`：事务一旦被别人拆掉（Payload 每个 operation
 * 的 catch 都会 `killTransaction(req)`），`commitTransaction` 拿着空 id 会静默 return，
 * 于是「合并成功」但什么都没落库。原因见 `domain/shared/transaction-safety.ts`。
 *
 * 不传 req 时无事务可开，退化成逐条写入——**不假装原子**。生产链路（endpoint）
 * 一定带 req。
 */
export async function mergeBuildings(
  payload: BasePayload,
  input: MergeBuildingsInput,
  req?: PayloadRequest,
): Promise<MergeBuildingsResult> {
  // 纯入参校验，不碰库，放在开事务之前
  if (String(input.sourceId) === String(input.targetId)) {
    return { ok: false, code: 'INVALID_MERGE', error: '源楼盘与目标楼盘不能相同' }
  }

  const ownsTransaction = req ? await initTransaction(req) : false
  const transactionId = req?.transactionID

  try {
    const result = await runMerge(payload, input, req)

    if (!result.ok) {
      // 预检失败时并没有写入，回滚只是把这笔空事务收掉，语义上「整笔合并作废」
      if (ownsTransaction && req) await killTransaction(req)
      return result
    }

    assertTransactionIntact(req, transactionId, 'building-merge')
    if (ownsTransaction && req) await commitTransaction(req)
    return result
  } catch (error) {
    if (ownsTransaction && req) await killTransaction(req)
    throw error
  }
}

/** 合并的实际步骤。事务边界由 `mergeBuildings` 负责，这里只管业务。 */
async function runMerge(
  payload: BasePayload,
  input: MergeBuildingsInput,
  req?: PayloadRequest,
): Promise<MergeBuildingsResult> {
  const { sourceId, targetId } = input

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
