import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * 房源-商户有效期关系区间排斥约束（tasks.md M4.2 / design §3.3 / R2, R4）
 *
 * 本迁移为**手写新迁移**，不是由 migrate:create 生成的正文——Payload 的 schema
 * 生成器不认识 EXCLUDE / gist / tstzrange，无法自动产出这段并发兜底 DDL，
 * 故按既定决策单独成文（区别于「生成迁移正文绝不手改」的约束）。
 * 与 building_merchant_relations_no_overlap 同构（见 M3.3 exclude 迁移）。
 *
 * 不变量：同一房源在任一时刻至多有一条有效供给关系。
 *   - [effective_from, effective_to) 半开区间语义，effective_to 为 NULL 表无限期
 *     → tstzrange 上界传 NULL 即为 +∞，'[)' 边界与应用层 findListingRelationOverlap 一致。
 *   - EXCLUDE USING gist (listing_id WITH =, tstzrange(...) WITH &&)：
 *     同房源 && 区间相交即冲突，数据库层面拒绝并发写入穿透。
 *
 * SQLite 无此能力，仅靠 protect hook 事务内 findListingRelationOverlap 兜底；
 * 生产 PostgreSQL 用本约束覆盖并发竞态（两请求同时通过应用层校验的窗口）。
 *
 * gist 对标量列（listing_id integer）做等值排斥需要 btree_gist 扩展
 * （M3.3 迁移已 CREATE EXTENSION IF NOT EXISTS，此处再次幂等声明以防单独回滚）。
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE EXTENSION IF NOT EXISTS btree_gist;
    ALTER TABLE "listing_merchant_relations"
      ADD CONSTRAINT "listing_merchant_relations_no_overlap"
      EXCLUDE USING gist (
        "listing_id" WITH =,
        tstzrange("effective_from", "effective_to", '[)') WITH &&
      );
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "listing_merchant_relations"
      DROP CONSTRAINT IF EXISTS "listing_merchant_relations_no_overlap";
  `)
}
