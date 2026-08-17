/**
 * 房源类指标查询适配器（tasks.md M7.3-M7.4 / R4, R7）
 *
 * 覆盖：
 *   - listings.total / published / pending_review / rejected / offline / rented
 *   - listings.completeness_below_80（M7.4 真实完整度计算，权重见 listing-completeness.ts）
 *   - listings.created_per_day_7d / _30d（趋势）
 *   - listings.by_city（按城市分布）
 *
 * 业务不变量：
 *   - 所有有效供给类指标复用 getEffectiveSupplyWhere + getPausedListingIds
 *   - 时间窗口按 Asia/Shanghai 自然日
 *   - URL 参数不扩大数据范围（ctx.filters 已由 sanitizeFilters 服务端兜底）
 *   - listings.completeness_below_80 内存过滤（DB 无法直接计算字段权重之和）
 */

import {
  getEffectiveSupplyWhere,
  getPausedListingIds,
  type PayloadQueryPort,
} from '@/domain/review/effective-supply'
import { PUBLICATION_STATUSES } from '@/domain/review/publication-status'

import type {
  MetricBucket,
  MetricQueryAdapter,
  MetricQueryContext,
  MetricScalarResult,
  MetricSeriesResult,
} from '../metric-types'
import {
  buildCityWhere,
  buildMerchantWhere,
  buildRangeWhere,
  mergeWhere,
} from './scope-where'
import { buildDailyBuckets, emptyBuckets } from './time-bucket'
import { computeListingCompleteness } from './listing-completeness'

// ────────────────────────────────────────────────────────────
// 标量计数查询
// ────────────────────────────────────────────────────────────

/**
 * 通用房源计数：按 statusWhere + filters + 可选有效供给谓词。
 *
 * @param statusWhere 状态过滤片段（如 { publicationStatus: { equals: 'published' } }）
 * @param useEffectiveSupply 是否叠加有效供给谓词（supply.effective_count 用）
 */
function makeListingCount(
  statusWhere: Record<string, unknown>,
  options: { useEffectiveSupply?: boolean } = {},
): MetricQueryAdapter {
  return async (ctx: MetricQueryContext): Promise<MetricScalarResult> => {
    const where = mergeWhere(
      { deletedAt: { exists: false } },
      statusWhere,
      buildCityWhere(ctx.filters),
      buildMerchantWhere(ctx.filters),
      options.useEffectiveSupply ? getEffectiveSupplyWhere(ctx.asOf) : null,
    )

    let effectiveWhere = where
    if (options.useEffectiveSupply) {
      // 排除被举报暂停的房源
      const payloadPort = ctx.payload as unknown as PayloadQueryPort
      const pausedIds = await getPausedListingIds(payloadPort)
      if (pausedIds.length > 0) {
        effectiveWhere = mergeWhere(where, { id: { not_in: pausedIds } })
      }
    }

    const value = await ctx.payload.count({
      collection: 'listings',
      where: effectiveWhere,
      overrideAccess: true,
    })

    return {
      kind: 'scalar',
      value,
      asOf: ctx.asOf.toISOString(),
    }
  }
}

/** listings.total：所有未逻辑删除的房源 */
export const countListingsTotal: MetricQueryAdapter = makeListingCount({})

/** listings.published：publicationStatus=published */
export const countListingsPublished: MetricQueryAdapter = makeListingCount({
  publicationStatus: { equals: 'published' },
})

/** listings.pending_review：reviewStatus=pending */
export const countListingsPendingReview: MetricQueryAdapter = makeListingCount({
  reviewStatus: { equals: 'pending' },
})

/** listings.rejected：reviewStatus=rejected */
export const countListingsRejected: MetricQueryAdapter = makeListingCount({
  reviewStatus: { equals: 'rejected' },
})

/** listings.offline：publicationStatus=unpublished */
export const countListingsOffline: MetricQueryAdapter = makeListingCount({
  publicationStatus: { equals: 'unpublished' },
})

/**
 * listings.rented：publicationStatus=leased
 *
 * 只算租赁成交。售出走 `countListingsSold`，两者刻意不合并——合并后无法回答
 * 「这个月租出去几套、卖出去几套」，而这正是运营最常问的问题。
 */
export const countListingsRented: MetricQueryAdapter = makeListingCount({
  publicationStatus: { equals: 'leased' },
})

/** listings.sold：publicationStatus=sold */
export const countListingsSold: MetricQueryAdapter = makeListingCount({
  publicationStatus: { equals: 'sold' },
})

/**
 * listings.completeness_below_80：完整度 < 80%。
 *
 * Listing 无 completeness 持久化字段，DB 无法直接计算字段权重之和。
 * 此处先按 where 粗筛（deletedAt + city + merchant），再分页拉取候选 Listing
 * 文档到内存，按 computeListingCompleteness 计算权重，统计 belowThreshold=true 的数量。
 *
 * 业务不变量：
 *   - 候选 cap = 500（与 building-aggregate 一致），超过需人工介入
 *   - 内存过滤后正确返回 belowThreshold 数量
 *   - asOf 与查询时刻一致
 *
 * 注意：
 *   - depth=1 让 Payload 解析 building/coverImage/gallery 关联，便于完整度判定
 *   - 不依赖有效供给谓词（完整度针对所有未逻辑删除的房源，不论是否在 C 端曝光）
 */
const COMPLETENESS_CANDIDATE_CAP = 500

export const countListingsCompletenessBelow80: MetricQueryAdapter = async (
  ctx,
): Promise<MetricScalarResult> => {
  const where = mergeWhere(
    { deletedAt: { exists: false } },
    buildCityWhere(ctx.filters),
    buildMerchantWhere(ctx.filters),
  )

  // depth=1 让 building/coverImage/gallery 等关联解析为对象，便于 hasRef 判定
  const result = await ctx.payload.find({
    collection: 'listings',
    where,
    depth: 1,
    limit: COMPLETENESS_CANDIDATE_CAP,
    overrideAccess: true,
  })

  const docs = result.docs as ReadonlyArray<Record<string, unknown>>
  let below = 0
  for (const doc of docs) {
    const { belowThreshold } = computeListingCompleteness(doc)
    if (belowThreshold) below += 1
  }

  return {
    kind: 'scalar',
    value: below,
    asOf: ctx.asOf.toISOString(),
  }
}

/** supply.effective_count：复用统一供给谓词 + 举报暂停排除 */
export const countEffectiveSupply: MetricQueryAdapter = makeListingCount(
  {},
  { useEffectiveSupply: true },
)

// ────────────────────────────────────────────────────────────
// 趋势序列查询（per-day count）
// ────────────────────────────────────────────────────────────

/**
 * 创建 per-day 创建趋势序列查询。
 *
 * 桶 i = 第 i 天 Asia/Shanghai 自然日 [00:00, 次日 00:00) UTC。
 *
 * @param days 桶数量（7 / 30）
 */
function makeCreatedPerDayTrend(days: number): MetricQueryAdapter {
  return async (ctx: MetricQueryContext): Promise<MetricSeriesResult> => {
    const buckets = buildDailyBuckets(ctx.asOf, days)
    const result: MetricSeriesResult = {
      kind: 'series',
      buckets: emptyBuckets(buckets),
      asOf: ctx.asOf.toISOString(),
    }

    // 并发查每个桶
    const counts = await Promise.all(
      buckets.map(async (b) => {
        const where = mergeWhere(
          { deletedAt: { exists: false } },
          buildCityWhere(ctx.filters),
          buildMerchantWhere(ctx.filters),
          {
            createdAt: {
              greater_than_equal: b.start.toISOString(),
              less_than: b.end.toISOString(),
            },
          },
        )
        return ctx.payload.count({
          collection: 'listings',
          where,
          overrideAccess: true,
        })
      }),
    )

    result.buckets = buckets.map((b, i) => ({
      label: b.label,
      value: counts[i],
    }))
    return result
  }
}

/** listings.created_per_day_7d：近 7 天每日新建房源趋势 */
export const trendListingsCreatedPerDay7d: MetricQueryAdapter =
  makeCreatedPerDayTrend(7)

/** listings.created_per_day_30d：近 30 天每日新建房源趋势 */
export const trendListingsCreatedPerDay30d: MetricQueryAdapter =
  makeCreatedPerDayTrend(30)

// ────────────────────────────────────────────────────────────
// 分布序列查询（按城市分组）
// ────────────────────────────────────────────────────────────

/**
 * listings.by_city：按 building.city 分组的房源数量分布。
 *
 * - 若 filters.cityIds 提供，则按这些城市分组
 * - 若 permission.cityIds 为 'all' 且未传 cityIds，分布为空（避免全量城市扫描）
 * - 单卡失败局部标记（看板层捕获）
 */
export const distributionListingsByCity: MetricQueryAdapter = async (
  ctx,
): Promise<MetricSeriesResult> => {
  const cityIds = ctx.filters.cityIds
  if (cityIds.length === 0) {
    return {
      kind: 'series',
      buckets: [],
      asOf: ctx.asOf.toISOString(),
    }
  }

  // 并发查每个城市
  const counts = await Promise.all(
    cityIds.map(async (cityId) => {
      const where = mergeWhere(
        { deletedAt: { exists: false } },
        { 'building.city': { equals: cityId } },
        buildMerchantWhere(ctx.filters),
      )
      return ctx.payload.count({
        collection: 'listings',
        where,
        overrideAccess: true,
      })
    }),
  )

  // 桶 label 暂用城市 id（前端可查 locations 表显示名称）
  return {
    kind: 'series',
    buckets: cityIds.map((cityId, i) => ({
      label: String(cityId),
      value: counts[i],
      metadata: { cityId },
    })),
    asOf: ctx.asOf.toISOString(),
  }
}

/**
 * listings.by_status：按发布状态分组的房源数量分布。
 *
 * 用于经营概览「来源分布」：published / unpublished / leased / draft。
 */
export const distributionListingsByStatus: MetricQueryAdapter = async (
  ctx,
): Promise<MetricSeriesResult> => {
  // 从 PUBLICATION_STATUSES 派生而非硬编码：这里曾写死 4 个状态，新增 sold 后
  // 已售房源会从分布图里整类消失，而图表不会报错，只是少一根柱子。
  const statuses = PUBLICATION_STATUSES
  const counts = await Promise.all(
    statuses.map(async (status) => {
      const where = mergeWhere(
        { deletedAt: { exists: false } },
        { publicationStatus: { equals: status } },
        buildCityWhere(ctx.filters),
        buildMerchantWhere(ctx.filters),
      )
      return ctx.payload.count({
        collection: 'listings',
        where,
        overrideAccess: true,
      })
    }),
  )
  return {
    kind: 'series',
    buckets: statuses.map((status, i) => ({
      label: status,
      value: counts[i],
    })),
    asOf: ctx.asOf.toISOString(),
  }
}

// 显式导出辅助类型以便测试 mock
export type { MetricBucket, MetricQueryContext, MetricScalarResult, MetricSeriesResult } from '../metric-types'
