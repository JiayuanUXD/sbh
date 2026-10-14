/**
 * 房源 / 楼盘的一次写入能否影响公开页面（OPT-111）。
 *
 * 为什么需要：`supply-cache-hook.ts` 原来对**每一次**保存都做城市级硬失效——草稿保存、
 * 只改内部字段的保存也一样。后台录入、审核流转、批量操作都在持续写这两张表，
 * 公开缓存因此几乎总是冷的。
 *
 * 判定按顺序，第一条命中即返回；**拿不准一律失效**：错判成「跳过」的代价是变化最长
 * 300s（`unstable_cache` 的 TTL）后才对外可见，错判成「失效」只是多清一次缓存。
 *
 *   1. 删除：删除前可能公开 → 失效，否则跳过。
 *   2. 新建（无 previousDoc）：新建即可能公开 → 失效，否则跳过。
 *   3. 任一侧不是对象 → 失效。
 *   4. 前后都确定不可能公开 → 跳过。
 *   5. 前后公开性不同（上架 / 下架）→ 失效。
 *   6. 逐个顶层字段深比较，去掉内部字段名单；有差异 → 失效，否则跳过。
 *
 * 「可能公开」只看状态字段是否为 `published`（有效供给的前置条件，见
 * `domain/review/effective-supply.ts` §2 与 `domain/supply/public-building.ts`）。
 * 它是有效供给的**超集**：商户资格、举报暂停等其余条件不满足也照样算「可能公开」，
 * 只会多失效、不会漏失效。状态字段缺失或不是字符串同样算「可能公开」。
 *
 * 已获用户确认的代价（2026-10-14，工作项 D1）：只改内部字段的保存不再清缓存，
 * 而公开排序的「最近维护」过渡口径读的是 `updatedAt`（`stable-sort.ts`），
 * 该房源的排序位置要等 TTL 后才前移。
 */
import { isDeepStrictEqual } from 'node:util'

export type SupplyCollection = 'listings' | 'buildings'

export type SupplyCacheDecisionReason =
  | 'created_public'
  | 'became_or_was_public'
  | 'public_field_changed'
  | 'deleted_public'
  | 'never_public'
  | 'internal_fields_only'
  | 'unknown_shape'

export type SupplyCacheDecision = Readonly<{
  invalidate: boolean
  reason: SupplyCacheDecisionReason
}>

const STATUS_FIELD: Readonly<Record<SupplyCollection, string>> = {
  listings: 'publicationStatus',
  buildings: 'status',
}

/**
 * 不会出现在任何公开输出里的字段：它们单独变化不影响公开页面。
 *
 * 加字段之前先确认公开代码（Web 前台与小程序 API）没有读它——
 * `tests/supply-cache-relevance.test.ts` 的源码契约会在公开目录里扫字段名。
 * 元字段 `updatedAt` / `createdAt` / `version` 每次保存都变，不排除它们本条规则等于没有。
 */
export const INTERNAL_ONLY_SUPPLY_FIELDS: Readonly<Record<SupplyCollection, readonly string[]>> = {
  listings: ['updatedAt', 'createdAt', 'version', 'dataSource', 'roomNumber', 'contactBroker'],
  buildings: ['updatedAt', 'createdAt', 'version', 'dataSource', 'verificationStatus'],
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 保存前后都确定不可能公开时为 false；状态字段缺失或不认识时为 true（fail-safe）。 */
export function couldBePublic(collection: SupplyCollection, doc: unknown): boolean {
  if (!isRecord(doc)) return true
  const status = doc[STATUS_FIELD[collection]]
  return typeof status !== 'string' || status === 'published'
}

function hasPublicFieldChange(
  collection: SupplyCollection,
  previousDoc: Record<string, unknown>,
  doc: Record<string, unknown>,
): boolean {
  const internal = new Set(INTERNAL_ONLY_SUPPLY_FIELDS[collection])
  const keys = new Set([...Object.keys(previousDoc), ...Object.keys(doc)])
  for (const key of keys) {
    if (internal.has(key)) continue
    if (!isDeepStrictEqual(previousDoc[key], doc[key])) return true
  }
  return false
}

export function decideSupplyCacheInvalidation(input: Readonly<{
  collection: SupplyCollection
  doc: unknown
  /** 缺省表示 create 或 delete。 */
  previousDoc?: unknown
  operation: 'change' | 'delete'
}>): SupplyCacheDecision {
  const { collection, doc, previousDoc, operation } = input

  if (operation === 'delete') {
    return couldBePublic(collection, doc)
      ? { invalidate: true, reason: 'deleted_public' }
      : { invalidate: false, reason: 'never_public' }
  }
  if (previousDoc === undefined) {
    return couldBePublic(collection, doc)
      ? { invalidate: true, reason: 'created_public' }
      : { invalidate: false, reason: 'never_public' }
  }
  if (!isRecord(doc) || !isRecord(previousDoc)) {
    return { invalidate: true, reason: 'unknown_shape' }
  }

  const wasPublic = couldBePublic(collection, previousDoc)
  const isPublic = couldBePublic(collection, doc)
  if (!wasPublic && !isPublic) return { invalidate: false, reason: 'never_public' }
  if (wasPublic !== isPublic) return { invalidate: true, reason: 'became_or_was_public' }

  return hasPublicFieldChange(collection, previousDoc, doc)
    ? { invalidate: true, reason: 'public_field_changed' }
    : { invalidate: false, reason: 'internal_fields_only' }
}
