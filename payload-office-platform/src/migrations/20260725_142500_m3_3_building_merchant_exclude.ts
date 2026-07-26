import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * 楼盘-商户有效期关系区间排斥约束（tasks.md M3.3 / design §3.3 / R2, R3）
 *
 * 本迁移为**手写新迁移**，不是由 migrate:create 生成的正文——Payload 的 schema
 * 生成器不认识 EXCLUDE / gist / tstzrange，无法自动产出这段并发兜底 DDL，
 * 故按既定决策单独成文（区别于「生成迁移正文绝不手改」的约束）。
 *
 * 不变量：同一楼盘在任一时刻至多有一条有效供给关系。
 *   - [effective_from, effective_to) 半开区间语义，effective_to 为 NULL 表无限期
 *     → tstzrange 上界传 NULL 即为 +∞，'[)' 边界与应用层 findRelationOverlap 一致。
 *   - EXCLUDE USING gist (building_id WITH =, tstzrange(...) WITH &&)：
 *     同楼盘 && 区间相交即冲突，数据库层面拒绝并发写入穿透。
 *
 * SQLite 无此能力，仅靠 protect hook 事务内 findRelationOverlap 兜底；
 * 生产 PostgreSQL 用本约束覆盖并发竞态（两请求同时通过应用层校验的窗口）。
 *
 * gist 对标量列（building_id integer）做等值排斥需要 btree_gist 扩展。
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE EXTENSION IF NOT EXISTS btree_gist;
    ALTER TABLE "building_merchant_relations"
      ADD CONSTRAINT "building_merchant_relations_no_overlap"
      EXCLUDE USING gist (
        "building_id" WITH =,
        tstzrange("effective_from", "effective_to", '[)') WITH &&
      );
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "building_merchant_relations"
      DROP CONSTRAINT IF EXISTS "building_merchant_relations_no_overlap";
  `)
}
