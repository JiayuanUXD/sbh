/**
 * 所有 SQL 公开供给查询共用资格。参数约定：$1 asOf、$2 可选楼盘 ID、$3 城市、$4 租售频道。
 *
 * 资格拆成楼盘侧与房源侧两段，供需要先圈楼盘再连房源的查询（详情页推荐）单独组合；
 * 整城查询仍经 `effectiveSupplySqlFrom` 一次拼齐，两边谓词只此一份。
 */

/** 楼盘侧：楼盘自身 + 所在城市 + 行政区。只引用 b / city / dist 与 $3。 */
export const EFFECTIVE_BUILDING_JOINS = `JOIN locations city ON city.id = b.city_id
JOIN locations dist ON dist.id = b.district_id`;

export const EFFECTIVE_BUILDING_WHERE = `b.status = 'published'
  AND b.operational_status = 'active'
  AND b.deleted_at IS NULL
  AND city.status = 'active'
  AND city.slug = $3
  AND dist.status = 'active'`;

/** 房源侧：房源 + 商户（含服务城市）+ 举报暂停。只引用 l / m / b.city_id 与 $1 $2 $4。 */
export const EFFECTIVE_LISTING_WHERE = `($2::int[] IS NULL OR l.building_id = ANY($2))
  AND l.deleted_at IS NULL
  AND l.publication_status = 'published'
  AND l.review_status = 'approved'
  AND l.supply_visibility_hold = 'normal'
  AND ($4::text IS NULL OR l.business_type::text = $4::text)
  AND m.status = 'active'
  AND m.qualification_status = 'valid'
  AND (m.qualification_expires_at IS NULL OR m.qualification_expires_at >= $1)
  AND EXISTS (
    SELECT 1 FROM merchants_rels mr
    WHERE mr.parent_id = m.id AND mr.path = 'serviceCities' AND mr.locations_id = b.city_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM listing_reports rep
    WHERE rep.target_listing_id = l.id AND rep.supply_paused = true
  )`;

export function effectiveSupplySqlFrom(extraJoins = ''): string {
  return `
FROM listings l
JOIN buildings b ON b.id = l.building_id
${EFFECTIVE_BUILDING_JOINS}
JOIN merchants m ON m.id = l.merchant_id
${extraJoins}
WHERE ${EFFECTIVE_LISTING_WHERE}
  AND ${EFFECTIVE_BUILDING_WHERE}
`;
}

export const EFFECTIVE_SUPPLY_AGGREGATE_FROM = effectiveSupplySqlFrom();
