import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * 免审直发：审核动作枚举新增 fast_track。
 *
 * 带 IF NOT EXISTS 是必需的，不是保险起见：PG 的 ENUM 加值**回滚不掉**——迁移中途
 * 失败后，已执行的 ADD VALUE 仍然生效但迁移记录没写，重跑会报「枚举标签已经存在」
 * 并卡死整条迁移链。生产上已经踩过一次（见 20260817_172754 / 20260817_180000）。
 */

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_listing_reviews_decision" ADD VALUE IF NOT EXISTS 'fast_track';`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "listing_reviews" ALTER COLUMN "decision" SET DATA TYPE text;
  DROP TYPE "public"."enum_listing_reviews_decision";
  CREATE TYPE "public"."enum_listing_reviews_decision" AS ENUM('submit', 'withdraw', 'approve', 'reject');
  ALTER TABLE "listing_reviews" ALTER COLUMN "decision" SET DATA TYPE "public"."enum_listing_reviews_decision" USING "decision"::"public"."enum_listing_reviews_decision";`)
}
