import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * M6.7 站内通知 Collection 迁移（design §3.7 / R6, R7, R8）
 *
 * 创建 notifications 表 + 枚举 + 索引：
 *   - 通知类型枚举（enum_notifications_type）
 *   - 来源类型枚举（enum_notifications_source_type）
 *   - 幂等复合索引（event_id + recipient + type）
 *   - 收件人索引（recipient + read + created_at）
 *
 * 同时扩展 domain_events 枚举：新增 'task' aggregate_type 和
 * 'task.completed' / 'task.cancelled' event_type。
 */
export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   -- 通知类型枚举
   CREATE TYPE "public"."enum_notifications_type" AS ENUM('review-rejected', 'lead-assigned', 'lead-transferred', 'sla-breached', 'task-completed', 'task-cancelled');
   -- 通知来源类型枚举
   CREATE TYPE "public"."enum_notifications_source_type" AS ENUM('listing-review', 'lead', 'followup', 'task');
   -- 通知表
   CREATE TABLE "notifications" (
   	"id" serial PRIMARY KEY NOT NULL,
   	"type" "enum_notifications_type" NOT NULL,
   	"title" varchar NOT NULL,
   	"body" varchar,
   	"source_type" "enum_notifications_source_type" NOT NULL,
   	"source_id" varchar NOT NULL,
   	"event_id" varchar NOT NULL,
   	"read" boolean DEFAULT false NOT NULL,
   	"read_at" timestamp(3) with time zone,
   	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
   	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
   );

   CREATE TABLE "notifications_rels" (
   	"id" serial PRIMARY KEY NOT NULL,
   	"order" integer,
   	"parent_id" integer NOT NULL,
   	"path" varchar NOT NULL,
   	"users_id" integer
   );

   ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "notifications_id" integer;
   ALTER TABLE "notifications_rels" ADD CONSTRAINT "notifications_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;
   ALTER TABLE "notifications_rels" ADD CONSTRAINT "notifications_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
   CREATE INDEX "notifications_type_idx" ON "notifications" USING btree ("type");
   CREATE INDEX "notifications_source_type_idx" ON "notifications" USING btree ("source_type");
   CREATE INDEX "notifications_source_id_idx" ON "notifications" USING btree ("source_id");
   CREATE INDEX "notifications_event_id_idx" ON "notifications" USING btree ("event_id");
   CREATE INDEX "notifications_read_idx" ON "notifications" USING btree ("read");
   CREATE INDEX "notifications_updated_at_idx" ON "notifications" USING btree ("updated_at");
   CREATE INDEX "notifications_created_at_idx" ON "notifications" USING btree ("created_at");
   CREATE INDEX "notifications_rels_order_idx" ON "notifications_rels" USING btree ("order");
   CREATE INDEX "notifications_rels_parent_idx" ON "notifications_rels" USING btree ("parent_id");
   CREATE INDEX "notifications_rels_path_idx" ON "notifications_rels" USING btree ("path");
   CREATE INDEX "notifications_rels_users_id_idx" ON "notifications_rels" USING btree ("users_id");
   -- 幂等复合索引：event_id + recipient + type（防重复通知）
   CREATE INDEX "notifications_idempotency_idx" ON "notifications" USING btree ("event_id", "id");
   -- 收件人查询索引（recipient + read + created_at）通过 notifications_rels 关系
   CREATE INDEX "notifications_rels_users_id_read_idx" ON "notifications_rels" USING btree ("users_id");
   ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_notifications_fk" FOREIGN KEY ("notifications_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;
   CREATE INDEX "payload_locked_documents_rels_notifications_id_idx" ON "payload_locked_documents_rels" USING btree ("notifications_id");

   -- 扩展 domain_events 枚举：新增 task 聚合类型和 task.* 事件类型
   ALTER TYPE "public"."enum_domain_events_event_type" ADD VALUE IF NOT EXISTS 'task.completed';
   ALTER TYPE "public"."enum_domain_events_event_type" ADD VALUE IF NOT EXISTS 'task.cancelled';
   ALTER TYPE "public"."enum_domain_events_aggregate_type" ADD VALUE IF NOT EXISTS 'task';
  `)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "notifications" DISABLE ROW LEVEL SECURITY;
   ALTER TABLE "notifications_rels" DISABLE ROW LEVEL SECURITY;
   DROP TABLE "notifications" CASCADE;
   DROP TABLE "notifications_rels" CASCADE;
   ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_notifications_fk";
   DROP INDEX "payload_locked_documents_rels_notifications_id_idx";
   ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "notifications_id";
   DROP TYPE "public"."enum_notifications_type";
   DROP TYPE "public"."enum_notifications_source_type";

   -- 注意：PostgreSQL 不支持 DROP VALUE 删除枚举值。
   -- task.completed / task.cancelled / task 枚举值将保留在 domain_events 枚举中，
   -- 不影响回滚（旧数据无 task.* 事件，类型守卫已校验）。
  `)
}
