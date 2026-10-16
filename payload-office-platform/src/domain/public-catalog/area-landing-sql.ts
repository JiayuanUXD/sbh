import { effectiveSupplySqlFrom } from './effective-supply-sql'
import { LISTING_PRICE_AMOUNT_SQL, LISTING_PRICE_UNIT_SQL } from './listing-query-sql'
import { AREA_LANDING_PRICE_UNIT, type AreaLandingStatsRow } from './area-landing'
import type { SearchContext } from './types'

type Query = Readonly<{ text: string; values: unknown[] }>

/**
 * 整城行政区 / 商圈统计（OPT-119）：一次扫描、`UNION ALL` 出两类分组。
 *
 * 资格谓词只来自 `effectiveSupplySqlFrom`（与列表 / 详情 / sitemap 同一份），价格归一只来自
 * `listing-query-sql` 导出的片段——这里不复制任何一条有效供给条件或单位映射。
 * 参数约定同全部公开 SQL：$1 asOf、$2 楼盘 ID（此处恒 null = 不限）、$3 城市、$4 租售频道。
 *
 * 为什么只聚合 `元/㎡/天`：其它计价单位彼此不可换算（`.agent/frontend.md`「计价单位彼此
 * 不可换算」），混进分位数就是把不同量纲排在同一把尺子上。非该单位（含面议、无报价）只计
 * `other_unit_count`，页面如实说明、不换算。
 *
 * 分位数用 `percentile_cont` 并在库内四舍五入到分，避免插值产生 4.2500000000000004 这类尾差。
 * 商圈可见性（`frontendVisible`）不在 SQL 里判——那是 Payload 的 locations 字段，由 facade
 * 与可见地点表求交；这里对所有挂了该商圈的有效房源都出一行。
 */
export function buildAreaLandingStatsQuery(ctx: SearchContext): Query {
  const aggregates = `COUNT(*)::int AS listing_count,
      COUNT(DISTINCT building_id)::int AS building_count,
      COUNT(*) FILTER (WHERE is_day_price)::int AS price_sample_count,
      MIN(price_amount) FILTER (WHERE is_day_price)::float8 AS price_min,
      ROUND((percentile_cont(0.25) WITHIN GROUP (ORDER BY price_amount::float8) FILTER (WHERE is_day_price))::numeric, 2)::float8 AS price_p25,
      ROUND((percentile_cont(0.5) WITHIN GROUP (ORDER BY price_amount::float8) FILTER (WHERE is_day_price))::numeric, 2)::float8 AS price_median,
      ROUND((percentile_cont(0.75) WITHIN GROUP (ORDER BY price_amount::float8) FILTER (WHERE is_day_price))::numeric, 2)::float8 AS price_p75,
      MAX(price_amount) FILTER (WHERE is_day_price)::float8 AS price_max,
      COUNT(*) FILTER (WHERE NOT is_day_price)::int AS other_unit_count,
      ROUND((percentile_cont(0.5) WITHIN GROUP (ORDER BY area_sqm::float8) FILTER (WHERE area_sqm IS NOT NULL))::numeric, 1)::float8 AS area_median,
      MAX(updated_at) AS last_updated_at`
  const text = `WITH normalized AS (
    SELECT l.updated_at, l.area AS area_sqm, b.id AS building_id,
      dist.id AS district_id, dist.slug AS district_slug, dist.name AS district_name,
      ba.id AS area_id, ba.slug AS area_slug, ba.name AS area_name,
      (${LISTING_PRICE_AMOUNT_SQL}) AS price_amount, (${LISTING_PRICE_UNIT_SQL}) AS price_unit
    ${effectiveSupplySqlFrom('LEFT JOIN locations ba ON ba.id = b.business_district_id')}
  ), priced AS (
    SELECT *, (price_unit = '${AREA_LANDING_PRICE_UNIT}' AND price_amount IS NOT NULL) AS is_day_price FROM normalized
  )
  SELECT 'district' AS kind, district_id AS id, district_slug AS slug, district_name AS name,
      NULL::text AS parent_slug, NULL::text AS parent_name, ${aggregates}
    FROM priced WHERE district_slug IS NOT NULL
    GROUP BY district_id, district_slug, district_name
  UNION ALL
  SELECT 'business_area' AS kind, area_id AS id, area_slug AS slug, area_name AS name,
      MIN(district_slug) AS parent_slug, MIN(district_name) AS parent_name, ${aggregates}
    FROM priced WHERE area_slug IS NOT NULL
    GROUP BY area_id, area_slug, area_name`
  return { text, values: [ctx.asOf, null, ctx.city, ctx.businessType ?? null] }
}

function integer(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : value
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0) throw new Error('area_landing_stats_row_invalid')
  return n
}

function nullableNumber(value: unknown): number | null {
  if (value == null) return null
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error('area_landing_stats_row_invalid')
  return n
}

function text(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error('area_landing_stats_row_invalid')
  return value
}

function nullableText(value: unknown): string | null {
  return value == null ? null : text(value)
}

/** SQL 行 → 类型化统计行。畸形行直接抛错（fail-closed）：宁可页面报错，也不展示被污染的数字。 */
export function mapAreaLandingStatsRow(row: Readonly<Record<string, unknown>>): AreaLandingStatsRow {
  if (row.kind !== 'district' && row.kind !== 'business_area') throw new Error('area_landing_stats_row_invalid')
  const updated = row.last_updated_at
  const lastUpdatedAt = updated == null ? null : new Date(updated as string | number | Date)
  if (lastUpdatedAt && Number.isNaN(lastUpdatedAt.getTime())) throw new Error('area_landing_stats_row_invalid')
  return {
    kind: row.kind,
    id: integer(row.id),
    slug: text(row.slug),
    name: text(row.name),
    parentSlug: nullableText(row.parent_slug),
    parentName: nullableText(row.parent_name),
    listingCount: integer(row.listing_count),
    buildingCount: integer(row.building_count),
    priceSampleCount: integer(row.price_sample_count),
    priceMin: nullableNumber(row.price_min),
    priceP25: nullableNumber(row.price_p25),
    priceMedian: nullableNumber(row.price_median),
    priceP75: nullableNumber(row.price_p75),
    priceMax: nullableNumber(row.price_max),
    otherUnitCount: integer(row.other_unit_count),
    areaMedian: nullableNumber(row.area_median),
    lastUpdatedAt: lastUpdatedAt ? lastUpdatedAt.toISOString() : null,
  }
}
