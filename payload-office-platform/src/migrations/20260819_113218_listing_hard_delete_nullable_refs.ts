import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * 房源永久删除修复：两张审计表的房源引用列改为可空。
 *
 * 病因：引用 listings 的外键都是 `ON DELETE SET NULL`，而这两列是 NOT NULL。
 * 删房源时 PG 试图置 NULL → 23502 not_null_violation → 后台只显示
 * "Something went wrong."（Payload 的兜底文案，真实报错仅在服务端 stdout）。
 *
 * 为什么是「脱钩」而不是「级联删除」：这两张表是审计记录，房源删了也该留着。
 * listing-reviews 自带 `snapshot`，脱钩后仍能看出当时审的是什么。
 * 第三张表 listing_merchant_relations 语义相反（纯关系表，房源没了就是垃圾行），
 * 由 `domain/supply/listing-delete-cleanup.ts` 的 beforeDelete hook 删除，
 * **不在本迁移内**——那里有为什么不用 ON DELETE CASCADE 的完整说明。
 *
 * 影响行数（2026-08-19 生产库实测）：
 *   listing_reviews.listing_id      3 行非空，本迁移不改数据、只放宽约束
 *   listing_reports.target_listing_id  0 行
 *
 * 回滚说明：`down` 会重新加上 NOT NULL。**若届时已有房源被永久删除**，
 * 这两列会存在 NULL 行，`SET NOT NULL` 将直接失败。回滚前需先决定这些
 * 脱钩审计记录的去留（删除或回填），不要指望 down 能无条件执行。
 */
export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "listing_reviews" ALTER COLUMN "listing_id" DROP NOT NULL;
  ALTER TABLE "listing_reports" ALTER COLUMN "target_listing_id" DROP NOT NULL;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "listing_reviews" ALTER COLUMN "listing_id" SET NOT NULL;
  ALTER TABLE "listing_reports" ALTER COLUMN "target_listing_id" SET NOT NULL;`)
}
