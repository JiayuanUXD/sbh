-- 2026-10-14 推荐候选 SQL 交叉连接取证脚本（全部只读；经 CloudBase MCP queryPgDatabase 在生产库执行）。
-- 参数代入：$1 = now()，$2 = NULL（楼盘档为 '{<id>}'），$3 = 'shanghai'，$4 = NULL，$5 = 商圈 / 行政区 ID。

-- 1. 谁占着连接
SELECT pid, query_id, now() - query_start AS running, state, wait_event_type, wait_event,
  left(regexp_replace(query, '\s+', ' ', 'g'), 120) AS q
FROM pg_stat_activity WHERE usename = 'sbh' ORDER BY query_start NULLS LAST;

-- 2. 旧 SQL 的计划（只 EXPLAIN，切勿 ANALYZE：会真跑 6~25 分钟）。商圈 144 触发交叉连接，商圈 10 不触发。
EXPLAIN SELECT l.id FROM listings l JOIN buildings b ON b.id = l.building_id
  JOIN locations city ON city.id = b.city_id JOIN locations dist ON dist.id = b.district_id
  JOIN merchants m ON m.id = l.merchant_id
WHERE (NULL::int[] IS NULL OR l.building_id = ANY(NULL::int[])) AND l.deleted_at IS NULL
  AND l.publication_status = 'published' AND l.review_status = 'approved' AND l.supply_visibility_hold = 'normal'
  AND b.status = 'published' AND b.operational_status = 'active' AND b.deleted_at IS NULL
  AND city.status = 'active' AND city.slug = 'shanghai' AND dist.status = 'active'
  AND (NULL::text IS NULL OR l.business_type::text = NULL::text)
  AND m.status = 'active' AND m.qualification_status = 'valid'
  AND (m.qualification_expires_at IS NULL OR m.qualification_expires_at >= now())
  AND EXISTS (SELECT 1 FROM merchants_rels mr WHERE mr.parent_id = m.id AND mr.path = 'serviceCities' AND mr.locations_id = b.city_id)
  AND NOT EXISTS (SELECT 1 FROM listing_reports rep WHERE rep.target_listing_id = l.id AND rep.supply_paused = true)
  AND b.business_district_id = 144
ORDER BY l.id ASC LIMIT 1000;

-- 3. 新 SQL 计时（计划有界后才可真跑）。把 `b.business_district_id = 144` 换成 `= 10` / `b.district_id = 7` 复测。
SELECT count(*) AS n, clock_timestamp() - statement_timestamp() AS elapsed FROM (
  WITH scoped AS MATERIALIZED (
    SELECT b.id, b.city_id, b.district_id, b.business_district_id
    FROM buildings b JOIN locations city ON city.id = b.city_id JOIN locations dist ON dist.id = b.district_id
    WHERE b.status = 'published' AND b.operational_status = 'active' AND b.deleted_at IS NULL
      AND city.status = 'active' AND city.slug = 'shanghai' AND dist.status = 'active'
      AND b.business_district_id = 144
  )
  SELECT l.id FROM scoped b JOIN listings l ON l.building_id = b.id JOIN merchants m ON m.id = l.merchant_id
  WHERE (NULL::int[] IS NULL OR l.building_id = ANY(NULL::int[])) AND l.deleted_at IS NULL
    AND l.publication_status = 'published' AND l.review_status = 'approved' AND l.supply_visibility_hold = 'normal'
    AND (NULL::text IS NULL OR l.business_type::text = NULL::text)
    AND m.status = 'active' AND m.qualification_status = 'valid'
    AND (m.qualification_expires_at IS NULL OR m.qualification_expires_at >= now())
    AND EXISTS (SELECT 1 FROM merchants_rels mr WHERE mr.parent_id = m.id AND mr.path = 'serviceCities' AND mr.locations_id = b.city_id)
    AND NOT EXISTS (SELECT 1 FROM listing_reports rep WHERE rep.target_listing_id = l.id AND rep.supply_paused = true)
  ORDER BY l.id ASC LIMIT 1000
) q;
