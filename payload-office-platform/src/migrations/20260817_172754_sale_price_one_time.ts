import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * 出售模式（批次 1）：结构化价格周期新增 `one-time`。
 *
 * `one-time` 表示一次性计价：配 `suite` 得出售总价，配 `sqm` 得出售单价。
 *
 * 本文件只做 ENUM 加值，**不含任何使用新值的 DML**。原因是 PostgreSQL 12+ 虽然
 * 允许在事务块内 `ALTER TYPE ... ADD VALUE`，但**同一事务内不能使用刚加的值**，
 * 而 Payload 迁移默认包在事务里。任何需要写入 `'one-time'` 的数据操作必须放到
 * 后续独立的迁移文件。仓库既有 5 次同形态先例（如
 * `20260809_142444_supply_submissions_and_entrust_source.ts`）。
 *
 * 注意：本文件是**手工收窄**的。`payload migrate:create` 生成的原始版本额外包含
 * 19 个 `DROP TABLE ... CASCADE`（roles_rels / listings_rels / audit_logs_rels 等）
 * 与 7 个表的 users_id 列删除——那是本地开发库与当前代码 schema 漂移的产物，与本
 * 次改动无关，跑到生产库会造成数据丢失。schema 漂移需要单独排查修复，不能由一次
 * ENUM 加值顺带携带。
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_listings_price_period" ADD VALUE 'one-time';`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  // PG 不支持从 ENUM 移除单个取值，只能重建类型。
  // 回滚前必须确保没有行仍持有 'one-time'，否则 USING 转换会失败。
  await db.execute(sql`
   ALTER TABLE "listings" ALTER COLUMN "price_period" SET DATA TYPE text;
  ALTER TABLE "listings" ALTER COLUMN "price_period" SET DEFAULT 'month'::text;
  DROP TYPE "public"."enum_listings_price_period";
  CREATE TYPE "public"."enum_listings_price_period" AS ENUM('month', 'day', 'year');
  ALTER TABLE "listings" ALTER COLUMN "price_period" SET DEFAULT 'month'::"public"."enum_listings_price_period";
  ALTER TABLE "listings" ALTER COLUMN "price_period" SET DATA TYPE "public"."enum_listings_price_period" USING "price_period"::"public"."enum_listings_price_period";`)
}
