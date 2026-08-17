import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * 出售模式（批次 3）：发布状态新增 `sold`（已售）。
 *
 * 与 `leased`（已租）并列的成交终态。分开而非复用 leased 的原因：一旦把售出记成
 * 「已租」，运营看板的成交口径、通知文案和后台筛选全部串味，且不可逆——事后无从
 * 分辨那笔到底是租还是卖。
 *
 * 同 `20260817_172754_sale_price_one_time`：只做 ENUM 加值，不含任何使用新值的
 * DML（PG 事务内不能使用刚加的 ENUM 值）。
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_listings_publication_status" ADD VALUE 'sold';`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  // PG 不支持从 ENUM 移除单个取值，只能重建类型。
  // 回滚前必须确保没有行仍是 'sold'，否则 USING 转换会失败。
  await db.execute(sql`
   ALTER TABLE "listings" ALTER COLUMN "publication_status" SET DATA TYPE text;
  ALTER TABLE "listings" ALTER COLUMN "publication_status" SET DEFAULT 'draft'::text;
  DROP TYPE "public"."enum_listings_publication_status";
  CREATE TYPE "public"."enum_listings_publication_status" AS ENUM('draft', 'published', 'unpublished', 'leased');
  ALTER TABLE "listings" ALTER COLUMN "publication_status" SET DEFAULT 'draft'::"public"."enum_listings_publication_status";
  ALTER TABLE "listings" ALTER COLUMN "publication_status" SET DATA TYPE "public"."enum_listings_publication_status" USING "publication_status"::"public"."enum_listings_publication_status";`)
}
