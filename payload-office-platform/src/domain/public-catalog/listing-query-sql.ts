import {
  EFFECTIVE_BUILDING_JOINS,
  EFFECTIVE_BUILDING_WHERE,
  EFFECTIVE_LISTING_WHERE,
  effectiveSupplySqlFrom,
} from './effective-supply-sql'
import { DISPLAY_UNIT_BY_PERIOD_BASIS, LEGACY_PRICE } from './mappers'
import type { ListingSearchInput, SearchContext } from './types'

type Query = Readonly<{ text: string; values: unknown[] }>

// 映射表与展示 mapper 共用；这里只翻译为 SQL，不另维护单位枚举。
const structuredUnit = `CASE ${Object.entries(DISPLAY_UNIT_BY_PERIOD_BASIS).flatMap(([period, bases]) =>
  Object.entries(bases).map(([basis, unit]) =>
    `WHEN l.price_period::text = '${period}' AND l.price_unit::text = '${basis === 'total' ? 'suite' : basis}' THEN '${unit}'`),
).join(' ')} END`
const legacyUnit = `CASE ${Object.entries(LEGACY_PRICE).map(([unit, key]) =>
  `WHEN l.rent_unit::text = '${unit}' THEN '${key.displayUnit}'`,
).join(' ')} END`
const structuredValid = `l.price_amount >= 0 AND l.price_amount::text NOT IN ('NaN', 'Infinity', '-Infinity')
  AND l.price_currency::text = 'CNY' AND (${structuredUnit}) IS NOT NULL`
const legacyValid = `l.rent >= 0 AND l.rent::text NOT IN ('NaN', 'Infinity', '-Infinity') AND (${legacyUnit}) IS NOT NULL`
const amount = `CASE WHEN ${structuredValid} THEN l.price_amount WHEN ${legacyValid} THEN l.rent END`
const unit = `CASE WHEN ${structuredValid} THEN (${structuredUnit}) WHEN ${legacyValid} THEN (${legacyUnit}) END`

function filteredQuery(input: ListingSearchInput, ctx: SearchContext) {
  const values: unknown[] = [ctx.asOf, null, ctx.city, ctx.businessType ?? null]
  const bind = (value: unknown) => { values.push(value); return `$${values.length}` }
  const conditions: string[] = []
  if (input.district?.length) conditions.push(`dist.slug = ANY(${bind(input.district)}::text[])`)
  if (input.businessArea?.length) conditions.push(`ba.slug = ANY(${bind(input.businessArea)}::text[])`)
  if (input.metro?.length) conditions.push(`metro.slug = ANY(${bind(input.metro)}::text[])`)
  if (input.listingType?.length) conditions.push(`l.listing_type::text = ANY(${bind(input.listingType)}::text[])`)
  if (input.buildingForm?.length) conditions.push(`EXISTS (SELECT 1 FROM listings_building_form form
    WHERE form.parent_id = l.id AND form.value::text = ANY(${bind(input.buildingForm)}::text[]))`)
  if (input.areaMin != null) conditions.push(`l.area >= ${bind(input.areaMin)}`)
  if (input.areaMax != null) conditions.push(`l.area <= ${bind(input.areaMax)}`)
  if (input.availableBefore) conditions.push(`(l.available_from IS NULL OR l.available_from <= ${bind(input.availableBefore)}::timestamptz)`)
  if (input.q) {
    const pattern = bind(`%${input.q}%`)
    conditions.push(`(l.title ILIKE ${pattern} OR b.name ILIKE ${pattern}
      OR dist.name ILIKE ${pattern} OR ba.name ILIKE ${pattern} OR metro.name ILIKE ${pattern})`)
  }
  const priceConditions: string[] = []
  if (input.priceUnit) {
    const selectedUnit = bind(input.priceUnit)
    const hasRange = input.priceMin != null || input.priceMax != null
    // 与 matchesPriceFilter 一致：仅选单位保留面议，带价格区间时排除面议。
    priceConditions.push(hasRange ? `price_unit = ${selectedUnit}` : `(price_unit IS NULL OR price_unit = ${selectedUnit})`)
    if (input.priceMin != null) priceConditions.push(`price_amount >= ${bind(input.priceMin)}`)
    if (input.priceMax != null) priceConditions.push(`price_amount <= ${bind(input.priceMax)}`)
  }
  const from = effectiveSupplySqlFrom(`LEFT JOIN locations ba ON ba.id = b.business_district_id
    LEFT JOIN locations metro ON metro.id = b.nearest_metro_id`)
  const text = `WITH normalized AS (
    SELECT l.id, l.is_featured, date_trunc('milliseconds', l.updated_at) AS updated_at,
      l.listing_type::text AS listing_type, CASE WHEN l.business_type::text = 'sale' THEN 'sale' ELSE 'lease' END AS business_type,
      dist.id AS district_id, dist.slug AS district_slug, dist.name AS district_name,
      ba.id AS area_id, ba.slug AS area_slug, ba.name AS area_name,
      (${amount}) AS price_amount, (${unit}) AS price_unit
    ${from} ${conditions.map(condition => `AND ${condition}`).join('\n')}
  ), matched AS MATERIALIZED (
    SELECT *, business_type || ':' || price_unit AS price_key FROM normalized
    ${priceConditions.length ? `WHERE ${priceConditions.join(' AND ')}` : ''}
  )`
  return { text, values, bind }
}

export function buildListingPageQuery(input: ListingSearchInput, ctx: SearchContext): Query {
  const query = filteredQuery(input, ctx)
  const priceSort = input.sort === 'price-asc' || input.sort === 'price-desc'
  let scope = 'SELECT * FROM matched'
  if (priceSort && input.priceUnit) scope += ` WHERE price_unit = ${query.bind(input.priceUnit)}`
  if (priceSort && !input.priceUnit) scope += ` WHERE (SELECT COUNT(DISTINCT price_key) FROM matched) <= 1
    OR price_key = (SELECT price_key FROM matched WHERE price_key IS NOT NULL ORDER BY id LIMIT 1)`
  const sort = priceSort
    ? `price_amount ${input.sort === 'price-desc' ? 'DESC' : 'ASC'} NULLS LAST, id ASC`
    : `${input.sort === 'newest' ? '' : 'COALESCE(is_featured, false) DESC, '}COALESCE(updated_at, 'epoch'::timestamptz) DESC, id ASC`
  const limit = query.bind(input.pageSize > 0 ? input.pageSize : 1)
  const offset = query.bind((Math.max(1, input.page) - 1) * (input.pageSize > 0 ? input.pageSize : 1))
  return { text: `${query.text}, selected AS MATERIALIZED (${scope})
    SELECT ARRAY(SELECT id FROM selected ORDER BY ${sort} LIMIT ${limit} OFFSET ${offset}) AS ids,
      (SELECT COUNT(*)::int FROM selected) AS total,
      ${priceSort && !input.priceUnit ? '(SELECT COUNT(DISTINCT price_key) > 1 FROM matched)' : 'false'} AS filtered`, values: query.values }
}

export function buildListingFacetsQuery(input: ListingSearchInput, ctx: SearchContext): Query {
  const query = filteredQuery(input, ctx)
  const locationGroups = (prefix: 'district' | 'area') => `COALESCE((SELECT json_agg(json_build_object(
    'id', id, 'slug', slug, 'name', name, 'count', cnt) ORDER BY first_id)
    FROM (SELECT ${prefix}_id AS id, ${prefix}_slug AS slug, ${prefix}_name AS name,
      COUNT(*)::int AS cnt, MIN(id) AS first_id FROM matched
      WHERE ${prefix}_id IS NOT NULL AND ${prefix}_slug IS NOT NULL AND ${prefix}_name IS NOT NULL
      GROUP BY ${prefix}_id, ${prefix}_slug, ${prefix}_name) groups), '[]'::json)`
  const valueGroups = (column: 'listing_type' | 'price_unit') => `COALESCE((SELECT json_agg(json_build_object(
    'value', value, 'count', cnt) ORDER BY first_id) FROM (SELECT ${column} AS value,
      COUNT(*)::int AS cnt, MIN(id) AS first_id FROM matched WHERE ${column} IS NOT NULL ${column === 'listing_type' ? "AND listing_type <> ''" : ''}
      GROUP BY ${column}) groups), '[]'::json)`
  return { text: `${query.text} SELECT json_build_object(
    'totalDocs', (SELECT COUNT(*)::int FROM matched),
    'districts', ${locationGroups('district')}, 'businessAreas', ${locationGroups('area')},
    'listingTypes', ${valueGroups('listing_type')}, 'rentUnits', ${valueGroups('price_unit')},
    'buildingForms', COALESCE((SELECT json_agg(json_build_object('value', value, 'count', cnt)
      ORDER BY first_id, first_order) FROM (SELECT f.value::text AS value, COUNT(*)::int AS cnt,
      MIN(r.id) AS first_id, (ARRAY_AGG(f."order" ORDER BY r.id))[1] AS first_order FROM matched r
      JOIN listings_building_form f ON f.parent_id = r.id GROUP BY f.value) groups), '[]'::json)
  ) AS facets`, values: query.values }
}

export const RECOMMENDATION_CANDIDATE_LIMIT = 1_000

export type RecommendationScope = Readonly<{
  businessDistrictId: number | null
  districtId: number | null
  buildingId: number | null
}>

/**
 * 详情页推荐候选查询：按商圈 → 行政区 → 同楼盘的优先级在库内直接限定局部范围，避免扫描全城。
 *
 * 先在 MATERIALIZED CTE 里圈出范围内的合格楼盘，再连房源。不能像整城查询那样把局部条件
 * 直接拼在 `effectiveSupplySqlFrom()` 后面：2026-10-14 生产事故里，商户侧谓词连乘把房源
 * 低估成几十行，规划器于是把 1536 行的 `locations dist` 无条件交叉连进来、最后才按楼盘过滤
 * （约 5.6 万房源 × 1536 × 商圈楼盘数），单条推荐查询跑 6~25 分钟、占满连接池。
 * 行政区 / 城市只在 CTE 里与楼盘按外键相连，主查询里已无可交叉放大的关系；
 * 统计信息再偏，最坏也只是把城内房源扫一遍。
 */
export function buildRecommendationCandidatesQuery(
  scope: RecommendationScope,
  ctx: SearchContext,
): Query | null {
  const query = (scopeCondition: string, values: unknown[]): Query => ({
    text: `WITH scoped AS MATERIALIZED (
      SELECT b.id, b.city_id, b.district_id, b.business_district_id
      FROM buildings b
      ${EFFECTIVE_BUILDING_JOINS}
      WHERE ${EFFECTIVE_BUILDING_WHERE}
        AND ${scopeCondition}
    )
    SELECT l.id, COALESCE(l.listing_type::text, '') AS listing_type,
      CASE WHEN l.business_type::text = 'sale' THEN 'sale' ELSE 'lease' END AS business_type,
      l.area::float8 AS area, (${amount})::float8 AS price_amount, (${unit}) AS price_unit,
      b.district_id AS district_id, b.business_district_id AS business_district_id
    FROM scoped b
    JOIN listings l ON l.building_id = b.id
    JOIN merchants m ON m.id = l.merchant_id
    WHERE ${EFFECTIVE_LISTING_WHERE}
    ORDER BY l.id ASC LIMIT ${RECOMMENDATION_CANDIDATE_LIMIT}`,
    values,
  })
  if (scope.businessDistrictId != null) {
    return query('b.business_district_id = $5',
      [ctx.asOf, null, ctx.city, ctx.businessType ?? null, scope.businessDistrictId])
  }
  if (scope.districtId != null) {
    return query('b.district_id = $5', [ctx.asOf, null, ctx.city, ctx.businessType ?? null, scope.districtId])
  }
  if (scope.buildingId != null) {
    return query('b.id = ANY($2::int[])', [ctx.asOf, [scope.buildingId], ctx.city, ctx.businessType ?? null])
  }
  return null
}


