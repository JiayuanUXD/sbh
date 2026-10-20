import type { VocabularyKind } from '@/domain/search/vocabulary'

export type SearchVocabularyRow = Readonly<{
  kind: VocabularyKind
  id: number
  slug: string
  name: string
  parent_name: string | null
}>

/**
 * 公开搜索词表：当前城市 + 前台可见行政区 / 商圈 + 启用地铁 + 公开楼盘。
 *
 * 与楼盘目录的公开谓词保持一致（`status` / `operational_status` / `deleted_at`），
 * 不引入第二套可见性规则。商圈与行政区要求 `frontend_visible = true`，与
 * `findEffectiveDistricts` / 首页热门商圈同口径；地铁只要求 `status = 'active'`，
 * 因为楼盘搜索本来就会按 `nearestMetro.name` 匹配，不要求它在前台单独露出。
 *
 * 上限 10 万行：正常城市远低于此；超过说明谓词写错或数据异常，宁可报错也
 * 不要把整库拖进内存（与楼盘目录 25 万上限同型）。
 */
export function buildSearchVocabularyQuery(city: string): Readonly<{ text: string; values: unknown[] }> {
  return {
    text: `
WITH city AS (
  SELECT id, slug, name FROM locations
  WHERE type = 'city' AND status = 'active' AND slug = $1
)
SELECT 'city'::text AS kind, id, slug, name, NULL::text AS parent_name FROM city
UNION ALL
SELECT 'district'::text, d.id, d.slug, d.name, c.name
FROM locations d
JOIN city c ON d.parent_id = c.id
WHERE d.type = 'district' AND d.status = 'active' AND d.frontend_visible = true
UNION ALL
SELECT 'businessArea'::text, ba.id, ba.slug, ba.name, d.name
FROM locations ba
JOIN locations d ON ba.parent_id = d.id
JOIN city c ON d.parent_id = c.id
WHERE ba.type = 'business_area' AND ba.status = 'active' AND ba.frontend_visible = true
UNION ALL
SELECT 'metro'::text, m.id, m.slug, m.name, p.name
FROM locations m
JOIN locations p ON m.parent_id = p.id
JOIN city c ON (p.id = c.id OR p.parent_id = c.id)
WHERE m.type IN ('metro_station', 'metro_line') AND m.status = 'active'
UNION ALL
SELECT 'building'::text, b.id, b.slug, b.name, COALESCE(ba.name, d.name)
FROM buildings b
JOIN city c ON b.city_id = c.id
JOIN locations d ON b.district_id = d.id
LEFT JOIN locations ba ON b.business_district_id = ba.id
WHERE b.status = 'published' AND b.operational_status = 'active' AND b.deleted_at IS NULL
  AND d.status = 'active'
LIMIT 100000
`,
    values: [city],
  }
}
