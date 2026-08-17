import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * 出售模式（批次 2）：business_type 残留 NULL 回填 + 公开查询部分索引。
 *
 * 两件事：
 *
 * 1) **回填残留 NULL**。`business_type` 加列时带 `DEFAULT 'lease'`，既有行已被
 *    回填；collection 也有 defaultValue。但字段当前非必填，理论上仍可经 Local API
 *    显式写入 NULL。有效供给谓词按 fail-closed 原则只用正向 `equals`（`not_equals`
 *    遇 NULL 返回 NULL 而非 true，会让行静默漏网），所以 NULL 行在租赁列表里会
 *    直接消失。与其在查询层绕开该原则，不如从数据层消除——批次 3 会把字段改必填，
 *    届时彻底闭环。
 *
 * 2) **公开查询部分索引**。照抄 `20260810_170000_public_page_performance_indexes.ts`
 *    的 WHERE 模式（published + approved + normal + 未删除），只索引前台可见行。
 *    租赁列表拿的是绝大多数行、走不走索引差别不大；出售列表是最差情况——从全部
 *    已发布房源里扫出那几套。当前数据量下用不上，但避免日后在生产 TencentDB 上
 *    临时补索引。
 *
 * 手写而非 `migrate:create` 生成：本次无 collection schema 变更，生成器检测不到；
 * 且该命令当前会把本地库与代码的 schema 漂移（19 个 DROP TABLE）一并写进迁移。
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   UPDATE "listings" SET "business_type" = 'lease' WHERE "business_type" IS NULL;

  CREATE INDEX IF NOT EXISTS "listings_public_business_type_idx"
  ON "listings" USING btree ("business_type", "id")
  WHERE
    "publication_status" = 'published'
    AND "review_status" = 'approved'
    AND "supply_visibility_hold" = 'normal'
    AND "deleted_at" IS NULL;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  // 只回滚索引。NULL 回填不可逆也不必逆：把 'lease' 改回 NULL 没有业务含义，
  // 且会重新引入谓词漏网问题。
  await db.execute(sql`
   DROP INDEX IF EXISTS "listings_public_business_type_idx";`)
}
