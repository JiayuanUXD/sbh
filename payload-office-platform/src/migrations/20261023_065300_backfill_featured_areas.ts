import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

import { planFeaturedAreasBackfill } from '../domain/geography/featured-areas-backfill'

/**
 * 精选区域回填：`city_site_profiles_rels(path='featuredRegions')` → `business_area_extensions.featured_order`。
 *
 * 只搬同城、启用、前台可见的商圈；行政区放弃；跳过项全部打日志供人工复核。
 * 用裸 SQL 而不是 payload.update：后者会触发文档锁检查（见 migration-order-document-lock 教训）。
 * 幂等：只给 `featured_order IS NULL` 的扩展赋值，已有值不覆盖；缺扩展行的商圈补建一行。
 *
 * **不删旧数据**：`city_site_profiles_rels` 原样保留，作为回滚退路；物理删除要等生产核对无误、
 * 并经用户批准后另开迁移（见 DESTRUCTIVE_MIGRATION_APPROVALS.json 的批准机制）。
 */
export async function up({ db, payload }: MigrateUpArgs): Promise<void> {
  const result = await db.execute(sql`
    SELECT p."city_id" AS profile_city_id,
           l."id" AS location_id,
           l."type" AS type,
           l."status" AS status,
           l."frontend_visible" AS frontend_visible,
           l."city_id" AS location_city_id
    FROM "city_site_profiles_rels" r
    JOIN "city_site_profiles" p ON p."id" = r."parent_id"
    JOIN "locations" l ON l."id" = r."locations_id"
    WHERE r."path" = 'featuredRegions'
    ORDER BY p."city_id" ASC, r."order" ASC, r."id" ASC;
  `)

  const rows = result.rows.map((r) => ({
    profileCityId: Number(r.profile_city_id),
    locationId: Number(r.location_id),
    type: String(r.type),
    status: String(r.status),
    frontendVisible: r.frontend_visible === true,
    locationCityId: r.location_city_id === null ? null : Number(r.location_city_id),
  }))
  const plan = planFeaturedAreasBackfill(rows)

  for (const { locationId, featuredOrder } of plan.assignments) {
    const updated = await db.execute(sql`
      UPDATE "business_area_extensions"
      SET "featured_order" = ${featuredOrder}
      WHERE "business_area_id" = ${locationId} AND "featured_order" IS NULL
      RETURNING "id";
    `)
    if (updated.rows.length > 0) continue
    // 没有扩展行（或已有值）：只在确实缺行时补建
    await db.execute(sql`
      INSERT INTO "business_area_extensions" ("business_area_id", "featured_order", "version")
      SELECT ${locationId}, ${featuredOrder}, 1
      WHERE NOT EXISTS (
        SELECT 1 FROM "business_area_extensions" WHERE "business_area_id" = ${locationId}
      );
    `)
  }

  payload.logger.info(
    `[backfill_featured_areas] 源 ${rows.length} 条，写入 ${plan.assignments.length} 条，跳过 ${plan.skipped.length} 条`,
  )
  for (const s of plan.skipped) {
    payload.logger.warn(`[backfill_featured_areas] 跳过 location=${s.locationId} 原因=${s.reason}`)
  }
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  // 旧数据未动，回滚只需清掉新字段里这次写入的值；紧随其后的 schema 迁移回滚会直接删列，
  // 这里无需额外处理。
  void db
}
