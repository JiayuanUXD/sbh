/** asOf、可选楼盘 ID、城市、租售频道；所有 SQL 公开供给查询共用资格。 */
export function effectiveSupplySqlFrom(extraJoins = ''): string {
  return `
FROM listings l
JOIN buildings b ON b.id = l.building_id
JOIN locations city ON city.id = b.city_id
JOIN locations dist ON dist.id = b.district_id
JOIN merchants m ON m.id = l.merchant_id
${extraJoins}
WHERE ($2::int[] IS NULL OR l.building_id = ANY($2))
  AND l.deleted_at IS NULL
  AND l.publication_status = 'published'
  AND l.review_status = 'approved'
  AND l.supply_visibility_hold = 'normal'
  AND b.status = 'published'
  AND b.operational_status = 'active'
  AND b.deleted_at IS NULL
  AND city.status = 'active'
  AND city.slug = $3
  AND dist.status = 'active'
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
  )
`;
}

export const EFFECTIVE_SUPPLY_AGGREGATE_FROM = effectiveSupplySqlFrom();
