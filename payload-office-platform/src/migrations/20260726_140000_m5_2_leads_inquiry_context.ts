import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * F5 前台询盘上下文字段迁移（specs/frontend-mvp/tasks/F5-inquiry.md 5.1）
 *
 * 给 leads 表添加 F5 咨询表单必需的字段：
 *   - idempotency_key：幂等键索引（重复请求只创建一条 Lead）
 *   - source_page_type：入口页面类型枚举
 *   - source_path / source_url：入口路径（白名单化）/ URL
 *   - target_type：目标对象类型枚举
 *   - target_listing_slug / target_building_slug：目标 slug
 *   - consent_accepted / consent_policy_version：隐私同意
 *   - campaign：活动归因 JSON
 *   - request_id：请求 ID（用于日志关联）
 *
 * design.md §10 / FP-05 §5：以 requestId + normalizedPhone + target 形成幂等键，
 * 并有数据库唯一约束。本迁移建唯一索引而非 NOT NULL 约束，
 * 兼容历史 Lead（迁移前已存在的 Lead 这些字段为 NULL）。
 *
 * 业务不变量：
 *   - idempotency_key 在新写入时必须非空且唯一；NULL 历史数据共存（PG 部分索引）
 *   - consent_accepted = true 才能写入新 Lead（API 层校验）
 *   - target_type = listing 时必须 target_listing_slug 非空（API 层校验）
 */
export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   -- ===== 枚举类型 =====
   CREATE TYPE "public"."enum_leads_source_page_type" AS ENUM('home', 'search', 'listing', 'building', 'content');
   CREATE TYPE "public"."enum_leads_target_type" AS ENUM('listing', 'building', 'none');

   -- ===== leads 扩展列 =====
   ALTER TABLE "leads" ADD COLUMN "idempotency_key" varchar;
   ALTER TABLE "leads" ADD COLUMN "source_page_type" "enum_leads_source_page_type";
   ALTER TABLE "leads" ADD COLUMN "source_path" varchar;
   ALTER TABLE "leads" ADD COLUMN "source_url" varchar;
   ALTER TABLE "leads" ADD COLUMN "target_type" "enum_leads_target_type";
   ALTER TABLE "leads" ADD COLUMN "target_listing_slug" varchar;
   ALTER TABLE "leads" ADD COLUMN "target_building_slug" varchar;
   ALTER TABLE "leads" ADD COLUMN "consent_accepted" boolean DEFAULT false;
   ALTER TABLE "leads" ADD COLUMN "consent_policy_version" varchar;
   ALTER TABLE "leads" ADD COLUMN "campaign" jsonb;
   ALTER TABLE "leads" ADD COLUMN "request_id" varchar;

   -- ===== 索引 =====
   -- 幂等键：部分唯一索引，仅对非 NULL 值生效，避免历史 NULL 数据冲突
   CREATE UNIQUE INDEX "leads_idempotency_key_uniq_idx" ON "leads" USING btree ("idempotency_key") WHERE "idempotency_key" IS NOT NULL;
   CREATE INDEX "leads_idempotency_key_idx" ON "leads" USING btree ("idempotency_key");
   CREATE INDEX "leads_source_page_type_idx" ON "leads" USING btree ("source_page_type");
   CREATE INDEX "leads_target_type_idx" ON "leads" USING btree ("target_type");
   CREATE INDEX "leads_request_id_idx" ON "leads" USING btree ("request_id");
  `)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP INDEX "leads_request_id_idx";
   DROP INDEX "leads_target_type_idx";
   DROP INDEX "leads_source_page_type_idx";
   DROP INDEX "leads_idempotency_key_idx";
   DROP INDEX "leads_idempotency_key_uniq_idx";

   ALTER TABLE "leads" DROP COLUMN "request_id";
   ALTER TABLE "leads" DROP COLUMN "campaign";
   ALTER TABLE "leads" DROP COLUMN "consent_policy_version";
   ALTER TABLE "leads" DROP COLUMN "consent_accepted";
   ALTER TABLE "leads" DROP COLUMN "target_building_slug";
   ALTER TABLE "leads" DROP COLUMN "target_listing_slug";
   ALTER TABLE "leads" DROP COLUMN "target_type";
   ALTER TABLE "leads" DROP COLUMN "source_url";
   ALTER TABLE "leads" DROP COLUMN "source_path";
   ALTER TABLE "leads" DROP COLUMN "source_page_type";
   ALTER TABLE "leads" DROP COLUMN "idempotency_key";

   DROP TYPE "public"."enum_leads_source_page_type";
   DROP TYPE "public"."enum_leads_target_type";
  `)
}
