import { BUILDING_CLEARABLE_DIMENSIONS, BUILDING_GRADE_VALUES,
  type BuildingSearchDimension, type BuildingSearchInput } from './building-search';
import { EFFECTIVE_SUPPLY_AGGREGATE_FROM } from './effective-supply-sql';
import type { BuildingFilteredResult } from './facade';
import type { SearchContext } from './types';

export type BuildingMetadataRow = {
  id: number; slug: string; name: string; city: unknown;
  area_slug: string | null; cover_id: number | null;
  recommended_order?: number | null;
};
export type BuildingSqlResult = Omit<BuildingFilteredResult, 'docs' | 'groups' | 'page' | 'totalPages'> & {
  supply: readonly Readonly<{ id: number; count: number; area: number | null }>[];
};
export type BuildingPageSelection = BuildingSqlResult & { page: number; totalPages: number };

/** 与公开楼盘查询相同的资格，只读取计数、排序和分面所需的紧凑字段。 */
export const PUBLIC_BUILDING_METADATA_SQL = `
SELECT b.id, b.slug, b.name,
  jsonb_build_object('id', city.id, 'slug', city.slug, 'name', city.name,
    'type', city.type, 'status', city.status) AS city,
  ba.slug AS area_slug, media.id AS cover_id,
  COALESCE(b.recommended_order, 0)::int AS recommended_order
FROM buildings b
JOIN locations city ON city.id = b.city_id
JOIN locations dist ON dist.id = b.district_id
LEFT JOIN locations ba ON ba.id = b.business_district_id
LEFT JOIN media ON media.id = b.cover_image_id
WHERE b.status = 'published' AND b.operational_status = 'active'
  AND b.deleted_at IS NULL AND city.status = 'active'
  AND dist.status = 'active' AND city.slug = $1
ORDER BY date_trunc('milliseconds', b.updated_at) DESC, b.id ASC
LIMIT 250001
`;

/** slug 的 localeCompare 次序由轻量身份查询提供；其它排序、筛选和分页在数据库完成。 */
export function buildBuildingPageQuery(input: BuildingSearchInput, ctx: SearchContext, slugOrderedIds: readonly number[]) {
  const values: unknown[] = [new Date(ctx.asOf).toISOString(), null, ctx.city,
    input.business ?? 'lease', slugOrderedIds, Intl.DateTimeFormat().resolvedOptions().timeZone,
    [...BUILDING_GRADE_VALUES]];
  const bind = (value: unknown) => { values.push(value); return `$${values.length}`; };
  const conditions: Partial<Record<BuildingSearchDimension, string>> = {};
  for (const [key, column] of [['district', 'district_slug'], ['businessArea', 'area_slug'],
    ['grade', 'grade'], ['metro', 'metro_slug']] as const) {
    if (input[key]) conditions[key] = `${column} = ANY(${bind(input[key])}::text[])`;
  }
  const areaConditions: string[] = [];
  if (input.leasableAreaMin != null) areaConditions.push(`leasable_area >= ${bind(input.leasableAreaMin)}`);
  if (input.leasableAreaMax != null) areaConditions.push(`leasable_area <= ${bind(input.leasableAreaMax)}`);
  if (areaConditions.length) conditions.leasableArea = areaConditions.join(' AND ');
  if (input.completedAfter != null) conditions.completedAfter = `completion_year >= ${bind(input.completedAfter)}`;
  if (input.onlyWithStock) conditions.onlyWithStock = 'has_stock';
  const filter = (omitted: readonly BuildingSearchDimension[] = []) => Object.entries(conditions)
    .filter(([key]) => !omitted.includes(key as BuildingSearchDimension)).map(([, condition]) => `(${condition})`).join(' AND ') || 'TRUE';
  const facet = (slugColumn: string, nameColumn: string | null, omitted: readonly BuildingSearchDimension[]) => {
    const object = nameColumn
      ? "jsonb_build_object('slug', slug, 'name', name, 'count', cnt)"
      : "jsonb_build_object('value', slug, 'count', cnt)";
    return `(SELECT COALESCE(jsonb_agg(${object} ORDER BY first_seen), '[]'::jsonb) FROM (
      SELECT ${slugColumn} AS slug, ${nameColumn ? `(array_agg(${nameColumn} ORDER BY universe_order DESC))[1] AS name,` : ''}
        COUNT(*) FILTER (WHERE ${filter(omitted)})::int AS cnt, MIN(universe_order) AS first_seen
      FROM base WHERE ${slugColumn} IS NOT NULL ${nameColumn ? '' : `AND ${slugColumn} <> ''`}
      GROUP BY ${slugColumn}) candidates)`;
  };
  const primarySort = { 'stock-desc': 'listing_count DESC', 'area-desc': 'leasable_area DESC NULLS LAST',
    grade: 'grade_rank ASC', 'completion-desc': 'completion_year DESC NULLS LAST' }[input.sort];
  const ordering = `has_stock DESC, ${primarySort}, slug_order ASC`;
  const pageSize = input.pageSize > 0 ? input.pageSize : 1;
  const limit = bind(pageSize);
  const offset = bind(Math.trunc((Math.max(1, input.page) - 1) * pageSize));
  return { values, text: `WITH stock AS MATERIALIZED (
    SELECT l.building_id, SUM(l.area)::float8 AS total_area, COUNT(*)::int AS listing_count
    ${EFFECTIVE_SUPPLY_AGGREGATE_FROM} GROUP BY l.building_id
  ), projected AS MATERIALIZED (
    SELECT b.id, dist.slug AS district_slug, dist.name AS district_name,
      ba.slug AS area_slug, ba.name AS area_name, metro.slug AS metro_slug, metro.name AS metro_name,
      b.grade::text AS grade,
      COALESCE(array_position($7::text[], b.grade::text), cardinality($7::text[]) + 1) AS grade_rank,
      EXTRACT(YEAR FROM b.completion_date AT TIME ZONE $6)::int AS completion_year,
      COALESCE(stock.listing_count, 0) AS listing_count,
      NULLIF(CASE WHEN stock.total_area > 0 AND stock.total_area < 'Infinity'::float8
        THEN floor(stock.total_area * 100 + 0.5) / 100 ELSE 0 END, 0) AS leasable_area,
      tie.slug_order, ROW_NUMBER() OVER (ORDER BY date_trunc('milliseconds', b.updated_at) DESC, b.id ASC) AS universe_order
    FROM buildings b
    JOIN locations city ON city.id = b.city_id
    JOIN locations dist ON dist.id = b.district_id
    LEFT JOIN locations ba ON ba.id = b.business_district_id
    LEFT JOIN locations metro ON metro.id = b.nearest_metro_id
    JOIN unnest($5::int[]) WITH ORDINALITY AS tie(id, slug_order) ON tie.id = b.id
    LEFT JOIN stock ON stock.building_id = b.id
    WHERE b.status = 'published' AND b.operational_status = 'active' AND b.deleted_at IS NULL
      AND city.status = 'active' AND dist.status = 'active' AND city.slug = $3
      AND ($4::text <> 'sale' OR stock.listing_count > 0)
  ), base AS MATERIALIZED (
    SELECT *, (listing_count > 0 OR COALESCE(leasable_area, 0) > 0) AS has_stock FROM projected
  ), matched AS MATERIALIZED (SELECT * FROM base WHERE ${filter()}), selected AS MATERIALIZED (
    SELECT *, ROW_NUMBER() OVER (ORDER BY ${ordering}) AS page_order FROM matched
    ORDER BY ${ordering} LIMIT ${limit} OFFSET ${offset}
  ) SELECT jsonb_build_object(
    'supply', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'count', listing_count,
      'area', leasable_area) ORDER BY page_order), '[]'::jsonb) FROM selected),
    'totalDocs', (SELECT COUNT(*)::int FROM matched),
    'withStockTotal', (SELECT COUNT(*)::int FROM matched WHERE has_stock),
    'withoutStockTotal', (SELECT COUNT(*)::int FROM matched WHERE NOT has_stock),
    'unfilteredTotalDocs', (SELECT COUNT(*)::int FROM base),
    'facets', jsonb_build_object(
      'districts', ${facet('district_slug', 'district_name', ['district', 'businessArea'])},
      'businessAreas', ${facet('area_slug', 'area_name', ['businessArea'])},
      'grades', ${facet('grade', null, ['grade'])},
      'metros', ${facet('metro_slug', 'metro_name', ['metro'])}),
    'dimensionHits', jsonb_build_object(${BUILDING_CLEARABLE_DIMENSIONS.map(dimension =>
      `'${dimension}', (SELECT COUNT(*) FILTER (WHERE ${filter([dimension])})::int FROM base)`).join(',')})
  ) AS result` };
}
